/**
 * imageCompressor.ts — Ultra-lightweight image compression utility.
 *
 * Receives a raw image Buffer (typically a 4MP JPEG from the Hikvision camera)
 * and returns a compressed Base64 data URI suitable for storage in the database
 * and embedding in thermal printer tickets.
 *
 * Design decisions:
 *  - JPEG over WebP: thermal printers and some legacy viewers don't support WebP.
 *  - 800px max width: sufficient for visual identification, ~30-50KB output.
 *  - 60% quality: aggressive but preserves vehicle identification details.
 *  - No cropping: full frame is preserved for civil liability / insurance purposes.
 *  - sharp runs in a libvips thread pool — does NOT block Electron's event loop.
 *
 * CRITICAL: sharp is a native dependency. If it fails to load (missing bindings),
 * the utility degrades gracefully by returning raw Buffer as native Base64.
 */

let sharpFn: ((input?: Buffer | string) => import('sharp').Sharp) | null = null;

try {
    // sharp exports a callable function as default
    const sharpMod = require('sharp');
    sharpFn = typeof sharpMod === 'function' ? sharpMod : sharpMod.default;
} catch (err: any) {
    console.error(
        `⚠️ [imageCompressor] Failed to load 'sharp' native module: ${err.message}. ` +
        `Image compression will be DISABLED — raw images will be used as-is (larger payloads).`
    );
}

/**
 * Compress a raw image buffer into an optimized Base64 JPEG data URI.
 *
 * @param rawBuffer - Raw image bytes (JPEG/PNG from camera)
 * @returns data:image/jpeg;base64,... string (compressed) or raw base64 fallback
 */
export async function compressSnapshot(rawBuffer: Buffer): Promise<string> {
    if (!sharpFn) {
        // Graceful degradation: return raw buffer as Base64 without compression
        console.warn('[imageCompressor] sharp unavailable — returning uncompressed Base64');
        return `data:image/jpeg;base64,${rawBuffer.toString('base64')}`;
    }

    try {
        const compressed = await sharpFn(rawBuffer)
            .resize(800, null, {
                withoutEnlargement: true,  // Don't upscale smaller images
                fit: 'inside',             // Maintain aspect ratio, no cropping
            })
            .jpeg({
                quality: 60,
                mozjpeg: true,  // Use MozJPEG encoder for better compression ratio
            })
            .toBuffer();

        const originalKB = Math.round(rawBuffer.length / 1024);
        const compressedKB = Math.round(compressed.length / 1024);
        console.log(
            `📦 [imageCompressor] ${originalKB}KB → ${compressedKB}KB ` +
            `(${Math.round((1 - compressed.length / rawBuffer.length) * 100)}% reduction)`
        );

        return `data:image/jpeg;base64,${compressed.toString('base64')}`;
    } catch (err: any) {
        // If sharp processing fails for any reason, fall back to raw
        console.error(`⚠️ [imageCompressor] Compression failed: ${err.message} — using raw buffer`);
        return `data:image/jpeg;base64,${rawBuffer.toString('base64')}`;
    }
}
