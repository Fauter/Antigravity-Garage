import { Vehicle } from '../../../shared/schemas';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';
import { v4 as uuidv4 } from 'uuid';

export class SqliteVehicleRepository extends BaseSqliteRepository<Vehicle> {
    constructor() {
        super('vehicles', 'Vehicle');
    }

    async save(vehicle: Vehicle): Promise<Vehicle> {
        if (!vehicle.id) vehicle.id = uuidv4();

        const existing = await this.findById(vehicle.id);
        if (existing && (existing as any).rfid_tag) {
            const incomingTag = (vehicle as any).rfid_tag;
            if (!incomingTag || String(incomingTag).trim() === '') {
                (vehicle as any).rfid_tag = (existing as any).rfid_tag;
            }
        } else if (!(vehicle as any).rfid_tag || String((vehicle as any).rfid_tag).trim() === '') {
            (vehicle as any).rfid_tag = `RFID-${uuidv4().substring(0, 8).toUpperCase()}`;
        }

        const rfidTag = (vehicle as any).rfid_tag;
        if (rfidTag && String(rfidTag).trim() !== '') {
            const normalizedTag = String(rfidTag).trim().toUpperCase();
            (vehicle as any).rfid_tag = normalizedTag;
            
            const db = SQLiteManager.getInstance().getDatabase();
            const rows = db.prepare(`SELECT json_data FROM vehicles WHERE json_extract(json_data, '$.rfid_tag') = ?`).all(normalizedTag) as any[];
            const parsed = rows.map(r => JSON.parse(r.json_data));
            const conflict = parsed[0];
            
            if (conflict && conflict.id !== vehicle.id) {
                throw new Error(`RFID Tag "${normalizedTag}" ya está asignado al vehículo ${conflict.plate}. No se puede duplicar.`);
            }
        }

        const operation = existing ? 'UPDATE' : 'CREATE';
        return await super.save(vehicle, operation);
    }

    async findByPlate(plate: string, garageId?: string): Promise<Vehicle | null> {
        const normalizedInput = plate.replace(/[\s\-_]/g, '').toLowerCase();
        
        const db = SQLiteManager.getInstance().getDatabase();
        const qStr = garageId 
            ? `SELECT json_data FROM vehicles WHERE json_extract(json_data, '$.garageId') = ?`
            : `SELECT json_data FROM vehicles`;
            
        const rows = garageId ? db.prepare(qStr).all(garageId) as any[] : db.prepare(qStr).all() as any[];
        const parsed = rows.map(r => JSON.parse(r.json_data));
        
        for (const v of parsed) {
            if (v.plate) {
                const pNorm = v.plate.replace(/[\s\-_]/g, '').toLowerCase();
                if (pNorm === normalizedInput) {
                    return v;
                }
            }
        }
        return null;
    }

    async findByCustomerId(customerId: string, garageId?: string): Promise<Vehicle[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const qStr = garageId 
            ? `SELECT json_data FROM vehicles WHERE json_extract(json_data, '$.customerId') = ? AND json_extract(json_data, '$.garageId') = ?`
            : `SELECT json_data FROM vehicles WHERE json_extract(json_data, '$.customerId') = ?`;
            
        const rows = garageId 
            ? db.prepare(qStr).all(customerId, garageId) as any[] 
            : db.prepare(qStr).all(customerId) as any[];
            
        return rows.map(r => JSON.parse(r.json_data));
    }

    async reset(): Promise<void> {
        const db = SQLiteManager.getInstance().getDatabase();
        db.exec(`DELETE FROM vehicles`);
    }
}
