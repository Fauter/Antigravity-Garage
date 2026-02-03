import { useState, useRef, useCallback } from 'react';

export const useWebcam = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isActive, setIsActive] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const startCamera = useCallback(async () => {
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720, facingMode: 'environment' }
            });
            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
            setIsActive(true);
            setError(null);
        } catch (err: any) {
            console.error(err);
            setError('No se pudo acceder a la cámara. Verifique los permisos.');
        }
    }, []);

    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
        setIsActive(false);
    }, [stream]);

    const takePhoto = useCallback(() => {
        if (videoRef.current && isActive) {
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(videoRef.current, 0, 0);
                return canvas.toDataURL('image/jpeg');
            }
        }
        return null;
    }, [isActive]);

    return {
        videoRef,
        startCamera,
        stopCamera,
        takePhoto,
        isActive,
        error
    };
};
