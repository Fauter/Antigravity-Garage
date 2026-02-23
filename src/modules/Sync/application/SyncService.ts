import { db } from '../../../infrastructure/database/datastore.js';
import { supabase } from '../../../infrastructure/lib/supabase.js';
import { QueueService } from '../../Sync/application/QueueService.js';

export class SyncService {
    private queue = new QueueService();
    private isSyncing = false;
    public isGlobalSyncing: boolean = false;
    private syncInterval: NodeJS.Timeout | null = null;
    private garageId: string | null = null;

    constructor() {
        console.log('🔄 SyncService Initialized (Offline-First Worker)');
        this.startBackgroundSync();
    }

    /**
     * Starts the background loop to process the mutation queue.
     */
    async startBackgroundSync() {
        if (this.syncInterval) return;

        // EMERGENCY FLUSH: Clear stuck mutations on startup
        console.log('🧹 Sync: Flushing legacy mutations...');
        await db.mutations.remove({}, { multi: true });

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
        // FIX: Extract 'payload' as 'rawData' (QueueService stores it as 'payload')
        const { entityType, operation, payload: rawData } = mutation;

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
        const payload = this.mapLocalToRemote(rawData, entityType);

        if (operation === 'CREATE' || operation === 'UPDATE') {
            // UPSERT strategy for resilience
            const { data: syncData, error, status } = await supabase.from(tableName).upsert(payload).select();
            console.log(`📡 DEBUG SYNC [${entityType}]: Status ${status}, Data:`, syncData, `Error:`, error);

            if (error) throw error;
        } else if (operation === 'DELETE') {
            // For DELETE, we might only have ID, but mapLocalToRemote handles safe extraction
            const { error, status } = await supabase.from(tableName).delete().eq('id', payload.id);
            console.log(`📡 DEBUG SYNC [${entityType} DELETE]: Status ${status}, Error:`, error);
            if (error) throw error;
        }
    }

    async pullAllData(garageId: string) {
        console.log(`📥 Sync: Pulling all data for Garage ${garageId}...`);
        this.garageId = garageId;
        this.isGlobalSyncing = true;

        try {
            // 0. Clean Local State (Avoid Ghost Records)
            console.log('🧹 Sync: Purging local transactional data...');
            await db.stays.remove({}, { multi: true });
            await db.movements.remove({}, { multi: true });
            await db.tariffs.remove({}, { multi: true });
            await db.vehicleTypes.remove({}, { multi: true });
            await db.prices.remove({}, { multi: true }); // Clean Prices to avoid duplicates
            await db.customers.remove({}, { multi: true }); // Required Purge for Ghost syncs
            await db.vehicles.remove({}, { multi: true }); // Required Purge for Ghost syncs
            await db.subscriptions.remove({}, { multi: true }); // Required Purge for Ghost syncs

            // DELAY TO ALLOW OS/ANTIVIRUS TO RELEASE FILE LOCKS ON THE .db~ FILES
            console.log('⏳ Sync: Pausing for 1000ms to allow OS to release DB locks...');
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 1. Config (CRITICAL: Fetch first to populate UI dropdowns)
            await this.fetchTable('vehicle_types', garageId, 'VehicleType');
            await this.fetchTable('tariffs', garageId, 'Tariff');
            await this.fetchTable('prices', garageId, 'Price'); // New: Sync Prices

            // 2. Core Operational Entities
            await this.fetchTable('customers', garageId, 'Customer');
            await this.fetchTable('vehicles', garageId, 'Vehicle');

            // 3. Transactional
            await this.fetchTable('stays', garageId, 'Stay');
            await this.fetchTable('movements', garageId, 'Movement');
            await this.fetchTable('subscriptions', garageId, 'Subscription');

            console.log('✅ Sync: Bootstrap Complete.');
            this.isGlobalSyncing = false;
        } catch (error) {
            console.error('❌ Sync: Bootstrap Failed', error);
            this.isGlobalSyncing = false;
            throw error;
        }
    }

