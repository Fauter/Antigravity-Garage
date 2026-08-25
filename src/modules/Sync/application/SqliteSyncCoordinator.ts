import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager.js';
import { supabase } from '../../../infrastructure/lib/supabase.js';
import { TransactionHelper } from '../../../infrastructure/database/sqlite/TransactionHelper.js';

export class SqliteSyncCoordinator {
    private isSyncing = false;
    public isGlobalSyncing = false;
    private syncInterval: NodeJS.Timeout | null = null;
    private garageId: string | null = null;
    
    private lastSuccessfulSyncAt: Date | null = null;
    private lastError: string | null = null;
    private backendReachable: boolean = true;

    constructor() {
        console.log('🔄 SqliteSyncCoordinator Initialized (Atomic Outbox Worker)');
        this.startBackgroundSync();
    }

    async getStatus() {
        const db = SQLiteManager.getInstance().getDatabase();
        const pending = db.prepare(`SELECT count(*) as count FROM outbox_events WHERE status = 'PENDING'`).get() as any;
        const retry = db.prepare(`SELECT count(*) as count FROM outbox_events WHERE status = 'RETRY'`).get() as any;
        const blocked = db.prepare(`SELECT count(*) as count FROM outbox_events WHERE status = 'BLOCKED'`).get() as any;

        // Attachments
        const attachPending = db.prepare(`SELECT count(*) as count FROM attachments_outbox WHERE status = 'PENDING' OR status = 'RETRY'`).get() as any;
        const attachFailed = db.prepare(`SELECT count(*) as count FROM attachments_outbox WHERE status = 'FAILED'`).get() as any;
        
        let state = 'ONLINE';
        if (!this.backendReachable) state = 'BACKEND_UNREACHABLE';
        if (this.isSyncing || this.isGlobalSyncing) state = 'SYNCING';
        if (blocked.count > 0 && state === 'ONLINE') state = 'HAS_BLOCKED_MUTATIONS';

        return {
            state,
            isSyncing: this.isSyncing || this.isGlobalSyncing,
            pending: pending.count,
            retry: retry.count,
            blocked: blocked.count,
            attachmentsPending: attachPending.count,
            attachmentsFailed: attachFailed.count,
            lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
            lastError: this.lastError
        };
    }

    async startBackgroundSync() {
        if (this.syncInterval) return;
        this.syncInterval = setInterval(async () => {
            await this.processOutbox();
            await this.processAttachments();
        }, 10000);
    }

