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

    private justReconnected = false;
    private realtimeChannel: any = null;

    static readonly tableMappings = [
        { remoteTable: 'customers', localTable: 'customers', entityType: 'Customer' },
        { remoteTable: 'subscriptions', localTable: 'subscriptions', entityType: 'Subscription' },
        { remoteTable: 'vehicles', localTable: 'vehicles', entityType: 'Vehicle' },
        { remoteTable: 'stays', localTable: 'stays', entityType: 'Stay' },
        { remoteTable: 'employee_accounts', localTable: 'employees', entityType: 'Employee' },
        { remoteTable: 'cocheras', localTable: 'cocheras', entityType: 'Cochera' },
        { remoteTable: 'debts', localTable: 'debts', entityType: 'Debt' },
        { remoteTable: 'incidents', localTable: 'incidents', entityType: 'Incident' },
        { remoteTable: 'vehicle_types', localTable: 'vehicle_types', entityType: 'VehicleType' },
        { remoteTable: 'tariffs', localTable: 'tariffs', entityType: 'Tariff' },
        { remoteTable: 'prices', localTable: 'prices', entityType: 'Price' },
        { remoteTable: 'financial_configs', localTable: 'financial_configs', entityType: 'FinancialConfig' },
        { remoteTable: 'building_levels', localTable: 'building_levels', entityType: 'BuildingLevel' },
    ];


    constructor() {
        console.log('🔄 SqliteSyncCoordinator Initialized (Atomic Outbox Worker)');
        try {
            const db = SQLiteManager.getInstance().getDatabase();
            db.prepare(`UPDATE outbox_events SET status = 'PENDING' WHERE status = 'PROCESSING'`).run();
        } catch(e) {}
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
        if (!this.backendReachable) {
            state = 'BACKEND_UNREACHABLE';
        } else if (this.isSyncing || this.isGlobalSyncing) {
            state = 'SYNCING';
        } else if (blocked.count > 0) {
            state = 'HAS_BLOCKED_MUTATIONS';
        } else if (retry.count > 0) {
            state = 'SYNC_ERROR';
        }

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

    private classifySyncError(e: any): 'TRANSIENT_NETWORK' | 'TRANSIENT_REMOTE' | 'PERMANENT' {
        const msg = String(e?.message || '');
        const code = String(e?.code || '');
        const status = e?.status;

        const isNetwork = 
            code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || 
            code === 'ENOTFOUND' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' ||
            e?.name === 'FetchError' || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT') || 
            msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || 
            msg.includes('NetworkError') || msg.includes('is unreachable') || msg.includes('Failed to fetch');

        if (isNetwork) return 'TRANSIENT_NETWORK';

        if (status === 429 || status >= 500) return 'TRANSIENT_REMOTE';

        // 22: Data Exception, 23: Integrity Constraint Violation (FK), 42: Syntax Error / Access Rule
        if (code.startsWith('22') || code.startsWith('23') || code.startsWith('42') || code.startsWith('PGRST') || 
            status === 400 || status === 404 || status === 409 || status === 422) {
            return 'PERMANENT';
        }

        return 'TRANSIENT_NETWORK'; // Default safe to retry
    }

    async startBackgroundSync() {
        if (this.syncInterval) return;
        if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
            console.log('🔇 [TEST] SqliteSyncCoordinator: Background sync disabled in test environment.');
            return;
        }
        this.syncInterval = setInterval(async () => {
            const wasReachable = this.backendReachable;
            await this.processOutbox();
            await this.processAttachments();
            
            // Lightweight ping if outbox was empty and we were offline
            if (this.backendReachable === false && !this.isSyncing) {
                try {
                    const { error } = await supabase.from('customers').select('id').limit(1);
                    if (!error) this.backendReachable = true;
                } catch (e) {
                    // Ignore ping error
                }
            }
            
            // Reconnect hook
            if (!wasReachable && this.backendReachable) {
                console.log('🌐 SyncCoordinator: Connection restored! Pulling remote changes...');
                this.justReconnected = true;
                try {
                    const db = SQLiteManager.getInstance().getDatabase();
                    // Get garageId from any local customer or vehicle
                    const customer = db.prepare(`SELECT json_extract(json_data, '$.garageId') as garageId FROM customers LIMIT 1`).get() as any;
                    const garageId = customer?.garageId;
                    if (garageId) {
                        this.pullAllData(garageId, true).catch(e => console.error('Auto-pull failed', e));
                    }
                } catch (e) {
                    console.error('Failed to trigger auto-pull', e);
                }
            }
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

                    db.prepare(`UPDATE attachments_outbox SET status = 'ACKED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), event.id);
                } catch (e: any) {
                    console.error(`❌ SyncCoordinator: Attachment upload failed for ${event.id}`, e);
                    db.prepare(`UPDATE attachments_outbox SET status = 'RETRY', attempts = attempts + 1, updated_at = ?, last_error = ? WHERE id = ?`).run(new Date().toISOString(), e.message, event.id);
                }
            }
        } catch (e) {
            console.error('❌ SyncCoordinator: Attachments loop error', e);
        }
    }

    async processOutbox() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            const db = SQLiteManager.getInstance().getDatabase();
            
            const events = db.prepare(`
                SELECT * FROM outbox_events 
                WHERE status IN ('PENDING', 'RETRY') 
                ORDER BY sequence ASC 
                LIMIT 50
            `).all() as any[];

            if (events.length === 0) {
                this.isSyncing = false;
                return;
            }

            for (const event of events) {
                if (event.status === 'RETRY' && event.last_attempt_at) {
                    const lastAttempt = new Date(event.last_attempt_at).getTime();
                    const now = Date.now();
                    const backoffMs = Math.min(10000 * Math.pow(2, Math.max(0, event.attempts - 1)), 300000);
                    const bypassBackoff = this.backendReachable && this.justReconnected;
                    
                    if (!bypassBackoff && now - lastAttempt < backoffMs) {
                        break; 
                    }
                }

                const claimed = db.prepare(`UPDATE outbox_events SET status = 'PROCESSING', last_attempt_at = ? WHERE sequence = ? AND status IN ('PENDING', 'RETRY')`).run(new Date().toISOString(), event.sequence);
                if (claimed.changes === 0) continue; 
                
                try {
                    await this.pushToCloud(event);
                    db.prepare(`UPDATE outbox_events SET status = 'ACKED', acked_at = ? WHERE sequence = ?`).run(new Date().toISOString(), event.sequence);
                    this.backendReachable = true;
                    this.lastSuccessfulSyncAt = new Date();
                    this.lastError = null;
                } catch (e: any) {
                    const classification = this.classifySyncError(e);
                    
                    if (classification === 'TRANSIENT_NETWORK') {
                        this.backendReachable = false;
                        this.lastError = e.message;
                        db.prepare(`UPDATE outbox_events SET status = 'RETRY', attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE sequence = ?`)
                          .run(new Date().toISOString(), e.message, event.sequence);
                        break; 
                    } else if (classification === 'TRANSIENT_REMOTE') {
                        this.backendReachable = true; 
                        this.lastError = e.message;
                        db.prepare(`UPDATE outbox_events SET status = 'RETRY', attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE sequence = ?`)
                          .run(new Date().toISOString(), e.message, event.sequence);
                        break; 
                    } else {
                        this.backendReachable = true;
                        db.prepare(`UPDATE outbox_events SET status = 'BLOCKED', last_error = ?, last_error_code = ? WHERE sequence = ?`)
                          .run(e.message || 'Validation failed', e.code || 'PERMANENT', event.sequence);
                        console.warn(`⚠️ SyncCoordinator: Event ${event.sequence} permanently BLOCKED: ${e.message}`);
                    }
                }
            }
            this.justReconnected = false;
        } catch (error) {
            console.error('❌ SyncCoordinator: Loop crash', error);
        } finally {
            this.isSyncing = false;
        }

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
            'ShiftClose': 'shift_closes',
            'Employee': 'employee_accounts',
            'Incident': 'incidents',
            'BuildingLevel': 'building_levels'
        };

        const table = tableMap[entity_type];
        if (!table) throw new Error(`Unknown entity type: ${entity_type}`);

        let error;
        const parsedPayload = payload ? JSON.parse(payload) : null;
        
        if (operation === 'CREATE' || operation === 'UPDATE') {
            const snakePayload = this.toSnakeCase(parsedPayload);
            // Ensure ID is present
            if (!snakePayload.id && entity_id) {
                snakePayload.id = entity_id;
            }

            // --- SCHEMA SAFETY GUARDS FOR SUPABASE ---
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
                    snakePayload.type = 'Movil'; // Default safe fallback for constraint
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
            const res = await supabase.from(table).delete().eq('id', entity_id);
            error = res.error;
        }

        if (error) {
            console.error(`Supabase Sync Error (${operation} on ${table}):`, error.message);
            throw error;
        }
    }

    private toSnakeCase(obj: any): any {
        if (Array.isArray(obj)) return obj.map(v => this.toSnakeCase(v));
        if (obj !== null && typeof obj === 'object') {
            return Object.keys(obj).reduce((result, key) => {
                const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                result[snakeKey] = this.toSnakeCase(obj[key]);
                return result;
            }, {} as any);
        }
        return obj;
    }

    private applyRemoteRow(tx: any, row: any, remoteTable: string, localTable: string, entityType: string, garageId: string) {
        const id = row.id || row.garage_id || row._id || garageId;
        if (!id) return;

        // Dirty Local Protection
        const pending = tx.prepare(`SELECT count(*) as count FROM outbox_events WHERE entity_id = ? AND entity_type = ? AND status != 'ACKED'`).get(id, entityType) as any;
        if (pending && pending.count > 0) {
            return;
        }

        const camelPayload = this.toCamelCase(row);
        if (!camelPayload.id) {
            camelPayload.id = id;
        }

        const legacyCheck = tx.prepare(`SELECT id, json_data FROM ${localTable} WHERE json_extract(json_data, '$.id') = ? AND id != ?`).get(id, id) as any;
        if (legacyCheck) {
            const legacyData = JSON.parse(legacyCheck.json_data);
            if (entityType === 'Debt') {
                if (camelPayload.remainingAmount === undefined && legacyData.remaining_amount !== undefined) {
                    camelPayload.remaining_amount = legacyData.remaining_amount;
                }
                if (camelPayload.amountPaid === undefined && legacyData.amount_paid !== undefined) {
                    camelPayload.amount_paid = legacyData.amount_paid;
                }
            }
            tx.prepare(`UPDATE ${localTable} SET json_data = ? WHERE id = ?`).run(JSON.stringify(camelPayload), legacyCheck.id);
        } else {
            tx.prepare(`
                INSERT INTO ${localTable} (id, json_data) VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
            `).run(id, JSON.stringify(camelPayload));
        }
    }


    async pullAllData(garageId: string, isSilent: boolean = false) {
        if (this.isGlobalSyncing) return;
        this.isGlobalSyncing = true;
        this.garageId = garageId;

        try {
            for (const mapping of SqliteSyncCoordinator.tableMappings) {
                try {
                    await this.fetchTable(mapping.remoteTable, mapping.localTable, garageId, mapping.entityType);
                } catch (tableErr: any) {
                    console.warn(`⚠️ Pull Error for table ${mapping.remoteTable}:`, tableErr?.message || tableErr);
                }
            }
            this.backendReachable = true;
            this.lastSuccessfulSyncAt = new Date();
        } catch (e: any) {

            console.error('❌ Pull Error', e);
        } finally {
            this.isGlobalSyncing = false;
        }
    }

    private async fetchTable(remoteTable: string, localTable: string, garageId: string, entityType: string) {
        const { data, error } = await supabase.from(remoteTable).select('*').eq('garage_id', garageId);
        if (error) throw error;
        if (!data || data.length === 0) return;

        TransactionHelper.run((tx) => {
            for (const row of data) {
                this.applyRemoteRow(tx, row, remoteTable, localTable, entityType, garageId);
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
        if (this.realtimeChannel) return;
        
        if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
            console.log(`🔌 [SQLITE] Realtime Listener Stub Initialized for ${garageId}`);
            return;
        }

        console.log(`🔌 [SQLITE] Realtime Listener Initialized for ${garageId}`);
        
        this.realtimeChannel = supabase.channel(`garage_sync_${garageId}`)
            .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
                this.handleRealtimePayload(payload, garageId);
            })
            .subscribe();
    }

    private handleRealtimePayload(payload: any, garageId: string) {
        if (payload.new && payload.new.garage_id && payload.new.garage_id !== garageId) return;

        const mapping = SqliteSyncCoordinator.tableMappings.find(m => m.remoteTable === payload.table);
        if (!mapping) return;

        try {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                TransactionHelper.run((tx) => {
                    this.applyRemoteRow(tx, payload.new, mapping.remoteTable, mapping.localTable, mapping.entityType, garageId);
                });
            } else if (payload.eventType === 'DELETE') {
                if (['Debt', 'Movement', 'Subscription', 'Cochera'].includes(mapping.entityType)) {
                    return; 
                }
                const id = payload.old?.id;
                if (!id) return;
                
                TransactionHelper.run((tx) => {
                    const pending = tx.prepare(`SELECT count(*) as count FROM outbox_events WHERE entity_id = ? AND entity_type = ? AND status != 'ACKED'`).get(id, mapping.entityType) as any;
                    if (pending && pending.count > 0) return; 
                    tx.prepare(`DELETE FROM ${mapping.localTable} WHERE id = ?`).run(id);
                });
            }
        } catch(e) {
            console.error('Realtime apply error', e);
        }
    }
}
