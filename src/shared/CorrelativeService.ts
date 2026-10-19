import { SQLiteManager } from '../infrastructure/database/sqlite/SQLiteManager';
import { supabase } from '../infrastructure/lib/supabase';
import { OpsLogger } from './OpsLogger.js';
import { randomUUID } from 'crypto';

export class CorrelativeError extends Error {
    constructor(public code: string, message: string, public details?: any) {
        super(message);
        this.name = 'CorrelativeError';
    }
}

/**
 * P0.3A — Correlative Lease System (Correctness Fix)
 * 
 * INVARIANT 1: A terminal may ONLY emit numbers within its active lease [active_start, active_end].
 * INVARIANT 2: Two global leases NEVER overlap (enforced by Supabase atomic counter).
 * INVARIANT 3: A request_id NEVER produces two different ranges (Supabase idempotency).
 * INVARIANT 4: Restart/crash never causes number reuse (pending_request_id recovery).
 * INVARIANT 5: Two concurrent local allocations never receive the same number (atomic UPDATE RETURNING).
 */
export class CorrelativeService {

    public static determineCorrelativeHighWater(garageId: string, type: 'movement' | 'stay', db?: any): number {
        const database = db || SQLiteManager.getInstance().getDatabase();
        this.ensureSchema(database);

        let maxObserved = 0;

        if (type === 'movement') {
            const movs = database.prepare(`
                SELECT 
                    COALESCE(json_extract(json_data, '$.ticket_code'), json_extract(json_data, '$.ticketCode')) as t, 
                    COALESCE(json_extract(json_data, '$.receipt_number'), json_extract(json_data, '$.receiptNumber')) as r 
                FROM movements 
                WHERE json_extract(json_data, '$.garageId') = ?
            `).all(garageId);

            for (const m of movs) {
                const tCode = m.t ? parseInt(String(m.t).replace(/\D/g, ''), 10) : 0;
                const rCode = m.r ? parseInt(String(m.r).replace(/\D/g, ''), 10) : 0;
                if (!isNaN(tCode) && tCode > maxObserved) maxObserved = tCode;
                if (!isNaN(rCode) && rCode > maxObserved) maxObserved = rCode;
            }
        } else {
            const stays = database.prepare(`
                SELECT COALESCE(json_extract(json_data, '$.ticket_code'), json_extract(json_data, '$.ticketCode')) as t 
                FROM stays 
                WHERE json_extract(json_data, '$.garageId') = ?
            `).all(garageId);

            for (const s of stays) {
                if (s.t) {
                    const num = parseInt(String(s.t).replace(/\D/g, ''), 10);
                    if (!isNaN(num) && num > maxObserved) maxObserved = num;
                }
            }
        }

        const lease = database.prepare(`
            SELECT last_issued, active_end, reserve_end
            FROM correlative_leases WHERE garage_id = ? AND type = ?
        `).get(garageId, type) as any;

        if (lease) {
            maxObserved = Math.max(
                maxObserved,
                lease.last_issued || 0,
                lease.active_end || 0,
                lease.reserve_end || 0
            );
        }
        
        try {
            const oldLease = database.prepare('SELECT max_val FROM correlative_leases WHERE garage_id = ? AND type = ?').get(garageId, type) as any;
            if (oldLease && oldLease.max_val) {
                maxObserved = Math.max(maxObserved, oldLease.max_val);
            }
        } catch (e) {}

        return maxObserved;
    }

    // ═══════════════════════════════════════════════════════════════
    // PUBLIC API — P0.3B Architecture: Strict separation of Network and Local SQLite
    // ═══════════════════════════════════════════════════════════════

    /**
     * @deprecated Used by older code. Will be replaced by ensure* and consume*.
     * Does both ensure and consume. STILL DANGEROUS if called inside a transaction.
     */
    static async allocateMovementTicketCode(garageId: string, tx?: any): Promise<string> {
        let attempts = 0;
        while (attempts < 3) {
            attempts++;
            await this.ensureMovementLeaseAvailable(garageId);
            try {
                return this.consumeMovementTicketLocal(garageId, tx);
            } catch (err: any) {
                if (err.message?.includes('LOCAL_LEASE_EXHAUSTED') && attempts < 3) continue;
                throw err;
            }
        }
        throw new Error('Unreachable');
    }

