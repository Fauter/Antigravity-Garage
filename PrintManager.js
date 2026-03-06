/**
 * PrintManager.js — Módulo de impresión silenciosa para Electron Main Process
 * 
 * Responsabilidades:
 *  1. Registrar handlers IPC para impresión
 *  2. Cola secuencial de jobs (anti-bloqueo)
 *  3. BrowserWindow oculta por job → webContents.print({ silent: true })
 *  4. Detección dinámica de impresora + POS-58 auto-detect
 *  5. Timeout de seguridad (25s) por job + delay de spooler (5s)
 */

const { BrowserWindow, ipcMain } = require('electron');

// ── Print Queue ──────────────────────────────────────────────────────────
let printChain = Promise.resolve();

/**
 * Detecta si el nombre de impresora corresponde a una térmica POS-58.
 */
function isPOS58Printer(deviceName) {
    if (!deviceName) return false;
    const n = deviceName.toLowerCase();
    return n.includes('pos') || n.includes('58') || n.includes('thermal') || n.includes('termica');
}

/**
 * Ejecuta un trabajo de impresión individual.
 */
async function executePrintJob(htmlContent, printerConfig = {}) {
    const JOB_TIMEOUT_MS = 25_000;
    let printWindow = null;

    try {
        const result = await Promise.race([
            (async () => {
                printWindow = new BrowserWindow({
                    show: false,
                    width: 226,
                    height: 1200,
                    webPreferences: {
                        javascript: true,
                        zoomFactor: 1.0,
                    }
                });

                printWindow.webContents.setZoomFactor(1.0);

                // Capturar errores críticos del render process
                printWindow.webContents.on('did-fail-load', (_e, code, desc) => {
                    console.error(`❌ [PrintManager] did-fail-load: ${code} — ${desc}`);
                });
                printWindow.webContents.on('render-process-gone', (_e, details) => {
                    console.error(`❌ [PrintManager] render-process-gone: ${details.reason}`);
                });

                // Cargar HTML
                const encodedHtml = encodeURIComponent(htmlContent);
                await printWindow.loadURL(`data:text/html;charset=utf-8,${encodedHtml}`);

                // Esperar DOM + imágenes (barcodes base64)
                await printWindow.webContents.executeJavaScript(`
                    new Promise((resolve) => {
                        if (document.readyState === 'complete' || document.readyState === 'interactive') {
                            const images = Array.from(document.querySelectorAll('img'));
                            if (images.length === 0) { resolve(true); return; }
                            let done = 0;
                            const total = images.length;
                            const check = () => { if (++done >= total) resolve(true); };
                            images.forEach(img => {
                                if (img.complete) { check(); }
                                else { img.onload = check; img.onerror = check; }
                            });
                            setTimeout(() => resolve(true), 3000);
                        } else {
                            document.addEventListener('DOMContentLoaded', () => {
                                setTimeout(() => resolve(true), 200);
                            });
                        }
                    });
                `);

                // Delay de rasterización para composite de barcodes
                await new Promise(resolve => setTimeout(resolve, 1200));

                // ── Resolución de impresora ──
                let useDeviceName = undefined;
                let detectedPOS58 = false;

                if (printerConfig.deviceName) {
                    useDeviceName = printerConfig.deviceName;
                    detectedPOS58 = isPOS58Printer(useDeviceName);

                    try {
                        const printers = await printWindow.webContents.getPrintersAsync();
                        const exists = printers.some(p => p.name === useDeviceName);
                        if (!exists) {
                            console.warn(`⚠️ [PrintManager] Impresora "${useDeviceName}" no encontrada. Usando OS default.`);
                            useDeviceName = undefined;
                            const pos58 = printers.find(p => isPOS58Printer(p.name));
                            if (pos58) detectedPOS58 = true;
                        }
                    } catch (err) {
                        console.warn(`⚠️ [PrintManager] Error verificando impresora: ${err.message}`);
                    }
                } else {
                    try {
                        const printers = await printWindow.webContents.getPrintersAsync();
                        const def = printers.find(p => p.isDefault);
                        if (def && isPOS58Printer(def.name)) detectedPOS58 = true;
                    } catch (_) { /* silenciar */ }
                }

                // ── Opciones de impresión ──
                const printOptions = {
                    silent: true,
                    printBackground: true,
                    margins: { marginType: 'none' },
                };

                if (useDeviceName) {
                    printOptions.deviceName = useDeviceName;
                }

                // Dimensiones forzadas para POS-58 (evita mapeo a A4)
                if (detectedPOS58) {
                    printOptions.pageSize = {
                        width: 58000,
                        height: 300000,
                    };
                }

                // ── Imprimir ──
                console.log(`🖨️ [PrintManager] Enviando a "${useDeviceName || 'OS default'}"...`);

                return new Promise((resolve) => {
                    printWindow.webContents.print(
                        printOptions,
                        (success, failureReason) => {
                            if (success) {
                                const SPOOLER_DELAY = detectedPOS58 ? 7000 : 5000;
                                setTimeout(() => {
                                    resolve({ success: true });
                                }, SPOOLER_DELAY);
                            } else {
                                console.error(`❌ [PrintManager] Impresión fallida: ${failureReason}`);
                                setTimeout(() => resolve({
                                    success: false,
                                    error: failureReason || 'Error desconocido de impresión'
                                }), 1000);
                            }
                        }
                    );
                });
            })(),

            // Timeout de seguridad
            new Promise((resolve) => {
                setTimeout(() => {
                    resolve({ success: false, error: `Timeout: impresión tardó más de ${JOB_TIMEOUT_MS / 1000}s` });
                }, JOB_TIMEOUT_MS);
            })
        ]);

        return result;
    } catch (err) {
        console.error('❌ [PrintManager] Error en job:', err);
        return { success: false, error: String(err.message || err) };
    } finally {
        if (printWindow && !printWindow.isDestroyed()) {
            printWindow.destroy();
            printWindow = null;
        }
    }
}

/**
 * Encola un trabajo de impresión en la cola secuencial.
 */
function enqueuePrint(htmlContent, printerConfig = {}) {
    return new Promise((resolve) => {
        printChain = printChain
            .then(() => executePrintJob(htmlContent, printerConfig))
            .then((result) => resolve(result))
            .catch((err) => {
                console.error('❌ [PrintManager] Error en cola:', err);
                resolve({ success: false, error: 'Error interno de la cola de impresión' });
            });
    });
}

/**
 * Inicializa los handlers IPC del PrintManager.
 */
function initPrintManager() {
    console.log('🖨️ [PrintManager] Inicializando módulo de impresión silenciosa...');

    ipcMain.handle('print:silent', async (_event, htmlContent, printerConfig) => {
        if (!htmlContent || typeof htmlContent !== 'string') {
            return { success: false, error: 'HTML de ticket inválido o vacío' };
        }
        return enqueuePrint(htmlContent, printerConfig || {});
    });

    ipcMain.handle('print:get-printers', async () => {
        try {
            const tmpWin = new BrowserWindow({ show: false, width: 1, height: 1 });
            const printers = await tmpWin.webContents.getPrintersAsync();
            tmpWin.destroy();
            return printers.map(p => ({
                name: p.name,
                isDefault: p.isDefault,
                status: p.status,
            }));
        } catch (err) {
            console.error('❌ [PrintManager] Error al listar impresoras:', err);
            return [];
        }
    });

    console.log('✅ [PrintManager] Handlers IPC registrados.');
}

module.exports = { initPrintManager };
