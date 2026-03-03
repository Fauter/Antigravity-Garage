/**
 * Client-side image compression utility for webcam captures.
 * Resizes images to a max width of 800px and compresses at quality 0.7
 * to keep payloads lightweight for DB storage / Supabase upload.
 */

const MAX_WIDTH = 800;
const JPEG_QUALITY = 0.7;

/**
 * Compresses a single base64 data URL image.
 * @param dataUrl - The original base64 data URL (image/jpeg or image/png)
 * @returns A compressed base64 data URL (image/jpeg)
 */
export function compressImage(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                let { width, height } = img;

                // Only downscale, never upscale
                if (width > MAX_WIDTH) {
                    const ratio = MAX_WIDTH / width;
                    width = MAX_WIDTH;
                    height = Math.round(height * ratio);
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas context unavailable'));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);
                const compressed = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
                resolve(compressed);
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = dataUrl;
    });
}

/**
 * Compresses all photos in a dictionary, filtering out empty entries.
 * @param photos - Dictionary keyed by document type (e.g. "Seguro", "DNI", "Cédula")
 * @returns A new dictionary with compressed base64 data URLs (only non-empty entries)
 */
export async function compressPhotos(
    photos: Record<string, string>
): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const entries = Object.entries(photos).filter(([, value]) => value && value.length > 0);

    await Promise.all(
        entries.map(async ([key, dataUrl]) => {
            try {
                result[key] = await compressImage(dataUrl);
            } catch (err) {
                console.warn(`[ImageCompression] Failed to compress "${key}", using original.`, err);
                result[key] = dataUrl; // Graceful fallback to uncompressed
            }
        })
    );

    return result;
}
