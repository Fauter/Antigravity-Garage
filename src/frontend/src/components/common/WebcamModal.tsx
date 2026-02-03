import React, { useEffect } from 'react';
import { X, Camera } from 'lucide-react';
import { useWebcam } from '../../hooks/useWebcam';

interface WebcamModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCapture: (imageSrc: string) => void;
    label: string;
}

export const WebcamModal: React.FC<WebcamModalProps> = ({ isOpen, onClose, onCapture, label }) => {
    const { videoRef, startCamera, stopCamera, takePhoto, isActive, error } = useWebcam();

    useEffect(() => {
        if (isOpen) {
            startCamera();
        } else {
            stopCamera();
        }
        return () => stopCamera();
    }, [isOpen]);

    const handleCapture = () => {
        const img = takePhoto();
        if (img) {
            onCapture(img);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="relative w-full max-w-2xl bg-gray-900 rounded-2xl overflow-hidden border border-gray-700 shadow-2xl">
                <div className="bg-black relative aspect-video">
                    {/* Error State */}
                    {error && (
                        <div className="absolute inset-0 flex items-center justify-center text-red-500 font-bold p-4 text-center">
                            {error}
                        </div>
                    )}

                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        className={`w-full h-full object-cover transform ${isActive ? 'scale-100' : 'scale-100'}`}
                    />

                    {/* Guidelines Overlay */}
                    <div className="absolute inset-0 border-[3px] border-white/20 m-8 rounded-lg pointer-events-none border-dashed flex items-center justify-center">
                        <span className="text-white/20 text-4xl font-black uppercase tracking-widest opacity-50">{label}</span>
                    </div>
                </div>

                <div className="p-6 flex items-center justify-between bg-gray-900">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 text-gray-400 font-bold hover:text-white transition-colors"
                    >
                        CANCELAR
                    </button>

                    <div className="flex items-center gap-4">
                        <span className="text-sm font-bold text-emerald-500 uppercase tracking-widest animate-pulse">
                            ● EN VIVO: {label}
                        </span>
                        <button
                            onClick={handleCapture}
                            className="w-16 h-16 bg-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(255,255,255,0.2)] border-4 border-gray-200"
                        >
                            <div className="w-12 h-12 border-2 border-black rounded-full box-border"></div>
                        </button>
                    </div>
                </div>

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 bg-black/50 p-2 rounded-full text-white hover:bg-black/80 transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};
