import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueService } from '../src/modules/Sync/application/QueueService';
import { SyncService } from '../src/modules/Sync/application/SyncService';
import { db } from '../src/infrastructure/database/datastore';

vi.mock('../src/infrastructure/database/datastore', () => ({
    db: {
        mutations: {
            insert: vi.fn(),
            find: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
            count: vi.fn()
        },
        stays: {
            find: vi.fn(),
            update: vi.fn(),
            remove: vi.fn()
        }
    }
}));

vi.mock('../src/infrastructure/lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            upsert: vi.fn(),
            select: vi.fn(),
            eq: vi.fn(),
            is: vi.fn(),
            range: vi.fn(),
            update: vi.fn()
        }))
    }
}));

describe('Phase 0 Hardening Tests', () => {
    let queueService: QueueService;
    let syncService: SyncService;

    beforeEach(() => {
        vi.clearAllMocks();
        queueService = new QueueService();
        syncService = new SyncService();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('TEST 1: Pending survives restart (No emergency flush)', async () => {
        // Mock remove to throw if called (which proves it doesn't emergency flush)
        const removeSpy = vi.spyOn(db.mutations, 'remove');
        
        await syncService.startBackgroundSync();
        
        // It shouldn't have called remove
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('TEST 7: Queue persistence failure (Throws error)', async () => {
        // Make db.mutations.insert fail consistently
        vi.mocked(db.mutations.insert).mockRejectedValue(new Error('NeDB disk error'));
        
        // enqueue should throw after retries
        await expect(queueService.enqueue('Stay', 'UPDATE', { id: '1' }))
            .rejects.toThrow(/LOCAL_SAVED_SYNC_INTENT_FAILED/);
    });

    it('TEST 3: Constraint preserved (Poison pill becomes BLOCKED)', async () => {
        // Setup pending mutation
        const mockMutation = { id: 'm1', entityType: 'Stay', entityId: '1', operation: 'UPDATE', payload: {}, retryCount: 0, status: 'PENDING' };
        vi.mocked(db.mutations.find).mockImplementationOnce(() => ({
            sort: () => ({
                limit: () => Promise.resolve([mockMutation])
            })
        } as any));
        
        // Mock Supabase to throw 23505 (Unique violation)
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        vi.mocked(supabase.from).mockImplementationOnce(() => {
            return { 
                upsert: () => ({
                    select: () => Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
                })
            } as any;
        });

        const updateSpy = vi.spyOn(db.mutations, 'update');
        
        await syncService.processQueue();
        
        // Should mark blocked
        expect(updateSpy).toHaveBeenCalledWith(
            { id: 'm1' },
            { $set: { status: 'BLOCKED', lastError: 'duplicate key', lastErrorCode: '23505' } }
        );
    });

    it('TEST 4: Network retry (Backoff on fetch error)', async () => {
        const mockMutation = { id: 'm1', entityType: 'Stay', entityId: '1', operation: 'UPDATE', payload: {}, retryCount: 0, status: 'PENDING' };
        vi.mocked(db.mutations.find).mockImplementationOnce(() => ({
            sort: () => ({
                limit: () => Promise.resolve([mockMutation])
            })
        } as any));
        
        const { supabase } = await import('../src/infrastructure/lib/supabase');
        vi.mocked(supabase.from).mockImplementationOnce(() => {
            return { 
                upsert: () => ({
                    select: () => Promise.resolve({ error: { message: 'fetch failed', code: 'ECONNRESET' } })
                })
            } as any;
        });

        const updateSpy = vi.spyOn(db.mutations, 'update');
        
        await syncService.processQueue();
        
        // Should mark retry
        expect(updateSpy).toHaveBeenCalledWith(
            { id: 'm1' },
            expect.objectContaining({ 
                $set: expect.objectContaining({ status: 'RETRY', lastError: 'fetch failed' }),
                $inc: { retryCount: 1 }
            })
        );
        
        const status = await syncService.getStatus();
        expect(status.state).toBe('BACKEND_UNREACHABLE');
    });

    it('TEST 8: Manual + Auto trigger protection (isSyncing mutex)', async () => {
        // Mock queue to take a long time
        vi.mocked(db.mutations.find).mockImplementationOnce(() => ({
            sort: () => ({
                limit: () => new Promise(resolve => setTimeout(() => resolve([]), 100))
            })
        } as any));
        
        const p1 = syncService.processQueue();
        const p2 = syncService.processQueue(); // Second one should return early
        
        await Promise.all([p1, p2]);
        
        // find should only be called once
        expect(db.mutations.find).toHaveBeenCalledTimes(1);
    });

    it('TEST 10: markBlocked changes status and is properly isolated', async () => {
        const updateSpy = vi.spyOn(db.mutations, 'update');
        await queueService.markBlocked('m99', 'Constraint Violation', '23505');
        
        expect(updateSpy).toHaveBeenCalledWith(
            { id: 'm99' },
            { $set: { status: 'BLOCKED', lastError: 'Constraint Violation', lastErrorCode: '23505' } }
        );
    });
});
