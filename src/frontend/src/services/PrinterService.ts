
import { toast } from 'sonner';
import JsBarcode from 'jsbarcode';

// Helper to resolve garage config
const getGarageConfig = () => {
    try {
        const stored = localStorage.getItem('ag_terminal_config');
        if (stored) return JSON.parse(stored);
    } catch (e) {
        console.error('Error reading terminal config for printer', e);
    }
    return { name: 'ANTIGRAVITY GARAGE', address: 'Dirección no configurada' };
};

export const PrinterService = {
    generateBase64Barcode: (text: string): string => {
        try {
            const canvas = document.createElement('canvas');
            JsBarcode(canvas, text, {
                format: "CODE128",
                displayValue: false,
                height: 40,
                width: 2,
                margin: 5,
                background: "#ffffff",
                lineColor: "#000000"
            });
            return canvas.toDataURL('image/png');
        } catch (error) {
            console.error('Error generating barcode', error);
            return '';
        }
    },

    printEntryTicket: (stay: any) => {
        const config = getGarageConfig();
        const shortId = stay.id ? stay.id.slice(0, 8).toUpperCase() : 'UNKNOWN';
        const entryTime = new Date(stay.entryTime || stay.entry_time || Date.now());
        const formattedDate = entryTime.toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const barcodeDataUrl = PrinterService.generateBase64Barcode(shortId);

        const content = `
            <div style="font-family: 'Courier New', Courier, monospace; width: 58mm; margin: 0 auto; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 10px; margin-top: 10px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: 900; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 11px;">Ticket: <b>${shortId}</b></div>
                </div>

                ${barcodeDataUrl ? `
                <div style="margin: 10px 0;">
                    <img src="${barcodeDataUrl}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                </div>
                ` : ''}

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin: 10px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.4; font-family: 'Courier New', Courier, monospace;">
                        <tr>
                            <td style="text-align: left;">Ingreso:</td>
                            <td style="text-align: right; font-weight: bold;">${formattedDate}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Tipo:</td>
                            <td style="text-align: right; font-weight: bold;">${stay.vehicleType || 'Auto'}</td>
                        </tr>
                    </table>
                </div>

                <div style="margin: 15px 0;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: 900; letter-spacing: 1px;">${stay.plate}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 10px;">
                    <div>Conserve este ticket para retirar su vehículo.</div>
                    <div>La empresa no se responsabiliza por objetos</div>
                    <div>dejados en el interior del mismo.</div>
                    <div style="font-weight: bold; margin-top: 5px;">¡Gracias por su visita!</div>
                </div>
                
                <div style="font-size: 10px; font-weight: bold; margin-top: 10px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 30px;"></div>
            </div>
        `;
        printHtml(content);
        toast.info(`🖨️ Imprimiendo Ticket Entrada: ${stay.plate}`);
    },

    printExitTicket: (stay: any, movement: any) => {
        const config = getGarageConfig();
        const shortId = stay.id ? stay.id.slice(0, 8).toUpperCase() : 'UNKNOWN';
        const isSubscriber = stay.isSubscriber || stay.is_subscriber || (movement && movement.amount === 0 && movement.notes?.includes('Abonado'));
        const ticketType = isSubscriber ? 'SALIDA - ABONADO' : 'TICKET SALIDA';

        const barcodeDataUrl = PrinterService.generateBase64Barcode(shortId);

        const entryTime = new Date(stay.entryTime || stay.entry_time);
        const exitTime = new Date(stay.exitTime || stay.exit_time || Date.now());
        const formattedEntry = entryTime.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const formattedExit = exitTime.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const duration = (movement && movement.notes) ? movement.notes : 'N/A';
        const totalAmount = movement ? Math.floor(movement.amount || 0) : 0;
        const paymentMethod = movement ? movement.paymentMethod : 'N/A';
        const operatorName = movement ? (movement.operator || 'Sys') : 'Sys';

        const generateTicket = (title: string, showTotal: boolean = true) => `
            <div style="font-family: 'Courier New', Courier, monospace; width: 58mm; margin: 0 auto; color: #000; padding: 0; text-align: center; page-break-after: always;">
                
                <div style="margin-bottom: 10px; margin-top: 10px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: 900; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 11px;">Ticket: <b>${shortId}</b></div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 3px;">${title}</div>
                </div>

                ${barcodeDataUrl ? `
                <div style="margin: 10px 0;">
                    <img src="${barcodeDataUrl}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                </div>
                ` : ''}

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin: 10px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.4; font-family: 'Courier New', Courier, monospace;">
                        <tr>
                            <td style="text-align: left;">Ingreso:</td>
                            <td style="text-align: right; font-weight: bold;">${formattedEntry}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Salida:</td>
                            <td style="text-align: right; font-weight: bold;">${formattedExit}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Duración:</td>
                            <td style="text-align: right; font-weight: bold;">${duration}</td>
                        </tr>
                    </table>
                </div>

                <div style="margin: 15px 0;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: 900; letter-spacing: 1px;">${stay.plate}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                ${showTotal ? `
                <div style="margin: 15px 0;">
                    <div style="font-size: 14px; font-weight: bold;">TOTAL</div>
                    <div style="font-size: 32px; font-weight: 900; letter-spacing: -1px;">$${totalAmount}</div>
                </div>
                
                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <table style="width: 100%; font-size: 11px; line-height: 1.3; font-family: 'Courier New', Courier, monospace;">
                    <tr>
                        <td style="text-align: left;">Medio de Pago:</td>
                        <td style="text-align: right; font-weight: bold;">${paymentMethod}</td>
                    </tr>
                    <tr>
                        <td style="text-align: left;">Operador:</td>
                        <td style="text-align: right; font-weight: bold;">${operatorName.substring(0, 15)}</td>
                    </tr>
                </table>
                ` : ''}

                <div style="font-size: 10px; line-height: 1.3; margin-top: 15px;">
                    <div>¡Gracias por su visita!</div>
                </div>
                
                <div style="font-size: 10px; font-weight: bold; margin-top: 10px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 30px;"></div>
            </div>
        `;

        const clientTicket = generateTicket(ticketType, true);
        const controlTicket = generateTicket(ticketType === 'SALIDA - ABONADO' ? 'CONTROL - ABONADO' : 'CONTROL INTERNO', true);

        // Print both sequentially
        printHtml(clientTicket + controlTicket);

        toast.info(`🖨️ Imprimiendo Tickets Salida (x2): ${stay.plate}`);
    },

    printSubscriptionTicket: (data: any) => {
        const config = getGarageConfig();
        const formattedDate = new Date().toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const cocheraText = data.tipoCochera === 'Movil' ? 'Móvil' : (data.numeroCochera || 'Fija');
        const now = new Date();
        const ultimoDia = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysRemaining = (ultimoDia - now.getDate()) + 1;

        const content = `
            <div style="font-family: 'Courier New', Courier, monospace; width: 58mm; margin: 0 auto; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 10px; margin-top: 10px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: 900; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 10px;">
                    <div style="font-size: 14px; font-weight: bold; letter-spacing: 1px;">COMPROBANTE ALTA</div>
                    <div style="font-size: 11px; margin-top: 3px;">ABONO MES</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <!-- SECCIÓN 1: IDENTIFICACIÓN -->
                <div style="text-align: left; font-size: 12px; margin: 10px 0; line-height: 1.4;">
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Fecha Alta:</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">${formattedDate}</span>
                    </div>
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Cliente:</span><br/>
                        <span style="font-weight: bold; margin-left: 10px; font-size: 14px;">${data.nombreApellido.toUpperCase()}</span>
                    </div>
                    <div>
                        <span style="font-size: 10px;">Cochera:</span><br/>
                        <span style="font-weight: bold; margin-left: 10px; font-size: 14px;">${cocheraText}</span>
                    </div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <!-- SECCIÓN 2: ECONÓMICA -->
                <div style="text-align: left; font-size: 12px; margin: 10px 0; line-height: 1.4;">
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Valor Mensual (Referencia):</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">$${data.basePriceDisplay}</span>
                    </div>
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Por días: ${daysRemaining}</span><br/>
                    </div>
                    <div style="margin-bottom: 5px; background: #000; color: #fff; padding: 3px;">
                        <span style="font-size: 11px;">RECIBIMOS:</span>
                        <span style="font-weight: bold; font-size: 16px; float: right;">$${data.proratedPrice}</span>
                        <div style="clear: both;"></div>
                    </div>
                    <div>
                        <span style="font-size: 10px;">Medio de Pago:</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">${data.metodoPago}</span>
                    </div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <!-- SECCIÓN 3: VEHÍCULO -->
                <div style="text-align: left; font-size: 12px; margin: 10px 0; line-height: 1.4;">
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Vehículo (${data.tipoVehiculo}):</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">${data.marca} ${data.modelo}</span>
                    </div>
                </div>

                <div style="margin: 15px 0; text-align: center;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: 900; letter-spacing: 1px;">${data.patente}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 10px;">
                    <div style="font-weight: bold;">¡Gracias por confiar en nosotros!</div>
                    <div style="margin-top: 5px;">Recuerde que la mensualidad</div>
                    <div>se paga del 1 al 10 de cada mes.</div>
                </div>
                
                <div style="font-size: 10px; font-weight: bold; margin-top: 10px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 30px;"></div>
            </div>
        `;

        printHtml(content);
        toast.info(`🖨️ Imprimiendo Comprobante Alta Abono: ${data.patente}`);
    }
};

