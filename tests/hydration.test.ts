import { describe, it, expect, vi } from 'vitest';
import { GarageController } from '../src/modules/Garage/infra/GarageController';
import { Request, Response } from 'express';

describe('Hydration Isolated Integrations', () => {
    it('should return 200 and the correct shape for GET /api/abonos/hydration', async () => {
        const controller = new GarageController();
        const req = { headers: { 'x-garage-id': 'test-garage' } } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;

        await controller.getHydration(req, res);

        // Expect not to have errored (status 500)
        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(res.status).not.toHaveBeenCalledWith(400);

        // Should return json directly if no status was explicitly chained for 200 (default in Express is 200 if omitted, but my code does `return res.json(...)`)
        expect(res.json).toHaveBeenCalled();
        const body = (res.json as any).mock.calls[0][0];

        expect(body).toHaveProperty('subscriptions');
        expect(body).toHaveProperty('customers');
        expect(body).toHaveProperty('vehicles');
        expect(body).toHaveProperty('debts');
        expect(body).toHaveProperty('cocheras');
        
        expect(Array.isArray(body.subscriptions)).toBe(true);
        expect(Array.isArray(body.customers)).toBe(true);
        expect(Array.isArray(body.vehicles)).toBe(true);
        expect(Array.isArray(body.debts)).toBe(true);
        expect(Array.isArray(body.cocheras)).toBe(true);
    });
});
