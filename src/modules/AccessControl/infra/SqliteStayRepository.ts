import { Stay } from './StayRepository';
import { BaseSqliteRepository } from '../../../infrastructure/database/sqlite/BaseSqliteRepository';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';

export class SqliteStayRepository extends BaseSqliteRepository<Stay> {
    constructor() {
        super('stays', 'Stay');
    }

    private mapStay(stay: any): Stay {
        return {
            id: stay.id,
            _id: stay._id,
            garageId: stay.garageId,
            ownerId: stay.ownerId,
            plate: stay.plate,
            entryTime: new Date(stay.entryTime),
            exitTime: stay.exitTime ? new Date(stay.exitTime) : undefined,
            vehicleType: stay.vehicleType,
            vehicleId: stay.vehicleId,
            active: stay.active,
            isSubscriber: stay.isSubscriber,
            subscriptionId: stay.subscriptionId,
            ticket_code: stay.ticket_code,
            exit_authorized: stay.exit_authorized ?? false,
            exit_authorized_at: stay.exit_authorized_at ?? null,
            exit_authorized_by: stay.exit_authorized_by ?? null,
            entry_photo_path: stay.entry_photo_path ?? null,
            is_pending_processing: stay.is_pending_processing ?? false,
            anpr_suggested_plate: stay.anpr_suggested_plate ?? null,
            barrier_exit_used: stay.barrier_exit_used ?? false,
            barrier_exit_at: stay.barrier_exit_at ?? null,
            isPrepaid: stay.isPrepaid ?? false,
            prepaidUntil: stay.prepaidUntil ? new Date(stay.prepaidUntil) : null,
            prepaidTariffId: stay.prepaidTariffId ?? null,
        };
    }

    // Overriding save to handle the domain specific default properties before passing to base.
    async save(stay: Stay): Promise<Stay> {
        // En SQLite el `id` público UUID siempre se preserva. `_id` de NeDB se elimina.
        const id = stay.id || stay._id;
        
        const doc = {
            ...stay,
            id: id,
            garageId: stay.garageId,
            ticket_code: stay.ticket_code,
            exit_authorized: stay.exit_authorized ?? false,
            exit_authorized_at: stay.exit_authorized_at ?? null,
            exit_authorized_by: stay.exit_authorized_by ?? null,
            barrier_exit_used: stay.barrier_exit_used ?? false,
            barrier_exit_at: stay.barrier_exit_at ?? null,
            is_pending_processing: stay.is_pending_processing ?? false,
            anpr_suggested_plate: stay.anpr_suggested_plate ?? null,
            entry_photo_path: stay.entry_photo_path ?? null,
            isPrepaid: stay.isPrepaid ?? false,
            prepaidUntil: stay.prepaidUntil ?? null,
            prepaidTariffId: stay.prepaidTariffId ?? null,
            updatedAt: new Date()
        };

        // Call the super class which does the ATOMIC WRITE
        await super.save(doc as Stay, 'UPDATE');
        
        return this.mapStay(doc);
    }

    async findActiveByPlateOrTicket(queryInput: string, garageId?: string): Promise<Stay | null> {
        const db = SQLiteManager.getInstance().getDatabase();
        
        const qStr = garageId 
            ? `SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?`
            : `SELECT json_data FROM stays`;
            
        const rows = garageId ? db.prepare(qStr).all(garageId) as any[] : db.prepare(qStr).all() as any[];
        
        const parsed = rows.map(r => JSON.parse(r.json_data));
        
        const ticketMatch = parsed.find(s => s.ticket_code === queryInput && !s.exitTime);
        if (ticketMatch) return this.mapStay(ticketMatch);
        
        const exactPlate = queryInput.trim().toUpperCase();
        const plateMatches = parsed.filter(s => s.plate === exactPlate && !s.exitTime && s.active !== false);
        
        if (plateMatches.length > 0) {
            const sorted = plateMatches.sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());
            return this.mapStay(sorted[0]);
        }
        
        return null;
    }

    async findAllActive(garageId?: string): Promise<Stay[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const qStr = garageId 
            ? `SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?`
            : `SELECT json_data FROM stays`;
            
        const rows = garageId ? db.prepare(qStr).all(garageId) as any[] : db.prepare(qStr).all() as any[];
        const parsed = rows.map(r => JSON.parse(r.json_data));
        
        const active = parsed.filter(s => !s.exitTime && !s.exit_time && s.active !== false);
        return active
            .sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
            .map(s => this.mapStay(s));
    }

    async findByTicketCode(ticketCode: string, garageId?: string): Promise<Stay | null> {
        const db = SQLiteManager.getInstance().getDatabase();
        const qStr = garageId 
            ? `SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?`
            : `SELECT json_data FROM stays`;
            
        const rows = garageId ? db.prepare(qStr).all(garageId) as any[] : db.prepare(qStr).all() as any[];
        const parsed = rows.map(r => JSON.parse(r.json_data));
        
        const found = parsed.find(s => s.ticket_code && s.ticket_code.toUpperCase() === ticketCode.toUpperCase());
        return found ? this.mapStay(found) : null;
    }

    async findPendingProcessing(garageId?: string): Promise<Stay[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const qStr = garageId 
            ? `SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?`
            : `SELECT json_data FROM stays`;
            
        const rows = garageId ? db.prepare(qStr).all(garageId) as any[] : db.prepare(qStr).all() as any[];
        const parsed = rows.map(r => JSON.parse(r.json_data));
        
        const results = parsed.filter(s => s.is_pending_processing === true);
        return results
            .sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
            .map(s => this.mapStay(s));
    }

    async reset(): Promise<void> {
        const db = SQLiteManager.getInstance().getDatabase();
        db.exec(`DELETE FROM stays`);
    }

    async closeZombieStays(plate: string, excludeStayId: string, garageId?: string): Promise<number> {
        const db = SQLiteManager.getInstance().getDatabase();
        const qStr = garageId 
            ? `SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?`
            : `SELECT json_data FROM stays`;
            
        const rows = garageId ? db.prepare(qStr).all(garageId) as any[] : db.prepare(qStr).all() as any[];
        const parsed = rows.map(r => JSON.parse(r.json_data));
        
        const zombies = parsed.filter(s => s.plate === plate.trim().toUpperCase() && !s.exitTime && s.id !== excludeStayId && s.active !== false);
        
        if (zombies.length === 0) return 0;
        
        for (const zombie of zombies) {
            zombie.active = false;
            zombie.exitTime = new Date();
            zombie.updatedAt = new Date();
            await this.save(zombie);
        }
        return zombies.length;
    }
}
