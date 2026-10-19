import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { CorrelativeService } from '../src/shared/CorrelativeService';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { supabase } from '../src/infrastructure/lib/supabase';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'garageia-test-'));
const testDbPath = path.join(tmpDir, 'test-correlative.sqlite');

describe('Correlative System', () => {
    let db: any;
    const garageId = 'test-garage-123';

    beforeAll(async () => {
        (SQLiteManager as any).instance = undefined;
        process.env.DATA_DIR = tmpDir;
        const manager = SQLiteManager.getInstance(testDbPath);
        db = manager.getDatabase();
    });

    afterAll(() => {
        const manager = SQLiteManager.getInstance();
        if (manager.close) manager.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
    });

    beforeEach(() => {
        db.exec('DROP TABLE IF EXISTS correlative_leases');
        db.exec('DROP TABLE IF EXISTS movements');
        db.exec('DROP TABLE IF EXISTS stays');
        db.exec('CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, json_data TEXT)');
        db.exec('CREATE TABLE IF NOT EXISTS stays (id TEXT PRIMARY KEY, json_data TEXT)');
        
        // Default mock: v2 RPC
        supabase.rpc = async (rpcName: string, args: any) => {
            if (rpcName === 'allocate_ticket_block_v2') {
                return {
                    data: {
                        start_val: args.p_type === 'movement' ? 695 : 104,
                        end_val: args.p_type === 'movement' ? 744 : 153,
                        idempotent: false
                    },
                    error: null
                };
            }
            // Fallback for v1
            if (rpcName === 'allocate_ticket_block') {
                return {
                    data: {
                        start_val: args.p_type === 'movement' ? 695 : 104,
                        end_val: args.p_type === 'movement' ? 744 : 153
                    },
                    error: null
                };
            }
            return { data: null, error: null };
        };
    });

    const insertMovement = (code: string) => {
        const id = `mov-${code}-${Math.random().toString(36).slice(2)}`;
        db.prepare('INSERT INTO movements (id, json_data) VALUES (?, ?)').run(id, JSON.stringify({
            garageId,
            ticket_code: code,
            receipt_number: code
        }));
    };

    const insertStay = (code: string) => {
        const id = `stay-${code}-${Math.random().toString(36).slice(2)}`;
        db.prepare('INSERT INTO stays (id, json_data) VALUES (?, ?)').run(id, JSON.stringify({
            garageId,
            ticket_code: code
        }));
    };

    it('TEST 1 — MOVEMENT REGRESSION: reconcile then allocate continues correctly', async () => {
        ['00000691', '00000692', '00000693', '00000694', '00000641', '00000642'].forEach(insertMovement);
        
        await CorrelativeService.reconcileForGarage(garageId);
        
        // After reconcile with no active lease, next allocation triggers RPC → gets 695-744
        const m1 = await CorrelativeService.allocateMovementTicketCode(garageId, db);
        expect(m1).toBe('00000695');
        
        const m2 = await CorrelativeService.allocateMovementTicketCode(garageId, db);
        expect(m2).toBe('00000696');
    });

    it('TEST 2 — STAY: reconcile sets last_issued, then RPC block starts correctly', async () => {
        for (let i = 1; i <= 103; i++) {
            insertStay('E' + String(i).padStart(7, '0'));
        }

        await CorrelativeService.reconcileForGarage(garageId);

        // After reconcile, last_issued=103 but no active lease (start=0, end=0)
        // → triggers RPC → gets 104-153
        const s1 = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(s1).toBe('E0000104');
        const s2 = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(s2).toBe('E0000105');
    });

    it('TEST 3 — MIGRATED LEASE: old schema with remaining tickets', async () => {
        // Create OLD schema, let ensureSchema migrate it
        db.exec('CREATE TABLE IF NOT EXISTS correlative_leases (garage_id TEXT, type TEXT, last_issued INTEGER, current_val INTEGER, max_val INTEGER, PRIMARY KEY (garage_id, type))');
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'stay', 449, 1000)").run(garageId);
        
        // After migration: active_start=450, active_end=1000, last_issued=449
        const s1 = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(s1).toBe('E0000450');
    });

    it('TEST 4 — MIGRATED LEASE: continues from last_issued boundary', async () => {
        db.exec('CREATE TABLE IF NOT EXISTS correlative_leases (garage_id TEXT, type TEXT, last_issued INTEGER, current_val INTEGER, max_val INTEGER, PRIMARY KEY (garage_id, type))');
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'stay', 499, 1000)").run(garageId);
        
        // After migration: active_start=500, active_end=1000
        const s1 = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(s1).toBe('E0000500');
    });

    it('TEST 5 — ISOLATION: stay and movement are independent', async () => {
        db.exec('CREATE TABLE IF NOT EXISTS correlative_leases (garage_id TEXT, type TEXT, last_issued INTEGER, current_val INTEGER, max_val INTEGER, PRIMARY KEY (garage_id, type))');
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'stay', 103, 1000)").run(garageId);
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'movement', 694, 1000)").run(garageId);

        const s1 = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(s1).toBe('E0000104');

        const m1 = await CorrelativeService.allocateMovementTicketCode(garageId, db);
        expect(m1).toBe('00000695');
    });

    it('TEST 6 — RESTART: allocations persist across restart', async () => {
        // First, we need a lease. Mock the RPC to return a block.
        supabase.rpc = async (rpcName: string, args: any) => {
            if (rpcName === 'allocate_ticket_block_v2' && args.p_type === 'stay') {
                return { data: { start_val: 104, end_val: 153, idempotent: false }, error: null };
            }
            return { data: null, error: { message: `function ${rpcName} does not exist` } };
        };

        const first = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(first).toBe('E0000104');

        const second = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(second).toBe('E0000105');

        // "Restart" — reconcile should not regress
        await CorrelativeService.reconcileForGarage(garageId);

        const next = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(next).toBe('E0000106');
    });

    it('TEST 7 — CONCURRENT: 10 parallel allocations are unique', async () => {
        db.exec('CREATE TABLE IF NOT EXISTS correlative_leases (garage_id TEXT, type TEXT, last_issued INTEGER, current_val INTEGER, max_val INTEGER, PRIMARY KEY (garage_id, type))');
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'movement', 694, 1000)").run(garageId);
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'stay', 103, 1000)").run(garageId);

        const movPromises = Array.from({ length: 10 }).map(() => CorrelativeService.allocateMovementTicketCode(garageId, db));
        const stayPromises = Array.from({ length: 10 }).map(() => CorrelativeService.allocateStayTicketCode(garageId, db));

        const movs = await Promise.all(movPromises);
        const stays = await Promise.all(stayPromises);

        const uniqueMovs = new Set(movs);
        expect(uniqueMovs.size).toBe(10);
        
        const uniqueStays = new Set(stays);
        expect(uniqueStays.size).toBe(10);
    });

    it('TEST 8 — PARTIAL PULL: reconcile keeps persisted last_issued', async () => {
        db.exec('CREATE TABLE IF NOT EXISTS correlative_leases (garage_id TEXT, type TEXT, last_issued INTEGER, current_val INTEGER, max_val INTEGER, PRIMARY KEY (garage_id, type))');
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'movement', 694, 1000)").run(garageId);

        ['00000641', '00000642'].forEach(insertMovement);

        await CorrelativeService.reconcileForGarage(garageId);

        const m1 = await CorrelativeService.allocateMovementTicketCode(garageId, db);
        expect(m1).toBe('00000695');
    });

    it('TEST 9 — WITHIN MIGRATED LEASE: allocates correctly', async () => {
        db.exec('CREATE TABLE IF NOT EXISTS correlative_leases (garage_id TEXT, type TEXT, last_issued INTEGER, current_val INTEGER, max_val INTEGER, PRIMARY KEY (garage_id, type))');
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'stay', 103, 150)").run(garageId);

        const s1 = await CorrelativeService.allocateStayTicketCode(garageId, db);
        expect(s1).toBe('E0000104');
    });

    it('TEST 10 — RPC RESPECTS start_val (THE BUG FIX)', async () => {
        db.exec('CREATE TABLE IF NOT EXISTS correlative_leases (garage_id TEXT, type TEXT, last_issued INTEGER, current_val INTEGER, max_val INTEGER, PRIMARY KEY (garage_id, type))');
        // Exhausted lease: last_issued=694, max_val=681 (past end)
        db.prepare("INSERT INTO correlative_leases (garage_id, type, last_issued, max_val) VALUES (?, 'movement', 694, 681)").run(garageId);

        // After migration: active_start=0, active_end=0 (exhausted, max_val < last_issued)
        // Mock an RPC that returns a distant block
        supabase.rpc = async (rpcName: string, args: any) => {
            if (rpcName === 'allocate_ticket_block_v2' && args.p_type === 'movement') {
                return { data: { start_val: 732, end_val: 781, idempotent: false }, error: null };
            }
            return { data: null, error: { message: `function ${rpcName} does not exist` } };
        };

        const m1 = await CorrelativeService.allocateMovementTicketCode(garageId, db);
        
        // THE FIX: must jump to start_val=732, NOT continue from last_issued+1=695
        expect(m1).toBe('00000732');

        // Verify internal state
        const lease = db.prepare("SELECT last_issued, active_start, active_end FROM correlative_leases WHERE type = 'movement'").get() as any;
        expect(lease.last_issued).toBe(732);
        expect(lease.active_start).toBe(732);
        expect(lease.active_end).toBe(781);
    });
});
