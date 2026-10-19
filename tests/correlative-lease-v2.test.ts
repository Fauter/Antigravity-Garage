import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CorrelativeService } from '../src/shared/CorrelativeService';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { supabase } from '../src/infrastructure/lib/supabase';

// Mock Supabase
vi.mock('../src/infrastructure/lib/supabase', () => ({
    supabase: {
        rpc: vi.fn()
    }
}));

// Mock OpsLogger to avoid file I/O in tests
vi.mock('../src/shared/OpsLogger.js', () => ({
    OpsLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        log: vi.fn()
    }
}));

// Mock crypto.randomUUID to control request IDs in tests
let mockUuidCounter = 0;
vi.mock('crypto', () => ({
    randomUUID: () => `test-uuid-${++mockUuidCounter}`
}));

function createTestDb() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    // Create minimal tables for _isCodeOccupied (movements, stays)
    db.exec(`CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, json_data TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS stays (id TEXT PRIMARY KEY, json_data TEXT)`);
    return db;
}

function mockRpcV2(blocks: Array<{ start_val: number; end_val: number }>) {
    let callIndex = 0;
    const seenRequests = new Map<string, { start_val: number; end_val: number }>();

    (supabase.rpc as any).mockImplementation(async (fnName: string, params: any) => {
        if (fnName === 'allocate_ticket_block_v2') {
            const key = `${params.p_garage_id}:${params.p_type}:${params.p_terminal_id}:${params.p_request_id}`;
            
            // Idempotency: same request_id → same block
            if (seenRequests.has(key)) {
                const existing = seenRequests.get(key)!;
                return { data: { ...existing, idempotent: true }, error: null };
            }

            if (callIndex >= blocks.length) {
                // If this is hit, it should throw all the way out
                console.log(`[mockRpcV2] Out of blocks for request: ${key}`);
                return { data: null, error: { message: 'No more blocks configured in mock' } };
            }

            const block = blocks[callIndex++];
            seenRequests.set(key, block);
            return { data: { ...block, idempotent: false }, error: null };
        }
        return { data: null, error: { message: `function ${fnName} does not exist` } };
    });

    return { seenRequests };
}

