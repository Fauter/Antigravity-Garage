
import { toast } from 'sonner';
import JsBarcode from 'jsbarcode';

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
        <div style="margin-top: 10px; text-align: center; font-size: 12px; line-height: 1.2;">
            <div>Aceptación Contrato (Adm.)</div>
            <div>Jurisdicción: Tribunales CABA</div>
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

    printEntryTicket: (stay: any) => {
        const config = getGarageConfig();
        const shortId = stay.ticket_code ? stay.ticket_code : (stay.id ? stay.id.slice(0, 8).toUpperCase() : 'UNKNOWN');
        const entryTime = new Date(stay.entryTime || stay.entry_time || Date.now());
        const formattedDate = entryTime.toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const barcodeDataUrl = PrinterService.generateBase64Barcode(shortId, config.paperWidth);

        const content = `
            <div style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 10px; margin-top: 10px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 11px;">Ingreso: <b>${shortId}</b></div>
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
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${stay.plate}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 10px;">
                    <div>Conserve este ticket para retirar su vehículo.</div>
                    <div>La empresa no se responsabiliza por objetos</div>
                    <div>dejados en el interior del mismo.</div>
                    <div style="font-weight: bold; margin-top: 5px;">¡Gracias por su visita!</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 10px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 30px;"></div>
            </div>
        `;
        printHtml(content, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Ticket Entrada: ${stay.plate}`);
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

        const generateTicket = (title: string, showTotal: boolean = true) => `
            <div class="page-break" style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 10px; margin-top: 10px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    ${movement?.receipt_number ? `<div style="font-size: 11px; margin-top: 2px;">Ticket: <b>${movement.receipt_number}</b></div>` : ''}
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
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${stay.plate}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                ${showTotal ? `
                <div style="margin: 15px 0;">
                    <div style="font-size: 14px; font-weight: bold;">TOTAL</div>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">$${Number(totalAmount).toFixed(2)}</div>
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
                
                ${PrinterService.getLegalFooter()}

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
        printHtml(clientTicket + controlTicket, config.paperWidth);

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

        const generateTicketHtml = (typeLabel: string) => `
            <div class="page-break" style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 5px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px;">
                        [X]
                    </div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 14px; font-weight: bold; letter-spacing: 1px;">COMPROBANTE ALTA</div>
                    <div style="font-size: 12px; font-weight: bold; margin-top: 2px;">${typeLabel}</div>
                    ${data.ticket_code ? `<div style="font-size: 11px; margin-top: 2px;">Ticket: <b>${data.ticket_code}</b></div>` : ''}
                    <div style="font-size: 11px; margin-top: 2px;">ABONO MES</div>
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

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <!-- SECCIÓN 3: VEHÍCULO -->
                <div style="text-align: left; font-size: 12px; margin: 10px 0; line-height: 1.4;">
                    <div style="margin-bottom: 5px;">
                        <span style="font-size: 10px;">Vehículo (${data.tipoVehiculo}):</span><br/>
                        <span style="font-weight: bold; margin-left: 10px;">${data.marca} ${data.modelo}</span>
                    </div>
                </div>

                <div style="margin: 8px 0; text-align: center;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${data.patente}</div>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 5px;">
                    <div style="font-weight: bold;">¡Gracias por confiar en nosotros!</div>
                    <div style="margin-top: 3px;">Recuerde que la mensualidad</div>
                    <div>se paga del 1 al 10 de cada mes.</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 15px;"></div>
            </div>
        `;

        const ticketOriginal = generateTicketHtml('ORIGINAL');
        const ticketDuplicado = generateTicketHtml('DUPLICADO (CONTROL)');

        printHtml(ticketOriginal + ticketDuplicado, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Comprobantes Alta Abono (x2): ${data.patente}`);
    },

    printRenewalTicket: (data: any) => {
        const config = getGarageConfig();
        const formattedDate = new Date().toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const generateRenewalHtml = (typeLabel: string) => `
            <div class="page-break" style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 5px; margin-top: 10px;">
                    <h2 style="margin: 0; font-size: 16px; font-weight: bold; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 11px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 14px; font-weight: bold; letter-spacing: 0.5px;">RENOVACIÓN DE ABONO</div>
                    <div style="font-size: 12px; font-weight: bold; margin-top: 2px;">${typeLabel}</div>
                    ${data.ticket_code ? `<div style="font-size: 11px; margin-top: 2px;">Ticket: <b>${data.ticket_code}</b></div>` : ''}
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="text-align: left; font-size: 12px; margin: 10px 0; line-height: 1.4;">
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

                <div style="margin: 15px 0; border: 2px solid #000; padding: 8px; text-align: center;">
                    <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">MONTO PAGADO:</div>
                    <div style="font-size: 22px; font-weight: bold;">$${Number(data.monto).toLocaleString('es-AR')}</div>
                </div>

                <div style="text-align: left; font-size: 11px; margin: 10px 0; line-height: 1.3;">
                    <div><span style="font-weight: bold;">FECHA:</span> ${formattedDate}</div>
                    <div><span style="font-weight: bold;">OPERADOR:</span> ${data.operador}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 5px;">
                    <div style="font-weight: bold; text-transform: uppercase;">Comprobante de Renovación</div>
                    <div style="margin-top: 2px;">CONSERVE ESTE TICKET</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 15px;"></div>
            </div>
        `;

        const original = generateRenewalHtml('ORIGINAL');
        const duplicado = generateRenewalHtml('DUPLICADO');

        printHtml(original + duplicado, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Comprobante Renovación (x2): ${data.titular}`);
    },

    printUpgradeTicket: (data: any) => {
        const config = getGarageConfig();
        const formattedDate = new Date().toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const generateUpgradeHtml = (typeLabel: string) => `
            <div class="page-break" style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
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

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 13px; font-weight: bold; letter-spacing: 0.5px;">DIFERENCIA POR CAMBIO</div>
                    <div style="font-size: 13px; font-weight: bold; letter-spacing: 0.5px;">DE CATEGORÍA</div>
                    <div style="font-size: 12px; font-weight: bold; margin-top: 2px;">${typeLabel}</div>
                    ${data.ticket_code ? `<div style="font-size: 11px; margin-top: 2px;">Ticket: <b>${data.ticket_code}</b></div>` : ''}
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <!-- SECCIÓN 1: IDENTIFICACIÓN -->
                <div style="text-align: left; font-size: 12px; margin: 10px 0; line-height: 1.4;">
                    <div style="margin-bottom: 3px;">
                        <span style="font-weight: bold;">TITULAR:</span> ${String(data.titular).toUpperCase()}
                    </div>
                    <div style="margin-bottom: 3px;">
                        <span style="font-weight: bold;">VEHÍCULO:</span> ${data.tipoVehiculo}
                    </div>
                </div>

                <div style="margin: 8px 0; text-align: center;">
                    <div style="font-size: 11px; margin-bottom: 2px;">PATENTE</div>
                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 1px;">${data.patente}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <!-- SECCIÓN 2: ECONÓMICA -->
                <div style="text-align: left; font-size: 12px; margin: 10px 0; line-height: 1.4;">
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

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="text-align: left; font-size: 11px; margin: 10px 0; line-height: 1.3;">
                    <div><span style="font-weight: bold;">FECHA:</span> ${formattedDate}</div>
                    <div><span style="font-weight: bold;">OPERADOR:</span> ${data.operador}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 5px;">
                    <div style="font-weight: bold; text-transform: uppercase;">Comprobante de Upgrade</div>
                    <div style="margin-top: 2px;">CONSERVE ESTE TICKET</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 5px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 15px;"></div>
            </div>
        `;

        const original = generateUpgradeHtml('ORIGINAL');
        const duplicado = generateUpgradeHtml('DUPLICADO (CONTROL)');

        printHtml(original + duplicado, config.paperWidth);
        toast.info(`🖨️ Imprimiendo Comprobante Upgrade (x2): ${data.patente}`);
    },

    printPartialCloseTicket: (data: any) => {
        const config = getGarageConfig();

        const generateTicket = (title: string) => `
            <div class="page-break" style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 10px; margin-top: 10px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 11px; margin-top: 2px;">${title}</div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 3px;">RETIRO PARCIAL</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin: 10px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.4; font-family: 'Courier New', Courier, monospace;">
                        <tr>
                            <td style="text-align: left;">Fecha:</td>
                            <td style="text-align: right; font-weight: bold;">${new Date(data.timestamp).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">Operador:</td>
                            <td style="text-align: right; font-weight: bold;">${data.operatorName ? data.operatorName.substring(0, 15) : '---'}</td>
                        </tr>
                        <tr>
                            <td style="text-align: left;">A:</td>
                            <td style="text-align: right; font-weight: bold;">${data.recipientName}</td>
                        </tr>
                        ${data.partialNotes ? `
                        <tr>
                            <td style="text-align: left;">Notas:</td>
                            <td style="text-align: right; font-weight: bold;">${data.partialNotes}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>

                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <div style="margin: 15px 0;">
                    <div style="font-size: 14px; font-weight: bold;">TOTAL RETIRADO</div>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">$${Number(data.partialAmount).toLocaleString('es-AR')}</div>
                </div>
                
                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <div style="text-align: center; margin-top: 20px;">
                    <div style="border-bottom: 1px solid #000; width: 80%; margin: 0 auto;"></div>
                    <div style="font-size: 11px; margin-top: 5px;">Firma de quien recibe</div>
                </div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 15px;">
                    <div>Retiro parcial de caja</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 10px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 30px;"></div>
            </div>
        `;

        const original = generateTicket('ORIGINAL');
        const duplicado = generateTicket('DUPLICADO');
        
        printHtml(original + duplicado, config.paperWidth);
        toast.info('🖨️ Imprimiendo Retiro Parcial');
    },

    printShiftCloseTicket: (data: any) => {
        const config = getGarageConfig();

        const generateTicket = (title: string) => `
            <div class="page-break" style="font-family: 'Courier New', Courier, monospace; width: 48mm; margin: 0; color: #000; padding: 0; text-align: center;">
                
                <div style="margin-bottom: 10px; margin-top: 10px;">
                    <div style="border: 2px solid #000; display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 14px; margin-bottom: 5px;">
                        [X]
                    </div>
                    <div style="font-size: 10px; font-weight: bold;">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: -0.5px; text-transform: uppercase;">${config.name}</h2>
                    <div style="font-size: 12px; font-family: sans-serif; margin-top: 2px;">${config.address}</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin-bottom: 5px;">
                    <div style="font-size: 11px; margin-top: 2px;">${title}</div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 3px;">CIERRE DE CAJA FINAL</div>
                </div>

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin: 10px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.4; font-family: 'Courier New', Courier, monospace;">
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

                <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>

                <div style="margin: 10px 0;">
                    <table style="width: 100%; font-size: 12px; line-height: 1.4; font-family: 'Courier New', Courier, monospace;">
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

                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <div style="margin: 15px 0;">
                    <div style="font-size: 14px; font-weight: bold;">MONTO RENDIDO</div>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: -1px;">$${Number(data.renderedAmount).toLocaleString('es-AR')}</div>
                </div>
                
                <div style="border-bottom: 1px solid #000; margin: 8px 0;"></div>

                <div style="text-align: center; margin-top: 20px;">
                    <div style="border-bottom: 1px solid #000; width: 80%; margin: 0 auto;"></div>
                    <div style="font-size: 11px; margin-top: 5px;">Firma del Operador</div>
                </div>

                <div style="font-size: 10px; line-height: 1.3; margin-top: 15px;">
                    <div>Cierre de turno</div>
                </div>
                
                ${PrinterService.getLegalFooter()}

                <div style="font-size: 10px; font-weight: bold; margin-top: 10px; letter-spacing: 2px;">
                    XXXXXXXXXXXXXXXXX
                </div>
                <!-- Spacing for printer cut -->
                <div style="height: 30px;"></div>
            </div>
        `;

        const original = generateTicket('ORIGINAL');
        const duplicado = generateTicket('DUPLICADO');

        printHtml(original + duplicado, config.paperWidth);
        toast.info('🖨️ Imprimiendo Cierre de Caja Final');
    }
};

const buildFullHtml = (html: string, paperWidth: number): string => {
    const is80 = paperWidth === 80;
    const layoutWidth = is80 ? '100%' : '48mm';
    const baseFontSize = is80 ? '16px' : '12px'; // Proporcional para 80mm via calc()

    // Reemplazamos los widths fijos de 48mm por 100% (el contenedor dictará el límite real)
    let processedHtml = html.replace(/width:\s*48mm;/g, 'width: 100%;');

    // Reemplazamos todos los font-size: Xpx por proporciones basadas en var(--base-font-size)
    processedHtml = processedHtml.replace(/font-size:\s*(\d+)px/g, (_match, p1) => {
        const factor = (parseInt(p1) / 12).toFixed(3);
        return `font-size: calc(${factor} * var(--base-font-size))`;
    });

    return `
    <html>
        <head>
            <title>Pos Print</title>
            <style>
                :root {
                    --base-font-size: ${baseFontSize};
                }
                /* ═══ CSS SAFE-MODE PARA IMPRESORAS TÉRMICAS ═══ */
                @media print {
                    @page { margin: 0; size: ${paperWidth}mm auto; }
                    body {
                        zoom: 1;
                        transform: none;
                        margin: 0; padding: 0;
                        font-weight: 600;
                        color: #000 !important;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    * {
                        box-sizing: border-box;
                        color: black !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .page-break { page-break-after: always; }
                }

                body {
                    margin: 0; padding: 0;
                    background: #fff;
                    font-weight: 600;
                    color: #000 !important;
                }
                * {
                    box-sizing: border-box;
                    color: black !important;
                }
                .page-break { page-break-after: always; }
                b, strong { font-weight: bold !important; }
                td, th { font-weight: 600; }
                img {
                    image-rendering: -webkit-optimize-contrast;
                    image-rendering: crisp-edges;
                }
                
                /* Contenedor estricto para Área Imprimible */
                .print-container {
                    width: ${layoutWidth};
                    max-width: ${is80 ? '100%' : layoutWidth};
                    overflow: hidden;
                    margin: 0 auto;
                    ${is80 ? 'padding: 0 5mm;' : ''}
                }
            </style>
        </head>
        <body>
            <div class="print-container">
                ${processedHtml}
            </div>
        </body>
    </html>
    `;
};

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
