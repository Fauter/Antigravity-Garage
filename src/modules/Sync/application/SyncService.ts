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

            const MAX_RETRIES = 5;

            for (const mutation of pending) {
                // 🛡️ MAX RETRY CAP: Discard mutations stuck in retry loop
                if (mutation.retryCount >= MAX_RETRIES) {
                    console.warn(`☣️ Sync: Mutación ${mutation.id} [${mutation.entityType}] descartada tras ${mutation.retryCount} reintentos.`);
                    await this.queue.markSynced(mutation.id);
                    continue;
                }

                try {
                    await this.pushToCloud(mutation);
                    await this.queue.markSynced(mutation.id);
                    console.log(`✅ Sync: Synced [${mutation.entityType} ${mutation.operation}]`);
                } catch (err: any) {
                    console.error(`❌ Sync: Failed to sync mutation ${mutation.id}`, err);

                    // POISON PILL: Integrity Violations (Foreign Key, Unique, Check) + Missing Table + Extra Columns
                    // 23505: Unique Violation, 23514: Check Violation
                    // PGRST205: Relation not found (Table missing)
                    if (['23505', '23514', 'PGRST205', 'PGRST204', '42P01'].includes(err?.code) || err?.message?.includes('vehicles_type_check')) {
                        // PGRST204 is now a poison pill — column cleanup is handled at the mapping layer
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
            'Subscription': 'subscriptions',
            'Cochera': 'cocheras',
            'Debt': 'debts',
            'ShiftClose': 'shift_closes',
            'PartialClose': 'partial_closes',
            'Incident': 'incidents',
            'BuildingLevel': 'building_levels'
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
            // SOFT DELETE: En lugar de borrar, actualizamos con deleted_at
            const { error, status } = await supabase.from(tableName).update({ deleted_at: new Date().toISOString() }).eq('id', payload.id);
            console.log(`📡 DEBUG SYNC [${entityType} SOFT-DELETE]: Status ${status}, Error:`, error);
            if (error) throw error;
        }
    }

    async pullAllData(garageId: string, isSilent: boolean = false) {
        // Detección Crítica de Entorno
        const projectPath = process.cwd().toLowerCase();
        if (projectPath.includes('onedrive')) {
            console.warn('⚠️ WARNING: Ejecutando en OneDrive. Esto causará bloqueos extremos de lectura/escritura en la base de datos local (NeDB) debido a la Sincronización Continua de Windows.');
        }

        console.log(`📥 Sync: Pulling all data for Garage ${garageId}... (Silent: ${isSilent})`);
        this.garageId = garageId;

        if (!isSilent) {
            this.isGlobalSyncing = true;
        }

        try {
            // Delta Sync: Leer el estado de la sincronización
            const syncStateDoc: any = await db.syncState.findOne({ garageId });
            const lastSyncTimestamp = syncStateDoc?.last_sync_timestamp;
            let hasErrors = false;

            const fetchSafe = async (table: string, gId: string, entity: string) => {
                try {
                    await this.fetchTable(table, gId, entity, lastSyncTimestamp);
                } catch (e: any) {
                    console.error(`❌ Sync: Error cargando tabla ${table}: ${e.message || e}`);
                    hasErrors = true;
                }
            };

            // 1. Config (CRITICAL: Fetch first to populate UI dropdowns)
            await fetchSafe('vehicle_types', garageId, 'VehicleType');
            await fetchSafe('tariffs', garageId, 'Tariff');
            await fetchSafe('prices', garageId, 'Price'); // New: Sync Prices
            await fetchSafe('financial_configs', garageId, 'FinancialConfig');
            await fetchSafe('promos', garageId, 'Promo');
            await fetchSafe('building_levels', garageId, 'BuildingLevel');

            // 2. Core Operational Entities
            await fetchSafe('customers', garageId, 'Customer');
            await fetchSafe('vehicles', garageId, 'Vehicle');
            await fetchSafe('cocheras', garageId, 'Cochera');

            // 3. Transactional
            await fetchSafe('stays', garageId, 'Stay');
            await fetchSafe('movements', garageId, 'Movement');
            await fetchSafe('subscriptions', garageId, 'Subscription');
            await fetchSafe('debts', garageId, 'Debt');
            await fetchSafe('shift_closes', garageId, 'ShiftClose');
            await fetchSafe('partial_closes', garageId, 'PartialClose');
            await fetchSafe('incidents', garageId, 'Incident');

            console.log('✅ Sync: Ciclo de sincronización completado.');

            if (!hasErrors) {
                const newTimestamp = new Date().toISOString();
                await db.syncState.update(
                    { garageId }, 
                    { $set: { garageId, last_sync_timestamp: newTimestamp } }, 
                    { upsert: true }
                );
                console.log(`✅ Sync: Timestamp actualizado exitosamente a ${newTimestamp}`);
            } else {
                console.warn(`⚠️ Sync: No se actualizó el timestamp debido a errores parciales en algunas tablas.`);
            }

            if (!isSilent) {
                this.isGlobalSyncing = false;
            }
        } catch (error) {
            console.error('❌ Sync: Bootstrap Failed', error);
            if (!isSilent) {
                this.isGlobalSyncing = false;
            }
            throw error;
        }
    }

    private async fetchTable(tableName: string, garageId: string, entityType: string, lastSyncTimestamp?: string) {
        try {
            console.log(`🔍 Sync: Fetching table [${tableName}] para [${garageId}] (Delta: ${lastSyncTimestamp || 'Initial Load'})...`);

            // --- PAGINATED FETCH: Loop de 1000 en 1000 para superar el límite de Supabase ---
            const PAGE_SIZE = 1000;
            let allData: any[] = [];
            let from = 0;

            while (true) {
                const to = from + PAGE_SIZE - 1;
                let query = supabase.from(tableName).select('*');

                if (tableName === 'garages') {
                    query = query.eq('id', garageId);
                } else {
                    query = query.eq('garage_id', garageId);
                }

                // Aplicar Delta Sync o Límite de carga inicial (30 días para Históricas)
                if (lastSyncTimestamp) {
                    query = query.gte('updated_at', lastSyncTimestamp);
                } else {
                    // Carga Inicial: Solo filtrar tablas históricas
                    const historicas = ['stays', 'movements', 'shift_closes', 'partial_closes', 'incidents'];
                    if (historicas.includes(tableName)) {
                        const limitDate = new Date();
                        limitDate.setDate(limitDate.getDate() - 30);
                        query = query.gte('created_at', limitDate.toISOString());
                    }
                    // Las tablas maestras no llevan filtro de fecha en la carga inicial
                }

                const { data: pageData, error } = await query.range(from, to);
                if (error) throw error;

                if (pageData && pageData.length > 0) {
                    allData = allData.concat(pageData);
                }

                // Si la página trajo menos de PAGE_SIZE, ya no hay más datos
                if (!pageData || pageData.length < PAGE_SIZE) {
                    break;
                }

                from += PAGE_SIZE;
            }

            if (allData.length === 0) {
                console.log(`⚠️ Sync: No records found for ${entityType} in Supabase.`);
            } else {
                console.log(`📥 Sync: Fetched ${allData.length} total records for [${entityType}] (paginated).`);
            }

            // Mapeo Local (Descartar _id interno para inserción masiva)
            const localItems = allData.map(item => {
                const localItem = this.mapRemoteToLocalImport(item, entityType);
                if (localItem._id) delete localItem._id;
                return localItem;
            });

            // Determinar colección
            let collection: any;
            switch (entityType) {
                case 'VehicleType': collection = db.vehicleTypes; break;
                case 'Tariff': collection = db.tariffs; break;
                case 'Price': collection = db.prices; break;
                case 'Customer': collection = db.customers; break;
                case 'Vehicle': collection = db.vehicles; break;
                case 'Stay': collection = db.stays; break;
                case 'Movement': collection = db.movements; break;
                case 'Subscription': collection = db.subscriptions; break;
                case 'Garage': collection = db.garages; break;
                case 'Cochera': collection = db.cocheras; break;
                case 'Debt': collection = db.debts; break;
                case 'FinancialConfig': collection = db.financialConfigs; break;
                case 'ShiftClose': collection = db.shiftCloses; break;
                case 'PartialClose': collection = db.partialCloses; break;
                case 'Incident': collection = db.incidents; break;
                case 'Promo': collection = db.promos; break;
                case 'BuildingLevel': collection = db.buildingLevels; break;
            }

            if (collection) {
                // Validación Estricta de estado NeDB (No colgar la cola si base no inicializada)
                if (typeof collection.loadDatabase === 'function') {
                    // 1. Forzar/Esperar la carga explícita de la DB para evitar encolamientos infinitos
                    await collection.loadDatabase();
                    console.log(`✅ Datastore [${entityType}] loaded successfully.`);
                } else if (collection.executor && collection.executor.ready === false) {
                    throw new Error(`NeDB Store for [${entityType}] is NOT LOADED, operation rejected.`);
                }

                // --- MUTATION GUARD: Preservar salidas recientes antes del Upsert (Solo para Stay) ---
                let preservedStayIds = new Set<string>();
                if (entityType === 'Stay') {
                    const now = Date.now();
                    const GUARD_WINDOW_MS = 60_000; // 60 segundos
                    const allLocalStays: any[] = await collection.find({});
                    allLocalStays.forEach((s: any) => {
                        if (s.active === false && s.exitTime) {
                            const exitTs = new Date(s.exitTime).getTime();
                            if ((now - exitTs) <= GUARD_WINDOW_MS) {
                                preservedStayIds.add(s.id);
                            }
                        }
                    });

                    if (preservedStayIds.size > 0) {
                        console.log(`🛡️ Sync Guard: Omitiendo upsert para ${preservedStayIds.size} salidas recientes (<60s).`);
                    }
                }

                console.log(`📥 Sync: Delta Sync iniciado para [${entityType}] (${localItems.length} registros)...`);

                let numRemoved = 0;
                let numUpserted = 0;
                let numOmitted = 0;

                for (const item of localItems) {
                    // Omitir si es un Stay recién modificado localmente
                    if (entityType === 'Stay' && preservedStayIds.has(item.id)) {
                        numOmitted++;
                        continue;
                    }

                    // Soft Delete Check local (Remover físicamente de NeDB)
                    if (item.deleted_at !== null && item.deleted_at !== undefined) {
                        await collection.remove({ id: item.id }, {});
                        numRemoved++;
                    } else {
                        // Limpiar deleted_at por si acaso antes de guardar local
                        const { deleted_at, ...itemToSave } = item;
                        await collection.update({ id: itemToSave.id }, { $set: itemToSave }, { upsert: true });
                        numUpserted++;
                    }
                }

                console.log(`✅ Sync: [${entityType}] Sincronizado OK. (Borrados: ${numRemoved} | Upserted: ${numUpserted} | Omitidos: ${numOmitted})`);
            }

        } catch (err: any) {
            console.error(`❌ Sync: Error crítico sincronizando [${tableName} -> ${entityType}]:`, err.message || err);
            throw err; // El Error sube al fetchSafe en PullAllData y detiene SU tabla, no toda la APP.
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
            // receipt_number and ticket_code: same name in both local and remote, no mapping needed
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

        if (type === 'Cochera') {
            if (local.cliente_id) { local.clienteId = local.cliente_id; delete local.cliente_id; }
            if (local.precio_base) { local.precioBase = Number(local.precio_base); delete local.precio_base; }
        }

        if (type === 'Debt') {
            if (local.subscription_id) { local.subscriptionId = local.subscription_id; delete local.subscription_id; }
            if (local.customer_id) { local.customerId = local.customer_id; delete local.customer_id; }

            // STRICT NUMBER SANITIZATION for Financial Safety
            local.surchargeApplied = local.surcharge_applied !== undefined ? Number(local.surcharge_applied) || 0 : 0;
            local.amount = local.amount !== undefined ? Number(local.amount) || 0 : 0;

            delete local.surcharge_applied;

            if (local.due_date) { local.dueDate = local.due_date; delete local.due_date; }
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

        if (type === 'FinancialConfig') {
            if (local.initial_tolerance !== undefined) { local.initialTolerance = Number(local.initial_tolerance); delete local.initial_tolerance; }
            if (local.fractionate_after !== undefined) { local.fractionateAfter = Number(local.fractionate_after); delete local.fractionate_after; }

            if (local.surcharge_config && typeof local.surcharge_config === 'string') {
                try {
                    local.surchargeConfig = JSON.parse(local.surcharge_config);
                } catch (e) {
                    console.error("Failed to parse surcharge_config", e);
                    local.surchargeConfig = local.surcharge_config;
                }
                delete local.surcharge_config;
            } else if (local.surcharge_config) {
                local.surchargeConfig = local.surcharge_config;
                delete local.surcharge_config;
            }
        }

        if (type === 'ShiftClose') {
            if (local.total_in_cash !== undefined) { local.totalInCash = Number(local.total_in_cash); delete local.total_in_cash; }
            if (local.staying_in_cash !== undefined) { local.stayingInCash = Number(local.staying_in_cash); delete local.staying_in_cash; }
            if (local.rendered_amount !== undefined) { local.renderedAmount = Number(local.rendered_amount); delete local.rendered_amount; }
        }

        if (type === 'PartialClose') {
            if (local.recipient_name !== undefined) { local.recipientName = local.recipient_name; delete local.recipient_name; }
            if (local.amount !== undefined) { local.amount = Number(local.amount); }
        }

        if (type === 'Incident') {
            if (local.garage_id) { local.garageId = local.garage_id; delete local.garage_id; }
            if (local.created_at) { local.createdAt = local.created_at; delete local.created_at; }
        }

        if (type === 'Promo') {
            if (local.porcentaje !== undefined) { local.porcentaje = Number(local.porcentaje); }
        }

        if (type === 'BuildingLevel') {
            if (local.display_name !== undefined) { local.displayName = local.display_name; delete local.display_name; }
            if (local.sort_order !== undefined) { local.sortOrder = Number(local.sort_order); delete local.sort_order; }
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

            const stayPayload: any = {
                id: item.id,
                garage_id: item.garageId || item.garage_id,
                plate: item.plate,
                vehicle_type: vType,
                vehicle_id: item.vehicleId || item.vehicle_id,
                active: item.active,
                is_subscriber: item.isSubscriber || false,
                subscription_id: item.subscriptionId || item.subscription_id || null,
                ticket_code: item.ticket_code || null,
                entry_time: item.entryTime ? new Date(item.entryTime).toISOString() : (item.entry_time || null),
                exit_time: item.exitTime ? new Date(item.exitTime).toISOString() : (item.exit_time || null),
                // 🔓 HARDWARE: Only sync fields that EXIST in the Supabase 'stays' table.
                // exit_authorized is the core flag. All other hardware fields
                // (exit_authorized_at, authorized_at, exit_authorized_by, barrier_exit_*,
                //  is_pending_processing, anpr_suggested_plate, entry_photo_path)
                // are LOCAL-ONLY (NeDB). Sending them causes PGRST204 infinite retry loops.
                exit_authorized: item.exit_authorized ?? false,
            };

            console.log(`📡 DEBUG SYNC [Stay]: exit_authorized=${stayPayload.exit_authorized}, ticket=${stayPayload.ticket_code}`);
            return stayPayload;
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
            if (base.paymentMethod !== undefined) { base.payment_method = base.paymentMethod; delete base.paymentMethod; }
            if (base.shiftId !== undefined) { base.shift_id = base.shiftId; delete base.shiftId; }
            if (base.relatedEntityId !== undefined) { base.related_entity_id = base.relatedEntityId; delete base.relatedEntityId; }
            if (base.invoiceType !== undefined) { base.invoice_type = base.invoiceType; delete base.invoiceType; }
            if (base.ticketNumber !== undefined) { base.ticket_number = base.ticketNumber; delete base.ticketNumber; }
            // receipt_number and ticket_code: same name in both local and remote, passthrough
        }

        if (type === 'Customer') {
            console.log('📡 DEBUG SYNC: Objeto Customer recibido de NeDB:', JSON.stringify(item));

            if (base.customerId !== undefined) { base.customer_id = base.customerId; delete base.customerId; }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }
            if (base.ownerId !== undefined) { base.owner_id = base.ownerId; delete base.ownerId; }

            console.log('📡 DEBUG SYNC: Objeto tras mapeo (antes de whitelist):', JSON.stringify(base));

            // Strip unauthorized fields from Customer to prevent PGRST204
            const allowedCustomerFields = ['id', 'garage_id', 'owner_id', 'name', 'email', 'phone', 'dni', 'address', 'localidad', 'work_address', 'emergency_phone', 'work_phone', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedCustomerFields.includes(key)) {
                    delete base[key];
                }
            });

            console.log('📡 DEBUG SYNC: Objeto final enviado a Supabase:', JSON.stringify(base));
        }

        if (type === 'Vehicle') {
            if (base.customerId !== undefined) { base.customer_id = base.customerId; delete base.customerId; }
            if (base.vehicleTypeId !== undefined) { base.vehicle_type_id = base.vehicleTypeId; delete base.vehicleTypeId; }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }
            // CRITICAL: Type should be freeform, do NOT map 'Camioneta' to 'PickUp' anymore as requested by user

            // Ensure Plate
            if (!base.plate && item.plate) base.plate = item.plate;
            // Map Subscriber Status (Strict Boolean Check)
            base.is_subscriber = item.isSubscriber !== undefined
                ? item.isSubscriber
                : (item.is_subscriber !== undefined ? item.is_subscriber : false);
            delete base.isSubscriber; // Prevent PGRST204 (Extra column)

            const allowedVehicleFields = ['id', 'garage_id', 'owner_id', 'plate', 'type', 'brand', 'model', 'color', 'year', 'insurance', 'is_subscriber', 'vehicle_type_id', 'customer_id', 'rfid_tag', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedVehicleFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        if (type === 'Subscription') {
            if (base.startDate !== undefined) { base.start_date = new Date(base.startDate).toISOString(); delete base.startDate; }
            if (base.endDate !== undefined) { base.end_date = new Date(base.endDate).toISOString(); delete base.endDate; }
            if (base.vehicleId !== undefined) { base.vehicle_id = base.vehicleId; delete base.vehicleId; }
            if (base.customerId !== undefined) { base.customer_id = base.customerId; delete base.customerId; }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }

            const allowedSubFields = ['id', 'garage_id', 'owner_id', 'customer_id', 'vehicle_id', 'type', 'price', 'start_date', 'end_date', 'active', 'documents_metadata', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedSubFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        if (type === 'Cochera') {
            if (base.clienteId !== undefined) { base.cliente_id = base.clienteId; delete base.clienteId; }
            if (base.precioBase !== undefined) { base.precio_base = base.precioBase; delete base.precioBase; }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }
            if (base.ownerId !== undefined) { base.owner_id = base.ownerId; delete base.ownerId; }

            const allowedCocheraFields = ['id', 'garage_id', 'owner_id', 'tipo', 'numero', 'vehiculos', 'cliente_id', 'precio_base', 'piso', 'status', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedCocheraFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        if (type === 'Debt') {
            if (base.subscriptionId !== undefined) { base.subscription_id = base.subscriptionId; delete base.subscriptionId; }
            if (base.customerId !== undefined) { base.customer_id = base.customerId; delete base.customerId; }
            if (base.surchargeApplied !== undefined) { base.surcharge_applied = Number(base.surchargeApplied); delete base.surchargeApplied; }
            if (base.dueDate !== undefined) { base.due_date = new Date(base.dueDate).toISOString(); delete base.dueDate; }
            if (base.amount !== undefined) { base.amount = Number(base.amount); }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }

            const allowedDebtFields = ['id', 'subscription_id', 'customer_id', 'amount', 'remaining_amount', 'amount_paid', 'surcharge_applied', 'status', 'type', 'due_date', 'garage_id', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedDebtFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        if (type === 'ShiftClose') {
            if (base.totalInCash !== undefined) { base.total_in_cash = base.totalInCash; delete base.totalInCash; }
            if (base.stayingInCash !== undefined) { base.staying_in_cash = base.stayingInCash; delete base.stayingInCash; }
            if (base.renderedAmount !== undefined) { base.rendered_amount = base.renderedAmount; delete base.renderedAmount; }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }
            if (base.timestamp !== undefined) { base.timestamp = new Date(base.timestamp).toISOString(); }

            const allowedFields = ['id', 'garage_id', 'operator', 'total_in_cash', 'staying_in_cash', 'rendered_amount', 'timestamp'];
            Object.keys(base).forEach(key => {
                if (!allowedFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        if (type === 'PartialClose') {
            if (base.recipientName !== undefined) { base.recipient_name = base.recipientName; delete base.recipientName; }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }
            if (base.timestamp !== undefined) { base.timestamp = new Date(base.timestamp).toISOString(); }

            const allowedFields = ['id', 'garage_id', 'operator', 'amount', 'recipient_name', 'notes', 'timestamp'];
            Object.keys(base).forEach(key => {
                if (!allowedFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        if (type === 'Incident') {
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }
            if (base.createdAt !== undefined) { base.created_at = new Date(base.createdAt).toISOString(); delete base.createdAt; }

            const allowedFields = ['id', 'garage_id', 'operator', 'description', 'created_at'];
            Object.keys(base).forEach(key => {
                if (!allowedFields.includes(key)) {
                    delete base[key];
                }
            });
        }

        if (type === 'BuildingLevel') {
            if (base.displayName !== undefined) { base.display_name = base.displayName; delete base.displayName; }
            if (base.sortOrder !== undefined) { base.sort_order = base.sortOrder; delete base.sortOrder; }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }

            const allowedBLFields = ['id', 'garage_id', 'display_name', 'sort_order', 'created_at', 'updated_at'];
            Object.keys(base).forEach(key => {
                if (!allowedBLFields.includes(key)) delete base[key];
            });
        }

        if (type === 'FinancialConfig') {
            if (base.initialTolerance !== undefined) { base.initial_tolerance = base.initialTolerance; delete base.initialTolerance; }
            if (base.fractionateAfter !== undefined) { base.fractionate_after = base.fractionateAfter; delete base.fractionateAfter; }
            if (base.surchargeConfig !== undefined) { base.surcharge_config = base.surchargeConfig; delete base.surchargeConfig; }
            if (base.garageId !== undefined) { base.garage_id = base.garageId; delete base.garageId; }
        }

        // SANITIZE FKs
        const fks = ['garage_id', 'owner_id', 'customer_id', 'vehicle_id', 'vehicle_type_id', 'tariff_id', 'related_entity_id', 'shift_id', 'cliente_id', 'subscription_id'];
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