    /**
     * @deprecated Used by older code. Will be replaced by ensure* and consume*.
     * Does both ensure and consume. STILL DANGEROUS if called inside a transaction.
     */
    static async allocateStayTicketCode(garageId: string, tx?: any): Promise<string> {
        let attempts = 0;
        while (attempts < 3) {
            attempts++;
            await this.ensureStayLeaseAvailable(garageId);
            try {
                return this.consumeStayTicketLocal(garageId, tx);
            } catch (err: any) {
                if (err.message?.includes('LOCAL_LEASE_EXHAUSTED') && attempts < 3) continue;
                throw err;
            }
        }
        throw new Error('Unreachable');
    }

    // --- PHASE 1: PREFLIGHT (EXTERNAL) ---
    // May use network I/O. Must be called OUTSIDE of SQLite transactions.
    
    static async ensureMovementLeaseAvailable(garageId: string): Promise<void> {
        await this._ensureLeaseAvailable(garageId, 'movement');
    }

    static async ensureStayLeaseAvailable(garageId: string): Promise<void> {
        await this._ensureLeaseAvailable(garageId, 'stay');
    }

    // --- PHASE 2: TRANSACTIONAL (INTERNAL) ---
    // Strictly local SQLite. Safe to call INSIDE BEGIN IMMEDIATE. Throws LOCAL_LEASE_EXHAUSTED if exhausted.

    static consumeMovementTicketLocal(garageId: string, tx?: any): string {
        const val = this._consumeLocal(garageId, 'movement', tx);
        return String(val).padStart(8, '0');
    }

    static consumeStayTicketLocal(garageId: string, tx?: any): string {
        const val = this._consumeLocal(garageId, 'stay', tx);
        return `E${String(val).padStart(7, '0')}`;
    }

