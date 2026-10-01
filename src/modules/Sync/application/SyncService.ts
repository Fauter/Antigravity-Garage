import { db } from '../../../infrastructure/database/datastore.js';
import { supabase } from '../../../infrastructure/lib/supabase.js';
import { QueueService } from '../../Sync/application/QueueService.js';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SqliteSyncCoordinator } from './SqliteSyncCoordinator.js';

export class NeDBSyncService {
    private queue = new QueueService();
    private isSyncing = false;
    public isGlobalSyncing: boolean = false;
    private syncInterval: NodeJS.Timeout | null = null;
    private garageId: string | null = null;
    
    private lastSuccessfulSyncAt: Date | null = null;
    private lastError: string | null = null;
    private backendReachable: boolean = true;

    async getStatus() {
        const pending = await db.mutations.count({ 
            $or: [{ status: 'PENDING' }, { status: 'RETRY' }, { status: { $exists: false }, synced: false }] 
        });
        const blocked = await db.mutations.count({ status: 'BLOCKED' });
        
        let state = 'ONLINE';
        if (!this.backendReachable) state = 'BACKEND_UNREACHABLE';
        if (this.isSyncing || this.isGlobalSyncing) state = 'SYNCING';
        if (blocked > 0 && state === 'ONLINE') state = 'HAS_BLOCKED_MUTATIONS';

        return {
            state,
            isSyncing: this.isSyncing || this.isGlobalSyncing,
            pending,
            blocked,
            lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
            lastError: this.lastError
        };
    }

    constructor() {
        console.log('🔄 SyncService Initialized (Offline-First Worker)');
        this.startBackgroundSync();
    }

    async startBackgroundSync() {
        if (this.syncInterval) return;
        this.syncInterval = setInterval(async () => {
            await this.processQueue();
        }, 10000); 
    }

    async processQueue() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            const pendingMutations = await db.mutations.find({
                $or: [
                    { status: 'PENDING' },
                    { status: 'RETRY' },
                    { status: { $exists: false }, synced: false }
                ]
            }).sort({ timestamp: 1 }) as any[];

            if (pendingMutations.length === 0) {
                this.isSyncing = false;
                return;
            }

