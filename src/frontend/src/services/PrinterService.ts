
import { toast } from 'sonner';

export const PrinterService = {
    printEntryTicket: (stay: any) => {
        const content = `
            <div style="font-family: monospace; font-size: 12px; width: 300px; text-align: center;">
                <h2 style="margin: 0;">ANTIGRAVITY GARAGE</h2>
                <div style="border-bottom: 1px dashed black; margin: 5px 0;"></div>
                <div style="font-size: 16px; font-weight: bold; margin: 10px 0;">${stay.plate}</div>
                <div style="text-align: left; margin: 10px 0;">
                    <div>Entrada: ${new Date(stay.entryTime).toLocaleString()}</div>
                    <div>Tipo: ${stay.vehicleType || 'Auto'}</div>
                    <div>ID: ${stay.id.slice(0, 8)}</div>
                </div>
                <div style="border-bottom: 1px dashed black; margin: 5px 0;"></div>
                <div style="font-size: 10px;">Conserve este ticket</div>
            </div>
        `;
        printHtml(content);
        toast.info(`🖨️ Imprimiendo Ticket Entrada: ${stay.plate}`);
    },

    printExitTicket: (stay: any, movement: any) => {
        // Ticket content generation helper
        const generateTicket = (title: string) => `
            <div style="font-family: monospace; font-size: 12px; width: 300px; text-align: center; page-break-after: always;">
                <h2 style="margin: 0;">ANTIGRAVITY GARAGE</h2>
                <div style="font-size: 10px;">${title}</div>
                <div style="border-bottom: 1px dashed black; margin: 5px 0;"></div>
                <div style="font-size: 16px; font-weight: bold; margin: 10px 0;">${stay.plate}</div>
                <div style="text-align: left; margin: 10px 0;">
                    <div>Entrada: ${new Date(stay.entryTime).toLocaleString()}</div>
                    <div>Salida: ${new Date(stay.exitTime).toLocaleString()}</div>
                    <div>Duración: ${movement.notes}</div>
                </div>
                <div style="border-bottom: 1px dashed black; margin: 5px 0;"></div>
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 14px;">
                    <span>TOTAL</span>
                    <span>$${movement.amount}</span>
                </div>
                <div style="text-align: left; font-size: 10px; margin-top: 5px;">
                    <div>Medio: ${movement.paymentMethod}</div>
                    <div>Op: ${movement.operator || 'Sys'}</div>
                </div>
            </div>
        `;

        const clientTicket = generateTicket("TICKET CLIENTE");
        const controlTicket = generateTicket("CONTROL INTERNO");

        // Print both in one job
        printHtml(clientTicket + '<br/><br/>' + controlTicket);

        toast.info(`🖨️ Imprimiendo Tickets Salida (x2): ${stay.plate}`);
    }
};

const printHtml = (html: string) => {
    const hiddenFrame = document.createElement('iframe');
    hiddenFrame.style.position = 'fixed';
    hiddenFrame.style.right = '0';
    hiddenFrame.style.bottom = '0';
    hiddenFrame.style.width = '0';
    hiddenFrame.style.height = '0';
    hiddenFrame.style.border = '0';
    document.body.appendChild(hiddenFrame);

    const doc = hiddenFrame.contentWindow?.document;
    if (doc) {
        doc.open();
        doc.write(`
            <html>
                <head>
                    <title>Print</title>
                    <style>
                        @media print {
                            @page { margin: 0; }
                            body { margin: 1cm; }
                        }
                    </style>
                </head>
                <body>${html}</body>
            </html>
        `);
        doc.close();
        hiddenFrame.contentWindow?.focus();
        hiddenFrame.contentWindow?.print();
    }

    // Cleanup after print dialog usage (timeout to allow print dialog to open)
    setTimeout(() => {
        document.body.removeChild(hiddenFrame);
    }, 1000);
};