    // ═══════════════════════════════════════════════════════════════
    // SCHEMA MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    /**
     * Ensures the correlative_leases table exists with the new schema.
     * Performs a safe migration from old schema if needed.
     * Idempotent — safe to call multiple times.
     */
    static ensureSchema(db: any): void {
        // Check if table exists at all
        const tableExists = db.prepare(
            `SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='correlative_leases'`
        ).get() as any;

        if (tableExists.c === 0) {
            // Fresh install — create new schema directly
            db.exec(`
                CREATE TABLE correlative_leases (
                    garage_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    active_start INTEGER NOT NULL DEFAULT 0,
                    active_end INTEGER NOT NULL DEFAULT 0,
                    last_issued INTEGER NOT NULL DEFAULT 0,
                    reserve_start INTEGER NOT NULL DEFAULT 0,
                    reserve_end INTEGER NOT NULL DEFAULT 0,
                    active_request_id TEXT,
                    reserve_request_id TEXT,
                    pending_request_id TEXT,
                    PRIMARY KEY (garage_id, type)
                )
            `);
            return;
        }

        // Table exists — check if it's old schema or new
        const cols = db.prepare(`PRAGMA table_info(correlative_leases)`).all() as any[];
        const colNames = cols.map((c: any) => c.name);

        if (colNames.includes('active_start')) {
            // Already new schema
            return;
        }

        // ─── OLD SCHEMA MIGRATION ───
        // Old columns: garage_id, type, last_issued, current_val, max_val
        // We add new columns and migrate data conservatively
        OpsLogger.infoText('STARTUP', 'Migrating correlative_leases to v2 schema...');

        // Add new columns safely
        const newCols = [
            { name: 'active_start', def: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'active_end', def: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'reserve_start', def: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'reserve_end', def: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'active_request_id', def: 'TEXT' },
            { name: 'reserve_request_id', def: 'TEXT' },
            { name: 'pending_request_id', def: 'TEXT' },
        ];

        for (const col of newCols) {
            if (!colNames.includes(col.name)) {
                try {
                    db.exec(`ALTER TABLE correlative_leases ADD COLUMN ${col.name} ${col.def}`);
                } catch (e) {
                    // Ignore duplicate column errors
                }
            }
        }

        // Ensure last_issued column exists (some very old schemas may lack it)
        if (!colNames.includes('last_issued')) {
            try {
                db.exec(`ALTER TABLE correlative_leases ADD COLUMN last_issued INTEGER NOT NULL DEFAULT 0`);
            } catch (e) {}
        }

        // ─── CONSERVATIVE DATA MIGRATION ───
        // For each existing row, set active_start/active_end based on what we can safely infer
        const rows = db.prepare(`SELECT garage_id, type, COALESCE(last_issued, 0) as last_issued, COALESCE(max_val, 0) as max_val FROM correlative_leases`).all() as any[];

        for (const row of rows) {
            let activeStart = 0;
            let activeEnd = 0;

            if (row.last_issued > 0 && row.max_val > 0 && row.last_issued < row.max_val) {
                // There are remaining tickets in the old lease
                // We set active_start to last_issued + 1 (everything before was already used)
                // This may waste some tickets at the start of the original block, but never reuses
                activeStart = row.last_issued + 1;
                activeEnd = row.max_val;
            }
            // If last_issued >= max_val: lease exhausted → active_start=0,active_end=0 → forces new RPC
            // If data is inconsistent: same → forces new RPC (safe)

            db.prepare(`
                UPDATE correlative_leases 
                SET active_start = ?, active_end = ?
                WHERE garage_id = ? AND type = ?
            `).run(activeStart, activeEnd, row.garage_id, row.type);

            OpsLogger.info({
                operation: 'CORRELATIVE_LEASE_MIGRATED',
                status: 'SUCCESS',
                garageId: row.garage_id,
                errorMessage: `type=${row.type} old_last_issued=${row.last_issued} old_max_val=${row.max_val} new_active_start=${activeStart} new_active_end=${activeEnd}`
            });
        }

        OpsLogger.infoText('STARTUP', `[OK] Migration complete · ${rows.length} lease(s) migrated`);
    }

    // ═══════════════════════════════════════════════════════════════
    // RECONCILIATION — updated to work with new schema
    // ═══════════════════════════════════════════════════════════════

