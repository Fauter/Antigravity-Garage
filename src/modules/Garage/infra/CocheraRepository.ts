import { Cochera } from '../../../shared/schemas';
import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';

export class CocheraRepository {
    private queue = new QueueService();

    async save(cochera: Cochera): Promise<Cochera> {
        if (!cochera.id) {
            cochera.id = uuidv4();
        }

        cochera.updatedAt = new Date(); // Inyectar updatedAt consistentemente para Sync

        try {
            await db.cocheras.update({ id: cochera.id }, cochera, { upsert: true });
            console.log(`💾 Repo: Cochera Saved Local (${cochera.id})`);
        } catch (err) {
            console.error('❌ Repo: Cochera Save Failed', err);
            throw err;
        }

        await this.queue.enqueue('Cochera', 'UPDATE', cochera);
        return cochera;
    }

    async findById(id: string): Promise<Cochera | null> {
        return await db.cocheras.findOne({ id }) as Cochera | null;
    }

    async findByGarageId(garageId: string): Promise<Cochera[]> {
        return await db.cocheras.find({ garageId }) as Cochera[];
    }

    async findByGarageAndNumber(garageId: string, numero: string): Promise<Cochera | null> {
        return await db.cocheras.findOne({ garageId, numero }) as Cochera | null;
    }

    async findAll(): Promise<Cochera[]> {
        return await db.cocheras.find({}) as Cochera[];
    }

    async delete(id: string): Promise<void> {
        await db.cocheras.remove({ id }, { multi: false });
        await this.queue.enqueue('Cochera', 'DELETE', { id });
    }

    async reset(): Promise<void> {
        await db.cocheras.remove({}, { multi: true });
    }
}
