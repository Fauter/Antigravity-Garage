import { db } from '../infrastructure/database/datastore';

/**
 * Generador de números correlativos por garage_id.
 * Usa MAX del número extraído de registros existentes + 1 para garantizar unicidad real,
 * incluso cuando la DB local tiene un subconjunto paginado (límite Supabase 1000 filas).
 */
export class CorrelativeGenerator {

    /**
     * Genera el próximo ticket de ingreso: E0000001, E0000002, ...
     * Basado en MAX(número extraído de ticket_code) + 1.
     */
    static async nextStayTicket(garageId: string): Promise<string> {
        try {
            const allStays: any[] = await db.stays.find({ garageId });
            let maxNum = 0;

            for (const stay of allStays) {
                const code = stay.ticket_code;
                if (typeof code === 'string' && code.startsWith('E')) {
                    const num = parseInt(code.substring(1), 10);
                    if (!isNaN(num) && num > maxNum) {
                        maxNum = num;
                    }
                }
            }

            const next = maxNum + 1;
            return `E${String(next).padStart(7, '0')}`;
        } catch (err) {
            console.error('❌ [CorrelativeGenerator] Error al generar ticket de ingreso:', err);
            // Fallback seguro: timestamp-based para no bloquear la operación
            return `E${Date.now().toString().slice(-7)}`;
        }
    }

    /**
     * Genera el próximo número de comprobante: 00000001, 00000002, ...
     * Basado en MAX(número extraído de receipt_number) + 1.
     */
    static async nextReceiptNumber(garageId: string): Promise<string> {
        try {
            const allMovements: any[] = await db.movements.find({ garageId });
            let maxNum = 0;

            for (const mov of allMovements) {
                const receipt = mov.receipt_number;
                if (typeof receipt === 'string') {
                    const num = parseInt(receipt, 10);
                    if (!isNaN(num) && num > maxNum) {
                        maxNum = num;
                    }
                }
            }

            const next = maxNum + 1;
            return String(next).padStart(8, '0');
        } catch (err) {
            console.error('❌ [CorrelativeGenerator] Error al generar receipt_number:', err);
            return String(Date.now()).slice(-8);
        }
    }
}
