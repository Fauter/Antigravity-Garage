// Native fetch and FormData are available globally in Node 18+ / Electron
// Native fetch is available globally in Node 18+ / Electron

export type OcrStatus = 'DETECTED' | 'NOT_FOUND' | 'ERROR';

export interface AnprRecognitionResult {
    status: OcrStatus;
    plate: string;
    normalizedPlate?: string;
    confidence?: number;
    processingTimeMs: number;
    message?: string;
    errorCode?: string;
    candidates?: Array<{ plate: string; confidence: number }>;
}

export interface FastAlprClientConfig {
    serviceUrl: string; // e.g., 'http://127.0.0.1:8100'
    timeoutMs?: number; // Default 3000
}

export class FastAlprClient {
    private serviceUrl: string;
    private timeoutMs: number;

    constructor(config: FastAlprClientConfig) {
        this.serviceUrl = config.serviceUrl.replace(/\/$/, '');
        this.timeoutMs = config.timeoutMs || 3000;
    }

    /**
     * Checks if the FastALPR service is up and models are loaded.
     */
    async healthCheck(): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            
            const res = await fetch(`${this.serviceUrl}/health`, {
                signal: controller.signal as any
            });
            clearTimeout(timeout);

            if (res.ok) {
                const data = await res.json() as any;
                return data.status === 'ready';
            }
            return false;
        } catch (err) {
            return false;
        }
    }

    /**
     * Sends an image to the FastALPR service for recognition.
     */
    async recognize(input: {
        eventId: string;
        imageBuffer: Buffer;
        mimeType: 'image/jpeg' | 'image/png';
    }): Promise<AnprRecognitionResult> {
        const startTime = Date.now();
        
        try {
            // Log without base64 or secrets
            console.log(`🔍 [FastAlprClient] Starting OCR for event ${input.eventId} (size: ${input.imageBuffer.length} bytes)`);

            // Check size (Max 5MB)
            if (input.imageBuffer.length > 5 * 1024 * 1024) {
                return {
                    status: 'ERROR',
                    plate: '',
                    processingTimeMs: Date.now() - startTime,
                    message: 'Image size exceeds 5MB limit',
                    errorCode: 'FILE_TOO_LARGE'
                };
            }

            const formData = new FormData();
            const blob = new Blob([new Uint8Array(input.imageBuffer)], { type: input.mimeType });
            formData.append('file', blob, `capture_${input.eventId}.${input.mimeType.split('/')[1]}`);

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

            const res = await fetch(`${this.serviceUrl}/predict`, {
                method: 'POST',
                body: formData,
                signal: controller.signal as any,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                // Should be 200 even for errors per schema, but handle HTTP errors just in case
                throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
            }

            const data = await res.json() as AnprRecognitionResult;
            
            console.log(`✅ [FastAlprClient] OCR result for ${input.eventId}: ${data.status} ${data.plate ? '(' + data.plate + ' @ ' + Math.round((data.confidence || 0) * 100) + '%)' : ''} in ${data.processingTimeMs}ms`);

            // Validate structure
            if (!data.status || !['DETECTED', 'NOT_FOUND', 'ERROR'].includes(data.status)) {
                throw new Error('Invalid JSON schema from FastALPR service');
            }

            return data;

        } catch (err: any) {
            console.error(`❌ [FastAlprClient] OCR failed for event ${input.eventId}: ${err.message}`);
            return {
                status: 'ERROR',
                plate: '',
                processingTimeMs: Date.now() - startTime,
                message: err.name === 'AbortError' ? 'Timeout al procesar imagen' : 'Error de comunicación con el servicio OCR',
                errorCode: err.name === 'AbortError' ? 'TIMEOUT' : 'COMMUNICATION_ERROR'
            };
        }
    }
}
