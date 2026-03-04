/**
 * PrintManager.js — Módulo de impresión silenciosa para Electron Main Process
 * 
 * Responsabilidades:
 *  1. Registrar handlers IPC para impresión
 *  2. Cola secuencial de jobs (anti-bloqueo)
 *  3. BrowserWindow oculta por job → webContents.print({ silent: true })
 *  4. Detección dinámica de impresora (isDefault → status:0 → primera)
 *  5. Timeout de seguridad (25s) por job + delay de spooler (5s)
 */

const { BrowserWindow, ipcMain } = require('electron');

// ── DEBUG FLAG ───────────────────────────────────────────────────────────
// Poner en true para mantener la BrowserWindow viva tras imprimir.
// Esto permite verificar si el destroy() prematuro es el que corta el GDI.
// Establecer via variable de entorno: DEBUG_KEEP_WINDOW_ALIVE=true
const DEBUG_KEEP_WINDOW_ALIVE = process.env.DEBUG_KEEP_WINDOW_ALIVE === 'true';

// ── Print Queue ──────────────────────────────────────────────────────────
// Cadena de promesas: cada job espera a que termine el anterior.
// Esto previene que imprimir varios tickets rápido sature el spooler.
let printChain = Promise.resolve();

/**
 * Ejecuta un trabajo de impresión individual.
 * Crea una BrowserWindow oculta, carga el HTML, imprime, destruye.
 * @param {string} htmlContent - HTML renderizable del ticket
 * @param {object} printerConfig - { deviceName?: string, pageWidth?: number (micrones) }
 */
