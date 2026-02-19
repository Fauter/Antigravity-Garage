import { db } from '../../../infrastructure/database/datastore.js';
import { supabase } from '../../../infrastructure/lib/supabase.js';
import { QueueService } from '../../Sync/application/QueueService.js';

export class SyncService {
    private queue = new QueueService();
    private isSyncing = false;
    private syncInterval: NodeJS.Timeout | null = null;
    private garageId: string | null = null;

    constructor() {
        console.log('🔄 SyncService Initialized (Offline-First Worker)');
        this.startBackgroundSync();
    }

    /**
     * Starts the background loop to process the mutation queue.
     */
    startBackgroundSync() {
        if (this.syncInterval) return;

        console.log('🚀 Background Sync Started...');
        this.syncInterval = setInterval(async () => {
            await this.processQueue();
        }, 10000); // Check every 10 seconds
    }

    async processQueue() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            const pending = await this.queue.getPending(10); // Batch of 10
            if (pending.length === 0) {
                this.isSyncing = false;
                return;
            }

            console.log(`📡 Sync: Processing ${pending.length} pending mutations...`);

            for (const mutation of pending) {
                try {
                    await this.pushToCloud(mutation);
                    await this.queue.markSynced(mutation.id);
                    console.log(`✅ Sync: Synced [${mutation.entityType} ${mutation.operation}]`);
                } catch (err: any) {
                    console.error(`❌ Sync: Failed to sync mutation ${mutation.id}`, err);

                    // POISON PILL: Integrity Violations (Foreign Key, Unique, Check) + Missing Table + Extra Columns
                    // 23503: FK Violation, 23505: Unique Violation, 23514: Check Violation
                    // PGRST205: Relation not found (Table missing)
                    // PGRST204: Columns not found (Extra columns in payload)
                    if (['23503', '23505', '23514', 'PGRST205', '42P01', 'PGRST204'].includes(err?.code) || err?.message?.includes('vehicles_type_check')) {
                        console.warn(`☣️ Sync: Mutación ${mutation.id} descartada por Error Irrecuperable (Error ${err?.code}).`);
                        await this.queue.markSynced(mutation.id); // Mark as synced effectively "skips" it
                    } else {
                        await this.queue.incrementRetry(mutation.id);
                    }
                }
            }

        } catch (error) {
            console.error('❌ Sync Loop Error', error);
        } finally {
            this.isSyncing = false;
        }
    }

    private async pushToCloud(mutation: any) {
        const { entityType, operation, data } = mutation;
        const tableMap: any = {
            'Stay': 'stays',
            'Movement': 'movements',
            'Garage': 'garages',
            'Customer': 'customers',
            'Vehicle': 'vehicles',
            'VehicleType': 'vehicle_types',
            'Tariff': 'tariffs',
            'Subscription': 'subscriptions'
        };

        const tableName = tableMap[entityType];
        if (!tableName) throw new Error(`Unknown Table for Entity: ${entityType}`);

        // Sanitize Payload
        const payload = this.mapLocalToRemote(data, entityType);

        if (operation === 'CREATE') {
            const { error } = await supabase.from(tableName).insert(payload);
            if (error) throw error;
        } else if (operation === 'UPDATE') {
            const { error } = await supabase.from(tableName).update(payload).eq('id', payload.id);
            if (error) throw error;
        } else if (operation === 'DELETE') {
            const { error } = await supabase.from(tableName).delete().eq('id', payload.id);
            if (error) throw error;
        }
    }

    async pullAllData(garageId: string) {
        console.log(`📥 Sync: Pulling all data for Garage ${garageId}...`);
        this.garageId = garageId;

        try {
            // 0. Clean Local State (Avoid Ghost Records)
            console.log('🧹 Sync: Purging local transactional data...');
            await db.stays.remove({}, { multi: true });
            await db.movements.remove({}, { multi: true });

            // 1. Config
            await this.fetchTable('vehicle_types', garageId, 'VehicleType');
            await this.fetchTable('tariffs', garageId, 'Tariff');

            // 2. Core Operational Entities
            await this.fetchTable('customers', garageId, 'Customer');
            await this.fetchTable('vehicles', garageId, 'Vehicle');

            // 3. Transactional
            await this.fetchTable('stays', garageId, 'Stay');
            await this.fetchTable('movements', garageId, 'Movement');
            await this.fetchTable('subscriptions', garageId, 'Subscription');

            console.log('✅ Sync: Bootstrap Complete.');
        } catch (error) {
            console.error('❌ Sync: Bootstrap Failed', error);
            throw error;
        }
    }

    private async fetchTable(tableName: string, garageId: string, entityType: string) {
        try {
            // Basic query filtering by garage_id mostly
            let query = supabase.from(tableName).select('*');

            if (tableName === 'garages') {
                query = query.eq('id', garageId);
            } else {
                query = query.eq('garage_id', garageId);
            }

            const { data, error } = await query;
            if (error) throw error;

            if (data) {
                console.log(`📥 Sync: Fetched ${data.length} records for ${entityType}`);
                for (const item of data) {
                    await this.upsertLocal(entityType, item);
                }
            }
        } catch (err) {
            console.error(`❌ Sync: Error fetching ${tableName}`, err);
        }
    }

    private async upsertLocal(entityType: string, remoteItem: any) {
        const localItem = this.mapRemoteToLocalImport(remoteItem, entityType);

        let collection: any;
        switch (entityType) {
            case 'VehicleType': collection = db.vehicleTypes; break;
            case 'Tariff': collection = db.tariffs; break;
            case 'Checkpoint': collection = db.checkpoints; break;
            case 'Customer': collection = db.customers; break;
            case 'Vehicle': collection = db.vehicles; break;
            case 'Stay': collection = db.stays; break;
            case 'Movement': collection = db.movements; break;
            case 'Subscription': collection = db.subscriptions; break;
        }

        if (collection) {
            await collection.update({ id: localItem.id }, localItem, { upsert: true });
        }
    }

    private mapRemoteToLocalImport(item: any, type: string) {
        const local: any = { ...item };

        // Convert key timestamps to string (NeDB friendly?) or Date objects? 
        // NeDB stores what you give it. Code usually expects ISO strings or Date objects.
        // Let's stick to keeping them as is or converting common fields.
        // Actually, matching the reverse of mapLocalToRemote is good practice.

        if (local.created_at) { local.createdAt = local.created_at; delete local.created_at; }
        if (local.updated_at) { local.updatedAt = local.updated_at; delete local.updated_at; }
        if (local.garage_id) { local.garageId = local.garage_id; delete local.garage_id; }

        if (type === 'Stay') {
            if (local.entry_time) { local.entryTime = local.entry_time; delete local.entry_time; }
            if (local.exit_time) { local.exitTime = local.exit_time; delete local.exit_time; }
            if (local.vehicle_id) { local.vehicleId = local.vehicle_id; delete local.vehicle_id; }
            if (local.vehicle_type) { local.vehicleType = local.vehicle_type; delete local.vehicle_type; }
        }

        if (type === 'Movement') {
            if (local.payment_method) { local.paymentMethod = local.payment_method; delete local.payment_method; }
            if (local.shift_id) { local.shiftId = local.shift_id; delete local.shift_id; }
            if (local.related_entity_id) { local.relatedEntityId = local.related_entity_id; delete local.related_entity_id; }
            if (local.invoice_type) { local.invoiceType = local.invoice_type; delete local.invoice_type; }
            if (local.ticket_number) { local.ticketNumber = local.ticket_number; delete local.ticket_number; }
        }

        if (type === 'Vehicle') {
            if (local.customer_id) { local.customerId = local.customer_id; delete local.customer_id; }
            if (local.vehicle_type_id) { local.vehicleTypeId = local.vehicle_type_id; delete local.vehicle_type_id; }
        }

        if (type === 'Subscription') {
            if (local.start_date) { local.startDate = local.start_date; delete local.start_date; }
            if (local.end_date) { local.endDate = local.end_date; delete local.end_date; }
            if (local.vehicle_id) { local.vehicleId = local.vehicle_id; delete local.vehicle_id; }
            if (local.customer_id) { local.customerId = local.customer_id; delete local.customer_id; }
        }

        return local;
    }

    private mapLocalToRemote(item: any, type: string) {
        const base = { ...item };

        // 0. GLOBAL SANITIZATION (The "Purification")
        delete base._id;      // Remove NeDB internal ID
        delete base.updatedAt; // Let Supabase handle updated_at

        // 1. Generic ID & Timestamp Mappings (Global)
        if (base.garageId) {
            base.garage_id = base.garageId;
            delete base.garageId;
        }
        if (base.ownerId) {
            base.owner_id = base.ownerId;
            delete base.ownerId;
        }
        if (base.createdAt) {
            base.created_at = new Date(base.createdAt).toISOString();
            delete base.createdAt;
        }
        if (base.updatedAt) {
            base.updated_at = new Date(base.updatedAt).toISOString();
            delete base.updatedAt;
        }

        // 2. Entity Specific Mappings
        if (type === 'Stay') {
            if (base.entryTime) { base.entry_time = new Date(base.entryTime).toISOString(); delete base.entryTime; }
            if (base.exitTime) { base.exit_time = new Date(base.exitTime).toISOString(); delete base.exitTime; }
            if (base.vehicleType) { base.vehicle_type = base.vehicleType; delete base.vehicleType; }
            if (base.vehicleId) { base.vehicle_id = base.vehicleId; delete base.vehicleId; }

            // STRICT CLEANUP: Remove customer_id as it doesn't exist on Stays table
            delete base.customerId;
            delete base.customer_id;
        }

        if (type === 'Movement') {
            if (base.paymentMethod) { base.payment_method = base.paymentMethod; delete base.paymentMethod; }
            if (base.shiftId) { base.shift_id = base.shiftId; delete base.shiftId; }
            if (base.relatedEntityId) { base.related_entity_id = base.relatedEntityId; delete base.relatedEntityId; }
            if (base.invoiceType) { base.invoice_type = base.invoiceType; delete base.invoiceType; }
            if (base.ticketNumber) { base.ticket_number = base.ticketNumber; delete base.ticketNumber; }
        }

        if (type === 'Subscription') {
            if (base.startDate) { base.start_date = new Date(base.startDate).toISOString(); delete base.startDate; }
            if (base.endDate) { base.end_date = new Date(base.endDate).toISOString(); delete base.endDate; }
            if (base.vehicleId) { base.vehicle_id = base.vehicleId; delete base.vehicleId; }
            if (base.customerId) { base.customer_id = base.customerId; delete base.customerId; }
        }

        if (type === 'Vehicle') {
            if (base.customerId) { base.customer_id = base.customerId; delete base.customerId; }
            if (base.vehicleTypeId) { base.vehicle_type_id = base.vehicleTypeId; delete base.vehicleTypeId; }

            // DATA CORRECTION for Check Constraint
            if (base.type === 'Automovil') base.type = 'Auto';
            if (base.type === 'Camioneta') base.type = 'PickUp';
        }

        // SANITIZE FKs (Integrity Protection)
        const fks = ['garage_id', 'owner_id', 'customer_id', 'vehicle_id', 'vehicle_type_id', 'tariff_id', 'related_entity_id', 'shift_id'];
        fks.forEach(fk => {
            // Only modify if key exists in object to avoid adding nulls for non-existent columns
            if (Object.prototype.hasOwnProperty.call(base, fk)) {
                if (base[fk] === '' || base[fk] === null || base[fk] === undefined || base[fk] === 'null') {
                    base[fk] = null;
                }
            }
        });

        return base;
    }

    initRealtime(garageId: string) {
        console.log('🔌 Realtime listeners ready (Stub)');
    }
}

const instance = new SyncService();

// Exportación con binding explícito para preservar el contexto de la clase
export const syncService = {
    pullAllData: instance.pullAllData.bind(instance),
    initRealtime: instance.initRealtime.bind(instance),
    processQueue: instance.processQueue.bind(instance)
};
