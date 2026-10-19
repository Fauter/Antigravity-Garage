import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthController } from '../src/modules/Identity/infra/AuthController';
import { Request, Response } from 'express';
import { supabase } from '../src/infrastructure/lib/supabase';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';

vi.mock('../src/infrastructure/lib/supabase', () => {
    const fromMock = vi.fn().mockReturnThis();
    const selectMock = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockReturnThis();
    const singleMock = vi.fn().mockReturnThis();
    const limitMock = vi.fn().mockReturnThis();
    const gteMock = vi.fn().mockReturnThis();

    return {
        supabase: {
            from: fromMock,
            select: selectMock,
            eq: eqMock,
            single: singleMock,
            limit: limitMock,
            gte: gteMock,
            channel: vi.fn().mockReturnThis(),
            on: vi.fn().mockReturnThis(),
            subscribe: vi.fn().mockReturnThis(),
            removeChannel: vi.fn()
        }
    };
});

describe('Offline Auth Integration', () => {
    let authController: AuthController;
    let syncCoordinator: SqliteSyncCoordinator;
    let db: any;

    beforeEach(() => {
        vi.clearAllMocks();
        StorageEngine.setEngine('SQLITE');
        SQLiteManager.initForTest();
        db = SQLiteManager.getInstance().getDatabase();
        authController = new AuthController();
        syncCoordinator = new SqliteSyncCoordinator();
    });

    const createReqRes = (body: any) => {
        const req = { body, headers: {} } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;
        return { req, res };
    };

    const setupLocalDb = (garageId: string, ownerId: string, username: string, passwordHash: string, empGarageId: string | null = null, empOwnerId: string = ownerId) => {
        db.prepare(`INSERT INTO garages (id, json_data) VALUES (?, ?)`).run(garageId, JSON.stringify({
            id: garageId,
            ownerId,
            name: "Test Garage"
        }));

        db.prepare(`INSERT INTO employees (id, json_data) VALUES (?, ?)`).run('emp-1', JSON.stringify({
            id: 'emp-1',
            username,
            passwordHash,
            ownerId: empOwnerId,
            garageId: empGarageId,
            role: "administrative"
        }));
    };

    // Case 1: Employee belongs to same owner as garage -> login OK
    it('Case 1: Should login successfully when employee belongs to the same owner as the garage', async () => {
        setupLocalDb('garage-1', 'owner-1', 'user1', 'pass1', 'garage-1');

        // Simulate offline
        (supabase.from as any).mockImplementation(() => { throw new Error("Network error") });

        const { req, res } = createReqRes({ username: 'user1', password: 'pass1', garage_id: 'garage-1' });
        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ username: 'user1' }));
    });

    // Case 2: Employee garage_id = null, owner_id correct -> login OK
    it('Case 2: Should login successfully when employee garage_id is null but owner_id matches', async () => {
        setupLocalDb('garage-1', 'owner-1', 'user2', 'pass2', null);

        (supabase.from as any).mockImplementation(() => { throw new Error("Network error") });

        const { req, res } = createReqRes({ username: 'user2', password: 'pass2', garage_id: 'garage-1' });
        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
    });

    // Case 3: Employee has different garage_id but same owner_id -> login OK
    it('Case 3: Should login successfully when employee has different garage_id but same owner_id', async () => {
        setupLocalDb('garage-1', 'owner-1', 'user3', 'pass3', 'old-garage-99');

        (supabase.from as any).mockImplementation(() => { throw new Error("Network error") });

        const { req, res } = createReqRes({ username: 'user3', password: 'pass3', garage_id: 'garage-1' });
        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
    });

    // Case 4: Employee belongs to another owner -> login rejected
    it('Case 4: Should reject login when employee belongs to a different owner', async () => {
        setupLocalDb('garage-1', 'owner-1', 'user4', 'pass4', null, 'other-owner');

        (supabase.from as any).mockImplementation(() => { throw new Error("Network error") });

        const { req, res } = createReqRes({ username: 'user4', password: 'pass4', garage_id: 'garage-1' });
        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
    });

    // Case 5: Incorrect password -> 401
    it('Case 5: Should return 401 on incorrect password', async () => {
        setupLocalDb('garage-1', 'owner-1', 'user5', 'pass5');

        (supabase.from as any).mockImplementation(() => { throw new Error("Network error") });

        const { req, res } = createReqRes({ username: 'user5', password: 'wrong', garage_id: 'garage-1' });
        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    // Case 6: Supabase inaccessible, employee already synced -> login OK from SQLite
    it('Case 6: Should login successfully entirely from SQLite when Supabase is inaccessible', async () => {
        setupLocalDb('garage-offline', 'owner-offline', 'user6', 'pass6');
        
        // Ensure supabase throws unconditionally
        (supabase.from as any).mockImplementation(() => { throw new Error("Network error") });

        const { req, res } = createReqRes({ username: 'user6', password: 'pass6', garage_id: 'garage-offline' });
        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
    });

    // Case 7: Supabase inaccessible, employee never synced -> controlled rejection
    it('Case 7: Should reject login gracefully if employee is not found in SQLite', async () => {
        db.prepare(`INSERT INTO garages (id, json_data) VALUES (?, ?)`).run('garage-7', JSON.stringify({ ownerId: 'owner-7' }));
        
        (supabase.from as any).mockImplementation(() => { throw new Error("Network error") });

        const { req, res } = createReqRes({ username: 'nosync', password: 'pwd', garage_id: 'garage-7' });
        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    // Case 8: Sync employee_accounts downloads all employees of the owner
    it('Case 8: Sync should download all employees belonging to the garage owner', async () => {
        db.prepare(`INSERT INTO garages (id, json_data) VALUES (?, ?)`).run('garage-sync', JSON.stringify({ ownerId: 'owner-sync' }));

        const fromMock = vi.fn().mockReturnThis();
        const selectMock = vi.fn().mockReturnThis();
        const eqMock = vi.fn().mockReturnValue({ data: [
            { id: 'emp-A', username: 'empA', owner_id: 'owner-sync', garage_id: null },
            { id: 'emp-B', username: 'empB', owner_id: 'owner-sync', garage_id: 'other' }
        ], error: null });

        (supabase.from as any) = fromMock;
        fromMock.mockReturnValue({ select: selectMock });
        selectMock.mockReturnValue({ eq: eqMock });

        // Force fetchTable directly for testing specific mapping
        await (syncCoordinator as any).fetchTable('employee_accounts', 'employees', 'garage-sync', 'Employee', 'owner_id', 'owner_lookup');

        // Verify Supabase was called with owner_id = owner-sync
        expect(eqMock).toHaveBeenCalledWith('owner_id', 'owner-sync');

        // Verify local DB was populated
        const rows = db.prepare("SELECT * FROM employees").all();
        expect(rows.length).toBe(2);
        
        const json1 = JSON.parse(rows[0].json_data);
        const json2 = JSON.parse(rows[1].json_data);
        expect(json1.username).toBe('empA');
        expect(json2.username).toBe('empB');
    });

    // Case 10: Sync twice is idempotent
    it('Case 10: Sync twice should be idempotent and not create duplicates', async () => {
        db.prepare(`INSERT INTO garages (id, json_data) VALUES (?, ?)`).run('garage-idemp', JSON.stringify({ ownerId: 'owner-idemp' }));

        const fromMock = vi.fn().mockReturnThis();
        const selectMock = vi.fn().mockReturnThis();
        const eqMock = vi.fn().mockReturnValue({ data: [
            { id: 'emp-X', username: 'empX', owner_id: 'owner-idemp' }
        ], error: null });

        (supabase.from as any) = fromMock;
        fromMock.mockReturnValue({ select: selectMock });
        selectMock.mockReturnValue({ eq: eqMock });

        await (syncCoordinator as any).fetchTable('employee_accounts', 'employees', 'garage-idemp', 'Employee', 'owner_id', 'owner_lookup');
        await (syncCoordinator as any).fetchTable('employee_accounts', 'employees', 'garage-idemp', 'Employee', 'owner_id', 'owner_lookup');

        const rows = db.prepare("SELECT * FROM employees").all();
        expect(rows.length).toBe(1); // Still 1 record
    });
});
