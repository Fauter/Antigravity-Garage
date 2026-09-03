import { describe, test, expect, beforeAll, vi } from 'vitest';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';

describe('Subscription Cochera Sync Serialization', () => {
    let coordinator: SqliteSyncCoordinator;

    beforeAll(() => {
        coordinator = new SqliteSyncCoordinator();
    });

    test('Push serialization maps cocheraId to cochera_id', () => {
        const payload = {
            id: 'sub-1',
            cocheraId: 'cochera-1',
            customerId: 'cust-1',
            type: 'Movil'
        };
        const snakePayload = (coordinator as any).toSnakeCase(payload);
        
        expect(snakePayload.cochera_id).toBe('cochera-1');
        expect(snakePayload.cocheraId).toBeUndefined();
        expect(snakePayload.customer_id).toBe('cust-1');
    });

    test('Pull serialization maps cochera_id to cocheraId', () => {
        const payload = {
            id: 'sub-1',
            cochera_id: 'cochera-1',
            customer_id: 'cust-1',
            type: 'Movil'
        };
        const camelPayload = (coordinator as any).toCamelCase(payload);
        
        expect(camelPayload.cocheraId).toBe('cochera-1');
        expect(camelPayload.cochera_id).toBeUndefined();
        expect(camelPayload.customerId).toBe('cust-1');
    });
});
