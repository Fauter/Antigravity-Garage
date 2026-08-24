import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { AccessController } from './AccessController';
import { db } from '../../../infrastructure/database/datastore';
import Datastore from '@seald-io/nedb';

describe('AccessController - Prepaid Validation', () => {
    let controller: AccessController;
    let req: any;
    let res: any;

    beforeEach(() => {
        // Use in-memory DBs to prevent EPERM lock errors
        db.tariffs = new Datastore({ inMemoryOnly: true });
        db.prices = new Datastore({ inMemoryOnly: true });
        db.garages = new Datastore({ inMemoryOnly: true });

        // Mock repositories
        const mockStayRepo = { save: vi.fn().mockResolvedValue({ id: 'stay-1' }) };
        const mockMovementRepo = { save: vi.fn().mockResolvedValue({ id: 'mov-1' }) };
        const mockVehicleRepo = { findById: vi.fn().mockResolvedValue(null) };
        const mockCustomerRepo = { findById: vi.fn().mockResolvedValue(null) };
        const mockSubRepo = { findActiveByCustomer: vi.fn().mockResolvedValue([]) };

        controller = new AccessController(
            mockStayRepo as any,
            mockMovementRepo as any,
            mockVehicleRepo as any,
            mockCustomerRepo as any,
            mockSubRepo as any
        );

        req = {
            body: {
                plate: 'TEST01',
                vehicleTypeId: 'v1',
                operator: 'Test'
            },
            headers: {
                'x-garage-id': 'g1'
            }
        };

        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
    });


    it('should reject prepaid entry if tariff does not exist locally', async () => {
        req.body.prepaidTariffId = 't1';
        req.body.prepaidPaymentMethod = 'Efectivo';
        req.body.prepaidInvoiceType = 'B';

        await controller.registerEntry(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('no existe') }));
    });

    it('should reject prepaid entry if calculated price is <= 0', async () => {
        req.body.prepaidTariffId = 't1';
        req.body.prepaidPaymentMethod = 'Efectivo';
        req.body.prepaidInvoiceType = 'B';

        await new Promise((resolve, reject) => db.tariffs.insert({ id: 't1', garageId: 'g1', name: 'Promo', hours: 1 }, (err) => err ? reject(err) : resolve(null)));
        // We do NOT insert a price, so price defaults to 0

        await controller.registerEntry(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('no posee un precio válido') }));
    });

    it('should allow prepaid entry if valid price exists', async () => {
        req.body.prepaidTariffId = 't1';
        req.body.prepaidPaymentMethod = 'Efectivo';
        req.body.prepaidInvoiceType = 'B';

        await new Promise((resolve, reject) => db.tariffs.insert({ id: 't1', garageId: 'g1', name: 'Promo', hours: 1 }, (err) => err ? reject(err) : resolve(null)));
        await new Promise((resolve, reject) => db.prices.insert({ garageId: 'g1', tariffId: 't1', vehicleTypeId: 'v1', priceList: 'standard', amount: 1500 }, (err) => err ? reject(err) : resolve(null)));

        await controller.registerEntry(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stay: expect.any(Object), prepaidMovement: expect.any(Object) }));
    });
});
