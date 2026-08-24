import { Vehicle } from '../../../shared/schemas';
import { db } from '../../../infrastructure/database/datastore.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { v4 as uuidv4 } from 'uuid';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SqliteVehicleRepository } from './SqliteVehicleRepository.js';

export class NeDBVehicleRepository {
    private queue = new QueueService();

    async save(vehicle: Vehicle): Promise<Vehicle> {
        if (!vehicle.id) {
            vehicle.id = uuidv4();
        }

        const existing = await db.vehicles.findOne({ id: vehicle.id }) as any;
        if (existing && existing.rfid_tag) {
            const incomingTag = (vehicle as any).rfid_tag;
            if (!incomingTag || String(incomingTag).trim() === '') {
                (vehicle as any).rfid_tag = existing.rfid_tag;
            }
        } else if (!(vehicle as any).rfid_tag || String((vehicle as any).rfid_tag).trim() === '') {
            (vehicle as any).rfid_tag = `RFID-${uuidv4().substring(0, 8).toUpperCase()}`;
        }

        const rfidTag = (vehicle as any).rfid_tag;
        if (rfidTag && String(rfidTag).trim() !== '') {
            const normalizedTag = String(rfidTag).trim().toUpperCase();
            (vehicle as any).rfid_tag = normalizedTag;
            const conflict = await db.vehicles.findOne({ rfid_tag: normalizedTag }) as any;
            if (conflict && conflict.id !== vehicle.id) {
                const errorMsg = `RFID Tag "${normalizedTag}" ya está asignado al vehículo ${conflict.plate}. No se puede duplicar.`;
                throw new Error(errorMsg);
            }
        }

        try {
            await db.vehicles.update({ id: vehicle.id }, vehicle, { upsert: true });
        } catch (err) {
            console.error('❌ Repo: Local Save Failed', err);
            throw err;
        }

        await this.queue.enqueue('Vehicle', 'UPDATE', vehicle);
        return vehicle;
    }

    async findById(id: string): Promise<Vehicle | null> {
        return await db.vehicles.findOne({ id }) as Vehicle | null;
    }

    async findByPlate(plate: string, garageId?: string): Promise<Vehicle | null> {
        const normalizedInput = plate.replace(/[\s\-_]/g, '');
        const plateRegex = new RegExp('^[\\s\\-_]*' + [...normalizedInput].join('[\\s\\-_]*') + '[\\s\\-_]*$', 'i');
        const query: any = { plate: { $regex: plateRegex } };
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

export class VehicleRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteVehicleRepository() : new NeDBVehicleRepository();
    }
    async save(vehicle: Vehicle): Promise<Vehicle> { return this.impl.save(vehicle); }
    async findById(id: string): Promise<Vehicle | null> { return this.impl.findById(id); }
    async findByPlate(plate: string, garageId?: string): Promise<Vehicle | null> { return this.impl.findByPlate(plate, garageId); }
    async findByCustomerId(customerId: string, garageId?: string): Promise<Vehicle[]> { return this.impl.findByCustomerId(customerId, garageId); }
    async reset(): Promise<void> { return this.impl.reset(); }
}