    async processAttachments() {
        if (!this.backendReachable) return; // Wait until network is up

        const db = SQLiteManager.getInstance().getDatabase();
        try {
            const events = db.prepare(`SELECT * FROM attachments_outbox WHERE status IN ('PENDING', 'RETRY') ORDER BY created_at ASC LIMIT 10`).all() as any[];
            if (events.length === 0) return;

            const fs = require('fs');

            for (const event of events) {
                try {
                    if (!fs.existsSync(event.local_path)) {
                        db.prepare(`UPDATE attachments_outbox SET status = 'FAILED', last_error = 'File missing' WHERE id = ?`).run(event.id);
                        continue;
                    }

                    const buffer = fs.readFileSync(event.local_path);
                    
                    // Supabase Storage Upload
                    const { data, error } = await supabase.storage
                        .from(event.remote_bucket)
                        .upload(event.remote_path, buffer, {
                            upsert: true,
                            contentType: 'image/jpeg'
                        });

                    if (error) throw error;

                    // Update local entity to use remote URL
                    const { data: publicUrlData } = supabase.storage.from(event.remote_bucket).getPublicUrl(event.remote_path);
                    const publicUrl = publicUrlData.publicUrl;

                    // Get the domain entity and update its json_data
                    const entity = db.prepare(`SELECT * FROM ${event.entity_type} WHERE id = ?`).get(event.entity_id) as any;
                    if (entity) {
                        const jsonData = JSON.parse(entity.json_data || '{}');
                        jsonData[event.field_name] = publicUrl;
                        
                        // We also update the corresponding outbox_event payload if it exists and is PENDING
                        // so the cloud DB gets the public URL, not the file:// path
                        db.prepare(`UPDATE ${event.entity_type} SET json_data = ? WHERE id = ?`).run(JSON.stringify(jsonData), event.entity_id);
                        
                        const pendingOutbox = db.prepare(`SELECT * FROM outbox_events WHERE entity_type = ? AND entity_id = ? AND status = 'PENDING'`).get(event.entity_type, event.entity_id) as any;
                        if (pendingOutbox) {
                            const payload = JSON.parse(pendingOutbox.payload || '{}');
                            if (payload.record) {
                                payload.record[event.field_name] = publicUrl;
                                db.prepare(`UPDATE outbox_events SET payload = ? WHERE sequence = ?`).run(JSON.stringify(payload), pendingOutbox.sequence);
                            }
                        }
                    }

                    // ACK
                    db.prepare(`UPDATE attachments_outbox SET status = 'ACKED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), event.id);

                    // Delete local file to save space? We can keep it or delete it.
                    // If we delete it, frontend has to re-download.
                    // For now, let's keep it, or maybe delete it after 7 days like outbox GC.
                } catch (e: any) {
                    console.error(`❌ SyncCoordinator: Failed to upload attachment ${event.id}`, e);
                    db.prepare(`UPDATE attachments_outbox SET status = 'RETRY', attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), event.id);
                    break;
                }
            }
        } catch (error) {
            console.error('❌ SyncCoordinator: Attachments loop crash', error);
        }
    }

    async processOutbox() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        const db = SQLiteManager.getInstance().getDatabase();
        try {
            // Pick up pending events, ordered by sequence (AUTOINCREMENT)
            const events = db.prepare(`SELECT * FROM outbox_events WHERE status IN ('PENDING', 'RETRY') ORDER BY sequence ASC LIMIT 50`).all() as any[];
            
            if (events.length === 0) {
                this.isSyncing = false;
                return;
            }

            for (const event of events) {
                try {
                    await this.pushToCloud(event);
                    db.prepare(`UPDATE outbox_events SET status = 'ACKED', acked_at = ? WHERE sequence = ?`).run(new Date().toISOString(), event.sequence);
                    this.backendReachable = true;
                    this.lastSuccessfulSyncAt = new Date();
                    this.lastError = null;
                } catch (e: any) {
                    console.error(`❌ SyncCoordinator: Failed to push event ${event.sequence}`, e);
                    
                    // Identify if it's a network/transient error or a permanent validation/DB error from Supabase
                    const isPermanent = e.code && (e.code.startsWith('23') || e.code === 'PGRST116' || e.code === '42P01'); // PostgreSQL error codes for constraints/schema
                    
                    if (isPermanent) {
                        db.prepare(`UPDATE outbox_events SET status = 'BLOCKED', last_error = ?, last_error_code = ? WHERE sequence = ?`)
                          .run(e.message, e.code, event.sequence);
                        console.error(`⚠️ SyncCoordinator: Event ${event.sequence} permanently BLOCKED due to Supabase rejection.`);
                        // Do NOT break, allow subsequent independent events to sync (they might fail and block too if they depend on this one, which is fine)
                    } else {
                        this.backendReachable = false;
                        this.lastError = e.message;
                        // Transient network error or 5xx. Update attempts and break to retry later.
                        db.prepare(`UPDATE outbox_events SET status = 'RETRY', attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE sequence = ?`)
                          .run(new Date().toISOString(), e.message, event.sequence);
                        break; 
                    }
                }
            }
        } catch (error) {
            console.error('❌ SyncCoordinator: Loop crash', error);
        } finally {
            this.isSyncing = false;
        }

        // Garbage Collection: Delete ACKED events older than 7 days
        try {
            const db = SQLiteManager.getInstance().getDatabase();
            db.prepare(`DELETE FROM outbox_events WHERE status = 'ACKED' AND acked_at < datetime('now', '-7 days')`).run();
        } catch (e) {
            console.error('❌ SyncCoordinator: GC failed', e);
        }
    }

    private async pushToCloud(event: any) {
        const { entity_type, entity_id, operation, payload } = event;
        const tableMap: any = {
            'Customer': 'customers',
            'Subscription': 'subscriptions',
            'Vehicle': 'vehicles',
            'Stay': 'stays',
            'Cochera': 'cocheras',
            'Debt': 'debts',
            'Movement': 'movements',
            'Shift': 'shifts',
            'Employee': 'employees',
            'Incident': 'incidents'
        };

        const table = tableMap[entity_type];
        if (!table) throw new Error(`Unknown entity type: ${entity_type}`);

        let rpcName = '';
        const parsedPayload = payload ? JSON.parse(payload) : null;
        
        const payloadToSend = {
            p_payload: parsedPayload,
            p_entity_id: entity_id
        };

        if (operation === 'CREATE') rpcName = `sync_${table}_insert`;
        if (operation === 'UPDATE') rpcName = `sync_${table}_update`;
        if (operation === 'DELETE') {
            rpcName = `sync_${table}_delete`;
            delete payloadToSend.p_payload;
        }

        // NO LOCKS HERE: We are calling HTTP APIs outside any SQLite transaction.
        const { error, data } = await supabase.rpc(rpcName, payloadToSend);

        if (error) {
            console.error(`Supabase RPC Error (${rpcName}):`, error.message);
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
            'shifts': 'Shift',
            'stays': 'Stay',
            'employees': 'Employee',
            'cocheras': 'Cochera',
            'debts': 'Debt',
            'incidents': 'Incident',
            'vehicle_types': 'VehicleType',
            'tariffs': 'Tariff',
            'prices': 'Price',
            'financial_configs': 'FinancialConfig',
        };

        try {
            for (const [table, entityType] of Object.entries(tableMap)) {
                await this.fetchTable(table, garageId, entityType as string);
            }
        } catch (e) {
            console.error('❌ Pull Error', e);
        } finally {
            this.isGlobalSyncing = false;
        }
    }

    private async fetchTable(tableName: string, garageId: string, entityType: string) {
        const { data, error } = await supabase.from(tableName).select('*').eq('garage_id', garageId);
        if (error) throw error;
        if (!data || data.length === 0) return;

        const db = SQLiteManager.getInstance().getDatabase();

        // Transaction for inserting pulled data
        TransactionHelper.run((tx) => {
            for (const row of data) {
                const id = row.id;

                // Pending Protection Check: Does outbox have a pending mutation for this ID?
                const pending = tx.prepare(`SELECT count(*) as count FROM outbox_events WHERE entity_id = ? AND entity_type = ? AND status != 'ACKED'`).get(id, entityType) as any;
                if (pending.count > 0) {
                    // We skip overwriting this record because we have a more recent local change
                    continue;
                }

                // If no pending local changes, we overwrite local state with cloud state
                // This converts snake_case row into camelCase dynamically or we just store raw payload
                // For simplicity we must convert snake_case back to camelCase to match local JSON schemas
                const camelPayload = this.toCamelCase(row);
                
                tx.prepare(`
                    INSERT INTO ${tableName} (id, json_data) VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
                `).run(id, JSON.stringify(camelPayload));
            }
        });
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
        // Realtime stub
        console.log(`🔌 [SQLITE] Realtime Listener Stub Initialized for ${garageId}`);
    }
}
