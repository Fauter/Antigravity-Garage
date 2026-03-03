/**
 * PrintManager.js — Módulo de impresión silenciosa para Electron Main Process
 * 
 * Responsabilidades:
 *  1. Registrar handlers IPC para impresión
 *  2. Cola secuencial de jobs (anti-bloqueo)
 *  3. BrowserWindow oculta por job → webContents.print({ silent: true })
 *  4. Cache de impresora por defecto (60s)
 *  5. Timeout de seguridad (15s) por job
 */

const { BrowserWindow, ipcMain } = require('electron');

// ── Print Queue ──────────────────────────────────────────────────────────
// Cadena de promesas: cada job espera a que termine el anterior.
// Esto previene que imprimir varios tickets rápido sature el spooler.
let printChain = Promise.resolve();

// ── Printer Cache ────────────────────────────────────────────────────────
let cachedPrinterName = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 segundos

/**
 * Obtiene la impresora por defecto del sistema.
 * Usa cache de 60s para no consultar en cada ticket.
 * Fallback: si la cacheada ya no existe, refresca.
 */
async function getDefaultPrinterName() {
    const now = Date.now();

    if (cachedPrinterName && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return cachedPrinterName;
    }

    try {
        const tmpWin = new BrowserWindow({ show: false, width: 1, height: 1 });
        const printers = await tmpWin.webContents.getPrintersAsync();
        tmpWin.destroy();

        if (!printers || printers.length === 0) {
            console.warn('⚠️ [PrintManager] No se detectaron impresoras.');
            return null;
        }

        // 1. Intentar encontrar la marcada como Default por el sistema
        let selected = printers.find(p => p.isDefault);

        // 2. Si falla (como ahora), buscar por nombre específico (Fallback de seguridad)
        if (!selected) {
            console.log("🔍 [PrintManager] Falló isDefault, buscando 'Microsoft Print to PDF'...");
            selected = printers.find(p => p.name.includes("Print to PDF"));
        }

        // 3. Si sigue fallando, tomar la primera de la lista
        if (!selected) {
            selected = printers[0];
        }

        cachedPrinterName = selected.name;
        cacheTimestamp = now;

        console.log(`🖨️ [PrintManager] Impresora seleccionada: "${cachedPrinterName}" (Detección: ${selected.isDefault ? 'SISTEMA' : 'NOMBRE/LISTA'})`);
        return cachedPrinterName;
    } catch (err) {
        console.error('❌ [PrintManager] Error al obtener impresoras:', err);
        return cachedPrinterName;
    }
}

/**
 * Invalida la cache de impresora para forzar re-detección.
 */
function invalidatePrinterCache() {
    cachedPrinterName = null;
    cacheTimestamp = 0;
}

/**
 * Ejecuta un trabajo de impresión individual.
 * Crea una BrowserWindow oculta, carga el HTML, imprime, destruye.
 */
async function executePrintJob(htmlContent) {
    const JOB_TIMEOUT_MS = 15_000; // 15 segundos máximo por job

    // Obtener impresora
    const deviceName = await getDefaultPrinterName();
    if (!deviceName) {
        return { success: false, error: 'No se detectó ninguna impresora en el sistema.' };
    }

    let printWindow = null;

    try {
        const result = await Promise.race([
            // ── Job principal ──
            (async () => {
                printWindow = new BrowserWindow({
                    show: false,
                    width: 226,   // ~58mm @ 96dpi
                    height: 800,
                    webPreferences: {
                        offscreen: true,
                        javascript: false, // No necesitamos JS en el ticket
                    }
                });

                // Cargar HTML del ticket
                const encodedHtml = encodeURIComponent(htmlContent);
                await printWindow.loadURL(`data:text/html;charset=utf-8,${encodedHtml}`);

                // Pequeña espera adicional para renderizado de imágenes/barcodes base64
                await new Promise(resolve => setTimeout(resolve, 300));

                // Imprimir silenciosamente
                return new Promise((resolve) => {
                    printWindow.webContents.print(
                        {
                            silent: true,
                            printBackground: true,
                            deviceName: deviceName,
                            margins: { marginType: 'none' },
                        },
                        (success, failureReason) => {
                            if (success) {
                                resolve({ success: true });
                            } else {
                                // Si falla con la impresora cacheada, invalidar cache
                                invalidatePrinterCache();
                                resolve({
                                    success: false,
                                    error: failureReason || 'Error desconocido de impresión'
                                });
                            }
                        }
                    );
                });
            })(),

            // ── Timeout de seguridad ──
            new Promise((resolve) => {
                setTimeout(() => {
                    resolve({ success: false, error: `Timeout: la impresión tardó más de ${JOB_TIMEOUT_MS / 1000}s` });
                }, JOB_TIMEOUT_MS);
            })
        ]);

        return result;
    } catch (err) {
        console.error('❌ [PrintManager] Error en job de impresión:', err);
        return { success: false, error: String(err.message || err) };
    } finally {
        // ── Limpieza de memoria: SIEMPRE destruir la ventana ──
        if (printWindow && !printWindow.isDestroyed()) {
            printWindow.destroy();
            printWindow = null;
        }
    }
}

/**
 * Encola un trabajo de impresión en la cola secuencial.
 * Cada job espera a que termine el anterior antes de ejecutarse.
 */
function enqueuePrint(htmlContent) {
    return new Promise((resolve) => {
        printChain = printChain
            .then(() => executePrintJob(htmlContent))
            .then((result) => resolve(result))
            .catch((err) => {
                console.error('❌ [PrintManager] Error inesperado en cola:', err);
                resolve({ success: false, error: 'Error interno de la cola de impresión' });
            });
    });
}

/**
 * Inicializa los handlers IPC del PrintManager.
 * Llamar una vez después de que la app esté lista.
 */
function initPrintManager() {
    console.log('🖨️ [PrintManager] Inicializando módulo de impresión silenciosa...');

    // ── Canal principal: impresión silenciosa ──
    ipcMain.handle('print:silent', async (_event, htmlContent) => {
        if (!htmlContent || typeof htmlContent !== 'string') {
            return { success: false, error: 'HTML de ticket inválido o vacío' };
        }
        console.log(`🖨️ [PrintManager] Job encolado (${Math.round(htmlContent.length / 1024)}KB)`);
        return enqueuePrint(htmlContent);
    });

    // ── Canal auxiliar: listar impresoras ──
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

    console.log('✅ [PrintManager] Handlers IPC registrados: print:silent, print:get-printers');
}

module.exports = { initPrintManager };
