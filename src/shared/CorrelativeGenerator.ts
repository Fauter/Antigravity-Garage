import { db } from '../infrastructure/database/datastore';

/**
 * Generador de números correlativos por garage_id.
 * Usa COUNT de registros existentes + 1 para garantizar secuencia.
 */
export class CorrelativeGenerator {

    /**
     * Genera el próximo ticket de ingreso: E0000001, E0000002, ...
     * Basado en la cantidad total de stays para el garageId.
     */
    static async nextStayTicket(garageId: string): Promise<string> {
        try {
            const count = await db.stays.count({ garageId });
            const next = count + 1;
            return `E${String(next).padStart(7, '0')}`;
        } catch (err) {
            console.error('❌ [CorrelativeGenerator] Error al generar ticket de ingreso:', err);
            // Fallback seguro: timestamp-based para no bloquear la operación
            return `E${Date.now().toString().slice(-7)}`;
        }
    }

    /**
     * Genera el próximo número de comprobante: 00000001, 00000002, ...
     * Basado en la cantidad total de movements para el garageId.
     */
    static async nextReceiptNumber(garageId: string): Promise<string> {
        try {
            const count = await db.movements.count({ garageId });
            const next = count + 1;
            return String(next).padStart(8, '0');
        } catch (err) {
            console.error('❌ [CorrelativeGenerator] Error al generar receipt_number:', err);
            return String(Date.now()).slice(-8);
        }
    }
}