    private async fetchTable(tableName: string, garageId: string, entityType: string) {
        try {
            // Basic query filtering by nature
            let query = supabase.from(tableName).select('*');

            if (tableName === 'garages') {
                query = query.eq('id', garageId);
            } else {
                query = query.eq('garage_id', garageId);
            }

            const { data, error } = await query;
            if (error) throw error;

            if (data && data.length > 0) {
                console.log(`📥 Sync: Fetched ${data.length} records for ${entityType}, preparing bulk insert...`);

                // Map all data exactly as before
                const localItems = data.map(item => this.mapRemoteToLocalImport(item, entityType));

                // Determine collection
                let collection: any;
                switch (entityType) {
                    case 'VehicleType': collection = db.vehicleTypes; break;
                    case 'Tariff': collection = db.tariffs; break;
                    case 'Price': collection = db.prices; break; // New: Prices
                    case 'Customer': collection = db.customers; break;
                    case 'Vehicle': collection = db.vehicles; break;
                    case 'Stay': collection = db.stays; break;
                    case 'Movement': collection = db.movements; break;
                    case 'Subscription': collection = db.subscriptions; break;
                    case 'Garage': collection = db.garages; break;
                }

                if (collection) {
                    // Bulk insert to prevent rapid file rewrites and EPERM errors
                    await collection.insert(localItems);
                    console.log(`✅ Sync: Bulk inserted ${localItems.length} records into ${entityType}`);
                }
            }
        } catch (err) {
            console.error(`❌ Sync: Error fetching ${tableName}`, err);
        }
    }

    private mapRemoteToLocalImport(item: any, type: string) {
        const local: any = { ...item };

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

        if (type === 'Tariff') {
            local.days = Number(item.days || 0);
            local.hours = Number(item.hours || 0);
            local.minutes = Number(item.minutes || 0);
            // Log de seguridad para ver qué estamos guardando
            console.log(`[Sync] Mapeando Tarifa: ${local.name} -> ${local.days}d ${local.hours}h ${local.minutes}m`);
        }

        if (type === 'Price') {
            if (local.vehicle_type_id) { local.vehicleTypeId = local.vehicle_type_id; delete local.vehicle_type_id; }
            if (local.tariff_id) { local.tariffId = local.tariff_id; delete local.tariff_id; }
            if (local.price_list) { local.priceList = local.price_list; delete local.price_list; }
            if (local.amount !== undefined) { local.amount = Number(local.amount); }
            if (local.id) { local.id = String(local.id); } // Usar ID único de Supabase
        }

        return local;
    }

