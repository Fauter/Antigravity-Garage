import { JsonDB } from '../../../infrastructure/database/json-db';
import { Movement } from '../../../shared/schemas';

export class MovementRepository {
    private db: JsonDB<Movement>;

    constructor() {
        this.db = new JsonDB<Movement>('movements');
    }

    async save(movement: Movement): Promise<Movement> {
        // JsonDB create/update logic. Simple approach: update if exists, else create.
        // Since movement Usually implies new Log, we construct it.
        // check if exists (rare for movements as they are usually immutable events, but let's be safe)
        const existing = await this.db.getById(movement.id);
        if (existing) {
            await this.db.updateOne({ id: movement.id }, movement);
            return movement;
        } else {
            return await this.db.create(movement);
        }
    }

    async findById(id: string): Promise<Movement | null> {
        return this.db.getById(id);
    }

    async findByShiftId(shiftId: string): Promise<Movement[]> {
        const all = await this.db.getAll();
        return all.filter(m => m.shiftId === shiftId);
    }

    async findAll(): Promise<Movement[]> {
        const all = await this.db.getAll();
        // Sort descending by date
        return all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    async reset(): Promise<void> {
        await this.db.reset();
    }
}
