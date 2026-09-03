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
            }).sort({ timestamp: 1 });

            if (pendingMutations.length === 0) {
                this.isSyncing = false;
                return;
            }

            for (const mutation of pendingMutations) {
                try {
                    await this.pushToCloud(mutation);
                    await db.mutations.remove({ _id: mutation._id }, {});
                    
                    this.backendReachable = true;
                    this.lastSuccessfulSyncAt = new Date();
                    this.lastError = null;
                } catch (err: any) {
                    this.backendReachable = false;
                    this.lastError = err.message;
                    break;
                }
            }
        } catch (error) {
            console.error('❌ SyncService: Error procesando cola de mutaciones', error);
        } finally {
            this.isSyncing = false;
        }
    }

    private async pushToCloud(mutation: any) {
        const { entityType, entityId, operation, payload } = mutation;
        let rpcName = '';
        
        const tableMap: any = {
            'Customer': 'customers',
            'Subscription': 'subscriptions',
            'Vehicle': 'vehicles',
            'Stay': 'stays',
            'Cochera': 'cocheras',
            'Debt': 'debts',
            'Movement': 'movements',
            'ShiftClose': 'shift_closes',
            'Employee': 'employee_accounts',
            'Incident': 'incidents',
            'BuildingLevel': 'building_levels'
        };

        const table = tableMap[entityType];

        if (!table) return;

        const payloadToSend = {
            p_payload: payload,
            p_entity_id: entityId
        };

        if (operation === 'CREATE') {
            rpcName = `sync_${table}_insert`;
        } else if (operation === 'UPDATE') {
            rpcName = `sync_${table}_update`;
        } else if (operation === 'DELETE') {
            rpcName = `sync_${table}_delete`;
            delete (payloadToSend as any).p_payload;
        }

        const { error, data } = await supabase.rpc(rpcName, payloadToSend);

        if (error) {
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

    private async fetchTable(tableName: string, garageId: string, entityType: string) {
        const { data, error } = await supabase.from(tableName).select('*').eq('garage_id', garageId);

        if (error) throw error;

        if (data && data.length > 0) {
            const localDbName = this.getLocalDbName(tableName);
            const localStore = (db as any)[localDbName];

            if (localStore) {
                for (const row of data) {
                    const id = row.id;
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

                    const camelPayload = this.toCamelCase(row);
                    await localStore.update({ id }, { $set: camelPayload }, { upsert: true });
                }
            }
        }
    }

    private getLocalDbName(tableName: string): string {
        const mapping: Record<string, string> = {
            'vehicle_types': 'vehicleTypes',
            'financial_configs': 'financialConfigs'
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

    initRealtime(garageId: string) {
        console.log(`🔌 Initializing Supabase Realtime for garage: ${garageId}`);
    }
}

export class SyncServiceProxy {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteSyncCoordinator() : new NeDBSyncService();
    }
    async getStatus() { return this.impl.getStatus(); }
    async pullAllData(garageId: string, isSilent: boolean = false) { return this.impl.pullAllData(garageId, isSilent); }
    initRealtime(garageId: string) { return this.impl.initRealtime(garageId); }
}

const instance = new SyncServiceProxy();

export const syncService = {
    getStatus: instance.getStatus.bind(instance),
    pullAllData: instance.pullAllData.bind(instance),
    initRealtime: instance.initRealtime.bind(instance),
};
