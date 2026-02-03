import { JsonDB } from '../../../infrastructure/database/json-db';

// Define Interface locally if not available globally to ensure zero-install stability
export interface Stay {
    id?: string;
    _id?: string;
    plate: string;
    entryTime: Date;
    exitTime?: Date;
    vehicleType?: string;
    active?: boolean;
}

export class StayRepository {
    private db: JsonDB<Stay>;

    constructor() {
        this.db = new JsonDB<Stay>('estadias');
    }

    async save(stay: Stay): Promise<Stay> {
        // Ensure ID
        if (!stay.id && !stay._id) {
            stay._id = Math.random().toString(36).substring(2, 9);
            stay.id = stay._id;
        }

        // Logic: Try to find by ID first to update, if not found, create.
        const id = stay.id || stay._id;
        let existing = null;
        if (id) {
            // Try finding by internal ID or mapped ID
            const all = await this.db.getAll();
            existing = all.find(s => s.id === id || s._id === id);
        }

        if (existing) {
            // Update
            await this.db.updateOne({ id: existing.id }, stay);
            // Also try _id if that's what we used
            if (existing._id && existing._id !== existing.id) {
                await this.db.updateOne({ _id: existing._id }, stay);
            }
            return stay;
        } else {
            // Create
            await this.db.create(stay);
            return stay;
        }
    }

    private mapStay(stay: any): Stay {
        return {
            ...stay,
            entryTime: new Date(stay.entryTime),
            exitTime: stay.exitTime ? new Date(stay.exitTime) : undefined,
            createdAt: stay.createdAt ? new Date(stay.createdAt) : undefined
        };
    }

    async findActiveByPlate(plate: string): Promise<Stay | null> {
        const all = await this.db.find({ plate });
        // Active means no exitTime OR exitTime is null/undefined
        const found = all.find(s => !s.exitTime);
        return found ? this.mapStay(found) : null;
    }

    async findAllActive(): Promise<Stay[]> {
        const all = await this.db.find({});
        return all.filter(s => !s.exitTime).map(s => this.mapStay(s));
    }

    async reset(): Promise<void> {
        await this.db.reset();
    }
}
