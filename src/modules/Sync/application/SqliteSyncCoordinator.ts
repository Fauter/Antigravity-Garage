import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager.js';
import { supabase } from '../../../infrastructure/lib/supabase.js';
import { TransactionHelper } from '../../../infrastructure/database/sqlite/TransactionHelper.js';
import { OpsLogger } from '../../../shared/OpsLogger.js';

export interface TableMapping {
    remoteTable: string;
    localTable: string;
    entityType: string;
    filterColumn?: string;
    filterStrategy?: 'direct' | 'owner_lookup';
}

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
    private activeRealtimeGarageId: string | null = null;

    static readonly tableMappings: TableMapping[] = [
        { remoteTable: 'customers', localTable: 'customers', entityType: 'Customer' },
        { remoteTable: 'subscriptions', localTable: 'subscriptions', entityType: 'Subscription' },
        { remoteTable: 'vehicles', localTable: 'vehicles', entityType: 'Vehicle' },
        { remoteTable: 'stays', localTable: 'stays', entityType: 'Stay' },
        { remoteTable: 'employee_accounts', localTable: 'employees', entityType: 'Employee', filterStrategy: 'owner_lookup', filterColumn: 'owner_id' },
        { remoteTable: 'cocheras', localTable: 'cocheras', entityType: 'Cochera' },
        { remoteTable: 'debts', localTable: 'debts', entityType: 'Debt' },
        { remoteTable: 'incidents', localTable: 'incidents', entityType: 'Incident' },
        { remoteTable: 'vehicle_types', localTable: 'vehicle_types', entityType: 'VehicleType' },
        { remoteTable: 'tariffs', localTable: 'tariffs', entityType: 'Tariff' },
        { remoteTable: 'prices', localTable: 'prices', entityType: 'Price' },
        { remoteTable: 'financial_configs', localTable: 'financial_configs', entityType: 'FinancialConfig' },
        { remoteTable: 'building_levels', localTable: 'building_levels', entityType: 'BuildingLevel' },
        { remoteTable: 'movements', localTable: 'movements', entityType: 'Movement' },
        { remoteTable: 'shift_closes', localTable: 'shift_closes', entityType: 'ShiftClose' },
        { remoteTable: 'partial_closes', localTable: 'partial_closes', entityType: 'PartialClose' },
        { remoteTable: 'promos', localTable: 'promos', entityType: 'Promo' },
        { remoteTable: 'garages', localTable: 'garages', entityType: 'Garage', filterColumn: 'id' },
    ];

    constructor() {
        console.log('[STARTUP][SYNC] SqliteSyncCoordinator initialized');
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

        const isLocalCodeError = msg.includes('Unknown entity type') || msg.includes('Unknown table mapping') || msg.includes('unsupported operation') || msg.includes('invalid local serializer state');
        if (isLocalCodeError) return 'PERMANENT';

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
            
            // Lightweight ping to detect connection changes when idle
            if (!this.isSyncing) {
                try {
                    const { error } = await supabase.from('garages').select('id', { count: 'exact', head: true });
                    const nowReachable = !error;
                    if (nowReachable !== this.backendReachable) {
                        OpsLogger.info({
                            operation: 'REMOTE_API_STATE_CHANGE',
                            onlineState: nowReachable ? 'ONLINE' : 'OFFLINE',
                            status: 'SUCCESS'
                        });
                    }
                    this.backendReachable = nowReachable;
                } catch (e) {
                    if (this.backendReachable) {
                        OpsLogger.info({
                            operation: 'REMOTE_API_STATE_CHANGE',
                            onlineState: 'OFFLINE',
                            status: 'SUCCESS'
                        });
                    }
                    this.backendReachable = false;
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
            console.log(`[SYNC] outbox pending=${events.length}`);

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
            'PartialClose': 'partial_closes',
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
            if (snakePayload._id !== undefined) {
                delete snakePayload._id;
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

    private async applyRemoteRowsChunked(db: any, rows: any[], remoteTable: string, localTable: string, entityType: string, garageId: string, isRecovery: boolean = false) {
        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        let skippedOutbox = 0;

        const CHUNK_SIZE = 500;
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            
            TransactionHelper.run((tx) => {
                const stmtPending = tx.prepare(`SELECT count(*) as count FROM outbox_events WHERE entity_id = ? AND entity_type = ? AND status != 'ACKED'`);
                const stmtExisting = tx.prepare(`SELECT json_data FROM ${localTable} WHERE id = ?`);
                const stmtUpsert = tx.prepare(`
                    INSERT INTO ${localTable} (id, json_data) VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
                `);

                for (const row of chunk) {
                    const id = row.id || row.garage_id || row._id || garageId;
                    if (!id) continue;

                    if (!isRecovery) {
                        const pending = stmtPending.get(id, entityType) as any;
                        if (pending && pending.count > 0) {
                            skippedOutbox++;
                            continue;
                        }
                    }

                    const camelPayload = this.toCamelCase(row);
                    if (!camelPayload.id) {
                        camelPayload.id = id;
                    }

                    const stringifiedPayload = JSON.stringify(camelPayload);
                    const existing = stmtExisting.get(id) as any;

                    if (existing) {
                        if (existing.json_data === stringifiedPayload) {
                            unchanged++;
                            continue;
                        } else {
                            const legacyData = JSON.parse(existing.json_data);
                            if (entityType === 'Debt') {
                                if (camelPayload.remainingAmount === undefined && legacyData.remaining_amount !== undefined) {
                                    camelPayload.remaining_amount = legacyData.remaining_amount;
                                }
                                if (camelPayload.amountPaid === undefined && legacyData.amount_paid !== undefined) {
                                    camelPayload.amount_paid = legacyData.amount_paid;
                                }
                            }
                            // Upsert
                            stmtUpsert.run(id, JSON.stringify(camelPayload));
                            updated++;
                        }
                    } else {
                        stmtUpsert.run(id, stringifiedPayload);
                        inserted++;
                    }
                }
            });
            
            // Yield event loop between chunks
            if (i + CHUNK_SIZE < rows.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        return { inserted, updated, unchanged, skippedOutbox };
    }

    // Exposed for tests and handleRealtimePayload
    public applyRemoteRow(tx: any, row: any, remoteTable: string, localTable: string, entityType: string, garageId: string, isRecovery: boolean = false) {
        const id = row.id || row.garage_id || row._id || garageId;
        if (!id) return;

        if (!isRecovery) {
            const pending = tx.prepare(`SELECT count(*) as count FROM outbox_events WHERE entity_id = ? AND entity_type = ? AND status != 'ACKED'`).get(id, entityType) as any;
            if (pending && pending.count > 0) {
                return;
            }
        }

        const camelPayload = this.toCamelCase(row);
        if (!camelPayload.id) {
            camelPayload.id = id;
        }

        const stringifiedPayload = JSON.stringify(camelPayload);
        const existing = tx.prepare(`SELECT json_data FROM ${localTable} WHERE id = ?`).get(id) as any;

        const stmtUpsert = tx.prepare(`
            INSERT INTO ${localTable} (id, json_data) VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data
        `);

        if (existing) {
            if (existing.json_data === stringifiedPayload) {
                return;
            } else {
                const legacyData = JSON.parse(existing.json_data);
                if (entityType === 'Debt') {
                    if (camelPayload.remainingAmount === undefined && legacyData.remaining_amount !== undefined) {
                        camelPayload.remaining_amount = legacyData.remaining_amount;
                    }
                    if (camelPayload.amountPaid === undefined && legacyData.amount_paid !== undefined) {
                        camelPayload.amount_paid = legacyData.amount_paid;
                    }
                }
                stmtUpsert.run(id, JSON.stringify(camelPayload));
            }
        } else {
            stmtUpsert.run(id, stringifiedPayload);
        }
    }

    public async runSyncCycle(garageId: string, reason: string): Promise<{ status: 'SUCCESS' | 'WITH_WARNINGS', failedTables: string[] }> {
        const result: { status: 'SUCCESS' | 'WITH_WARNINGS', failedTables: string[] } = { status: 'SUCCESS', failedTables: [] };
        
        if (this.isGlobalSyncing) {
            console.log(`[SYNC] Skipped runSyncCycle (${reason}): Already syncing.`);
            return result;
        }
        this.isGlobalSyncing = true;
        this.garageId = garageId;
        const startTime = Date.now();
        console.log(`[SYNC] engine=SQLITE cycle=${reason} started for garage: ${garageId}`);
        OpsLogger.info({ operation: 'SYNC_START', status: 'START', garageId });

        try {
            // STEP 1: PUSH LOCAL (fast-track any pending outbox items before pulling)
            await this.processOutbox();

            // STEP 2: PULL REMOTE -> RECONCILE LOCAL (Controlled Parallelism)
            const chunkSize = 4;
            for (let i = 0; i < SqliteSyncCoordinator.tableMappings.length; i += chunkSize) {
                const chunk = SqliteSyncCoordinator.tableMappings.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (mapping) => {
                    try {
                        await this.fetchTable(mapping.remoteTable, mapping.localTable, garageId, mapping.entityType, mapping.filterColumn, mapping.filterStrategy, false, reason);
                    } catch (tableErr: any) {
                        console.warn(`⚠️ Pull Error for table ${mapping.remoteTable}:`, tableErr?.message || tableErr);
                        result.failedTables.push(mapping.remoteTable);
                    }
                }));
            }

            this.backendReachable = true;
            this.lastSuccessfulSyncAt = new Date();
            
            const duration = Date.now() - startTime;
            if (result.failedTables.length > 0) {
                result.status = 'WITH_WARNINGS';
                console.log(`[SYNC] cycle completed duration=${duration}ms WITH WARNINGS. Failed tables: ${result.failedTables.join(', ')}`);
                OpsLogger.warn({ operation: 'SYNC_SUCCESS', status: 'SUCCESS', garageId, errorMessage: `Warnings on: ${result.failedTables.join(', ')}` });
            } else {
                console.log(`[SYNC] cycle completed duration=${duration}ms`);
                OpsLogger.info({ operation: 'SYNC_SUCCESS', status: 'SUCCESS', garageId });
            }
        } catch (e: any) {
            console.error(`❌ [SYNC] Error in runSyncCycle (${reason}):`, e);
            result.status = 'WITH_WARNINGS';
            result.failedTables.push('ALL'); // Indicate critical failure
            OpsLogger.error({ operation: 'SYNC_FAILURE', status: 'FAIL', garageId, errorMessage: e.message, errorCode: e.code, stack: e.stack });
        } finally {
            this.isGlobalSyncing = false;
        }
        return result;
    }

    async resetReplicatedStateFromRemote(garageId: string) {
        if (this.isGlobalSyncing) return { status: 'ERROR', message: 'Already syncing' };
        this.isGlobalSyncing = true;
        
        console.log(`[SYNC] engine=SQLITE cycle=BOOTSTRAP started`);
        const startTotal = Date.now();
        const db = SQLiteManager.getInstance().getDatabase();
        
        try {
            // 1. Limpiar mutations
            db.prepare(`DELETE FROM outbox_events`).run();
            db.prepare(`DELETE FROM sync_checkpoints`).run();
            
            const timingResults: Record<string, number> = {};
            
            // 2. Clear replicated tables
            for (const mapping of SqliteSyncCoordinator.tableMappings) {
                const smallConfigTables = ['financial_configs', 'vehicle_types', 'tariffs', 'prices', 'promos', 'building_levels', 'employee_accounts', 'garages'];
                if (!smallConfigTables.includes(mapping.remoteTable)) {
                    // Try to delete by garage_id/garageId if present
                    try {
                        db.prepare(`DELETE FROM ${mapping.localTable} WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?`).run(garageId, garageId);
                    } catch (e) {
                        try {
                            db.prepare(`DELETE FROM ${mapping.localTable}`).run();
                        } catch (e2) {}
                    }
                }
            }
            
            // 3. Fetch all data with true (isRecovery)
            const fetchPromises = SqliteSyncCoordinator.tableMappings.map(async (mapping) => {
                const startMs = Date.now();
                await this.fetchTable(mapping.remoteTable, mapping.localTable, garageId, mapping.entityType, mapping.filterColumn, mapping.filterStrategy, true, 'MANUAL_BOOTSTRAP');
                timingResults[mapping.remoteTable] = Date.now() - startMs;
            });
            await Promise.all(fetchPromises);
            
            console.log(`[SYNC] cycle completed duration=${Date.now() - startTotal}ms`);
            return { status: 'SUCCESS', timing: timingResults, totalMs: Date.now() - startTotal };
        } catch (error: any) {
            console.error('❌ Error en Authoritative Recovery SQLite', error);
            return { status: 'ERROR', message: error.message };
        } finally {
            this.isGlobalSyncing = false;
        }
    }

    async pullAllData(garageId: string, isSilent: boolean = false) {
        // We now map pullAllData directly to runSyncCycle for DRY and correctness (PUSH -> PULL)
        return this.runSyncCycle(garageId, isSilent ? 'BACKGROUND_PULL' : 'MANUAL_BOOTSTRAP');
    }

    private reconciliationInterval: NodeJS.Timeout | null = null;
    private activeReconciliationGarageId: string | null = null;
    
    public startReconciliation(garageId: string) {
        // Same garage already running — no-op
        if (this.reconciliationInterval && this.activeReconciliationGarageId === garageId) return;
        
        // Different garage — stop old timer first
        if (this.reconciliationInterval) {
            this.stopReconciliation();
        }

        const SYNC_RECONCILIATION_INTERVAL_MS = 300000; // 5 minutes
        
        this.activeReconciliationGarageId = garageId;
        this.reconciliationInterval = setInterval(() => {
            this.runSyncCycle(garageId, 'PERIODIC').catch(console.error);
        }, SYNC_RECONCILIATION_INTERVAL_MS);
        
        if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') {
            console.log(`[SYNC:TRACE] 5-minute periodic reconciliation started for garage: ${garageId}`);
        }
    }

    public stopReconciliation() {
        if (this.reconciliationInterval) {
            clearInterval(this.reconciliationInterval);
            this.reconciliationInterval = null;
            if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') {
                console.log(`[SYNC:TRACE] Periodic reconciliation stopped (was: ${this.activeReconciliationGarageId}).`);
            }
        }
        this.activeReconciliationGarageId = null;
    }

    private async fetchTable(remoteTable: string, localTable: string, garageId: string, entityType: string, filterColumn?: string, filterStrategy?: 'direct' | 'owner_lookup', isRecovery: boolean = false, reason: string = 'MANUAL_BOOTSTRAP') {
        const startMs = Date.now();
        const db = SQLiteManager.getInstance().getDatabase();
        
        // FASE B/C: Config vs Transactional Large
        const smallConfigTables = ['financial_configs', 'vehicle_types', 'tariffs', 'prices', 'promos', 'building_levels', 'employee_accounts', 'garages'];
        const isIncremental = !isRecovery && !smallConfigTables.includes(remoteTable);
        
        const checkpointKey = `${garageId}_${remoteTable}`;
        let watermark = null;
        
        if (isIncremental) {
            try {
                const cp = db.prepare("SELECT last_synced_at FROM sync_checkpoints WHERE collection_name = ?").get(checkpointKey) as any;
                if (cp && cp.last_synced_at) {
                    // Safety overlap: 120 segundos
                    const overlapTime = new Date(new Date(cp.last_synced_at).getTime() - 120000).toISOString();
                    watermark = overlapTime;
                }
            } catch (e) {
                // Table sync_checkpoints might not exist, ignore
            }
        }
        
        const fetchStart = Date.now();
        let allData: any[] = [];
        let from = 0;
        let to = 999;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            let query;
            if (filterStrategy === 'owner_lookup') {
                const garageRow = db.prepare(`SELECT json_data FROM garages WHERE id = ?`).get(garageId) as any;
                let ownerId = null;
                if (garageRow) {
                    const parsedGarage = JSON.parse(garageRow.json_data);
                    ownerId = parsedGarage.ownerId || parsedGarage.owner_id;
                }
                if (!ownerId) {
                    console.warn(`⚠️ Cannot resolve owner_id for garage ${garageId} locally. Skipping ${remoteTable} sync.`);
                    return;
                }
                const columnToFilter = filterColumn || 'owner_id';
                query = supabase.from(remoteTable).select('*').eq(columnToFilter, ownerId);
            } else {
                const columnToFilter = filterColumn || 'garage_id';
                query = supabase.from(remoteTable).select('*').eq(columnToFilter, garageId);
            }
            
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
        
        const fetchMs = Date.now() - fetchStart;
        
        const applyStart = Date.now();
        let applyStats: { inserted: number; updated: number; unchanged: number; skippedOutbox: number; deleted?: number } = { inserted: 0, updated: 0, unchanged: 0, skippedOutbox: 0 };
        if (allData.length > 0) {
            const stats = await this.applyRemoteRowsChunked(db, allData, remoteTable, localTable, entityType, garageId, isRecovery);
            applyStats = { ...stats };
        }
        const writeMs = Date.now() - applyStart;
        
        // Update watermark ONLY if pull finished successfully
        if (isIncremental) {
            try {
                const now = new Date().toISOString();
                db.prepare("INSERT INTO sync_checkpoints (collection_name, last_synced_at) VALUES (?, ?) ON CONFLICT(collection_name) DO UPDATE SET last_synced_at = excluded.last_synced_at").run(checkpointKey, now);
            } catch (e) {
                // Table might not exist yet, handled by migrations
            }

            // ==========================================================
            // AUTHORITATIVE DELETIONS RECONCILIATION
            // Un pull incremental basado en updated_at no descubre DELETEs.
            // Para evitar "Stale/Zombie Stays", traemos TODOS los IDs remotamente.
            // ==========================================================
            if ((reason === 'MANUAL_BOOTSTRAP' || reason === 'PERIODIC') && (remoteTable === 'stays' || remoteTable === 'movements')) {
                try {
                    let remoteIds: string[] = [];
                    let idHasMore = true;
                    let idFrom = 0;
                    const idPageSize = 1000;
                    
                    while (idHasMore) {
                        let query;
                        if (filterStrategy === 'owner_lookup') {
                            const garageRow = db.prepare(`SELECT json_data FROM garages WHERE id = ?`).get(garageId) as any;
                            const ownerId = garageRow ? JSON.parse(garageRow.json_data).ownerId : null;
                            if (!ownerId) {
                                throw new Error('Cannot resolve ownerId for authoritative reconciliation.');
                            }
                            query = supabase.from(remoteTable).select('id').eq(filterColumn || 'owner_id', ownerId).order('id', { ascending: true }).range(idFrom, idFrom + idPageSize - 1);
                        } else {
                            query = supabase.from(remoteTable).select('id').eq(filterColumn || 'garage_id', garageId).order('id', { ascending: true }).range(idFrom, idFrom + idPageSize - 1);
                        }

                        const { data: idData, error: idError } = await query;
                        if (idError) {
                            console.error(`[SYNC][${remoteTable.toUpperCase()}][RECONCILE] Error fetching page ${idFrom}:`, idError.message);
                            throw idError; // Abort completely if any page fails
                        }

                        if (idData && idData.length > 0) {
                            remoteIds = remoteIds.concat(idData.map(r => r.id));
                            if (idData.length < idPageSize) {
                                idHasMore = false; // Last page
                            } else {
                                idFrom += idPageSize; // Exact page size returned, there might be more
                            }
                        } else {
                            idHasMore = false;
                        }
                    }

                    // Only proceed to delete if the loop completed successfully without throwing
                    let deletedCount = 0;
                    let protectedCount = 0;
                    TransactionHelper.run((tx) => {
                        const localRows = tx.prepare(`SELECT id FROM ${localTable} WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?`).all(garageId, garageId) as any[];
                        const localIds = new Set(localRows.map(r => r.id));
                        
                        // Get all pending mutations for this entity type
                        const pendingRows = tx.prepare(`SELECT entity_id FROM outbox_events WHERE entity_type = ? AND status != 'ACKED'`).all(entityType) as any[];
                        const pendingIds = new Set(pendingRows.map(r => r.entity_id));

                        const remoteIdsSet = new Set(remoteIds);

                        for (const lId of localIds) {
                            if (!remoteIdsSet.has(lId)) {
                                if (pendingIds.has(lId)) {
                                    protectedCount++;
                                } else {
                                    tx.prepare(`DELETE FROM ${localTable} WHERE id = ?`).run(lId);
                                    deletedCount++;
                                }
                            }
                        }
                    });
                    
                    applyStats.deleted = deletedCount; // add to stats
                    if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') {
                        console.log(`[SYNC:TRACE] pull ${remoteTable} remote=${remoteIds.length} deleted=${deletedCount} protected=${protectedCount}`);
                    }
                } catch (recError: any) {
                    console.warn(`⚠️ [SYNC][${remoteTable.toUpperCase()}][RECONCILE] ABORTED. No local records were deleted. Cause:`, recError.message);
                }
            }
        }
        
        // Print detailed per-table instrumentation log
        const totalMs = Date.now() - startMs;
        const totalFetched = allData.length;
        const mode = isRecovery ? 'RECOVERY' : (isIncremental ? 'DELTA' : 'FULL');
        console.log(`[SYNC][${remoteTable.toUpperCase()}] mode=${mode} remote=${totalFetched} inserted=${applyStats.inserted} updated=${applyStats.updated} unchanged=${applyStats.unchanged} deleted=${(applyStats as any).deleted || 0} fetchMs=${fetchMs} writeMs=${writeMs} totalMs=${totalMs}`);
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
        // Same garage already listening — no-op
        if (this.realtimeChannel && this.activeRealtimeGarageId === garageId) return;

        // Different garage — cleanup old channel first (runs even in test env)
        if (this.realtimeChannel) {
            console.log(`🔌 [SYNC] Removing old realtime channel (was: ${this.activeRealtimeGarageId}).`);
            supabase.removeChannel(this.realtimeChannel);
            this.realtimeChannel = null;
            this.activeRealtimeGarageId = null;
        }

        if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
            console.log(`🔌 [SQLITE] Realtime Listener Stub Initialized for ${garageId}`);
            this.realtimeChannel = { stub: true }; // Dummy object so we know it exists
            this.activeRealtimeGarageId = garageId;
            return;
        }

        console.log(`🔌 [SQLITE] Realtime Listener Initialized for ${garageId}`);
        
        this.realtimeChannel = supabase.channel(`garage_sync_${garageId}`)
            .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
                this.handleRealtimePayload(payload, garageId);
            })
            .subscribe();
        
        this.activeRealtimeGarageId = garageId;
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
                const id = payload.old?.id || payload.old?._id;
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