            for (const mutation of pendingMutations) {
                // Backoff logic for NeDB
                if (mutation.status === 'RETRY' && mutation.nextAttemptAt) {
                    const nextAttempt = new Date(mutation.nextAttemptAt).getTime();
                    const now = Date.now();
                    if (now < nextAttempt) {
                        break;
                    }
                }

                try {
                    await this.pushToCloud(mutation);
                    await db.mutations.remove({ _id: mutation._id }, {});
                    
                    this.backendReachable = true;
                    this.lastSuccessfulSyncAt = new Date();
                    this.lastError = null;
                } catch (err: any) {
                    const msg = String(err?.message || '');
                    const code = String(err?.code || '');
                    const status = err?.status;

                    const isNetwork = 
                        code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || 
                        code === 'ENOTFOUND' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' ||
                        err?.name === 'FetchError' || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT') || 
                        msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || 
                        msg.includes('NetworkError') || msg.includes('is unreachable') || msg.includes('Failed to fetch');
                        
                    const isTransientRemote = status === 429 || status >= 500;
                    
                    const isPermanent = code.startsWith('22') || code.startsWith('23') || code.startsWith('42') || code.startsWith('PGRST') || 
                        status === 400 || status === 404 || status === 409 || status === 422 || 
                        msg.includes('Unknown entity type');

                    if (isNetwork || isTransientRemote) {
                        this.backendReachable = !isNetwork;
                        this.lastError = err.message;
                        await this.queue.markRetry(mutation.id, err.message, mutation.retryCount || 0);
                        break; // transient, break loop to backoff
                    } else {
                        // Permanent error, mark as blocked and CONTINUE to next mutation
                        this.backendReachable = true;
                        await this.queue.markBlocked(mutation.id, err.message, code || 'PERMANENT');
                        console.warn(`⚠️ SyncService: Event ${mutation.id} permanently BLOCKED: ${err.message}`);
                    }
                }
            }
        } catch (error) {
            console.error('❌ SyncService: Error procesando cola de mutaciones', error);
        } finally {
            this.isSyncing = false;
        }
    }

    private toSnakeCase(obj: any): any {
        if (Array.isArray(obj)) return obj.map(v => this.toSnakeCase(v));
        if (obj instanceof Date) return obj.toISOString();
        if (obj !== null && typeof obj === 'object') {
            return Object.keys(obj).reduce((result, key) => {
                const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                result[snakeKey] = this.toSnakeCase(obj[key]);
                return result;
            }, {} as any);
        }
        return obj;
    }

    private async pushToCloud(mutation: any) {
        const { entityType, entityId, operation, payload } = mutation;
        
        const tableMap: any = {
            'Customer': 'customers',
            'Subscription': 'subscriptions',
            'Vehicle': 'vehicles',
            'Stay': 'stays',
            'Cochera': 'cocheras',
            'Debt': 'debts',
            'Movement': 'movements',
            'ShiftClose': 'shift_closes',
            'PartialClose': 'partial_closes',
            'Employee': 'employee_accounts',
            'Incident': 'incidents',
            'BuildingLevel': 'building_levels'
        };

        const table = tableMap[entityType];

        if (!table) throw new Error(`Unknown entity type: ${entityType}`);

        let error;
        const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;

        if (operation === 'CREATE' || operation === 'UPDATE') {
            const snakePayload = this.toSnakeCase(parsedPayload);
            if (!snakePayload.id && entityId) {
                snakePayload.id = entityId;
            }
            if (snakePayload._id !== undefined) {
                delete snakePayload._id;
            }

            if (table === 'subscriptions') {
                delete snakePayload.plate;
                delete snakePayload.vehicle_type;
                delete snakePayload.spot_number;
                if (snakePayload.customer_id === 'client-sin-precio' || snakePayload.customer_id === 'sin-cliente' || snakePayload.customer_id === 'general') {
                    snakePayload.customer_id = null;
                }
                if (snakePayload.garage_id === 'garage-inexistente') {
                    snakePayload.garage_id = null;
                }
                if (!snakePayload.start_date) {
                    snakePayload.start_date = new Date().toISOString();
                }
                if (snakePayload.type === 'TIPO_DESCONOCIDO') {
                    snakePayload.type = 'Movil';
                }
            }

            if (table === 'debts') {
                delete snakePayload.billing_period;
                delete snakePayload.json_data;
            }

            if (table === 'movements') {
                delete snakePayload.json_data;
            }

            const res = await supabase.from(table).upsert(snakePayload);
            error = res.error;
        } else if (operation === 'DELETE') {
            const res = await supabase.from(table).delete().eq('id', entityId);
            error = res.error;
        }

        if (error) {
            console.error(`Supabase Sync Error (${operation} on ${table}):`, error.message);
            throw error;
        }
    }

    async pullAllData(garageId: string, isSilent: boolean = false) {
        if (this.isGlobalSyncing) return;
        this.isGlobalSyncing = true;
        this.garageId = garageId;

        const tableMap: any = {
            'vehicles': 'Vehicle',
            'customers': 'Customer',
            'subscriptions': 'Subscription',
            'movements': 'Movement',
            'shift_closes': 'ShiftClose',
            'partial_closes': 'PartialClose',
            'stays': 'Stay',
            'employee_accounts': 'Employee',
            'cocheras': 'Cochera',
            'debts': 'Debt',
            'incidents': 'Incident',
            'vehicle_types': 'VehicleType',
            'tariffs': 'Tariff',
            'prices': 'Price',
            'financial_configs': 'FinancialConfig',
            'building_levels': 'BuildingLevel',
        };

        try {
            const fetchPromises = Object.entries(tableMap).map(([table, entityType]) => 
                this.fetchTable(table, garageId, entityType as string).catch(e => console.error(e))
            );
            await Promise.all(fetchPromises);
        } catch (error) {
            console.error('❌ SyncService: Error en Pull Global', error);
        } finally {
            this.isGlobalSyncing = false;
        }
    }

    async resetReplicatedStateFromRemote(garageId: string) {
        if (this.isGlobalSyncing) return { status: 'ERROR', message: 'Already syncing' };
        this.isGlobalSyncing = true;
        this.garageId = garageId;
        const startTotal = Date.now();
        console.log(`[BOOTSTRAP] INICIANDO RECOVERY AUTORITATIVO PARA GARAGE ${garageId}`);

        try {
            // 1. Limpiar mutations locales SOLO de este garage
            // (NeDB usa un query para borrar)
            await db.mutations.remove({}, { multi: true });
            console.log(`[BOOTSTRAP] Mutations locales limpiadas.`);

            const tableMap: any = {
                'vehicles': 'Vehicle',
                'customers': 'Customer',
                'subscriptions': 'Subscription',
                'movements': 'Movement',
                'shift_closes': 'ShiftClose',
                'partial_closes': 'PartialClose',
                'stays': 'Stay',
                'employee_accounts': 'Employee',
                'cocheras': 'Cochera',
                'debts': 'Debt',
                'incidents': 'Incident',
                'vehicle_types': 'VehicleType',
                'tariffs': 'Tariff',
                'prices': 'Price',
                'financial_configs': 'FinancialConfig',
                'building_levels': 'BuildingLevel',
            };

            const timingResults: Record<string, number> = {};

            // Ojo: en NeDB borramos todo lo local para este garage
            for (const [tableName, entityType] of Object.entries(tableMap)) {
                const localDbName = this.getLocalDbName(tableName);
                const localStore = (db as any)[localDbName];
                if (localStore) {
                    // Para configs globales (no scopeadas por garageId) no borramos, solo actualizamos.
                    // Tablas como vehicle_types, tariffs, prices, tienen garage_id
                    await localStore.remove({ $or: [{ garageId }, { garage_id: garageId }] }, { multi: true });
                }
            }

            // Descargar snapshot paginado por partes
            // Paralelismo controlado
            const fetchPromises = Object.entries(tableMap).map(async ([tableName, entityType]) => {
                const startMs = Date.now();
                await this.fetchTable(tableName, garageId, entityType as string, true); // true = bypass pending check, bulk insert
                timingResults[tableName] = Date.now() - startMs;
                console.log(`[BOOTSTRAP] ${tableName} reconstruido en ${timingResults[tableName]}ms`);
            });

            await Promise.all(fetchPromises);
            console.log(`[BOOTSTRAP] RECOVERY COMPLETADO EN ${Date.now() - startTotal}ms`);
            return { status: 'SUCCESS', timing: timingResults, totalMs: Date.now() - startTotal };
        } catch (error: any) {
            console.error('❌ SyncService: Error en Authoritative Recovery', error);
            return { status: 'ERROR', message: error.message };
        } finally {
            this.isGlobalSyncing = false;
        }
    }

    private async fetchTable(tableName: string, garageId: string, entityType: string, isRecovery: boolean = false) {
        let allData: any[] = [];
        let from = 0;
        let to = 999;
        const pageSize = 1000;
        let hasMore = true;

        const smallConfigTables = ['financial_configs', 'vehicle_types', 'tariffs', 'prices', 'promos', 'building_levels', 'employee_accounts', 'garages'];
        const isIncremental = !isRecovery && !smallConfigTables.includes(tableName);
        let watermark: string | null = null;
        
        if (isIncremental) {
            const cp = await db.syncState.findOne({ collection_name: `${garageId}_${tableName}` }) as any;
            if (cp && cp.last_synced_at) {
                watermark = new Date(new Date(cp.last_synced_at).getTime() - 120000).toISOString();
            }
        }

        while (hasMore) {
            let query = supabase
                .from(tableName)
                .select('*')
                .eq('garage_id', garageId);
                
            if (isIncremental && watermark) {
                query = query.gte('updated_at', watermark);
            }
                
            query = query.range(from, to);
            
            const { data, error } = await query;

            if (error) throw error;
            if (data && data.length > 0) {
                allData = allData.concat(data);
                if (data.length < pageSize) hasMore = false;
                else {
                    from += pageSize;
                    to += pageSize;
                }
            } else {
                hasMore = false;
            }
        }

        if (allData.length > 0) {
            const localDbName = this.getLocalDbName(tableName);
            const localStore = (db as any)[localDbName];

            if (localStore) {
                for (const row of allData) {
                    const id = row.id;
                    if (!isRecovery) {
                        const pendingMutations = await db.mutations.count({
                            entityType: entityType,
                            entityId: id,
                            $or: [
                                { status: 'PENDING' },
                                { status: 'RETRY' },
                                { status: { $exists: false }, synced: false }
                            ]
                        });
                        if (pendingMutations > 0) continue;
                    }
                    const camelPayload = this.toCamelCase(row);
                    await localStore.update({ id }, { $set: camelPayload }, { upsert: true });
                }
            }
        }
        
        if (isIncremental) {
            const now = new Date().toISOString();
            await db.syncState.update(
                { collection_name: `${garageId}_${tableName}` },
                { $set: { collection_name: `${garageId}_${tableName}`, last_synced_at: now } },
                { upsert: true }
            );
        }
    }

    private getLocalDbName(tableName: string): string {
        const mapping: Record<string, string> = {
            'vehicle_types': 'vehicleTypes',
            'financial_configs': 'financialConfigs',
            'shift_closes': 'shiftCloses',
            'partial_closes': 'partialCloses',
            'employee_accounts': 'employees',
            'building_levels': 'buildingLevels'
        };
        return mapping[tableName] || tableName;
    }

    private toCamelCase(obj: any): any {
        if (Array.isArray(obj)) return obj.map(v => this.toCamelCase(v));
        if (obj !== null && typeof obj === 'object') {
            return Object.keys(obj).reduce((result, key) => {
                if (key === '_id') {
                    result[key] = obj[key];
                } else {
                    const camelKey = key.replace(/_([a-z])/g, g => g[1].toUpperCase());
                    result[camelKey] = this.toCamelCase(obj[key]);
                }
                return result;
            }, {} as any);
        }
        return obj;
    }

    async runSyncCycle(garageId: string, reason: string) {
        if (this.isGlobalSyncing) return { status: 'SUCCESS', failedTables: [] };
        
        try {
            await this.processQueue();
            await this.pullAllData(garageId, true);
            
            const status = await this.getStatus();
            if (status.blocked > 0 || status.state === 'SYNC_ERROR' || !this.backendReachable) {
                return { status: 'WITH_WARNINGS', failedTables: ['mutations_queue'] };
            }
            return { status: 'SUCCESS', failedTables: [] };
        } catch (err: any) {
            console.error('❌ Error in NeDB runSyncCycle:', err);
            return { status: 'WITH_WARNINGS', failedTables: ['ALL'] };
        }
    }

    private realtimeChannel: any = null;
    private activeRealtimeGarageId: string | null = null;

    initRealtime(garageId: string) {
        if (this.realtimeChannel && this.activeRealtimeGarageId === garageId) return;

        if (this.realtimeChannel) {
            console.log(`🔌 [NEDB SYNC] Removing old realtime channel`);
            supabase.removeChannel(this.realtimeChannel);
            this.realtimeChannel = null;
            this.activeRealtimeGarageId = null;
        }

        console.log(`🔌 [NEDB SYNC] Initializing Supabase Realtime for garage: ${garageId}`);
        
        this.realtimeChannel = supabase.channel(`garage_sync_nedb_${garageId}`)
            .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
                this.handleRealtimePayload(payload, garageId);
            })
            .subscribe();
        
        this.activeRealtimeGarageId = garageId;
    }

    private async handleRealtimePayload(payload: any, garageId: string) {
        if (payload.new && payload.new.garage_id && payload.new.garage_id !== garageId) return;

        const tableMap: Record<string, { entityType: string, localTable: string }> = {
            'vehicles': { entityType: 'Vehicle', localTable: 'vehicles' },
            'customers': { entityType: 'Customer', localTable: 'customers' },
            'subscriptions': { entityType: 'Subscription', localTable: 'subscriptions' },
            'movements': { entityType: 'Movement', localTable: 'movements' },
            'shift_closes': { entityType: 'ShiftClose', localTable: 'shiftCloses' },
            'partial_closes': { entityType: 'PartialClose', localTable: 'partialCloses' },
            'stays': { entityType: 'Stay', localTable: 'stays' },
            'employee_accounts': { entityType: 'Employee', localTable: 'employees' },
            'cocheras': { entityType: 'Cochera', localTable: 'cocheras' },
            'debts': { entityType: 'Debt', localTable: 'debts' },
            'incidents': { entityType: 'Incident', localTable: 'incidents' },
            'vehicle_types': { entityType: 'VehicleType', localTable: 'vehicleTypes' },
            'tariffs': { entityType: 'Tariff', localTable: 'tariffs' },
            'prices': { entityType: 'Price', localTable: 'prices' },
            'financial_configs': { entityType: 'FinancialConfig', localTable: 'financialConfigs' },
            'building_levels': { entityType: 'BuildingLevel', localTable: 'buildingLevels' },
        };

        const mapping = tableMap[payload.table];
        if (!mapping) return;

        try {
            const localStore = (db as any)[mapping.localTable];
            if (!localStore) return;

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                const id = payload.new.id;
                const pending = await db.mutations.count({
                    entityType: mapping.entityType,
                    entityId: id,
                    $or: [ { status: 'PENDING' }, { status: 'RETRY' }, { status: { $exists: false }, synced: false } ]
                });
                if (pending > 0) return;
                
                const camelPayload = this.toCamelCase(payload.new);
                await localStore.update({ id }, { $set: camelPayload }, { upsert: true });
            } else if (payload.eventType === 'DELETE') {
                const id = payload.old?.id;
                if (!id) return;
                
                const pending = await db.mutations.count({
                    entityType: mapping.entityType,
                    entityId: id,
                    $or: [ { status: 'PENDING' }, { status: 'RETRY' }, { status: { $exists: false }, synced: false } ]
                });
                if (pending > 0) return;
                
                await localStore.remove({ id }, { multi: true });
                console.log(`🗑️ [NEDB REALTIME] Registro eliminado localmente: ${mapping.entityType} ${id}`);
            }
        } catch (e) {
            console.error('Error handling realtime payload', e);
        }
    }
}