    private mapLocalToRemote(item: any, type: string) {
        if (!item) return {}; // Fail-Safe

        // 1. STAY: Strict Manual Mapping (The "Ironclad" approach)
        if (type === 'Stay') {
            let vType = item.vehicleType || item.vehicle_type;

            // Safety: If it's still a UUID (missed by controller?), force fallback
            if (vType && vType.length > 20 && !vType.includes(' ')) {
                console.warn(`⚠️ Sync: Detected UUID in Stay vehicle_type (${vType}). Fallback to 'Auto'`);
                vType = 'Auto';
            }

            return {
                id: item.id,
                garage_id: item.garageId || item.garage_id,
                plate: item.plate,
                vehicle_type: vType,
                vehicle_id: item.vehicleId || item.vehicle_id, // Added vehicle_id logic
                active: item.active,
                is_subscriber: item.isSubscriber || false,
                subscription_id: item.subscriptionId || item.subscription_id || null,
                entry_time: item.entryTime ? new Date(item.entryTime).toISOString() : (item.entry_time || null),
                exit_time: item.exitTime ? new Date(item.exitTime).toISOString() : (item.exit_time || null)
            };
        }

        // 2. Generic Base Mappings for others
        const base: any = { ...item };

        // Remove Internal Fields
        delete base._id;
        // Supabase handles updated_at, but we map created_at if present
        delete base.updatedAt;
        delete base.createdAt;

        if (item.createdAt) base.created_at = new Date(item.createdAt).toISOString();
        if (item.updatedAt) base.updated_at = new Date(item.updatedAt).toISOString();
        if (item.garageId) { base.garage_id = item.garageId; delete base.garageId; }
        if (item.ownerId) { base.owner_id = item.ownerId; delete base.ownerId; }

        // Entity Specifics
        if (type === 'Movement') {
            if (base.paymentMethod) { base.payment_method = base.paymentMethod; delete base.paymentMethod; }
            if (base.shiftId) { base.shift_id = base.shiftId; delete base.shiftId; }
            if (base.relatedEntityId) { base.related_entity_id = base.relatedEntityId; delete base.relatedEntityId; }
            if (base.invoiceType) { base.invoice_type = base.invoiceType; delete base.invoiceType; }
            if (base.ticketNumber) { base.ticket_number = base.ticketNumber; delete base.ticketNumber; }
        }

        if (type === 'Customer') {
            console.log('📡 DEBUG SYNC: Objeto Customer recibido de NeDB:', JSON.stringify(item));

            if (base.customerId) { base.customer_id = base.customerId; delete base.customerId; }
            if (base.garageId) { base.garage_id = base.garageId; delete base.garageId; }
            if (base.ownerId) { base.owner_id = base.ownerId; delete base.ownerId; }

            console.log('📡 DEBUG SYNC: Objeto tras mapeo (antes de whitelist):', JSON.stringify(base));

            // Strip unauthorized fields from Customer to prevent PGRST204
            const allowedCustomerFields = ['id', 'garage_id', 'owner_id', 'name', 'email', 'phone', 'dni', 'address', 'localidad', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedCustomerFields.includes(key)) {
                    delete base[key];
                }
            });

            console.log('📡 DEBUG SYNC: Objeto final enviado a Supabase:', JSON.stringify(base));
        }

        if (type === 'Vehicle') {
            if (base.customerId) { base.customer_id = base.customerId; delete base.customerId; }
            if (base.vehicleTypeId) { base.vehicle_type_id = base.vehicleTypeId; delete base.vehicleTypeId; }
            if (base.garageId) { base.garage_id = base.garageId; delete base.garageId; }
            // CRITICAL: Type should be freeform, do NOT map 'Camioneta' to 'PickUp' anymore as requested by user

            // Ensure Plate
            if (!base.plate && item.plate) base.plate = item.plate;
            // Map Subscriber Status
            base.is_subscriber = item.isSubscriber || item.is_subscriber || false;
            delete base.isSubscriber; // Prevent PGRST204 (Extra column)

            const allowedVehicleFields = ['id', 'garage_id', 'owner_id', 'plate', 'type', 'brand', 'model', 'color', 'year', 'insurance', 'is_subscriber', 'vehicle_type_id', 'customer_id', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedVehicleFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        if (type === 'Subscription') {
            if (base.startDate) { base.start_date = new Date(base.startDate).toISOString(); delete base.startDate; }
            if (base.endDate) { base.end_date = new Date(base.endDate).toISOString(); delete base.endDate; }
            if (base.vehicleId) { base.vehicle_id = base.vehicleId; delete base.vehicleId; }
            if (base.customerId) { base.customer_id = base.customerId; delete base.customerId; }
            if (base.garageId) { base.garage_id = base.garageId; delete base.garageId; }

            const allowedSubFields = ['id', 'garage_id', 'owner_id', 'customer_id', 'vehicle_id', 'type', 'price', 'start_date', 'end_date', 'active', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedSubFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        // SANITIZE FKs
        const fks = ['garage_id', 'owner_id', 'customer_id', 'vehicle_id', 'vehicle_type_id', 'tariff_id', 'related_entity_id', 'shift_id'];
        fks.forEach(fk => {
            if (Object.prototype.hasOwnProperty.call(base, fk)) {
                if (base[fk] === '' || base[fk] === null || base[fk] === 'null') {
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
    processQueue: instance.processQueue.bind(instance),
    get isGlobalSyncing() { return instance.isGlobalSyncing; }
};
