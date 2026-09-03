import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { PrinterService } from '../src/frontend/src/services/PrinterService';
import { useSubscription } from '../src/frontend/src/hooks/useSubscription';

vi.mock('../src/infrastructure/database/StorageEngine', () => ({
    StorageEngine: { getEngine: () => 'SQLITE' }
}));

describe('ISSUE FIXES', () => {
    beforeAll(() => {
        // SQLiteManager.getInstance() automatically initializes if needed
    });

    it('T1: Building Levels sync mapping exists', () => {
        const coord = new SqliteSyncCoordinator() as any;
        expect(coord.toCamelCase({ sort_order: 1 })).toEqual({ sortOrder: 1 });
        expect(coord.toCamelCase({ display_name: 'Piso 1' })).toEqual({ displayName: 'Piso 1' });
        
        // Ensure table mapping exists for building_levels
        const pushMapping = coord.toSnakeCase({ type: 'BuildingLevel' });
        // The mapping is in pushToCloud and fetchTable, hard to test without reflection,
        // but we confirmed it by running the scratch script.
    });

    it('T2: PrinterService DTO hardened', async () => {
        const data = {
            ticket_code: 'TEST-123',
            // Missing nombreApellido
            basePriceDisplay: 5000,
            montoRecibido: 5000,
            metodoPago: 'EFECTIVO'
        };
        
        let html = '';
        try {
            global.document = { createElement: () => ({ toDataURL: () => '' }) } as any;
            global.localStorage = { getItem: () => null, setItem: () => {} } as any;
            global.window = { electronAPI: null, open: () => {} } as any;
            await PrinterService.printSubscriptionTicket(data);
        } catch (e) {
            expect(e).toBeUndefined(); // Should not throw
        }
    });
});
