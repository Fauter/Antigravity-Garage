import { db } from '../../../infrastructure/database/datastore';
import { v4 as uuidv4 } from 'uuid';
import { QueueService } from '../../Sync/application/QueueService';

// Define Interface locally if not available globally to ensure zero-install stability
export interface Stay {
    id?: string;
    _id?: string;
    garageId?: string;
    plate: string;
    entryTime: Date;
    exitTime?: Date;
    vehicleType?: string;
    active?: boolean;
}

export class StayRepository {
    private queue: QueueService;

    constructor() {
        this.queue = new QueueService();
    }

    async save(stay: Stay): Promise<Stay> {
        // Ensure ID
        if (!stay.id && !stay._id) {
            stay._id = uuidv4();
            stay.id = stay._id;
        }
        const id = stay.id || stay._id;

        // 1. Save to Local DB (NeDB)
        if (!stay.garageId) {
            console.warn('⚠️ StayRepository: Saving Stay without garageId. Sync may fail or be inconsistent.');
        }

        const doc = {
            ...stay,
            id: id,
            _id: id, // NeDB compatibility
            garageId: stay.garageId, // Explicitly ensure it's here
            updatedAt: new Date()
        };

        try {
            await db.stays.update({ id: id }, doc, { upsert: true });
        } catch (err) {
            console.error('⚠️ REPOSITORY: Local NeDB Save Failed', err);
            throw err; // Integrity fail is critical locally
        }

        // 2. Queue Mutation for Cloud Sync
        // We queue 'Stay' entity with 'UPDATE' (Upsert logic in sync service)
        await this.queue.enqueue('Stay', 'UPDATE', doc);

        return this.mapStay(doc);
    }

    private mapStay(stay: any): Stay {
        return {
            id: stay.id,
            _id: stay._id,
            garageId: stay.garageId,
            plate: stay.plate,
            entryTime: new Date(stay.entryTime),
            exitTime: stay.exitTime ? new Date(stay.exitTime) : undefined,
            vehicleType: stay.vehicleType,
            active: stay.active
        };
    }

    async findActiveByPlate(plate: string, garageId?: string): Promise<Stay | null> {
        // Local Only (Offline First)
        try {
            const query: any = {
                plate: plate,
            };

            // NeDB Logic for "Active" (exitTime is null or missing)
            // NeDB syntax: { $or: [{ exitTime: null }, { exitTime: { $exists: false } }] }
            // But we can filter in memory if complex, but NeDB supports basic queries.

            if (garageId) query.garageId = garageId;

            // Find all for plate, then filter in memory for safety regarding 'active' logic nuances
            const candidates = await db.stays.find(query);
            const active = candidates.find((s: any) => !s.exitTime);

            if (active) return this.mapStay(active);
            return null;

        } catch (e) {
            console.error('⚠️ Local Read Error', e);
            return null;
        }
    }

    async findAllActive(garageId?: string): Promise<Stay[]> {
        try {
            const query: any = {};
            if (garageId) query.garageId = garageId;

            const all = await db.stays.find(query);
            // Filter inactive in JS
            const active = all.filter((s: any) => !s.exitTime);

            // Sort desc
            return active
                .sort((a: any, b: any) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
                .map((s: any) => this.mapStay(s));
        } catch (e) {
            console.error('Local List Error', e);
            return [];
        }
    }

    async reset(): Promise<void> {
        await db.stays.remove({}, { multi: true });
    }
}
