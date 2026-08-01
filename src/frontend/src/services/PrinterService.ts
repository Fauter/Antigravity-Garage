
import { toast } from 'sonner';
import JsBarcode from 'jsbarcode';
import { applyDithering } from '../utils/dithering';

// ── Constantes de layout para impresión térmica ──────────────────────────
// Separador visual entre copias de un mismo ticket (negro puro para térmicas monocromáticas)
const TICKET_SEPARATOR = '<div style="border-top: 1px dashed #000; margin: 6px 0;"></div>';
// Espacio para corte de papel — se agrega SOLO al final del bloque HTML consolidado
const CUT_SPACER = '<div style="height: 30px;"></div>';

// Helper to resolve garage config
const getGarageConfig = () => {
    try {
        const stored = localStorage.getItem('ag_terminal_config');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (!parsed.paperWidth) parsed.paperWidth = 58;
            return parsed;
        }
    } catch (e) {
        console.error('Error reading terminal config for printer', e);
    }
    return { name: 'ANTIGRAVITY GARAGE', address: 'Dirección no configurada', paperWidth: 58 };
};

export const PrinterService = {
    getLegalFooter: () => `
        <div style="margin-top: 5px; text-align: center; font-size: 9px; line-height: 1.2;">
            <div style="white-space: nowrap;">Aceptación Contrato (Adm.)</div>
            <div style="white-space: nowrap;">Jurisdicción: Tribunales CABA</div>
        </div>
    `,

    generateBase64Barcode: (text: string, paperWidth: number = 58): string => {
        try {
            const canvas = document.createElement('canvas');
            const bcWidth = paperWidth === 80 ? 3 : 2;
            JsBarcode(canvas, text, {
                format: "CODE128",
                displayValue: false,
                height: 40,
                width: bcWidth,
                margin: 5,
                background: "#ffffff",
                lineColor: "#000000",
                flat: true
            });
            return canvas.toDataURL('image/png');
        } catch (error) {
            console.error('Error generating barcode', error);
            return '';
        }
    },

    printEntryTicket: async (stay: any) => {
        const config = getGarageConfig();
        const shortId = stay.ticket_code ? stay.ticket_code : (stay.id ? stay.id.slice(0, 8).toUpperCase() : 'UNKNOWN');
        const entryTime = new Date(stay.entryTime || stay.entry_time || Date.now());
        const formattedDate = entryTime.toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const barcodeDataUrl = PrinterService.generateBase64Barcode(shortId, config.paperWidth);
        
        let photoHtml = '';
        if (stay.entry_photo_path) {
            let base64ToDither = stay.entry_photo_path;

            // Si es una ruta de disco, convertirla usando el main process
            if (!base64ToDither.startsWith('data:image')) {
                try {
                    const electronAPI = (window as any).electronAPI;
                    if (electronAPI?.readFileBase64) {
                        base64ToDither = await electronAPI.readFileBase64(base64ToDither);
                    }
                } catch (err) {
                    console.error("Error leyendo imagen del disco vía IPC:", err);
                }
            }

            if (base64ToDither && base64ToDither.startsWith('data:image')) {
                try {
                    // Pre-procesar imagen con Dithering para la ticketera (monocromo 1-bit real)
                    const ditheredBase64 = await applyDithering(base64ToDither, 380);
                    photoHtml = `
                    <div style="margin: 10px 0; text-align: center;">
                        <img src="${ditheredBase64}" style="width: 100%; max-width: 44mm; height: auto; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;" />
                    </div>
                    `;
                } catch (err) {
                    console.error("Error aplicando Dithering a la imagen de entrada", err);
                }
            }
        }

        const content = `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 11px;">Ingreso: <b>${shortId}</b></div>
                </div>

                ${barcodeDataUrl ? `
                <div style="margin: 5px 0;">
                    <img src="${barcodeDataUrl}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                </div>
                ` : ''}

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin: 5px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.2; font-family: 'Courier New', Courier, monospace;">
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

                <div style="margin: 8px 0;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${stay.plate}</div>
                </div>

                ${photoHtml}

                <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>

                <div style="font-size: 9px; line-height: 1.2; margin-top: 5px; white-space: nowrap;">
                    <div>Conserve este ticket para retirar su vehículo.</div>
                    <div>La empresa no se responsabiliza por objetos</div>
                    <div>dejados en el interior del mismo.</div>
                    <div style="font-weight: bold; margin-top: 5px; font-size: 10px;">¡Gracias por su visita!</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
            </div>
        `;
        printHtml(content + CUT_SPACER, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Ticket Entrada: ${stay.plate}`);
    },

    printPrepaidEntryTicket: async (stay: any, movement: any, tariffName: string) => {
        const config = getGarageConfig();
        const shortId = stay.ticket_code ? stay.ticket_code : (stay.id ? stay.id.slice(0, 8).toUpperCase() : 'UNKNOWN');
        const entryTime = new Date(stay.entryTime || stay.entry_time || Date.now());
        const formattedDate = entryTime.toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const prepaidUntil = new Date(stay.prepaidUntil);
        const formattedUntil = prepaidUntil.toLocaleString('es-AR', {
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const barcodeDataUrl = PrinterService.generateBase64Barcode(shortId, config.paperWidth);
        
        let photoHtml = '';
        if (stay.entry_photo_path) {
            let base64ToDither = stay.entry_photo_path;

            // Si es una ruta de disco, convertirla usando el main process
            if (!base64ToDither.startsWith('data:image')) {
                try {
                    const electronAPI = (window as any).electronAPI;
                    if (electronAPI?.readFileBase64) {
                        base64ToDither = await electronAPI.readFileBase64(base64ToDither);
                    }
                } catch (err) {
                    console.error("Error leyendo imagen del disco vía IPC:", err);
                }
            }

            if (base64ToDither && base64ToDither.startsWith('data:image')) {
                try {
                    // Pre-procesar imagen con Dithering para la ticketera (monocromo 1-bit real)
                    const ditheredBase64 = await applyDithering(base64ToDither, 380);
                    photoHtml = `
                    <div style="margin: 10px 0; text-align: center;">
                        <img src="${ditheredBase64}" style="width: 100%; max-width: 44mm; height: auto; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;" />
                    </div>
                    `;
                } catch (err) {
                    console.error("Error aplicando Dithering a la imagen de entrada", err);
                }
            }
        }

        const content = `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 16px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase;">PAGO ANTICIPADO</h2>
                    <div style="font-size: 11px;">Ticket: <b>${shortId}</b></div>
                </div>

                ${barcodeDataUrl ? `
                <div style="margin: 5px 0;">
                    <img src="${barcodeDataUrl}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                </div>
                ` : ''}

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin: 5px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.2; font-family: 'Courier New', Courier, monospace;">
                        <tr>
                            <td style="text-align: left;">Ingreso:</td>
                            <td style="text-align: right; font-weight: bold;">${formattedDate}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Tipo:</td>
                            <td style="text-align: right; font-weight: bold;">${stay.vehicleType || 'Auto'}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Tarifa:</td>
                            <td style="text-align: right; font-weight: bold;">${tariffName}</td>
                        </tr>

                    </table>
                </div>

                <div style="margin: 8px 0;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${stay.plate}</div>
                </div>

                ${photoHtml}

                <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>

                <div style="margin: 8px 0;">
                    <div style="font-size: 14px; font-weight: bold;">TOTAL</div>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">$${Number(movement.amount).toFixed(2)}</div>
                    
                    <div style="margin-top: 8px; font-size: 11px; font-weight: bold;">VÁLIDO HASTA:</div>
                    <div style="font-size: 24px; font-weight: bold; margin-top: 2px;">${formattedUntil}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>

                <table style="width: 100%; font-size: 11px; line-height: 1.3; font-family: 'Courier New', Courier, monospace;">
                    <tr>
                        <td style="text-align: left;">Medio de Pago:</td>
                        <td style="text-align: right; font-weight: bold;">${movement.paymentMethod}</td>
                    </tr>
                    <tr>
                        <td style="text-align: left;">Operador:</td>
                        <td style="text-align: right; font-weight: bold;">${movement.operator ? movement.operator.substring(0, 15) : 'Sys'}</td>
                    </tr>
                </table>

                <div style="font-size: 9px; line-height: 1.2; margin-top: 5px; white-space: nowrap;">
                    <div>Conserve este ticket para retirar su vehículo.</div>
                    <div>La empresa no se responsabiliza por objetos</div>
                    <div>dejados en el interior del mismo.</div>
                    <div style="font-weight: bold; margin-top: 5px; font-size: 10px;">¡Gracias por su visita!</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
            </div>
        `;
        printHtml(content + TICKET_SEPARATOR + content + CUT_SPACER, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Anticipado (x2): ${stay.plate}`);
    },

    printExitTicket: (stay: any, movement: any) => {
        const config = getGarageConfig();
        const shortId = stay.ticket_code ? stay.ticket_code : (stay.id ? stay.id.slice(0, 8).toUpperCase() : 'UNKNOWN');
        const isSubscriber = stay.isSubscriber || stay.is_subscriber || (movement && movement.amount === 0 && movement.notes?.includes('Abonado'));
        const ticketType = isSubscriber ? 'SALIDA - ABONADO' : 'TICKET SALIDA';

        const barcodeDataUrl = PrinterService.generateBase64Barcode(shortId, config.paperWidth);

        const entryTime = new Date(stay.entryTime || stay.entry_time);
        const exitTime = new Date(stay.exitTime || stay.exit_time || Date.now());
        const formattedEntry = entryTime.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        const formattedExit = exitTime.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

        const duration = (movement && movement.notes) ? movement.notes : 'N/A';
        const totalAmount = movement ? Math.floor(movement.amount || 0) : 0;
        const paymentMethod = movement ? movement.paymentMethod : 'N/A';
        const operatorName = movement ? (movement.operator || 'Sys') : 'Sys';

        const generateTicket = (showTotal: boolean = true) => `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin-bottom: 5px;">
                    ${movement?.receipt_number ? `<div style="font-size: 11px; margin-top: 2px;">Ticket: <b>${movement.receipt_number}</b></div>` : ''}
                    <div style="font-size: 11px; margin-top: 1px;">Ingreso: <b>${shortId}</b></div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 4px;">${ticketType}</div>
                </div>

                ${barcodeDataUrl ? `
                <div style="margin: 5px 0;">
                    <img src="${barcodeDataUrl}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                </div>
                ` : ''}

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin: 5px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.2; font-family: 'Courier New', Courier, monospace;">
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

                <div style="margin: 8px 0;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${stay.plate}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>

                ${showTotal ? `
                <div style="margin: 8px 0;">
                    <div style="font-size: 14px; font-weight: bold;">TOTAL</div>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">$${Number(totalAmount).toFixed(2)}</div>
                </div>
                
                <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>

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

                <div style="font-size: 10px; line-height: 1.3; margin-top: 8px; white-space: nowrap;">
                    <div>¡Gracias por su visita!</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
            </div>
        `;

        const clientTicket = generateTicket(true);
        const controlTicket = generateTicket(true);

        // Imprimir ambas copias con separador fino entre ellas y espacio de corte solo al final
        printHtml(clientTicket + TICKET_SEPARATOR + controlTicket + CUT_SPACER, config.paperWidth);

        toast.info(`🖨️ Imprimiendo Tickets Salida (x2): ${stay.plate}`);
    },

    printSubscriptionTicket: (data: any) => {
        const config = getGarageConfig();
        const formattedDate = new Date().toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const cocheraText = data.tipoCochera === 'Movil' ? 'Móvil' : (data.numeroCochera || 'Fija');
        const now = new Date();
        const ultimoDia = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysRemaining = (ultimoDia - now.getDate()) + 1;

        const generateTicketHtml = () => `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px;">
                        [X]
                    </div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 14px; font-weight: bold; letter-spacing: 1px;">COMPROBANTE ALTA</div>
                    ${data.ticket_code ? `<div style="font-size: 11px; margin-top: 2px;">Ticket: <b>${data.ticket_code}</b></div>` : ''}
                    <div style="font-size: 11px; margin-top: 2px;">ABONO MES</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <!-- SECCIÓN 1: IDENTIFICACIÓN -->
                <div style="text-align: left; font-size: 12px; margin: 5px 0; line-height: 1.2;">
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

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <!-- SECCIÓN 2: ECONÓMICA -->
                <div style="text-align: left; font-size: 12px; margin: 5px 0; line-height: 1.2;">
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Valor Mensual (Referencia):</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">$${data.basePriceDisplay}</span>
                    </div>
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Por días: ${daysRemaining}</span><br/>
                    </div>
                    <div style="margin-bottom: 5px; border: 2px solid #000; padding: 3px;">
                        <span style="font-size: 11px; font-weight: bold;">RECIBIMOS:</span>
                        <span style="font-weight: bold; font-size: 16px; float: right;">$${data.montoRecibido ?? data.proratedPrice}</span>
                        <div style="clear: both;"></div>
                    </div>
                    <div>
                        <span style="font-size: 10px;">Medio de Pago:</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">${data.metodoPago}</span>
                    </div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <!-- SECCIÓN 3: VEHÍCULO -->
                <div style="text-align: left; font-size: 12px; margin: 5px 0; line-height: 1.2;">
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Vehículo (${data.tipoVehiculo}):</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">${data.marca} ${data.modelo}</span>
                    </div>
                </div>

                <div style="margin: 4px 0; text-align: center;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${data.patente}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>

                <div style="font-size: 9px; line-height: 1.2; margin-top: 5px; white-space: nowrap;">
                    <div style="font-weight: bold; font-size: 10px;">¡Gracias por confiar en nosotros!</div>
                    <div style="margin-top: 3px;">Recuerde que la mensualidad</div>
                    <div>se paga del 1 al 10 de cada mes.</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
            </div>
        `;

        const ticketOriginal = generateTicketHtml();
        const ticketDuplicado = generateTicketHtml();

        printHtml(ticketOriginal + TICKET_SEPARATOR + ticketDuplicado + CUT_SPACER, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Comprobantes Alta Abono (x2): ${data.patente}`);
    },

    printRenewalTicket: (data: any) => {
        const config = getGarageConfig();
        const formattedDate = new Date().toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const generateRenewalHtml = () => `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <h2 style="margin: 0; font-size: 16px; font-weight: bold; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 11px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 14px; font-weight: bold; letter-spacing: 0.5px;">RENOVACIÓN DE ABONO</div>
                    ${data.ticket_code ? `<div style="font-size: 11px; margin-top: 2px;">Ticket: <b>${data.ticket_code}</b></div>` : ''}
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="text-align: left; font-size: 12px; margin: 5px 0; line-height: 1.2;">
                    <div style="margin-bottom: 3px;">
                        <span style="font-weight: bold;">TITULAR:</span> ${String(data.titular).toUpperCase()}
                    </div>
                    <div style="margin-bottom: 3px;">
                        <span style="font-weight: bold;">COCHERA:</span> ${data.cocheraTexto}
                    </div>
                    <div style="margin-bottom: 3px;">
                        <span style="font-weight: bold;">PATENTES:</span>
                        <div style="margin-left: 10px;">
                            ${data.patentes.map((p: string) => `<div>- ${p}</div>`).join('')}
                        </div>
                    </div>
                </div>

                <div style="margin: 8px 0; border: 2px solid #000; padding: 8px; text-align: center;">
                    <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">MONTO PAGADO:</div>
                    <div style="font-size: 22px; font-weight: bold;">$${Number(data.monto).toLocaleString('es-AR')}</div>
                </div>

                <div style="text-align: left; font-size: 11px; margin: 5px 0; line-height: 1.3;">
                    <div><span style="font-weight: bold;">FECHA:</span> ${formattedDate}</div>
                    <div><span style="font-weight: bold;">OPERADOR:</span> ${data.operador}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="font-size: 9px; line-height: 1.2; margin-top: 5px; white-space: nowrap;">
                    <div style="font-weight: bold; text-transform: uppercase; font-size: 10px;">Comprobante de Renovación</div>
                    <div style="margin-top: 2px;">CONSERVE ESTE TICKET</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
            </div>
        `;

        const original = generateRenewalHtml();
        const duplicado = generateRenewalHtml();

        printHtml(original + TICKET_SEPARATOR + duplicado + CUT_SPACER, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Comprobante Renovación (x2): ${data.titular}`);
    },

    printUpgradeTicket: (data: any) => {
        const config = getGarageConfig();
        const formattedDate = new Date().toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const generateUpgradeHtml = () => `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 16px; font-weight: bold; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 11px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 13px; font-weight: bold; letter-spacing: 0.5px;">DIFERENCIA POR CAMBIO</div>
                    <div style="font-size: 13px; font-weight: bold; letter-spacing: 0.5px;">DE CATEGORÍA</div>
                    ${data.ticket_code ? `<div style="font-size: 11px; margin-top: 2px;">Ticket: <b>${data.ticket_code}</b></div>` : ''}
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <!-- SECCIÓN 1: IDENTIFICACIÓN -->
                <div style="text-align: left; font-size: 12px; margin: 5px 0; line-height: 1.2;">
                    <div style="margin-bottom: 3px;">
                        <span style="font-weight: bold;">TITULAR:</span> ${String(data.titular).toUpperCase()}
                    </div>
                    <div style="margin-bottom: 3px;">
                        <span style="font-weight: bold;">VEHÍCULO:</span> ${data.tipoVehiculo}
                    </div>
                </div>

                <div style="margin: 4px 0; text-align: center;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${data.patente}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <!-- SECCIÓN 2: ECONÓMICA -->
                <div style="text-align: left; font-size: 12px; margin: 5px 0; line-height: 1.2;">
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Precio Anterior:</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">$${Number(data.precioAnterior).toLocaleString('es-AR')}</span>
                    </div>
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Nuevo Precio Base:</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">$${Number(data.precioNuevo).toLocaleString('es-AR')}</span>
                    </div>
                    <div style="margin-bottom: 5px; border: 2px solid #000; padding: 3px;">
                        <span style="font-size: 11px; font-weight: bold;">DIFERENCIA COBRADA:</span>
                        <span style="font-weight: bold; font-size: 16px; float: right;">$${Number(data.montoCobrado).toLocaleString('es-AR')}</span>
                        <div style="clear: both;"></div>
                    </div>
                    <div>
                        <span style="font-size: 10px;">Medio de Pago:</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">${data.metodoPago}</span>
                    </div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="text-align: left; font-size: 11px; margin: 5px 0; line-height: 1.3;">
                    <div><span style="font-weight: bold;">FECHA:</span> ${formattedDate}</div>
                    <div><span style="font-weight: bold;">OPERADOR:</span> ${data.operador}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="font-size: 9px; line-height: 1.2; margin-top: 5px; white-space: nowrap;">
                    <div style="font-weight: bold; text-transform: uppercase; font-size: 10px;">Comprobante de Upgrade</div>
                    <div style="margin-top: 2px;">CONSERVE ESTE TICKET</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
            </div>
        `;

        const original = generateUpgradeHtml();
        const duplicado = generateUpgradeHtml();

        printHtml(original + TICKET_SEPARATOR + duplicado + CUT_SPACER, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Comprobante Upgrade (x2): ${data.patente}`);
    },

    printPartialCloseTicket: (data: any) => {
        const config = getGarageConfig();
        const isExpense = data.movement_type === 'expense';
        const mainTitle = isExpense ? 'EGRESO DE CAJA' : 'RETIRO PARCIAL';
        const recipientLabel = isExpense ? 'Pagado a:' : 'Entregado a:';
        const notesLabel = isExpense ? 'Concepto:' : 'Notas:';
        const bottomText = isExpense ? 'Egreso operativo de caja' : 'Retiro parcial de caja';

        const generateTicket = () => `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 14px; font-weight: bold; margin-top: 3px;">${mainTitle}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin: 5px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.2; font-family: 'Courier New', Courier, monospace;">
                        <tr>
                            <td style="text-align: left;">Fecha:</td>
                            <td style="text-align: right; font-weight: bold;">${new Date(data.timestamp).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Operador:</td>
                            <td style="text-align: right; font-weight: bold;">${data.operatorName ? data.operatorName.substring(0, 15) : '---'}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">${recipientLabel}</td>
                            <td style="text-align: right; font-weight: bold;">${data.recipientName}</td>
                        </tr>
                        ${data.partialNotes ? `
                        <tr>
                            <td style="text-align: left;">${notesLabel}</td>
                            <td style="text-align: right; font-weight: bold;">${data.partialNotes}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>

                <div style="margin: 8px 0 12px 0;">
                    <div style="font-size: 14px; font-weight: bold;">TOTAL ${isExpense ? 'EGRESADO' : 'RETIRADO'}</div>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">$${Number(data.partialAmount).toLocaleString('es-AR')}</div>
                </div>

                <div style="text-align: center; margin-top: 12px;">
                    <div style="border-bottom: 1px solid #000; width: 80%; margin: 0 auto;"></div>
                    <div style="font-size: 11px; margin-top: 5px;">Firma de quien recibe</div>
                </div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 8px; white-space: nowrap;">
                    <div>${bottomText}</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
            </div>
        `;

        const original = generateTicket();
        const duplicado = generateTicket();

        printHtml(original + TICKET_SEPARATOR + duplicado + CUT_SPACER, config.paperWidth);
        toast.info('🖨️ Imprimiendo Retiro Parcial');
    },

    printShiftCloseTicket: (data: any) => {
        const config = getGarageConfig();

        const generateTicket = () => `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 14px; font-weight: bold; margin-top: 3px;">CIERRE DE CAJA FINAL</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin: 5px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.2; font-family: 'Courier New', Courier, monospace;">
                        <tr>
                            <td style="text-align: left;">Fecha:</td>
                            <td style="text-align: right; font-weight: bold;">${new Date(data.timestamp).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Operador:</td>
                            <td style="text-align: right; font-weight: bold;">${data.operatorName ? data.operatorName.substring(0, 15) : '---'}</td>
                        </tr>
                    </table>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>

                <div style="margin: 5px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.2; font-family: 'Courier New', Courier, monospace;">
                        <tr>
                            <td style="text-align: left;">Ef. Esperado:</td>
                            <td style="text-align: right; font-weight: bold;">$${Number(data.total).toLocaleString('es-AR')}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Ef. Contado:</td>
                            <td style="text-align: right; font-weight: bold;">$${Number(data.totalInCash).toLocaleString('es-AR')}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Diferencia:</td>
                            <td style="text-align: right; font-weight: bold;">${data.difference > 0 ? '+' : (data.difference < 0 ? '-' : '')}$${Math.abs(Number(data.difference)).toLocaleString('es-AR')}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Queda Fondo:</td>
                            <td style="text-align: right; font-weight: bold;">$${Number(data.stayingInCash).toLocaleString('es-AR')}</td>
                        </tr>
                    </table>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 4px 0;"></div>

                <div style="margin: 8px 0 12px 0;">
                    <div style="font-size: 14px; font-weight: bold;">MONTO RENDIDO</div>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">$${Number(data.renderedAmount).toLocaleString('es-AR')}</div>
                </div>

                <div style="text-align: center; margin-top: 12px;">
                    <div style="border-bottom: 1px solid #000; width: 80%; margin: 0 auto;"></div>
                    <div style="font-size: 11px; margin-top: 5px;">Firma del Operador</div>
                </div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 8px; white-space: nowrap;">
                    <div>Cierre de turno</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
            </div>
        `;

        // Cierre de caja: una sola copia (reporte interno, no requiere duplicado)
        const ticket = generateTicket();

        printHtml(ticket + CUT_SPACER, config.paperWidth);
        toast.info('🖨️ Imprimiendo Cierre de Caja Final');
    }
};

// ── Build Full HTML Document ─────────────────────────────────────────────
// Envuelve el HTML de tickets en un documento completo con CSS optimizado
// para impresión térmica, centrado correcto en 58mm y 80mm, y sin page-breaks.
const buildFullHtml = (html: string, paperWidth: number): string => {
    const is80 = paperWidth === 80;

    // ── Hard-Offset: Centrado anti-cropping para 80mm ───────────────────
    // Los drivers POS genéricos aplican "Whitespace Cropping" (recorte de
    // bounding box): descartan todo margen CSS puro (margin, auto-centering)
    // porque el raster resultante es solo espacio blanco sin píxeles.
    //
    // Solución: forzar un desplazamiento físico que ocupe píxeles reales
    // en el bitmap rasterizado, haciéndolo invisible al ojo pero opaco
    // al driver.
    //
    // Matemática del offset:
    //   Base ticket:   48mm
    //   Zoom:          1.35
    //   Ancho efectivo: 48 × 1.35 = 64.8mm
    //   Espacio libre:  80 - 64.8 = 15.2mm
    //   Offset:         15.2 / 2  = 7.6mm  ← centrado simétrico
    //
    // Se usa border-left: transparent en el contenedor porque:
    //   1. Genera píxeles reales (transparente ≠ inexistente en raster)
    //   2. El driver de Windows lo incluye en el bounding box del bitmap
    //   3. A diferencia de margin, NO puede ser recortado como whitespace
    //   4. print-color-adjust:exact fuerza a Chromium a rasterizar el borde

    const zoomCSS = is80 ? 'zoom: 1.35;' : '';

    // 80mm: padding-left empuja el contenedor; border-left transparente
    //       garantiza que el driver respete el espacio.
    // 58mm: margin: 0 auto clásico (funciona porque los drivers de 58mm
    //       no cropean — el contenido de 48mm ya llena casi todo el rollo).
    const bodyOffsetCSS = is80 ? 'padding-left: 7.6mm;' : '';
    const containerMarginCSS = is80 ? 'margin: 0;' : 'margin: 0 auto;';
    const containerBorderCSS = is80
        ? 'border-left: 7.6mm solid transparent;'
        : '';

    return `
    <html>
        <head>
            <title>Pos Print</title>
            <style>
                @page {
                    margin: 0;
                    size: ${paperWidth}mm auto;
                }

                @media print {
                    html, body {
                        margin: 0; padding: 0;
                        width: ${paperWidth}mm;
                        display: block !important;
                        ${bodyOffsetCSS}
                    }
                    * {
                        box-sizing: border-box;
                        color: black !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                }

                html, body {
                    margin: 0; padding: 0;
                    width: ${paperWidth}mm;
                    background: #fff;
                    font-weight: 600;
                    color: #000 !important;
                    display: block !important;
                    ${bodyOffsetCSS}
                }
                * {
                    box-sizing: border-box;
                    color: black !important;
                }
                b, strong { font-weight: bold !important; }
                td, th { font-weight: 600; }
                img {
                    image-rendering: -webkit-optimize-contrast;
                    image-rendering: crisp-edges;
                }

                /* ═══ CONTENEDOR ═══
                 * 48mm siempre — idéntico al width inline de los templates.
                 * 80mm: border-left transparente ocupa 7.6mm de píxeles
                 *       reales en el raster → el driver NO lo cropea.
                 *       Combinado con el padding-left del body, el bloque
                 *       queda desplazado 7.6mm a la derecha = centrado.
                 * 58mm: margin:0 auto clásico, sin borde, sin zoom.
                 */
                .print-container {
                    width: 48mm !important;
                    ${containerMarginCSS}
                    ${containerBorderCSS}
                    overflow: hidden;
                    ${zoomCSS}
                }

                .print-container > div {
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="print-container">
                ${html}
            </div>
        </body>
    </html>
    `;
};

// ── Print HTML ───────────────────────────────────────────────────────────
// Envía el HTML a la impresora (silenciosa vía Electron IPC) o abre en ventana para preview/PDF.
// El mismo buildFullHtml se usa para ambas rutas, garantizando paridad visual.
const printHtml = async (html: string, paperWidth: number, isVirtual: boolean = false) => {
    if (isVirtual) {
        const fullHtml = buildFullHtml(html, paperWidth);
        const blob = new Blob([fullHtml], { type: 'text/html' });
        window.open(URL.createObjectURL(blob), '_blank');
        return;
    }

    const fullHtml = buildFullHtml(html, paperWidth);

    if (window.electronAPI?.silentPrint) {
        const savedPrinter = localStorage.getItem('selected_printer_name') || undefined;
        // Prioridad Absoluta de config manual. Se inyectan las dimensiones en micrones.
        const printerConfig = {
            deviceName: savedPrinter,
            dimensions: {
                width: paperWidth === 80 ? 80000 : 58000,
                height: 300000
            }
        };

        try {
            const result = await window.electronAPI.silentPrint(fullHtml, printerConfig);
            if (!result.success) {
                console.error('[PrinterService] Impresión fallida:', result.error);
                toast.error('Error al imprimir: ' + (result.error || 'desconocido'));
            }
        } catch (err: any) {
            console.error('[PrinterService] Error IPC:', err);
            toast.error('Error de comunicación con la impresora');
        }
    } else {
        const blob = new Blob([fullHtml], { type: 'text/html' });
        window.open(URL.createObjectURL(blob), '_blank');
    }
};