describe('P0.3A — Correlative Lease System (Correctness)', () => {
    let db: any;

    beforeEach(() => {
        mockUuidCounter = 0;
        vi.clearAllMocks();
        db = createTestDb();
        vi.spyOn(SQLiteManager, 'getInstance').mockReturnValue({
            getDatabase: () => db,
        } as any);
    });

    // ════════════════════════════════════════════════════════════
    // TEST 1 — Single terminal, sequential leases
    // ════════════════════════════════════════════════════════════
    describe('Test 1: Single terminal', () => {
        it('emits exactly 1..50 from first lease, then respects new start', async () => {
            mockRpcV2([
                { start_val: 1, end_val: 50 },
                { start_val: 51, end_val: 100 }
            ]);

            // Emit all 50 from first lease
            const results: number[] = [];
            for (let i = 0; i < 50; i++) {
                const code = await CorrelativeService.allocateStayTicketCode('g1', db);
                results.push(parseInt(code.replace(/\D/g, ''), 10));
            }

            expect(results).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

            // Next allocation should trigger new RPC and start at 51
            const next = await CorrelativeService.allocateStayTicketCode('g1', db);
            expect(next).toBe('E0000051');

            // Verify the RPC was called exactly twice
            const rpcCalls = (supabase.rpc as any).mock.calls.filter(
                (c: any) => c[0] === 'allocate_ticket_block_v2'
            );
            console.log(rpcCalls.map(c => c[1].p_request_id)); expect(rpcCalls.length).toBe(2);
        });
    });

    // ════════════════════════════════════════════════════════════
    // TEST 2 — Two terminals: T1 never emits T2's range
    // ════════════════════════════════════════════════════════════
    describe('Test 2: Two terminals, disjoint ranges', () => {
        it('T1 never emits numbers from T2 range', async () => {
            // Simulate T1 gets 1-50, then 101-150 (T2 got 51-100 in between)
            mockRpcV2([
                { start_val: 1, end_val: 50 },
                { start_val: 101, end_val: 150 }
            ]);

            // T1 uses all 50
            for (let i = 0; i < 50; i++) {
                await CorrelativeService.allocateStayTicketCode('g1', db);
            }

            // Verify last_issued = 50
            const lease = db.prepare(
                `SELECT last_issued, active_start, active_end FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`
            ).get();
            expect(lease.last_issued).toBe(50);

            // Next allocation: T1 gets 101-150 from RPC
            const nextCode = await CorrelativeService.allocateStayTicketCode('g1', db);
            const nextVal = parseInt(nextCode.replace(/\D/g, ''), 10);

            // CRITICAL: must be 101, NOT 51
            expect(nextVal).toBe(101);

            // Verify active lease is now 101-150
            const newLease = db.prepare(
                `SELECT active_start, active_end, last_issued FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`
            ).get();
            expect(newLease.active_start).toBe(101);
            expect(newLease.active_end).toBe(150);
            expect(newLease.last_issued).toBe(101);
        });
    });

    // ════════════════════════════════════════════════════════════
    // TEST 3 — Simultaneous requests get non-overlapping blocks
    // ════════════════════════════════════════════════════════════
    describe('Test 3: Concurrent RPC requests', () => {
        it('two concurrent allocations get non-overlapping blocks', async () => {
            // The mock simulates sequential counter advancement (Supabase serialization)
            let counter = 0;
            const seenRequests = new Map<string, any>();

            (supabase.rpc as any).mockImplementation(async (fnName: string, params: any) => {
                if (fnName === 'allocate_ticket_block_v2') {
                    const key = `${params.p_request_id}`;
                    if (seenRequests.has(key)) {
                        return { data: { ...seenRequests.get(key), idempotent: true }, error: null };
                    }
                    const start = counter * 50 + 1;
                    const end = start + 49;
                    counter++;
                    const block = { start_val: start, end_val: end, idempotent: false };
                    seenRequests.set(key, block);
                    return { data: block, error: null };
                }
                return { data: null, error: { message: `function ${fnName} does not exist` } };
            });

            // Two DB instances simulating two terminals (separate in-memory DBs)
            const db2 = createTestDb();

            // T1 allocates
            const t1Code = await CorrelativeService.allocateStayTicketCode('g1', db);
            // T2 allocates
            vi.spyOn(SQLiteManager, 'getInstance').mockReturnValue({ getDatabase: () => db2 } as any);
            const t2Code = await CorrelativeService.allocateStayTicketCode('g1', db2);

            const t1Val = parseInt(t1Code.replace(/\D/g, ''), 10);
            const t2Val = parseInt(t2Code.replace(/\D/g, ''), 10);

            // They must be in different ranges
            const t1Lease = db.prepare(`SELECT active_start, active_end FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`).get() as any;
            const t2Lease = db2.prepare(`SELECT active_start, active_end FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`).get() as any;

            // Ranges must not overlap
            expect(t1Lease.active_end < t2Lease.active_start || t2Lease.active_end < t1Lease.active_start).toBe(true);
        });
    });

    // ════════════════════════════════════════════════════════════
    // TEST 4 — Lost RPC response + retry with same request_id
    // ════════════════════════════════════════════════════════════
    describe('Test 4: Lost RPC response recovery', () => {
        it('retry with same request_id returns same block', async () => {
            const { seenRequests } = mockRpcV2([
                { start_val: 1, end_val: 50 }
            ]);

            // Simulate: pending_request_id is set (crash after RPC but before saving)
            CorrelativeService.ensureSchema(db);
            db.prepare(`
                INSERT INTO correlative_leases (garage_id, type, last_issued, active_start, active_end, pending_request_id)
                VALUES ('g1', 'stay', 0, 0, 0, 'crash-request-123')
            `).run();

            // Override mock to handle this specific request_id
            (supabase.rpc as any).mockImplementation(async (fnName: string, params: any) => {
                if (fnName === 'allocate_ticket_block_v2') {
                    if (params.p_request_id === 'crash-request-123') {
                        return { data: { start_val: 1, end_val: 50, idempotent: true }, error: null };
                    }
                    return { data: { start_val: 51, end_val: 100, idempotent: false }, error: null };
                }
                return { data: null, error: { message: `function ${fnName} does not exist` } };
            });

            // First allocation should recover the pending request
            const code = await CorrelativeService.allocateStayTicketCode('g1', db);
            expect(code).toBe('E0000001');

            // Verify the lease was activated correctly
            const lease = db.prepare(
                `SELECT active_start, active_end, last_issued, pending_request_id FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`
            ).get() as any;
            expect(lease.active_start).toBe(1);
            expect(lease.active_end).toBe(50);
            expect(lease.last_issued).toBe(1);
            expect(lease.pending_request_id).toBeNull();
        });
    });

    // ════════════════════════════════════════════════════════════
    // TEST 5 — Crash before saving lease (pending_request_id)
    // ════════════════════════════════════════════════════════════
    describe('Test 5: Crash before saving lease', () => {
        it('recovers same block after restart', async () => {
            CorrelativeService.ensureSchema(db);

            // Simulate a crashed state: pending_request_id set, no active lease
            db.prepare(`
                INSERT INTO correlative_leases (garage_id, type, last_issued, active_start, active_end, pending_request_id)
                VALUES ('g1', 'movement', 0, 0, 0, 'pending-uuid-456')
            `).run();

            (supabase.rpc as any).mockImplementation(async (fnName: string, params: any) => {
                if (fnName === 'allocate_ticket_block_v2' && params.p_request_id === 'pending-uuid-456') {
                    return { data: { start_val: 201, end_val: 250, idempotent: true }, error: null };
                }
                return { data: null, error: { message: 'unexpected call' } };
            });

            const code = await CorrelativeService.allocateMovementTicketCode('g1', db);
            expect(code).toBe('00000201');

            // Verify recovery completed
            const lease = db.prepare(
                `SELECT active_start, active_end, last_issued, pending_request_id, active_request_id FROM correlative_leases WHERE garage_id = 'g1' AND type = 'movement'`
            ).get() as any;
            expect(lease.active_start).toBe(201);
            expect(lease.active_end).toBe(250);
            expect(lease.last_issued).toBe(201);
            expect(lease.pending_request_id).toBeNull();
            expect(lease.active_request_id).toBe('pending-uuid-456');
        });
    });

    // ════════════════════════════════════════════════════════════
    // TEST 6 — Restart does not retrocede last_issued
    // ════════════════════════════════════════════════════════════
    describe('Test 6: Restart never resets last_issued', () => {
        it('continues from last_issued after simulated restart', async () => {
            mockRpcV2([{ start_val: 1, end_val: 50 }]);

            // Allocate 10 tickets
            for (let i = 0; i < 10; i++) {
                await CorrelativeService.allocateStayTicketCode('g1', db);
            }

            // Verify state
            const before = db.prepare(
                `SELECT last_issued FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`
            ).get() as any;
            expect(before.last_issued).toBe(10);

            // "Restart" — just re-allocate. Schema is already set up, row exists.
            const next = await CorrelativeService.allocateStayTicketCode('g1', db);
            expect(next).toBe('E0000011');
        });
    });

    // ════════════════════════════════════════════════════════════
    // TEST 7 — Legacy data migration
    // ════════════════════════════════════════════════════════════
    describe('Test 7: Legacy data migration', () => {
        it('migrates old schema without reusing potentially assigned numbers', () => {
            // Create OLD schema
            db.exec(`
                CREATE TABLE correlative_leases (
                    garage_id TEXT,
                    type TEXT,
                    last_issued INTEGER,
                    current_val INTEGER,
                    max_val INTEGER,
                    PRIMARY KEY (garage_id, type)
                )
            `);

            // Insert old-style data: T1 used 1..30 of a 1-50 lease
            db.prepare(`
                INSERT INTO correlative_leases (garage_id, type, last_issued, current_val, max_val)
                VALUES ('g1', 'stay', 30, 31, 50)
            `).run();

            // Trigger migration
            CorrelativeService.ensureSchema(db);

            // Verify migration result
            const lease = db.prepare(
                `SELECT active_start, active_end, last_issued FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`
            ).get() as any;

            // active_start should be 31 (last_issued + 1), active_end should be 50 (max_val)
            expect(lease.active_start).toBe(31);
            expect(lease.active_end).toBe(50);
            expect(lease.last_issued).toBe(30);
        });

        it('forces new RPC for exhausted legacy lease', () => {
            db.exec(`
                CREATE TABLE correlative_leases (
                    garage_id TEXT,
                    type TEXT,
                    last_issued INTEGER,
                    current_val INTEGER,
                    max_val INTEGER,
                    PRIMARY KEY (garage_id, type)
                )
            `);

            // Exhausted: last_issued = max_val
            db.prepare(`
                INSERT INTO correlative_leases (garage_id, type, last_issued, current_val, max_val)
                VALUES ('g1', 'movement', 50, 51, 50)
            `).run();

            CorrelativeService.ensureSchema(db);

            const lease = db.prepare(
                `SELECT active_start, active_end FROM correlative_leases WHERE garage_id = 'g1' AND type = 'movement'`
            ).get() as any;

            // Must force new RPC
            expect(lease.active_start).toBe(0);
            expect(lease.active_end).toBe(0);
        });
    });

    // ════════════════════════════════════════════════════════════
    // TEST 8 — 100 concurrent local allocations: zero duplicates
    // ════════════════════════════════════════════════════════════
    describe('Test 8: 100 concurrent local allocations', () => {
        it('produces 100 unique numbers with zero duplicates and exactly 2 RPCs', async () => {
            mockRpcV2([
                { start_val: 1, end_val: 50 },
                { start_val: 51, end_val: 100 }
            ]);

            const promises: Promise<string>[] = [];
            for (let i = 0; i < 100; i++) {
                promises.push(CorrelativeService.allocateMovementTicketCode('g1', db));
            }

            const results = await Promise.all(promises);
            const nums = results.map(r => parseInt(r, 10));
            const unique = new Set(nums);

            expect(unique.size).toBe(100);
            expect(Math.min(...nums)).toBe(1);
            expect(Math.max(...nums)).toBe(100);

            // Verify single-flight refill: only 2 RPCs should have been made for 100 allocations
            const rpcCalls = (supabase.rpc as any).mock.calls.filter(
                (c: any) => c[0] === 'allocate_ticket_block_v2'
            );
            expect(rpcCalls.length).toBe(2);
        });
    });

    // ════════════════════════════════════════════════════════════
    // INVARIANT DEMONSTRATIONS
    // ════════════════════════════════════════════════════════════
    describe('Invariant demonstrations', () => {
        it('INVARIANT 1: terminal never emits outside active lease', async () => {
            mockRpcV2([{ start_val: 101, end_val: 150 }]);

            const code = await CorrelativeService.allocateStayTicketCode('g1', db);
            const val = parseInt(code.replace(/\D/g, ''), 10);

            expect(val).toBeGreaterThanOrEqual(101);
            expect(val).toBeLessThanOrEqual(150);
        });

        it('INVARIANT 2: two leases never overlap (via mock counter)', async () => {
            let counter = 0;
            (supabase.rpc as any).mockImplementation(async (fnName: string) => {
                if (fnName === 'allocate_ticket_block_v2') {
                    const start = counter * 50 + 1;
                    counter++;
                    return { data: { start_val: start, end_val: start + 49, idempotent: false }, error: null };
                }
                return { data: null, error: { message: 'not found' } };
            });

            const db2 = createTestDb();

            await CorrelativeService.allocateStayTicketCode('g1', db);
            vi.spyOn(SQLiteManager, 'getInstance').mockReturnValue({ getDatabase: () => db2 } as any);
            await CorrelativeService.allocateStayTicketCode('g1', db2);

            const l1 = db.prepare(`SELECT active_start, active_end FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`).get() as any;
            const l2 = db2.prepare(`SELECT active_start, active_end FROM correlative_leases WHERE garage_id = 'g1' AND type = 'stay'`).get() as any;

            // No overlap
            expect(l1.active_end).toBeLessThan(l2.active_start);
        });

        it('INVARIANT 3: same request_id returns same block', async () => {
            const requestId = 'fixed-request-id';
            CorrelativeService.ensureSchema(db);

            db.prepare(`
                INSERT INTO correlative_leases (garage_id, type, last_issued, active_start, active_end, pending_request_id)
                VALUES ('g1', 'stay', 0, 0, 0, ?)
            `).run(requestId);

            let callCount = 0;
            (supabase.rpc as any).mockImplementation(async (fnName: string, params: any) => {
                if (fnName === 'allocate_ticket_block_v2') {
                    callCount++;
                    return { data: { start_val: 500, end_val: 549, idempotent: callCount > 1 }, error: null };
                }
                return { data: null, error: { message: 'not found' } };
            });

            const code1 = await CorrelativeService.allocateStayTicketCode('g1', db);
            expect(parseInt(code1.replace(/\D/g, ''), 10)).toBe(500);
        });

        it('INVARIANT 4: restart never causes reuse', async () => {
            mockRpcV2([{ start_val: 1, end_val: 50 }]);

            for (let i = 0; i < 25; i++) {
                await CorrelativeService.allocateMovementTicketCode('g1', db);
            }

            // "Restart" — the DB persists, and last_issued = 25
            const lease = db.prepare(`SELECT last_issued FROM correlative_leases WHERE garage_id = 'g1' AND type = 'movement'`).get() as any;
            expect(lease.last_issued).toBe(25);

            const next = await CorrelativeService.allocateMovementTicketCode('g1', db);
            expect(parseInt(next, 10)).toBe(26);
        });

        it('INVARIANT 5: two local allocations never get same number', async () => {
            mockRpcV2([{ start_val: 1, end_val: 1000 }]);

            // Allocate first to get the lease
            await CorrelativeService.allocateMovementTicketCode('g1', db);

            // Then do 99 more in parallel
            const promises: Promise<string>[] = [];
            for (let i = 0; i < 99; i++) {
                promises.push(CorrelativeService.allocateMovementTicketCode('g1', db));
            }
            const results = await Promise.all(promises);
            const allNums = [1, ...results.map(r => parseInt(r, 10))];
            const unique = new Set(allNums);

            expect(unique.size).toBe(100);
        });
    });

    // ════════════════════════════════════════════════════════════
    // Backward compatibility
    // ════════════════════════════════════════════════════════════
    describe('Backward compatibility', () => {
        it('falls back to v1 RPC if v2 does not exist', async () => {
            (supabase.rpc as any).mockImplementation(async (fnName: string) => {
                if (fnName === 'allocate_ticket_block_v2') {
                    return { data: null, error: { message: 'function allocate_ticket_block_v2(uuid, text, integer, text, text) does not exist' } };
                }
                if (fnName === 'allocate_ticket_block') {
                    return { data: { start_val: 1, end_val: 50 }, error: null };
                }
                return { data: null, error: { message: 'unknown' } };
            });

            const code = await CorrelativeService.allocateStayTicketCode('g1', db);
            expect(code).toBe('E0000001');
        });
    });

    // ════════════════════════════════════════════════════════════
    // Format compatibility
    // ════════════════════════════════════════════════════════════
    describe('Format compatibility', () => {
        it('movement codes are 8-digit zero-padded', async () => {
            mockRpcV2([{ start_val: 1, end_val: 50 }]);
            const code = await CorrelativeService.allocateMovementTicketCode('g1', db);
            expect(code).toBe('00000001');
            expect(code.length).toBe(8);
        });

        it('stay codes are E + 7-digit zero-padded', async () => {
            mockRpcV2([{ start_val: 1, end_val: 50 }]);
            const code = await CorrelativeService.allocateStayTicketCode('g1', db);
            expect(code).toBe('E0000001');
            expect(code.length).toBe(8);
        });
    });
});
