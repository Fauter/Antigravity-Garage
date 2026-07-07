export const applyDithering = async (base64Image: string, maxWidth: number = 380): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Canvas 2D context not available'));
            }

            // Escalar imagen para no sobrecargar el renderizador de la impresora
            let width = img.width;
            let height = img.height;
            if (width > maxWidth) {
                height = Math.floor(height * (maxWidth / width));
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;

            // Dibujar imagen original escalada
            ctx.drawImage(img, 0, 0, width, height);

            // Obtener píxeles
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;

            // 1. Convertir a escala de grises
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // Luminancia estándar
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                data[i] = data[i + 1] = data[i + 2] = gray;
            }

            const getIndex = (x: number, y: number) => (y * width + x) * 4;

            // 2. Aplicar Algoritmo Floyd-Steinberg
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = getIndex(x, y);
                    const oldPixel = data[idx];
                    
                    // Umbral (threshold) en 128
                    const newPixel = oldPixel < 128 ? 0 : 255;
                    
                    // Asignar blanco puro o negro puro
                    data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
                    
                    const err = oldPixel - newPixel;

                    // Distribuir el error de cuantización a los píxeles vecinos
                    if (x + 1 < width) {
                        const i = getIndex(x + 1, y);
                        data[i] = data[i + 1] = data[i + 2] = data[i] + err * (7 / 16);
                    }
                    if (x - 1 >= 0 && y + 1 < height) {
                        const i = getIndex(x - 1, y + 1);
                        data[i] = data[i + 1] = data[i + 2] = data[i] + err * (3 / 16);
                    }
                    if (y + 1 < height) {
                        const i = getIndex(x, y + 1);
                        data[i] = data[i + 1] = data[i + 2] = data[i] + err * (5 / 16);
                    }
                    if (x + 1 < width && y + 1 < height) {
                        const i = getIndex(x + 1, y + 1);
                        data[i] = data[i + 1] = data[i + 2] = data[i] + err * (1 / 16);
                    }
                }
            }

            // 3. Limpieza final (asegurar que todo sea estrictamente 0 o 255)
            for (let i = 0; i < data.length; i += 4) {
                const val = data[i] < 128 ? 0 : 255;
                data[i] = data[i + 1] = data[i + 2] = val;
                data[i + 3] = 255; // Alpha opaco
            }

            ctx.putImageData(imageData, 0, 0);

            // Yielding back to event loop to avoid blocking UI during base64 encoding
            setTimeout(() => {
                resolve(canvas.toDataURL('image/png'));
            }, 0);
        };

        img.onerror = () => reject(new Error('Failed to load image for dithering'));
        img.src = base64Image;
    });
};