    static async reconcileForGarage(garageId: string) {
        const db = SQLiteManager.getInstance().getDatabase();
        this.ensureSchema(db);

        try {
            // --- MOVEMENT RECONCILIATION ---
            const movs = db.prepare(`
                SELECT 
                    COALESCE(json_extract(json_data, '$.ticket_code'), json_extract(json_data, '$.ticketCode')) as t, 
                    COALESCE(json_extract(json_data, '$.receipt_number'), json_extract(json_data, '$.receiptNumber')) as r 
                FROM movements 
                WHERE json_extract(json_data, '$.garageId') = ?
            `).all(garageId);

            let movCodes: number[] = [];
            for (const m of movs) {
                const tCode = m.t ? parseInt(String(m.t).replace(/\D/g, ''), 10) : 0;
                const rCode = m.r ? parseInt(String(m.r).replace(/\D/g, ''), 10) : 0;
                if (!isNaN(tCode) && tCode > 0) movCodes.push(tCode);
                if (!isNaN(rCode) && rCode > 0) movCodes.push(rCode);
            }
            const uniqueMovCodes = [...new Set(movCodes)].sort((a, b) => a - b);
            const maxMovCode = uniqueMovCodes.length > 0 ? uniqueMovCodes[uniqueMovCodes.length - 1] : 0;

            // Read current lease
            const currentMovLease = db.prepare(
                `SELECT last_issued, active_start, active_end FROM correlative_leases WHERE garage_id = ? AND type = 'movement'`
            ).get(garageId) as any;

            // Ensure last_issued is at least as high as the max observed code
            const finalLastIssued = Math.max(currentMovLease?.last_issued || 0, maxMovCode);
            
            if (currentMovLease) {
                // Only advance last_issued forward, never backward. Do NOT touch active_start/active_end.
                if (finalLastIssued > (currentMovLease.last_issued || 0)) {
                    db.prepare(`UPDATE correlative_leases SET last_issued = ? WHERE garage_id = ? AND type = 'movement'`).run(finalLastIssued, garageId);
                }
            } else {
                db.prepare(`INSERT OR IGNORE INTO correlative_leases (garage_id, type, last_issued, active_start, active_end) VALUES (?, 'movement', ?, 0, 0)`).run(garageId, finalLastIssued);
            }

            OpsLogger.debug('CORRELATIVE', 'Reconcile movement', { garageId, maxObserved: maxMovCode, finalLastIssued });

            // --- STAY RECONCILIATION ---
            const stays = db.prepare(`
                SELECT COALESCE(json_extract(json_data, '$.ticket_code'), json_extract(json_data, '$.ticketCode')) as t 
                FROM stays 
                WHERE json_extract(json_data, '$.garageId') = ?
            `).all(garageId);

            let stayCodes: number[] = [];
            for (const s of stays) {
                if (s.t) {
                    const num = parseInt(String(s.t).replace(/\D/g, ''), 10);
                    if (!isNaN(num) && num > 0) stayCodes.push(num);
                }
            }
            const uniqueStayCodes = [...new Set(stayCodes)].sort((a, b) => a - b);
            const maxStayCode = uniqueStayCodes.length > 0 ? uniqueStayCodes[uniqueStayCodes.length - 1] : 0;

            const currentStayLease = db.prepare(
                `SELECT last_issued, active_start, active_end FROM correlative_leases WHERE garage_id = ? AND type = 'stay'`
            ).get(garageId) as any;

            const finalStayLastIssued = Math.max(currentStayLease?.last_issued || 0, maxStayCode);

            if (currentStayLease) {
                if (finalStayLastIssued > (currentStayLease.last_issued || 0)) {
                    db.prepare(`UPDATE correlative_leases SET last_issued = ? WHERE garage_id = ? AND type = 'stay'`).run(finalStayLastIssued, garageId);
                }
            } else {
                db.prepare(`INSERT OR IGNORE INTO correlative_leases (garage_id, type, last_issued, active_start, active_end) VALUES (?, 'stay', ?, 0, 0)`).run(garageId, finalStayLastIssued);
            }

            OpsLogger.debug('CORRELATIVE', 'Reconcile stay', { garageId, maxObserved: maxStayCode, finalLastIssued: finalStayLastIssued });

        } catch (err: any) {
            OpsLogger.errorText('CORRELATIVE', `[ERR] Reconciliation failed for garage ${garageId}`, { error: (err as any)?.message || String(err) });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // CORE ALLOCATION — the bug fix
    // ═══════════════════════════════════════════════════════════════

    private static async _ensureLeaseAvailable(garageId: string, type: 'movement' | 'stay'): Promise<void> {
        const db = SQLiteManager.getInstance().getDatabase();
        this.ensureSchema(db);

        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                // Ensure a row exists
                db.prepare(`
                    INSERT OR IGNORE INTO correlative_leases 
                        (garage_id, type, last_issued, active_start, active_end, reserve_start, reserve_end) 
                    VALUES (?, ?, 0, 0, 0, 0, 0)
                `).run(garageId, type);

                // 1. Read current lease state
                const lease = db.prepare(
                    `SELECT last_issued, active_start, active_end, pending_request_id FROM correlative_leases WHERE garage_id = ? AND type = ?`
                ).get(garageId, type) as any;

                // 2. Check for crash recovery
                if (lease.pending_request_id) {
                    const key = `${garageId}:${type}`;
                    if (this.refillPromises.has(key)) {
                        // Another local concurrent request is already handling the refill. Just wait for it.
                        await this.refillPromises.get(key);
                        continue;
                    }

                    await this._recoverPendingRequest(db, garageId, type, lease.pending_request_id);
                    continue; // Loop around to verify the lease is now sufficient
                }

                // 3. Check if active lease has capacity
                const next = (lease.last_issued || 0) + 1;
                if (lease.active_end > 0 && next <= lease.active_end && next >= lease.active_start) {
                    // Capacity exists. We are done ensuring.
                    return;
                }

                // 4. Active lease exhausted — request new block
                await this._requestNewLease(db, garageId, type);
                
                // After requesting, loop around to verify capacity

            } catch (err: any) {
                if (attempt === MAX_RETRIES - 1) {
                    OpsLogger.errorText('CORRELATIVE', `[ERR] Error ensuring lease ${type} after ${MAX_RETRIES} attempts`, { error: (err as any)?.message || String(err) });
                    throw new Error(`Fallo al generar correlativo global: ${err.message}`);
                }
                if (!err.message?.includes('OF_ERR_LEASE_EXHAUSTED')) {
                    throw new Error(`Fallo al generar correlativo global: ${err.message}`);
                }
            }
        }
        throw new Error(`Fallo al generar correlativo global: MAX_RETRIES exceeded for ${type}`);
    }

