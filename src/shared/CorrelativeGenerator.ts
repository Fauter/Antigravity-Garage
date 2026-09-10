import { SQLiteManager } from '../infrastructure/database/sqlite/SQLiteManager';

/**
 * Generador de números correlativos por garage_id.
 */
export class CorrelativeGenerator {

    static async nextStayTicket(garageId: string, tx?: any): Promise<string> {
        const db = tx || SQLiteManager.getInstance().getDatabase();
        
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS correlatives (
                    garage_id TEXT,
                    type TEXT,
                    last_value INTEGER,
                    PRIMARY KEY (garage_id, type)
                )
            `);

            let persistedRow = db.prepare(`SELECT last_value FROM correlatives WHERE garage_id = ? AND type = 'stay'`).get(garageId) as any;
            let persistedVal = persistedRow ? persistedRow.last_value : 0;

            const rows = db.prepare(`
                SELECT json_extract(json_data, '$.ticketCode') as tc1, 
                       json_extract(json_data, '$.ticket_code') as tc2
                FROM stays 
                WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?
            `).all(garageId, garageId) as any[];
            
            let historicalMax = 0;
            for (const r of rows) {
                const code = r.tc1 || r.tc2;
                if (code && typeof code === 'string' && code.startsWith('E')) {
                    const num = parseInt(code.substring(1), 10);
                    if (!isNaN(num) && num > historicalMax) {
                        historicalMax = num;
                    }
                }
            }

            const effectiveLast = Math.max(persistedVal, historicalMax);
            const nextVal = effectiveLast + 1;
            
            db.prepare(`
                INSERT INTO correlatives (garage_id, type, last_value) 
                VALUES (?, 'stay', ?)
                ON CONFLICT(garage_id, type) DO UPDATE SET last_value = excluded.last_value
            `).run(garageId, nextVal);

            console.log(`\n[CORRELATIVE TRACE]\ngarageId: ${garageId}\ntype: stay\npersistedCounter: ${persistedVal}\nobservedHistoricalMax: ${historicalMax}\neffectiveLast: ${effectiveLast}\nallocated: ${nextVal}\n`);

            return `E${String(nextVal).padStart(7, '0')}`;
        } catch (err: any) {
            console.error('⚠️ [CorrelativeGenerator] Error al generar stay ticket:', err);
            throw new Error(`Fallo al generar correlativo para la estadía: ${err.message}`);
        }
    }

    static allocateMovementTicketCode(garageId: string, tx?: any): string {
        const db = tx || SQLiteManager.getInstance().getDatabase();
        
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS correlatives (
                    garage_id TEXT,
                    type TEXT,
                    last_value INTEGER,
                    PRIMARY KEY (garage_id, type)
                )
            `);

            let persistedRow = db.prepare(`SELECT last_value FROM correlatives WHERE garage_id = ? AND type = 'movement'`).get(garageId) as any;
            let persistedVal = persistedRow ? persistedRow.last_value : 0;

            const rows = db.prepare(`
                SELECT json_extract(json_data, '$.ticket_code') as tc1,
                       json_extract(json_data, '$.ticketCode') as tc2,
                       json_extract(json_data, '$.receipt_number') as rn1,
                       json_extract(json_data, '$.receiptNumber') as rn2
                FROM movements
                WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?
            `).all(garageId, garageId) as any[];
            
            let historicalMax = 0;
            for (const r of rows) {
                for (const val of [r.tc1, r.tc2, r.rn1, r.rn2]) {
                    if (val) {
                        // Limpiar posible string y parsear (Movement usa numérico 8 digits sin letras)
                        const cleanVal = String(val).replace(/[^0-9]/g, '');
                        if (cleanVal) {
                            const num = parseInt(cleanVal, 10);
                            if (!isNaN(num) && num > historicalMax) {
                                historicalMax = num;
                            }
                        }
                    }
                }
            }

            const effectiveLast = Math.max(persistedVal, historicalMax);
            const nextVal = effectiveLast + 1;
            
            db.prepare(`
                INSERT INTO correlatives (garage_id, type, last_value) 
                VALUES (?, 'movement', ?)
                ON CONFLICT(garage_id, type) DO UPDATE SET last_value = excluded.last_value
            `).run(garageId, nextVal);

            console.log(`\n[CORRELATIVE TRACE]\ngarageId: ${garageId}\ntype: movement\npersistedCounter: ${persistedVal}\nobservedHistoricalMax: ${historicalMax}\neffectiveLast: ${effectiveLast}\nallocated: ${nextVal}\n`);

            return String(nextVal).padStart(8, '0');
        } catch (err: any) {
            console.error('⚠️ [CorrelativeGenerator] Error al generar movement ticket_code:', err);
            throw new Error(`Fallo al generar correlativo para el movimiento: ${err.message}`);
        }
    }
}
