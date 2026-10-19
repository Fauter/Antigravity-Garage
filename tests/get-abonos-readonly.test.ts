import { describe, it, expect, vi } from 'vitest';
import { GarageController } from '../src/modules/Garage/infra/GarageController';

describe('GarageController - GET /abonos (getAllSubscriptions)', () => {
    it('MUST BE READ ONLY - should not call subscriptionRepo.save or trigger outbox', async () => {
        // Arrange
        const mockSubRepo = {
            findAll: vi.fn().mockResolvedValue([
                { id: 'sub-1', garageId: 'g1', endDate: '2026-01-01T00:00:00Z', startDate: '2026-01-01T00:00:00Z' }
            ]),
            save: vi.fn()
        };
        const mockCustRepo = { findAll: vi.fn().mockResolvedValue([]) };
        const mockVehRepo = { findAll: vi.fn().mockResolvedValue([]) };
        
        const controller = new GarageController(
            {} as any, mockCustRepo as any, mockVehRepo as any, mockSubRepo as any, {} as any, {} as any
        );

        const req = { headers: { 'x-garage-id': 'g1' } };
        const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

        // Act
        await controller.getAllSubscriptions(req as any, res as any);

        // Assert
        expect(mockSubRepo.findAll).toHaveBeenCalled();
        expect(mockSubRepo.save).not.toHaveBeenCalled(); // Critical check!
    });
});
