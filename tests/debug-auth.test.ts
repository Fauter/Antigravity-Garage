import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthController } from '../src/modules/Identity/infra/AuthController';
import { Request, Response } from 'express';
import { supabase } from '../src/infrastructure/lib/supabase';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';

vi.mock('../src/infrastructure/lib/supabase', () => {
    const fromMock = vi.fn().mockReturnThis();
    const selectMock = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockReturnThis();
    const singleMock = vi.fn().mockReturnThis();
    return {
        supabase: {
            from: fromMock, select: selectMock, eq: eqMock, single: singleMock
        }
    };
});

describe('Debug Auth', () => {
    it('debugs', async () => {
        StorageEngine.setEngine('SQLITE');
        SQLiteManager.initForTest();
        const db = SQLiteManager.getInstance().getDatabase();
        const authController = new AuthController();

        db.prepare(`INSERT INTO garages (id, json_data) VALUES (?, ?)`).run('garage-1', JSON.stringify({
            id: 'garage-1',
            ownerId: 'owner-1'
        }));

        db.prepare(`INSERT INTO employees (id, json_data) VALUES (?, ?)`).run('emp-1', JSON.stringify({
            id: 'emp-1',
            username: 'user1',
            passwordHash: 'pass1',
            ownerId: 'owner-1',
            role: "administrative"
        }));

        (supabase.from as any).mockImplementation(() => { throw new Error("Network error") });

        const req = { body: { username: 'user1', password: 'pass1', garage_id: 'garage-1' }, headers: {} } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;

        await authController.login(req, res);
        
        console.log("Status calls:", (res.status as any).mock.calls);
        console.log("Json calls:", (res.json as any).mock.calls);
    });
});
