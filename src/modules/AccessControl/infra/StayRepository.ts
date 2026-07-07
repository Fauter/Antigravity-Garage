import { db } from '../../../infrastructure/database/datastore';
import { v4 as uuidv4 } from 'uuid';
import { QueueService } from '../../Sync/application/QueueService';

// Define Interface locally if not available globally to ensure zero-install stability
export interface Stay {
    id?: string;
    _id?: string;
    garageId?: string;
    ownerId?: string;
    plate: string;
    entryTime: Date;
    exitTime?: Date;
    vehicleType?: string;
    vehicleId?: string | null;
    active?: boolean;
    isSubscriber?: boolean;
    subscriptionId?: string | null;
    ticket_code?: string;
    // Hardware Integration fields
    exit_authorized?: boolean;
    exit_authorized_at?: Date | null;
    exit_authorized_by?: string | null;
    entry_photo_path?: string | null;
    is_pending_processing?: boolean;
    anpr_suggested_plate?: string | null;
    barrier_exit_used?: boolean;
    barrier_exit_at?: Date | null;
    // Prepaid / Anticipado
    isPrepaid?: boolean;
    prepaidUntil?: Date | null;
    prepaidTariffId?: string | null;
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

        // 🔍 DIAGNOSTIC: Log hardware authorization state before persistence
        console.log('STAY TO SAVE:', stay.ticket_code, 'exit_authorized:', stay.exit_authorized, 'exit_authorized_at:', stay.exit_authorized_at);

        const doc = {
            ...dataWithoutInternalId,
            id: id, // Ensure public ID is explicit
            garageId: stay.garageId, // Explicitly ensure it's here
            ticket_code: stay.ticket_code, // Explicit inclusion for persistence
            // 🔓 HARDWARE: Explicitly preserve hardware fields to prevent spread overwrite
            exit_authorized: stay.exit_authorized ?? false,
            exit_authorized_at: stay.exit_authorized_at ?? null,
            exit_authorized_by: stay.exit_authorized_by ?? null,
            barrier_exit_used: stay.barrier_exit_used ?? false,
            barrier_exit_at: stay.barrier_exit_at ?? null,
            is_pending_processing: stay.is_pending_processing ?? false,
            anpr_suggested_plate: stay.anpr_suggested_plate ?? null,
            entry_photo_path: stay.entry_photo_path ?? null,
            // ⏱️ PREPAID: Explicitly preserve prepaid fields
            isPrepaid: stay.isPrepaid ?? false,
            prepaidUntil: stay.prepaidUntil ?? null,
            prepaidTariffId: stay.prepaidTariffId ?? null,
            updatedAt: new Date()
        };

        let retries = 3;
        let saved = false;
        
