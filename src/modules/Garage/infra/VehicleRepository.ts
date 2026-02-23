import { Vehicle } from '../../../shared/schemas';
import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';

export class VehicleRepository {
    private queue = new QueueService();

    async save(vehicle: Vehicle): Promise<Vehicle> {
        // Validation: Ensure ID (UUID v4)
        if (!vehicle.id) {
            vehicle.id = uuidv4();
        }

        // 1. Save to Local Datastore (NeDB) - Zero-Install, works offline
        // NeDB uses _id by default, but we can query by id. 
        // upsert: true equivalent in NeDB is update with upsert: true
        try {
            await db.vehicles.update(
                { id: vehicle.id },
                vehicle,
                { upsert: true }
            );
            console.log(`💾 Repo: Vehicle Saved Local (${vehicle.id})`);
        } catch (err) {
            console.error('❌ Repo: Local Save Failed', err);
            throw err; // Critical local failure
        }

        // 2. Enqueue for Sync (Background Push)
        // We queue specific operation. Here effectively CREATE or UPDATE.
        // We can check if it existed? For simplicity, we can use UPSERT logic in queue or just UPDATE.
        // Let's assume UPDATE implies Create if not exists for Sync logic often.
        // Or cleaner: Queue logic will handle it.
        await this.queue.enqueue('Vehicle', 'UPDATE', vehicle);

        return vehicle;
    }

    async findById(id: string): Promise<Vehicle | null> {
        return await db.vehicles.findOne({ id }) as Vehicle | null;
    }

    async findByPlate(plate: string, garageId?: string): Promise<Vehicle | null> {
        const query: any = { plate };
        if (garageId) query.garageId = garageId;
        return await db.vehicles.findOne(query) as Vehicle | null;
    }

    async findByCustomerId(customerId: string, garageId?: string): Promise<Vehicle[]> {
        const query: any = { customerId };
        if (garageId) query.garageId = garageId;
        return await db.vehicles.find(query) as Vehicle[];
    }

    async reset(): Promise<void> {
        await db.vehicles.remove({}, { multi: true });
    }
}
