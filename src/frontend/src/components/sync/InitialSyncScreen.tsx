import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { WifiOff, AlertTriangle } from 'lucide-react';

const StaticDashboardPreview = () => (
    <div className="flex w-full h-full overflow-hidden pointer-events-none select-none opacity-50">
        {/* Left Column: Entry */}
        <section className="w-[35%] xl:w-[30%] h-full flex flex-col bg-gray-900 border-r border-gray-800">
            <div className="px-3 py-2 bg-gray-950 border-b border-gray-800 h-[37px]" />
            <div className="flex-1 p-6 space-y-6">
                <div className="h-14 bg-gray-800/40 rounded-lg" />
                <div className="h-12 bg-gray-800/40 rounded-lg" />
                <div className="h-32 bg-gray-800/20 rounded-lg" />
            </div>
        </section>

        {/* Right Column: Exit */}
        <section className="flex-1 h-full bg-gray-950 flex flex-col">
            <div className="px-3 py-2 bg-gray-950 border-b border-gray-800 h-[37px]" />
            <div className="h-[35%] bg-gray-900 border-b border-gray-800 flex">
                <div className="w-1/2 border-r border-gray-800" />
                <div className="w-1/2 p-6 flex flex-col gap-4">
                    <div className="h-12 bg-gray-800/40 rounded-lg" />
                    <div className="h-20 bg-gray-800/20 rounded-lg" />
                </div>
            </div>
            <div className="flex-1 bg-gray-950 p-4">
                <div className="h-full w-full bg-gray-900/30 rounded-lg border border-gray-800/50" />
            </div>
        </section>
    </div>
);

const CometSpinner = () => (
    <div className="relative w-12 h-12 mb-5 animate-[spin_1s_linear_infinite]">
        {/* Base faint ring */}
        <div className="absolute inset-0 rounded-full border-[2px] border-emerald-900/20" />
        {/* Conic trail */}
        <div 
            className="absolute inset-0 rounded-full"
            style={{
                background: 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(16,185,129,0.05) 120deg, rgba(16,185,129,0.4) 260deg, rgb(16,185,129) 360deg)',
                WebkitMaskImage: 'radial-gradient(transparent 58%, black 60%)',
                maskImage: 'radial-gradient(transparent 58%, black 60%)'
            }}
        />
        {/* Glowing Head */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -mt-[0.5px] w-[5px] h-[5px] bg-emerald-300 rounded-full shadow-[0_0_10px_2px_rgba(16,185,129,1)]" />
    </div>
);

export const InitialSyncScreen: React.FC = () => {
    const { initialSyncState, readinessDiagnostics, retryInitialSync, continueWithLocalData } = useAuth();
    const canContinueLocally = Boolean(readinessDiagnostics?.hasLocalData);
    const missingDatasets = readinessDiagnostics?.missing || [];
    const failedTables = readinessDiagnostics?.failedTables || [];

    return (
        <>
            <div className="absolute inset-0 z-0">
                <StaticDashboardPreview />
            </div>
            <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gray-950/30 backdrop-blur-sm transition-opacity duration-300">
                {initialSyncState === 'syncing' || initialSyncState === 'warmup' ? (
                    <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                        <CometSpinner />
                        <p className="text-emerald-500/90 font-medium text-[14px] tracking-wide font-sans">
                            {initialSyncState === 'warmup' ? 'Preparando información...' : 'Sincronizando datos...'}
                        </p>
                    </div>
                ) : initialSyncState === 'offline' ? (
                    <div className="flex flex-col items-center max-w-md text-center px-6 animate-in fade-in zoom-in duration-300">
                        <WifiOff className="w-12 h-12 text-amber-500 mb-4" />
                        <h2 className="text-lg font-semibold text-amber-400 mb-2 font-sans">
                            Sin conexión remota
                        </h2>
                        <p className="text-gray-200 text-sm mb-3 font-sans">
                            {readinessDiagnostics?.message || 'No se pudo conectar con el servidor remoto para sincronizar este garaje.'}
                        </p>
                        {missingDatasets.length > 0 && (
                            <p className="text-amber-300/90 text-xs mb-6 font-mono bg-amber-950/40 border border-amber-800/50 rounded-md px-3 py-2">
                                Datos faltantes: {missingDatasets.join(', ')}
                            </p>
                        )}
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={retryInitialSync}
                                className="px-6 py-2 bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-sm rounded-lg backdrop-blur-md transition-colors"
                            >
                                Reintentar
                            </button>
                            {canContinueLocally && (
                                <button 
                                    onClick={continueWithLocalData}
                                    className="px-6 py-2 bg-gray-800/80 hover:bg-gray-700 text-white font-medium text-sm rounded-lg backdrop-blur-md border border-gray-600 transition-colors"
                                >
                                    Continuar con datos locales
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center max-w-md text-center px-6 animate-in fade-in zoom-in duration-300">
                        <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
                        <h2 className="text-xl font-semibold text-amber-400 mb-2 font-sans">
                            {initialSyncState === 'error'
                                ? 'Sincronización inicial incompleta'
                                : 'La sincronización está tardando más de lo esperado'}
                        </h2>
                        <p className="text-gray-200 text-sm mb-4 font-sans">
                            {readinessDiagnostics?.message ||
                                (initialSyncState === 'error'
                                    ? 'No se pudieron descargar todas las tablas requeridas para operar.'
                                    : 'La descarga inicial de datos continúa en progreso.')}
                        </p>
                        {failedTables.length > 0 && (
                            <p className="text-amber-300/90 text-xs mb-2 font-mono bg-amber-950/40 border border-amber-800/50 rounded-md px-3 py-1.5">
                                Tablas con error: {failedTables.join(', ')}
                            </p>
                        )}
                        {missingDatasets.length > 0 && (
                            <p className="text-amber-300/90 text-xs mb-6 font-mono bg-amber-950/40 border border-amber-800/50 rounded-md px-3 py-1.5">
                                Datos faltantes: {missingDatasets.join(', ')}
                            </p>
                        )}
                        <div className="flex w-full gap-4 justify-center mt-2">
                            <button 
                                onClick={retryInitialSync}
                                className="px-6 py-2 bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-sm rounded-lg backdrop-blur-md transition-colors"
                            >
                                Reintentar
                            </button>
                            {canContinueLocally && (
                                <button 
                                    onClick={continueWithLocalData}
                                    className="px-6 py-2 bg-gray-800/80 hover:bg-gray-700 text-white font-medium text-sm rounded-lg backdrop-blur-md border border-gray-600 transition-colors"
                                >
                                    Continuar con datos locales
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};