    private static _consumeLocal(garageId: string, type: 'movement' | 'stay', tx?: any): number {
        const db = tx || SQLiteManager.getInstance().getDatabase();
        
        // Atomic increment with guard: only succeeds if still within bounds
        const result = db.prepare(`
            UPDATE correlative_leases 
            SET last_issued = last_issued + 1 
            WHERE garage_id = ? AND type = ? AND last_issued < active_end
            RETURNING last_issued, active_end, active_start
        `).get(garageId, type) as any;

        if (!result) {
            throw new Error(`LOCAL_LEASE_EXHAUSTED: Sin tickets en el bloque local para ${type}. Se requiere refill fuera de la transacción.`);
        }

        const allocated = result.last_issued;
        const remaining = result.active_end - allocated;

        OpsLogger.info({
            operation: 'CORRELATIVE_ALLOCATED',
            status: 'SUCCESS',
            garageId,
            terminalId: this.getTerminalId(),
            errorMessage: `type=${type} value=${allocated} remaining=${remaining} range=[${result.active_start}-${result.active_end}]`
        });

        return allocated;
    }

    private static async _allocateCode(garageId: string, type: 'movement' | 'stay', tx?: any): Promise<number> {
        // Deprecated helper to keep old tests running without modification
        await this._ensureLeaseAvailable(garageId, type);
        try {
            return this._consumeLocal(garageId, type, tx);
        } catch (e: any) {
            if (e.message?.includes('LOCAL_LEASE_EXHAUSTED')) {
                // If it fails immediately after ensure, retry (race condition simulation)
                await this._ensureLeaseAvailable(garageId, type);
                return this._consumeLocal(garageId, type, tx);
            }
            throw e;
        }
    }

    // Map to deduplicate concurrent refill requests: Map<garageId:type, Promise>
    private static refillPromises = new Map<string, Promise<void>>();

    /**
     * Request a new lease from Supabase with single-flight deduplication.
     */
    private static async _requestNewLease(db: any, garageId: string, type: string): Promise<void> {
        const key = `${garageId}:${type}`;
        
        // Single-flight: if a refill is already in progress, wait for it instead of spawning another RPC.
        if (this.refillPromises.has(key)) {
            OpsLogger.info({
                operation: 'CORRELATIVE_LEASE_REQUEST_WAIT',
                status: 'START',
                garageId,
                terminalId: this.getTerminalId(),
                errorMessage: `Waiting for in-flight refill for ${type}`
            });
            return this.refillPromises.get(key)!;
        }

        const promise = this._doRequestNewLease(db, garageId, type).finally(() => {
            this.refillPromises.delete(key);
        });
        
        this.refillPromises.set(key, promise);
        return promise;
    }