        while (retries > 0 && !saved) {
            try {
                await db.stays.update({ id: id }, doc, { upsert: true });
                // Force persistence to disk (nedb-promises exposes compactDatafile directly)
                if (typeof (db.stays as any).compactDatafile === 'function') {
                    (db.stays as any).compactDatafile();
                }
                saved = true;
            } catch (err: any) {
                retries--;
                console.warn(`⚠️ REPOSITORY: Local NeDB Save Failed. Retries left: ${retries}. Err:`, err.message);
                if (retries === 0) {
                    console.error('❌ REPOSITORY: Failed to save Stay after retries.', err);
                    throw err; // Integrity fail is critical locally
                }
                // Esperar 250ms antes de reintentar (útil para bloqueos de OneDrive)
                await new Promise(res => setTimeout(res, 250));
            }
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
            // Hardware fields — MUST be preserved through the pipeline
            exit_authorized: stay.exit_authorized ?? false,
            exit_authorized_at: stay.exit_authorized_at ?? null,
            exit_authorized_by: stay.exit_authorized_by ?? null,
            entry_photo_path: stay.entry_photo_path ?? null,
            is_pending_processing: stay.is_pending_processing ?? false,
            anpr_suggested_plate: stay.anpr_suggested_plate ?? null,
            barrier_exit_used: stay.barrier_exit_used ?? false,
            barrier_exit_at: stay.barrier_exit_at ?? null,
            // Prepaid / Anticipado
            isPrepaid: stay.isPrepaid ?? false,
            prepaidUntil: stay.prepaidUntil ? new Date(stay.prepaidUntil) : null,
            prepaidTariffId: stay.prepaidTariffId ?? null,
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

            // 2. COMPREHENSIVE plate search: find ANY stay without exitTime
            // Regardless of 'active' flag value — this catches zombies that have
            // active: undefined, active: true, or missing active field entirely.
            const exactPlate = queryInput.trim().toUpperCase();
            const allForPlate = await db.stays.find({ ...query, plate: exactPlate });

            // Filter in-memory: any record WITHOUT exitTime is considered "in garage"
            const openStays = allForPlate.filter((s: any) => !s.exitTime && s.active !== false);

            if (openStays.length > 0) {
                // If multiple open stays exist (zombie scenario), return the most recent one
                const sorted = openStays.sort((a: any, b: any) =>
                    new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
                );
                if (openStays.length > 1) {
                    console.warn(`⚠️ StayRepository: Found ${openStays.length} open stays for plate ${exactPlate}. Returning most recent.`);
                }
                return this.mapStay(sorted[0]);
            }

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

    async findByTicketCode(ticketCode: string, garageId?: string): Promise<Stay | null> {
        try {
            const query: any = { ticket_code: ticketCode };
            if (garageId) query.garageId = garageId;

            const stay = await db.stays.findOne(query);
            if (stay) return this.mapStay(stay);

            // Fallback: case insensitive search
            const all = await db.stays.find(garageId ? { garageId } : {});
            const found = all.find((s: any) =>
                s.ticket_code && s.ticket_code.toUpperCase() === ticketCode.toUpperCase()
            );
            return found ? this.mapStay(found) : null;
        } catch (e) {
            console.error('⚠️ findByTicketCode Error', e);
            return null;
        }
    }

    async findPendingProcessing(garageId?: string): Promise<Stay[]> {
        try {
            const query: any = { is_pending_processing: true };
            if (garageId) query.garageId = garageId;

            const results = await db.stays.find(query);
            return results
                .sort((a: any, b: any) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
                .map((s: any) => this.mapStay(s));
        } catch (e) {
            console.error('⚠️ findPendingProcessing Error', e);
            return [];
        }
    }

    async reset(): Promise<void> {
        await db.stays.remove({}, { multi: true });
    }

    /**
     * Zombie Cleanup: Close all OTHER open stays for a given plate, excluding a specific stay ID.
     * Called after a successful exit to prevent orphaned open records.
     */
    async closeZombieStays(plate: string, excludeStayId: string, garageId?: string): Promise<number> {
        try {
            const query: any = { plate: plate.trim().toUpperCase() };
            if (garageId) query.garageId = garageId;

            const allForPlate: any[] = await db.stays.find(query);
            const zombies = allForPlate.filter((s: any) =>
                !s.exitTime && s.id !== excludeStayId && s.active !== false
            );

            if (zombies.length === 0) return 0;

            console.warn(`🧟 StayRepository: Closing ${zombies.length} zombie stays for plate ${plate}`);

            for (const zombie of zombies) {
                await db.stays.update(
                    { id: zombie.id },
                    { $set: { active: false, exitTime: new Date(), updatedAt: new Date() } },
                    {}
                );
                // Queue sync for the closed zombie
                await this.queue.enqueue('Stay', 'UPDATE', {
                    ...zombie,
                    active: false,
                    exitTime: new Date(),
                    updatedAt: new Date()
                });
                console.log(`🧟 Closed zombie stay: ${zombie.id} (ticket: ${zombie.ticket_code || 'N/A'})`);
            }

            return zombies.length;
        } catch (e) {
            console.error('⚠️ closeZombieStays Error', e);
            return 0;
        }
    }
}
