import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigRepository } from './ConfigRepository';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine';

// Mock DB
vi.mock('../../../infrastructure/database/datastore', () => {
    return {
        DATA_DIR: './.data',
        db: {
            financialConfigs: {
                find: vi.fn()
            }
        }
    };
});

import { db } from '../../../infrastructure/database/datastore.js';

describe('ConfigRepository', () => {
    beforeEach(() => {
        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('NEDB');
    });

    it('debe devolver la configuración más reciente y parsear snake_case y camelCase', async () => {
        const repo = new ConfigRepository();
        
        // Mock the find method to return an unordered array of mixed case configs
        (db.financialConfigs.find as any).mockResolvedValue([
            {
                _id: 'old',
                garageId: 'test-garage',
                subscription_full_price_enabled: false,
                subscription_full_price_until_day: null,
                updatedAt: '2026-07-05T10:58:39Z'
            },
            {
                _id: 'new',
                garageId: 'test-garage',
                subscriptionFullPriceEnabled: true,
                subscriptionFullPriceUntilDay: 10,
                updatedAt: '2026-08-04T18:13:02Z'
            }
        ]);

        const result = await repo.getParams('test-garage');

        // It should pick the newest one based on updatedAt, which has true and 10
        expect(result.subscriptionFullPriceEnabled).toBe(true);
        expect(result.subscriptionFullPriceUntilDay).toBe(10);
    });

    it('debe priorizar boolean y numbers validos frente a snake_case', async () => {
        const repo = new ConfigRepository();
        
        (db.financialConfigs.find as any).mockResolvedValue([
            {
                _id: 'snake_case_mock',
                garageId: 'test-garage',
                subscription_full_price_enabled: true,
                subscription_full_price_until_day: 15,
                updated_at: '2026-08-04T18:13:02Z'
            }
        ]);

        const result = await repo.getParams('test-garage');

        expect(result.subscriptionFullPriceEnabled).toBe(true);
        expect(result.subscriptionFullPriceUntilDay).toBe(15);
    });
});
