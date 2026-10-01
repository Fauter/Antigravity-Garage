import React, { useEffect, useState } from 'react';
import { X, RefreshCw, AlertTriangle, AlertCircle, Database, Check, Info, Copy } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from 'sonner';

interface SyncStatusModalProps {
    isOpen: boolean;
    onClose: () => void;
    syncStatus: any;
    onForceSync: () => void;
    isSyncing: boolean;
}

interface SyncDiagnosticEvent {
    id: string;
    sequence: number;
    entityType?: string;
    entityId?: string;
    operation?: string;
    status: string;
    attempts?: number;
    createdAt?: string;
    updatedAt?: string;
    lastAttemptAt?: string;
    nextRetryAt?: string;
    lastError?: string;
    lastErrorCode?: string;
    payload?: any;
}

interface SyncDiagnostics {
    database: {
        storageEngine: string;
        dbPath: string;
        schemaVersion: number;
        outboxTotal: number;
        ackedCount: number;
    };
    pending: SyncDiagnosticEvent[];
    blocked: SyncDiagnosticEvent[];
}

export const SyncStatusModal: React.FC<SyncStatusModalProps> = ({ isOpen, onClose, syncStatus, onForceSync, isSyncing }) => {
    const [blockedEvents, setBlockedEvents] = useState<any[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(false);
    
    // Diagnostics State
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);
    const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

    useEffect(() => {
        if (isOpen && syncStatus?.blocked > 0 && !showDiagnostics) {
            setLoadingEvents(true);
            api.get('/sync/check?include_blocked=true')
                .then(res => {
                    setBlockedEvents(res.data.blockedEvents || []);
                })
                .catch(err => console.error(err))
                .finally(() => setLoadingEvents(false));
        }
    }, [isOpen, syncStatus?.blocked, showDiagnostics]);

    useEffect(() => {
        if (isOpen && showDiagnostics) {
            fetchDiagnostics();
        }
    }, [isOpen, showDiagnostics]);

    const fetchDiagnostics = () => {
        setLoadingDiagnostics(true);
        api.get('/sync/diagnostics')
            .then(res => {
                setDiagnostics(res.data);
            })
            .catch(err => {
                console.error(err);
                toast.error("Error al cargar diagnóstico");
            })
            .finally(() => setLoadingDiagnostics(false));
    };

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
    
    const generateDiagnosticText = () => {
        if (!diagnostics) return '';
        
        let text = `GARAGEIA SYNC DIAGNOSTICS\nGenerated: ${new Date().toLocaleString()}\n\n`;
        text += `Database:\n`;
        text += `Engine: ${diagnostics.database.storageEngine}\n`;
        text += `Path: ${diagnostics.database.dbPath}\n`;
        text += `Schema: ${diagnostics.database.schemaVersion}\n`;
        text += `Outbox Total: ${diagnostics.database.outboxTotal}\n`;
        text += `Acked: ${diagnostics.database.ackedCount}\n\n`;
        
        text += `Pending: ${diagnostics.pending.length}\n`;
        text += `Blocked: ${diagnostics.blocked.length}\n\n`;
        
        const formatEvent = (evt: SyncDiagnosticEvent, index: number) => {
            let evtText = `[${index + 1}]\n`;
            evtText += `Entity: ${evt.entityType}\n`;
            evtText += `Operation: ${evt.operation}\n`;
            evtText += `Entity ID: ${evt.entityId}\n`;
            evtText += `Status: ${evt.status}\n`;
            evtText += `Attempts: ${evt.attempts}\n`;
            evtText += `Created: ${new Date(evt.createdAt!).toLocaleString()}\n`;
            if (evt.lastAttemptAt) evtText += `Last Attempt: ${new Date(evt.lastAttemptAt).toLocaleString()}\n`;
            if (evt.lastError) evtText += `Last error: ${evt.lastError}\n`;
            return evtText;
        };

        if (diagnostics.pending.length > 0) {
            text += `--- PENDING EVENTS ---\n\n`;
            diagnostics.pending.forEach((e, i) => { text += formatEvent(e, i) + '\n'; });
        }
        
        if (diagnostics.blocked.length > 0) {
            text += `--- BLOCKED EVENTS ---\n\n`;
            diagnostics.blocked.forEach((e, i) => { text += formatEvent(e, i) + '\n'; });
        }
        
        return text;
    };

    const handleCopyDiagnostics = async () => {
        const text = generateDiagnosticText();
        try {
            await navigator.clipboard.writeText(text);
            toast.success("Diagnóstico copiado");
        } catch (err) {
            toast.error("No se pudo copiar");
        }
    };
    
    const handleCopyEvent = async (evt: SyncDiagnosticEvent) => {
        const text = `Entity: ${evt.entityType}\nOperation: ${evt.operation}\nEntity ID: ${evt.entityId}\nStatus: ${evt.status}\nAttempts: ${evt.attempts}\nCreated: ${new Date(evt.createdAt!).toLocaleString()}\nLast Error: ${evt.lastError || 'None'}\nPayload: ${JSON.stringify(evt.payload, null, 2)}`;
        try {
            await navigator.clipboard.writeText(text);
            toast.success("Evento copiado");
        } catch (err) {
            toast.error("No se pudo copiar");
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
            <div className={`bg-gray-900 border border-gray-700 shadow-2xl rounded-lg w-full ${showDiagnostics ? 'max-w-3xl' : 'max-w-lg'} overflow-hidden flex flex-col max-h-[90vh] transition-all duration-300`}>
                
                <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-black/40">
                    <div className="flex items-center gap-2">
                        <Database className="w-5 h-5 text-emerald-500" />
                        <h2 className="text-gray-100 font-medium font-mono text-lg">
                            {showDiagnostics ? 'Diagnóstico de Sincronización' : 'Estado de Sincronización'}
                        </h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {showDiagnostics && (
                            <button onClick={fetchDiagnostics} className="text-gray-400 hover:text-white px-2 py-1 flex items-center gap-1 text-sm bg-gray-800 rounded transition-colors">
                                <RefreshCw className={`w-3 h-3 ${loadingDiagnostics ? 'animate-spin' : ''}`} /> Actualizar
                            </button>
                        )}
                        <button onClick={() => showDiagnostics ? setShowDiagnostics(false) : onClose()} className="text-gray-500 hover:text-gray-300 ml-2">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                    
                    {!showDiagnostics ? (
                        <>
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
                                <div className="bg-black/30 p-3 rounded border border-gray-800 flex justify-between items-center group">
                                    <div>
                                        <span className="block text-[10px] uppercase text-gray-500 font-bold tracking-wider mb-1">Pendientes de Subida</span>
                                        <span className="text-gray-300 font-mono text-xl">{syncStatus?.pending || 0}</span>
                                    </div>
                                    <button onClick={() => setShowDiagnostics(true)} className="text-gray-500 hover:text-blue-400 transition-colors p-1" title="Ver detalle">
                                        <Info className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="bg-black/30 p-3 rounded border border-gray-800 flex justify-between items-center group">
                                    <div>
                                        <span className="block text-[10px] uppercase text-gray-500 font-bold tracking-wider mb-1">Eventos Bloqueados</span>
                                        <span className="text-amber-400 font-mono text-xl">{syncStatus?.blocked || 0}</span>
                                    </div>
                                    <button onClick={() => setShowDiagnostics(true)} className="text-gray-500 hover:text-amber-400 transition-colors p-1" title="Ver detalle">
                                        <Info className="w-5 h-5" />
                                    </button>
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
                        </>
                    ) : (
                        /* DIAGNOSTICS VIEW */
                        <div className="space-y-6">
                            {loadingDiagnostics ? (
                                <div className="text-center p-8 text-gray-500 font-mono animate-pulse">Cargando base de datos local...</div>
                            ) : diagnostics ? (
                                <>
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-gray-300 font-medium font-mono text-sm uppercase tracking-wider">Información de la Base Local</h3>
                                        <button onClick={handleCopyDiagnostics} className="text-xs flex items-center gap-1 px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded transition-colors">
                                            <Copy className="w-3 h-3" /> Copiar diagnóstico
                                        </button>
                                    </div>
                                    <div className="bg-black/30 p-4 rounded border border-gray-800 text-xs font-mono text-gray-400 space-y-1">
                                        <p><span className="text-gray-500">Storage Engine:</span> {diagnostics.database.storageEngine}</p>
                                        <p><span className="text-gray-500">SQLite path:</span> {diagnostics.database.dbPath}</p>
                                        <p><span className="text-gray-500">Schema version:</span> {diagnostics.database.schemaVersion}</p>
                                        <p><span className="text-gray-500">Outbox total:</span> {diagnostics.database.outboxTotal}</p>
                                        <p><span className="text-gray-500">Acked:</span> {diagnostics.database.ackedCount}</p>
                                    </div>

                                    <h3 className="text-gray-300 font-medium font-mono text-sm uppercase tracking-wider border-b border-gray-800 pb-2">Pendientes de Subida ({diagnostics.pending.length})</h3>
                                    {diagnostics.pending.length === 0 ? (
                                        <div className="text-gray-500 text-sm font-mono text-center py-4 bg-gray-950/30 rounded border border-gray-800 border-dashed">No hay eventos pendientes.</div>
                                    ) : (
                                        <div className="space-y-3">
                                            {diagnostics.pending.map((evt) => (
                                                <div key={evt.sequence} className="bg-gray-950/50 border border-gray-800 rounded p-3 text-sm">
                                                    <div className="flex justify-between items-start mb-2 border-b border-gray-800/50 pb-2">
                                                        <div>
                                                            <span className="text-blue-400 font-bold font-mono">{evt.entityType} · {evt.operation}</span>
                                                            <span className="text-gray-500 font-mono text-[10px] uppercase tracking-wider block mt-1">ID: {evt.entityId}</span>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-2">
                                                            <span className={`font-mono text-[10px] px-2 py-0.5 rounded ${evt.status === 'RETRY' ? 'bg-amber-900/30 text-amber-400 border border-amber-900/50' : 'bg-blue-900/30 text-blue-400 border border-blue-900/50'}`}>
                                                                {evt.status}
                                                            </span>
                                                            <button onClick={() => handleCopyEvent(evt)} className="text-gray-500 hover:text-gray-300 p-1 transition-colors" title="Copiar evento">
                                                                <Copy className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-400 mb-2 mt-2">
                                                        <p><span className="text-gray-600">Intentos:</span> {evt.attempts}</p>
                                                        <p><span className="text-gray-600">Creado:</span> {new Date(evt.createdAt!).toLocaleString()}</p>
                                                        {evt.lastAttemptAt && <p><span className="text-gray-600">Últ. intento:</span> {new Date(evt.lastAttemptAt).toLocaleTimeString()}</p>}
                                                    </div>
                                                    {evt.lastError && (
                                                        <div className="bg-amber-950/20 text-amber-400/80 p-2 rounded text-xs font-mono mt-2 border border-amber-900/30 break-all">
                                                            Error: {evt.lastError}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {diagnostics.blocked.length > 0 && (
                                        <>
                                            <h3 className="text-gray-300 font-medium font-mono text-sm uppercase tracking-wider border-b border-gray-800 pb-2 mt-6">Eventos Bloqueados ({diagnostics.blocked.length})</h3>
                                            <div className="space-y-3">
                                                {diagnostics.blocked.map((evt) => (
                                                    <div key={evt.sequence} className="bg-red-950/10 border border-red-900/30 rounded p-3 text-sm">
                                                        <div className="flex justify-between items-start mb-2 border-b border-red-900/20 pb-2">
                                                            <div>
                                                                <span className="text-red-400 font-bold font-mono">{evt.entityType} · {evt.operation}</span>
                                                                <span className="text-gray-500 font-mono text-[10px] uppercase tracking-wider block mt-1">ID: {evt.entityId}</span>
                                                            </div>
                                                            <div className="flex flex-col items-end gap-2">
                                                                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-900/50">
                                                                    {evt.status}
                                                                </span>
                                                                <button onClick={() => handleCopyEvent(evt)} className="text-gray-500 hover:text-gray-300 p-1 transition-colors" title="Copiar evento">
                                                                    <Copy className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-400 mb-2 mt-2">
                                                            <p><span className="text-gray-600">Intentos:</span> {evt.attempts}</p>
                                                            <p><span className="text-gray-600">Creado:</span> {new Date(evt.createdAt!).toLocaleString()}</p>
                                                        </div>
                                                        {evt.lastError && (
                                                            <div className="bg-red-950/20 text-red-400/80 p-2 rounded text-xs font-mono mt-2 border border-red-900/30 break-all">
                                                                Motivo: {evt.lastError}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </>
                            ) : (
                                <div className="text-red-400 text-center font-mono text-sm py-4">Error al cargar datos locales.</div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-800 bg-black/40 flex justify-end gap-3">
                    {!showDiagnostics && (
                        <button
                            onClick={() => { onForceSync(); onClose(); }}
                            disabled={isSyncing}
                            className={`flex items-center gap-2 px-4 py-2 rounded font-medium transition-colors ${isSyncing ? 'bg-emerald-900/50 text-emerald-500/50 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                        >
                            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                            {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