    /**
     * Internal actual implementation of the crash-safe idempotent lease request.
     */
    private static async _doRequestNewLease(db: any, garageId: string, type: string): Promise<void> {
        const terminalId = this.getTerminalId();
        const requestId = randomUUID();
        const blockSize = 50;

        // Step 1: Persist the request_id BEFORE calling RPC (crash recovery marker)
        db.prepare(`
            UPDATE correlative_leases SET pending_request_id = ? WHERE garage_id = ? AND type = ?
        `).run(requestId, garageId, type);

        OpsLogger.info({
            operation: 'CORRELATIVE_LEASE_REQUEST_START',
            status: 'START',
            garageId,
            terminalId,
            operationId: requestId
        });

        try {
            const highWater = this.determineCorrelativeHighWater(garageId, type as any, db);
            const result = await this._callRpc(garageId, type, terminalId, blockSize, requestId, highWater);

            // Step 2: Activate the lease and clear pending marker
            this._activateLease(db, garageId, type, result.start_val, result.end_val, requestId);

            OpsLogger.info({
                operation: 'CORRELATIVE_LEASE_REQUEST_SUCCESS',
                status: 'SUCCESS',
                garageId,
                terminalId,
                operationId: requestId,
                errorMessage: `range=[${result.start_val}-${result.end_val}] idempotent=${result.idempotent || false}`
            });

        } catch (rpcError: any) {
            // Clear pending marker on failure (so we don't retry a request that never reached Supabase)
            // IMPORTANT: Only clear if we know the RPC never executed. Network errors are ambiguous.
            // For safety, we leave pending_request_id set if the error is a network error,
            // so on next attempt we'll retry the same request_id (idempotent).
            const isDefinitelyNotSent = rpcError.message?.includes('OF_ERR_RPC_NOT_AVAILABLE');
            if (isDefinitelyNotSent) {
                db.prepare(`UPDATE correlative_leases SET pending_request_id = NULL WHERE garage_id = ? AND type = ?`).run(garageId, type);
            }

            OpsLogger.error({
                operation: 'CORRELATIVE_LEASE_FAILURE',
                status: 'FAIL',
                errorMessage: rpcError.message,
                errorCode: rpcError.code,
                stack: rpcError.stack,
                garageId,
                terminalId,
                operationId: requestId
            });

            if (rpcError instanceof CorrelativeError) throw rpcError;
            
            if (rpcError.message === 'Failed to fetch' || rpcError.code === 'ENOTFOUND' || rpcError.message?.includes('fetch')) {
                throw new CorrelativeError('CORRELATIVE_NETWORK_UNREACHABLE', `OF_ERR_NO_LEASE: Sin conexión y bloque de correlativos agotado para ${type}.`, rpcError);
            }
            throw new CorrelativeError('CORRELATIVE_RPC_MISSING', `Error del servidor: ${rpcError.message}`, rpcError);
        }
    }

    /**
     * Recover from a crash where the RPC may have succeeded but we didn't save the result.
     * Retries the same request_id — Supabase returns the same block (idempotent).
     */
    private static async _recoverPendingRequest(db: any, garageId: string, type: string, pendingRequestId: string): Promise<void> {
        const terminalId = this.getTerminalId();
        const blockSize = 50;

        OpsLogger.info({
            operation: 'CORRELATIVE_LEASE_REQUEST_RETRY',
            status: 'START',
            garageId,
            terminalId,
            operationId: pendingRequestId
        });

        try {
            const highWater = this.determineCorrelativeHighWater(garageId, type as any, db);
            const result = await this._callRpc(garageId, type, terminalId, blockSize, pendingRequestId, highWater);
            this._activateLease(db, garageId, type, result.start_val, result.end_val, pendingRequestId);

            OpsLogger.info({
                operation: 'CORRELATIVE_LEASE_REQUEST_SUCCESS',
                status: 'SUCCESS',
                garageId,
                terminalId,
                operationId: pendingRequestId,
                errorMessage: `RECOVERED range=[${result.start_val}-${result.end_val}] idempotent=${result.idempotent || false}`
            });
        } catch (err: any) {
            // Recovery failed (still offline). Clear pending so we can try with a new request_id next time.
            // This is safe because if the RPC actually ran, the block is "burned" but never used —
            // acceptable cost vs. risking a stuck terminal.
            db.prepare(`UPDATE correlative_leases SET pending_request_id = NULL WHERE garage_id = ? AND type = ?`).run(garageId, type);

            OpsLogger.error({
                operation: 'CORRELATIVE_LEASE_FAILURE',
                status: 'FAIL',
                errorMessage: `Recovery failed: ${err.message}`,
                garageId,
                terminalId,
                operationId: pendingRequestId
            });

            if (err instanceof CorrelativeError) throw err;
            throw new CorrelativeError('CORRELATIVE_NETWORK_UNREACHABLE', `OF_ERR_NO_LEASE: Sin conexión y bloque de correlativos agotado para ${type}.`, err);
        }
    }

