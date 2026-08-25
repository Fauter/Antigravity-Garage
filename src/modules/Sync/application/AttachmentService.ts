import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DATA_DIR } from '../../../infrastructure/database/datastore.js';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager.js';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';

export class AttachmentService {
    public static async processBase64Attachment(
        entityType: string,
        entityId: string,
        fieldName: string,
        base64Data: string,
        remoteBucket: string,
        remotePath: string
    ): Promise<string> {
        if (!base64Data || !base64Data.startsWith('data:image')) {
            // Already a path/URL, or empty, or not base64
            return base64Data;
        }

        const engine = StorageEngine.getEngine();
        
        // If still in NeDB mode, we don't use attachments queue, just return base64
        if (engine === 'NEDB') {
            return base64Data;
        }

        // 1. Save locally to .data/attachments
        const attachmentsDir = path.join(DATA_DIR, 'attachments');
        if (!fs.existsSync(attachmentsDir)) {
            fs.mkdirSync(attachmentsDir, { recursive: true });
        }

        const matches = base64Data.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return base64Data;
        }

        const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `${entityId}_${fieldName}_${Date.now()}.${extension}`;
        const localPath = path.join(attachmentsDir, filename);

        fs.writeFileSync(localPath, buffer);

        // 2. Queue in attachments_outbox
        const db = SQLiteManager.getInstance().getDatabase();
        db.prepare(`
            INSERT INTO attachments_outbox (
                id, entity_type, entity_id, field_name, local_path, remote_bucket, remote_path, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            uuidv4(),
            entityType,
            entityId,
            fieldName,
            localPath,
            remoteBucket,
            remotePath,
            'PENDING',
            new Date().toISOString(),
            new Date().toISOString()
        );

        // Return the remote path (or local if we prefer). We will return remote path so it is deterministic.
        // Or wait, returning the local path is better for offline viewing!
        // We can prepend 'file://' so the frontend can load it locally!
        // When it uploads to Supabase, we can update the entity to the remote URL!
        // But for now, we return `file://${localPath}`.
        return `file://${localPath}`;
    }
}
