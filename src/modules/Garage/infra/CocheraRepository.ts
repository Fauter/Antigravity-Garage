import { Cochera } from '../../../shared/schemas';
import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SqliteCocheraRepository } from './SqliteCocheraRepository.js';

export class NeDBCocheraRepository {
    private queue = new QueueService();

    async save(cochera: Cochera): Promise<Cochera> {
        if (!cochera.id) {
            cochera.id = uuidv4();
        }
        cochera.updatedAt = new Date();
        try {
            await db.cocheras.update({ id: cochera.id }, cochera, { upsert: true });
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

export class CocheraRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteCocheraRepository() : new NeDBCocheraRepository();
    }
    async save(cochera: Cochera): Promise<Cochera> { return this.impl.save(cochera); }
    async findById(id: string): Promise<Cochera | null> { return this.impl.findById(id); }
    async findByGarageId(garageId: string): Promise<Cochera[]> { return this.impl.findByGarageId(garageId); }
    async findByGarageAndNumber(garageId: string, numero: string): Promise<Cochera | null> { return this.impl.findByGarageAndNumber(garageId, numero); }
    async findAll(): Promise<Cochera[]> { return this.impl.findAll(); }
    async delete(id: string): Promise<void> { return this.impl.delete(id); }
    async reset(): Promise<void> {
        if (typeof this.impl.reset === 'function') return this.impl.reset();
    }
}