    /**
     * Call the Supabase RPC. Tries v3, then v2 (idempotent) first, falls back to v1.
     */
    private static async _callRpc(garageId: string, type: string, terminalId: string, blockSize: number, requestId: string, minHighWater: number): Promise<{ start_val: number; end_val: number; idempotent?: boolean }> {
        // Try v3 first
        let result = await supabase.rpc('allocate_ticket_block_v3', {
            p_garage_id: garageId,
            p_terminal_id: terminalId,
            p_size: blockSize,
            p_type: type,
            p_request_id: requestId,
            p_min_value: minHighWater
        });

        if (result.error) {
            const isNotFound3 = result.error.code === 'PGRST202' || (result.error.message?.includes('function') && (result.error.message?.includes('does not exist') || result.error.message?.includes('Could not find the function')));
            if (isNotFound3) {
                OpsLogger.warnText('CORRELATIVE', '[WARN] allocate_ticket_block_v3 not found, falling back to v2');
                result = await supabase.rpc('allocate_ticket_block_v2', {
                    p_garage_id: garageId, p_terminal_id: terminalId, p_size: blockSize, p_type: type, p_request_id: requestId
                });
                
                if (result.error) {
                    const isNotFound2 = result.error.code === 'PGRST202' || (result.error.message?.includes('function') && (result.error.message?.includes('does not exist') || result.error.message?.includes('Could not find the function')));
                    if (isNotFound2) {
                        OpsLogger.warnText('CORRELATIVE', '[WARN] allocate_ticket_block_v2 not found, falling back to v1');
                        result = await supabase.rpc('allocate_ticket_block', {
                            p_garage_id: garageId, p_terminal_id: terminalId, p_size: blockSize, p_type: type
                        });
                        if (result.error) throw result.error;
                        return { start_val: result.data.start_val, end_val: result.data.end_val, idempotent: false };
                    }
                    throw result.error;
                }
                return { start_val: result.data.start_val, end_val: result.data.end_val, idempotent: result.data.idempotent };
            }
            throw result.error;
        }

        return { start_val: result.data.start_val, end_val: result.data.end_val, idempotent: result.data.idempotent };
    }

    /**
     * Store the received lease as the active lease.
     * Sets last_issued to start_val - 1 so the first _consumeFromLease returns start_val.
     */
    private static _activateLease(db: any, garageId: string, type: string, startVal: number, endVal: number, requestId: string): void {
        const highWater = this.determineCorrelativeHighWater(garageId, type as any, db);
        if (endVal < highWater) {
            throw new CorrelativeError('CORRELATIVE_REMOTE_BEHIND', `Inconsistencia crítica: El servidor devolvió un bloque ([${startVal}-${endVal}]) atrasado respecto al historial local (${highWater}). No se puede emitir desde este rango.`);
        }

        db.prepare(`
            UPDATE correlative_leases 
            SET active_start = ?,
                active_end = ?,
                last_issued = ?,
                active_request_id = ?,
                pending_request_id = NULL
            WHERE garage_id = ? AND type = ?
        `).run(startVal, endVal, startVal - 1, requestId, garageId, type);

        OpsLogger.info({
            operation: 'CORRELATIVE_LEASE_ACTIVATED',
            status: 'SUCCESS',
            garageId,
            terminalId: this.getTerminalId(),
            operationId: requestId,
            errorMessage: `type=${type} range=[${startVal}-${endVal}]`
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════

    private static getTerminalId(): string {
        return process.env.TERMINAL_ID || 'terminal_default';
    }
}
