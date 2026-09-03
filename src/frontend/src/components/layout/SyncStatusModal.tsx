import React, { useEffect, useState } from 'react';
import { X, RefreshCw, AlertTriangle, AlertCircle, Database, Check } from 'lucide-react';
import { api } from '../../services/api';

interface SyncStatusModalProps {
    isOpen: boolean;
    onClose: () => void;
    syncStatus: any;
    onForceSync: () => void;
    isSyncing: boolean;
}

export const SyncStatusModal: React.FC<SyncStatusModalProps> = ({ isOpen, onClose, syncStatus, onForceSync, isSyncing }) => {
    const [blockedEvents, setBlockedEvents] = useState<any[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(false);

    useEffect(() => {
        if (isOpen && syncStatus?.blocked > 0) {
            setLoadingEvents(true);
            api.get('/sync/check?include_blocked=true')
                .then(res => {
                    setBlockedEvents(res.data.blockedEvents || []);
                })
                .catch(err => console.error(err))
                .finally(() => setLoadingEvents(false));
        }
    }, [isOpen, syncStatus?.blocked]);

    if (!isOpen) return null;

    const formatLastSync = (ds: string) => {
        if (!ds) return 'Nunca';
        return new Date(ds).toLocaleString();
    };

    const handleRetry = async (sequence: number) => {
        try {
            await api.post('/sync/retry-blocked', { sequences: [sequence] });
            onForceSync();
            onClose();
        } catch (error) {
            console.error('Retry failed', error);
        }
    };

    const handleRetryAll = async () => {
        try {
            const sequences = blockedEvents
                .filter(e => !(e.last_error?.includes('foreign key constraint') || e.last_error_code?.startsWith('23')))
                .map(e => e.sequence);
            await api.post('/sync/retry-blocked', { sequences });
            onForceSync();
            onClose();
        } catch (error) {
            console.error('Retry all failed', error);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
            <div className="bg-gray-900 border border-gray-700 shadow-2xl rounded-lg w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                
                <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-black/40">
                    <div className="flex items-center gap-2">
                        <Database className="w-5 h-5 text-emerald-500" />
                        <h2 className="text-gray-100 font-medium font-mono text-lg">Estado de Sincronización</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-black/30 p-3 rounded border border-gray-800">
                            <span className="block text-[10px] uppercase text-gray-500 font-bold tracking-wider mb-1">Estado General</span>
                            <div className="flex items-center gap-2">
                                {syncStatus?.state === 'ONLINE' ? (
                                    <><Check className="w-4 h-4 text-emerald-500" /> <span className="text-emerald-400 font-mono text-sm">Online</span></>
                                ) : syncStatus?.state === 'HAS_BLOCKED_MUTATIONS' ? (
                                    <><AlertTriangle className="w-4 h-4 text-amber-500" /> <span className="text-amber-400 font-mono text-sm">Bloqueos Activos</span></>
                                ) : syncStatus?.state === 'SYNC_ERROR' ? (
                                    <><AlertCircle className="w-4 h-4 text-red-500" /> <span className="text-red-400 font-mono text-sm">Error (Reintentando)</span></>
                                ) : (
                                    <><AlertCircle className="w-4 h-4 text-gray-400" /> <span className="text-gray-400 font-mono text-sm">Offline</span></>
                                )}
                            </div>
                        </div>
                        <div className="bg-black/30 p-3 rounded border border-gray-800">
                            <span className="block text-[10px] uppercase text-gray-500 font-bold tracking-wider mb-1">Última Sincronización</span>
                            <span className="text-gray-300 font-mono text-sm">{formatLastSync(syncStatus?.lastSuccessfulSyncAt)}</span>
                        </div>
                        <div className="bg-black/30 p-3 rounded border border-gray-800">
                            <span className="block text-[10px] uppercase text-gray-500 font-bold tracking-wider mb-1">Pendientes de Subida</span>
                            <span className="text-gray-300 font-mono text-xl">{syncStatus?.pending || 0}</span>
                        </div>
                        <div className="bg-black/30 p-3 rounded border border-gray-800">
                            <span className="block text-[10px] uppercase text-gray-500 font-bold tracking-wider mb-1">Eventos Bloqueados</span>
                            <span className="text-amber-400 font-mono text-xl">{syncStatus?.blocked || 0}</span>
                        </div>
                    </div>

                    {syncStatus?.blocked > 0 && (
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-gray-300 font-medium font-mono text-sm uppercase tracking-wider">Detalle de Bloqueos</h3>
                                {blockedEvents.filter((e: any) => !(e.last_error?.includes('foreign key constraint') || e.last_error_code?.startsWith('23'))).length > 0 && (
                                    <button 
                                        onClick={handleRetryAll}
                                        className="text-xs px-3 py-1 bg-amber-900/40 text-amber-400 border border-amber-500/30 rounded hover:bg-amber-900/60 transition-colors"
                                    >
                                        Reintentar Seguros
                                    </button>
                                )}
                            </div>
                            
                            {loadingEvents ? (
                                <div className="text-center p-4 text-gray-500 text-sm font-mono animate-pulse">Cargando detalles...</div>
                            ) : (
                                <div className="space-y-3">
                                    {blockedEvents.map((evt: any) => (
                                        <div key={evt.sequence} className="bg-gray-950/50 border border-gray-800 rounded p-3 text-sm">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <span className="text-gray-400 font-mono text-[10px] uppercase tracking-wider block">ID: {evt.entity_id}</span>
                                                    <span className="text-amber-400 font-bold font-mono">{evt.operation} {evt.entity_type}</span>
                                                </div>
                                                <span className="text-gray-600 font-mono text-[10px]">{new Date(evt.created_at).toLocaleString()}</span>
                                            </div>
                                            <div className="bg-red-950/20 text-red-400/80 p-2 rounded text-xs font-mono mb-3 border border-red-900/30">
                                                {evt.last_error}
                                            </div>
                                            {evt.last_error?.includes('foreign key constraint') || evt.last_error_code === '23503' || evt.last_error_code?.startsWith('23') ? (
                                                <div className="w-full text-center text-xs py-1.5 bg-gray-900/50 text-gray-500 rounded border border-gray-800 font-medium cursor-not-allowed">
                                                    No reintentable — referencia inválida
                                                </div>
                                            ) : (
                                                <button 
                                                    onClick={() => handleRetry(evt.sequence)}
                                                    className="w-full text-center text-xs py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors border border-gray-700 font-medium"
                                                >
                                                    Reintentar este evento
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-800 bg-black/40 flex justify-end">
                    <button
                        onClick={() => { onForceSync(); onClose(); }}
                        disabled={isSyncing}
                        className={`flex items-center gap-2 px-4 py-2 rounded font-medium transition-colors ${isSyncing ? 'bg-emerald-900/50 text-emerald-500/50 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                    >
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
                    </button>
                </div>
            </div>
        </div>
    );
};
