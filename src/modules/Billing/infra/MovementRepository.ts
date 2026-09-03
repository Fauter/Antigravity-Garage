import { db } from '../../../infrastructure/database/datastore.js';
import { Movement } from '../../../shared/schemas';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SqliteMovementRepository } from './SqliteMovementRepository.js';

export class NeDBMovementRepository {
    private queue = new QueueService();

    async save(movement: Movement): Promise<Movement> {
        if (!movement.id) movement.id = uuidv4();
        try {
            await db.movements.update({ id: movement.id }, movement, { upsert: true });
        } catch (err) {
            console.error('❌ Repo: Movement Save Failed', err);
            throw err;
        }
        await this.queue.enqueue('Movement', 'CREATE', movement);
        return movement;
    }

    async findById(id: string): Promise<Movement | null> {
        return await db.movements.findOne({ id }) as Movement | null;
    }

    async findByShiftId(shiftId: string): Promise<Movement[]> {
        return await db.movements.find({ shiftId }) as Movement[];
    }

    async findAll(): Promise<Movement[]> {
        return await db.movements.find({}).sort({ timestamp: -1 }) as unknown as Movement[];
    }

    async reset(): Promise<void> {
        await db.movements.remove({}, { multi: true });
    }
}

export class MovementRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteMovementRepository() : new NeDBMovementRepository();
    }
    async save(movement: Movement, arg2?: any, arg3?: any): Promise<Movement> { return this.impl.save(movement, arg2, arg3); }
    async findById(id: string): Promise<Movement | null> { return this.impl.findById(id); }
    async findByShiftId(shiftId: string): Promise<Movement[]> { return this.impl.findByShiftId(shiftId); }
    async findAll(): Promise<Movement[]> { return this.impl.findAll(); }
    async reset(): Promise<void> { return this.impl.reset(); }
}
