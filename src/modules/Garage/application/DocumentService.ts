import { supabase } from '../../../infrastructure/lib/supabase.js';

/**
 * Metadata structure for a single captured document.
 */
interface DocumentEntry {
    type: string;           // "Seguro" | "DNI" | "Cédula"
    storagePath?: string;   // Path in Supabase Storage bucket
    publicUrl?: string;     // Public URL for preview
    base64?: string;        // Fallback: compressed base64 data URL
    sizeBytes: number;
}

/**
 * Full documents metadata stored in the subscription's JSONB column.
 */
export interface DocumentsMetadata {
    uploadedAt: string;     // ISO date
    documents: DocumentEntry[];
}

const BUCKET_NAME = 'subscription-docs';

/**
 * Service responsible for processing and persisting subscription document photos.
 * Strategy: Upload to Supabase Storage → fallback to base64 in JSONB.
 */
export class DocumentService {

    /**
     * Process a dictionary of photos (keyed by document type).
     * Attempts Supabase Storage upload first; falls back to inline base64.
     *
     * @param subscriptionId - UUID of the saved subscription
     * @param garageId - UUID of the garage
     * @param photos - Record<string, string> where key is doc type and value is base64 data URL
     * @returns DocumentsMetadata to be stored in `documents_metadata` column
     */
    static async processPhotos(
        subscriptionId: string,
        garageId: string,
        photos: Record<string, string>
    ): Promise<DocumentsMetadata> {
        const documents: DocumentEntry[] = [];

        for (const [docType, dataUrl] of Object.entries(photos)) {
            if (!dataUrl || dataUrl.length === 0) continue;

            // Extract raw base64 bytes for upload
            const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const sizeBytes = buffer.length;
            const storagePath = `${garageId}/${subscriptionId}/${docType}.jpg`;

            try {
                // Attempt Supabase Storage upload
                const { data, error } = await supabase.storage
                    .from(BUCKET_NAME)
                    .upload(storagePath, buffer, {
                        contentType: 'image/jpeg',
                        upsert: true
                    });

                if (error) {
                    throw error;
                }

                // Get public URL
                const { data: urlData } = supabase.storage
                    .from(BUCKET_NAME)
                    .getPublicUrl(storagePath);

                documents.push({
                    type: docType,
                    storagePath,
                    publicUrl: urlData?.publicUrl || undefined,
                    sizeBytes
                });

                console.log(`📸 [DocumentService] "${docType}" subido a Storage: ${storagePath} (${(sizeBytes / 1024).toFixed(1)} KB)`);

            } catch (uploadError: any) {
                // FALLBACK: Store compressed base64 directly in JSONB
                console.warn(
                    `⚠️ [DocumentService] FALLBACK ACTIVADO para "${docType}": ` +
                    `No se pudo subir a Supabase Storage (bucket: ${BUCKET_NAME}). ` +
                    `Error: ${uploadError?.message || uploadError}. ` +
                    `Guardando base64 comprimido en JSONB (${(sizeBytes / 1024).toFixed(1)} KB).`
                );

                documents.push({
                    type: docType,
                    base64: dataUrl,
                    sizeBytes
                });
            }
        }

        return {
            uploadedAt: new Date().toISOString(),
            documents
        };
    }

    /**
     * Cleanup orphaned documents from Storage when a subscription is rolled back.
     * Best-effort: errors are logged but do not propagate.
     */
    static async cleanupOrphanedDocs(garageId: string, subscriptionId: string): Promise<void> {
        try {
            const folderPath = `${garageId}/${subscriptionId}/`;
            const { data: files } = await supabase.storage
                .from(BUCKET_NAME)
                .list(folderPath);

            if (files && files.length > 0) {
                const paths = files.map(f => `${folderPath}${f.name}`);
                await supabase.storage.from(BUCKET_NAME).remove(paths);
                console.log(`🧹 [DocumentService] Cleaned up ${paths.length} orphaned documents for sub ${subscriptionId}`);
            }
        } catch (err) {
            console.warn(`⚠️ [DocumentService] Cleanup failed for sub ${subscriptionId}:`, err);
        }
    }
}
