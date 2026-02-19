import { db } from '../../../infrastructure/database/datastore.js';
import { Movement } from '../../../shared/schemas';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';

export class MovementRepository {
    private queue = new QueueService();

    constructor() { }

    async save(movement: Movement): Promise<Movement> {
        if (!movement.id) {
            movement.id = uuidv4();
        }

        try {
            await db.movements.update({ id: movement.id }, movement, { upsert: true });
        } catch (err) {
            console.error('❌ Repo: Movement Save Failed', err);
            throw err;
        }

        // Movements are critical for billing, ensure queue
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
