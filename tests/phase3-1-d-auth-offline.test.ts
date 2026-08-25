import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AuthController } from '../src/modules/Identity/infra/AuthController';
import { supabase as SupabaseClient } from '../src/infrastructure/lib/supabase';
import { saveHardwareConfig, loadHardwareConfig } from '../src/hardware/config/hardware.config';
import { Request, Response } from 'express';

describe('PHASE 3.1 - D: AUTH OFFLINE', () => {
    let authController: AuthController;

    beforeAll(() => {
        authController = new AuthController();
        
        // Mock Supabase to simulate Offline
        vi.spyOn(SupabaseClient, 'from').mockImplementation(() => {
            throw new Error('ENOTFOUND: supabase.co is unreachable');
        });
        vi.spyOn(SupabaseClient, 'rpc').mockRejectedValue(new Error('Offline'));

        // Inject hardware config
        const config = loadHardwareConfig();
        config.adminPinHash = 'offline-hash-123';
        saveHardwareConfig(config);
    });

    afterAll(() => {
        vi.restoreAllMocks();
        
        const config = loadHardwareConfig();
        config.adminPinHash = undefined;
        saveHardwareConfig(config);
    });

    it('D1: Should permit sign-in if the PIN is in hardware config and Supabase is offline', async () => {
        const req = {
            body: { username: 'admin', password: 'offline-hash-123', garage_id: 'test-garage' },
            headers: {}
        } as unknown as Request;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;

        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            id: 'local-admin-fallback',
            username: 'admin',
            role: 'ADMIN'
        }));
    });

    it('D2: Should reject sign-in if the PIN does not match', async () => {
        const req = {
            body: { username: 'admin', password: 'wrong-hash', garage_id: 'test-garage' },
            headers: {}
        } as unknown as Request;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;

        await authController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: 'Credenciales inválidas' });
    });
});
