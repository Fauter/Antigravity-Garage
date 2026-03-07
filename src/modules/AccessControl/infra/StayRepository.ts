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
    isSubscriber?: boolean;
    subscriptionId?: string | null;
    ticket_code?: string;
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

        // Fix: NeDB throws if we try to update _id. We must exclude it from the $set payload.
        // We use the public 'id' for query, and let NeDB manage the internal _id.
        const { _id, ...dataWithoutInternalId } = stay;

        const doc = {
            ...dataWithoutInternalId,
            id: id, // Ensure public ID is explicit
            garageId: stay.garageId, // Explicitly ensure it's here
            ticket_code: stay.ticket_code, // Explicit inclusion for persistence 
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
            active: stay.active,
            isSubscriber: stay.isSubscriber,
            subscriptionId: stay.subscriptionId,
            ticket_code: stay.ticket_code
        };
    }

    async findActiveByPlateOrTicket(queryInput: string, garageId?: string): Promise<Stay | null> {
        // Local Only (Offline First)
        try {
            const query: any = {};
            if (garageId) query.garageId = garageId;

            // 1. Exact match for ticket_code (Highest Priority)
            const ticketCandidates = await db.stays.find({ ...query, ticket_code: queryInput });
            const activeByTicket = ticketCandidates.find((s: any) => !s.exitTime);
            if (activeByTicket) return this.mapStay(activeByTicket);

            // 2. Exact match for plate, ensuring uppercase
            const exactPlate = queryInput.trim().toUpperCase();
            const plateCandidates = await db.stays.find({ ...query, plate: exactPlate, active: true });

            // NeDB Logic for "Active" (exitTime is null or missing)
            // Filter in memory for safety regarding 'active' logic nuances
            let activeByPlate = plateCandidates.find((s: any) => !s.exitTime);

            // Fallback for older records where active: true might not be explicitly set
            if (!activeByPlate) {
                const legacyCandidates = await db.stays.find({ ...query, plate: exactPlate });
                activeByPlate = legacyCandidates.find((s: any) => !s.exitTime && s.active !== false);
            }

            if (activeByPlate) return this.mapStay(activeByPlate);
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
