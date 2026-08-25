import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { SqliteSyncCoordinator } from '../src/modules/Sync/application/SqliteSyncCoordinator';
import { supabase as SupabaseClient } from '../src/infrastructure/lib/supabase';
import { AccessController } from '../src/modules/AccessControl/infra/AccessController';
import { db } from '../src/infrastructure/database/datastore';
import fs from 'fs';
import path from 'path';

describe('PHASE 3.1 - F: ATTACHMENTS OFFLINE', () => {
    let sqlite: any;
    let syncCoordinator: SqliteSyncCoordinator;
    let accessController: AccessController;

    beforeAll(async () => {
        vi.useFakeTimers();

        vi.spyOn(StorageEngine, 'getEngine').mockReturnValue('SQLITE');
        
        sqlite = SQLiteManager.getInstance().getDatabase();
        sqlite.exec('DELETE FROM outbox_events;');
        sqlite.exec('DELETE FROM attachments_outbox;');
        sqlite.exec('DELETE FROM stays;');
        sqlite.exec('DELETE FROM vehicles;');

        // Start offline
        vi.spyOn(SupabaseClient, 'rpc').mockRejectedValue(new Error('Offline'));
        vi.spyOn(SupabaseClient.storage, 'from').mockReturnValue({
            upload: vi.fn().mockRejectedValue(new Error('Offline Upload Failed')),
            getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'mock-url' } })
        } as any);

        accessController = new AccessController();
        syncCoordinator = new SqliteSyncCoordinator();
        syncCoordinator.stopBackgroundSync?.();
        if ((syncCoordinator as any).syncInterval) {
            clearInterval((syncCoordinator as any).syncInterval);
        }
    });

    afterAll(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('F1: Base64 photo is saved locally and enqueued in attachments_outbox when offline', async () => {
        const mockBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD';
        
        const req = {
            body: { plate: 'ATT123', vehicleTypeId: 'v-123', photoPath: mockBase64 },
            headers: { 'x-garage-id': 'test-garage' }
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as any;

        await accessController.registerEntry(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        
        // 1. Verify Stay was created with local path
        const stays = sqlite.prepare('SELECT * FROM stays').all();
        expect(stays.length).toBe(1);
        const stay = JSON.parse(stays[0].json_data);
        expect(stay.entry_photo_path).toMatch(/^file:\/\/.*\.jpg$/);

        // 2. Verify File exists on disk
        const localPath = stay.entry_photo_path.replace('file://', '');
        expect(fs.existsSync(localPath)).toBe(true);

        // 3. Verify attachments_outbox has an entry
        const attachments = sqlite.prepare('SELECT * FROM attachments_outbox').all();
        expect(attachments.length).toBe(1);
        expect(attachments[0].status).toBe('PENDING');
        expect(attachments[0].local_path).toBe(localPath);
    });

    it('F2: When online, attachments_outbox is processed and Supabase Storage receives the file', async () => {
        // Come online
        const uploadMock = vi.fn().mockResolvedValue({ data: { path: 'path' }, error: null });
        vi.spyOn(SupabaseClient.storage, 'from').mockReturnValue({
            upload: uploadMock,
            getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://mock-supabase.com/photo.jpg' } })
        } as any);

        await syncCoordinator.processAttachments();

        const attachments = sqlite.prepare('SELECT * FROM attachments_outbox').all();
        expect(attachments[0].status).toBe('ACKED');

        // Verify Storage upload was called
        expect(uploadMock).toHaveBeenCalled();

        // Verify Stay JSON data was updated to the public URL
        const stays = sqlite.prepare('SELECT * FROM stays').all();
        const stay = JSON.parse(stays[0].json_data);
        expect(stay.entry_photo_path).toBe('https://mock-supabase.com/photo.jpg');

        // Clean up mock file
        const localPath = attachments[0].local_path;
        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
        }
    });
});