async function executePrintJob(htmlContent, printerConfig = {}) {
    const JOB_TIMEOUT_MS = 25_000; // 25s — margen extra para ticketeras lentas por USB serial

    let printWindow = null;

    try {
        const result = await Promise.race([
            // ── Job principal ──
            (async () => {
                printWindow = new BrowserWindow({
                    show: false,
                    width: 226,       // ~58mm @ 96dpi
                    height: 1200,     // Más altura para tickets con dos copias (page-break)
                    webPreferences: {
                        javascript: false, // No necesitamos JS en el ticket
                        zoomFactor: 1.0,   // Previene distorsión por escalado de Windows (125%, 150%)
                    }
                });

                // Forzar DPI 1:1 para evitar que el escalado del sistema afecte el viewport
                printWindow.webContents.setZoomFactor(1.0);

                // Cargar HTML del ticket
                const encodedHtml = encodeURIComponent(htmlContent);
                await printWindow.loadURL(`data:text/html;charset=utf-8,${encodedHtml}`);

                // Espera para renderizado completo de imágenes/barcodes base64
                await new Promise(resolve => setTimeout(resolve, 800));

                // ── Resolución de impresora ──
                let printerName = '(default del sistema)';
                let useDeviceName = undefined; // si se define, fuerza deviceName en print()

                // Prioridad 1: Configuración manual del usuario (desde UI Config)
                if (printerConfig.deviceName) {
                    useDeviceName = printerConfig.deviceName;
                    printerName = printerConfig.deviceName;
                    console.log(`🎯 [PrintManager] Usando impresora CONFIGURADA por usuario: "${useDeviceName}"`);

                    // Verificar que la impresora configurada todavía existe en el sistema
                    try {
                        const printers = await printWindow.webContents.getPrintersAsync();
                        console.log(`📋 [PrintManager] === IMPRESORAS DETECTADAS (${printers.length}) ===`);
                        printers.forEach((p, i) => {
                            console.log(`   [${i}] "${p.name}" | isDefault: ${p.isDefault} | status: ${p.status}`);
                        });
                        console.log(`📋 [PrintManager] ==========================================`);

                        const exists = printers.some(p => p.name === useDeviceName);
                        if (!exists) {
                            console.warn(`⚠️ [PrintManager] ¡ALERTA! Impresora configurada "${useDeviceName}" NO encontrada en el sistema. Se usará fallback del OS.`);
                            useDeviceName = undefined; // dejar que el OS elija
                        }
                    } catch (err) {
                        console.warn(`⚠️ [PrintManager] No se pudo verificar existencia de impresora: ${err.message}`);
                    }
                } else {
                    // Prioridad 2: Sin config → log diagnóstico y dejar que el OS decida
                    try {
                        const printers = await printWindow.webContents.getPrintersAsync();
                        console.log(`📋 [PrintManager] Sin config manual. === IMPRESORAS DETECTADAS (${printers.length}) ===`);
                        printers.forEach((p, i) => {
                            console.log(`   [${i}] "${p.name}" | isDefault: ${p.isDefault} | status: ${p.status}`);
                        });
                        console.log(`📋 [PrintManager] Se usará la impresora default del OS.`);
                    } catch (err) {
                        console.warn(`⚠️ [PrintManager] Error al listar impresoras: ${err.message}`);
                    }
                }

                // ── Construir opciones de impresión ──
                // No se fuerza pageSize: se deja que el CSS @page { size: 58mm auto }
                // del HTML defina las dimensiones, compatible con rollo continuo.
                const printOptions = {
                    silent: true,
                    printBackground: true,
                    margins: { marginType: 'none' },
                };
                // Solo forzar deviceName si hay una impresora configurada y verificada
                if (useDeviceName) {
                    printOptions.deviceName = useDeviceName;
                }

                // ── Imprimir ──
                console.log(`📄 [PrintManager] Enviando a "${useDeviceName || 'OS default'}"...`);
                return new Promise((resolve) => {
                    printWindow.webContents.print(
                        printOptions,
                        (success, failureReason) => {
                            if (success) {
                                console.log(`✅ [PrintManager] Callback success recibido. Esperando 5s para vaciado de buffer del spooler...`);
                                // ── Delay de sincronización con spooler (5000ms) ──
                                // Las ticketeras térmicas necesitan tiempo para que el
                                // spooler de Windows termine de vaciar el buffer GDI
                                // hacia el puerto USB/Serial del dispositivo físico.
                                // Sin este delay, destroy() corta el stream prematuramente.
                                setTimeout(() => {
                                    console.log(`✅ [PrintManager] Delay de spooler completado. Liberando job.`);
                                    resolve({ success: true });
                                }, 5000);
                            } else {
                                console.error(`❌ [PrintManager] Impresión fallida en "${printerName}": ${failureReason}`);
                                setTimeout(() => resolve({
                                    success: false,
                                    error: failureReason || 'Error desconocido de impresión'
                                }), 1000);
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
        // ── Limpieza de memoria ──
        if (DEBUG_KEEP_WINDOW_ALIVE) {
            console.log(`🔧 [PrintManager] DEBUG: Keep-alive activo → la BrowserWindow NO será destruida.`);
            console.log(`🔧 [PrintManager] DEBUG: Si el ticket sale completo, el destroy() prematuro ES la causa raíz.`);
        } else if (printWindow && !printWindow.isDestroyed()) {
            printWindow.destroy();
            printWindow = null;
        }
    }
}

/**
 * Encola un trabajo de impresión en la cola secuencial.
 * Cada job espera a que termine el anterior antes de ejecutarse.
 */
function enqueuePrint(htmlContent, printerConfig = {}) {
    return new Promise((resolve) => {
        printChain = printChain
            .then(() => executePrintJob(htmlContent, printerConfig))
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
    console.log('🖨️ [PrintManager] Inicializando módulo de impresión silenciosa (Default OS)...');

    // ── Canal principal: impresión silenciosa ──
    ipcMain.handle('print:silent', async (_event, htmlContent, printerConfig) => {
        if (!htmlContent || typeof htmlContent !== 'string') {
            return { success: false, error: 'HTML de ticket inválido o vacío' };
        }
        const config = printerConfig || {};
        console.log(`🖨️ [PrintManager] Job encolado (${Math.round(htmlContent.length / 1024)}KB) | device: "${config.deviceName || 'OS default'}" | width: ${config.pageWidth ? (config.pageWidth / 1000) + 'mm' : 'auto'}`);
        return enqueuePrint(htmlContent, config);
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
