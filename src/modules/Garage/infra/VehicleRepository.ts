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

        // ── RFID IMMUTABILITY GUARD ──
        // If rfid_tag is being set to null/undefined but the existing record has one,
        // preserve the existing tag to prevent accidental data loss.
        const existing = await db.vehicles.findOne({ id: vehicle.id }) as any;
        if (existing && existing.rfid_tag) {
            const incomingTag = (vehicle as any).rfid_tag;
            if (!incomingTag || String(incomingTag).trim() === '') {
                // Preserve existing tag — never overwrite with null
                (vehicle as any).rfid_tag = existing.rfid_tag;
                console.log(`🛡️ Repo: Preserved existing rfid_tag "${existing.rfid_tag}" for vehicle ${vehicle.plate}`);
            }
        }

        // ── RFID UNIQUENESS GUARD ──
        // If an rfid_tag is being set, ensure no OTHER vehicle has it
        const rfidTag = (vehicle as any).rfid_tag;
        if (rfidTag && String(rfidTag).trim() !== '') {
            const normalizedTag = String(rfidTag).trim().toUpperCase();
            (vehicle as any).rfid_tag = normalizedTag; // Normalize
            const conflict = await db.vehicles.findOne({ rfid_tag: normalizedTag }) as any;
            if (conflict && conflict.id !== vehicle.id) {
                const errorMsg = `RFID Tag "${normalizedTag}" ya está asignado al vehículo ${conflict.plate}. No se puede duplicar.`;
                console.error(`❌ Repo: ${errorMsg}`);
                throw new Error(errorMsg);
            }
        }

        // 1. Save to Local Datastore (NeDB) - Zero-Install, works offline
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
        await this.queue.enqueue('Vehicle', 'UPDATE', vehicle);

        return vehicle;
    }

    async findById(id: string): Promise<Vehicle | null> {
        return await db.vehicles.findOne({ id }) as Vehicle | null;
    }

    async findByPlate(plate: string, garageId?: string): Promise<Vehicle | null> {
        // Create a regex to match the exact plate ignoring spaces, dashes, and casing
        const normalizedInput = plate.replace(/[\s\-_]/g, '');
        const plateRegex = new RegExp('^[\\\\s\\\\-_]*' + [...normalizedInput].join('[\\\\s\\\\-_]*') + '[\\\\s\\\\-_]*$', 'i');
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