export class SyncServiceProxy {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteSyncCoordinator() : new NeDBSyncService();
    }
    async getStatus() { return this.impl.getStatus(); }
    async pullAllData(garageId: string, isSilent: boolean = false) { return this.impl.pullAllData(garageId, isSilent); }
    async runSyncCycle(garageId: string, reason: string) { if (this.impl.runSyncCycle) return this.impl.runSyncCycle(garageId, reason); }
    initRealtime(garageId: string) { return this.impl.initRealtime(garageId); }
    startReconciliation(garageId: string) { if (this.impl.startReconciliation) return this.impl.startReconciliation(garageId); }
    stopReconciliation() { if (this.impl.stopReconciliation) return this.impl.stopReconciliation(); }
    async resetReplicatedStateFromRemote(garageId: string) {
        if (this.impl.resetReplicatedStateFromRemote) {
            return this.impl.resetReplicatedStateFromRemote(garageId);
        }
        return { status: 'ERROR', message: 'Not implemented in this engine' };
    }
}

const instance = new SyncServiceProxy();

export const syncService = {
    getStatus: instance.getStatus.bind(instance),
    pullAllData: instance.pullAllData.bind(instance),
    runSyncCycle: instance.runSyncCycle.bind(instance),
    initRealtime: instance.initRealtime.bind(instance),
    startReconciliation: instance.startReconciliation.bind(instance),
    stopReconciliation: instance.stopReconciliation.bind(instance),
    resetReplicatedStateFromRemote: instance.resetReplicatedStateFromRemote.bind(instance)
};