const printHtml = (html: string) => {
    // Kiosk printing requires the iframe to remain in the DOM, 
    // or at least not be removed too quickly. We'll use a hidden 
    // element that persists, re-using it if it exists.
    let hiddenFrame = document.getElementById('ag-printer-frame') as HTMLIFrameElement;

    if (!hiddenFrame) {
        hiddenFrame = document.createElement('iframe');
        hiddenFrame.id = 'ag-printer-frame';
        hiddenFrame.style.position = 'fixed';
        hiddenFrame.style.right = '0';
        hiddenFrame.style.bottom = '0';
        hiddenFrame.style.width = '0';
        hiddenFrame.style.height = '0';
        hiddenFrame.style.border = '0';
        document.body.appendChild(hiddenFrame);
    }

    const doc = hiddenFrame.contentWindow?.document;
    if (doc) {
        doc.open();
        doc.write(`
            <html>
                <head>
                    <title>Pos Print</title>
                    <style>
                        @media print {
                            @page { margin: 0; }
                            body { margin: 0; padding: 0; }
                        }
                    </style>
                </head>
                <body>${html}</body>
            </html>
        `);
        doc.close();

        // Give time for base64 images to render, then print
        setTimeout(() => {
            try {
                hiddenFrame.contentWindow?.focus();
                hiddenFrame.contentWindow?.print();
                // WE NO LONGER REMOVE THE IFRAME.
                // Removing it kills the print spooler in kiosk mode on some OS/Chrome versions.
            } catch (err) {
                console.error("Fallo al ejecutar print() en modo silencioso", err);
                // Fallback: Si falla el iframe (ej. permisos estrictos), abrimos en nueva pestaña
                openPrintFallback(html);
            }
        }, 500); // 500ms es suficiente pata renderizar el HTML y el base64 local
    } else {
        // Fallback total
        openPrintFallback(html);
    }
};

// Fallback: Abre el ticket en una pestaña nueva para imprimir manualmente o guardar PDF
const openPrintFallback = (html: string) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(`
            <html>
                <head>
                    <title>Ticket Fallback</title>
                    <style>
                        @media print {
                            @page { margin: 0; }
                            body { margin: 0; padding: 0; }
                        }
                    </style>
                </head>
                <body>${html}</body>
            </html>
        `);
        printWindow.document.close();

        // Auto-print en la nueva pestaña (esto sí levantará diálogo, pero al menos no falla)
        setTimeout(() => {
            printWindow.focus();
            printWindow.print();
        }, 500);
    } else {
        toast.error("Por favor, permita las ventanas emergentes (Pop-ups) para imprimir el ticket.");
    }
};
