const fs = require('fs');
let content = fs.readFileSync('src/frontend/src/components/layout/MainLayout.tsx', 'utf8');

// 1. Import
content = content.replace(
    "import { SyncStatusModal } from './SyncStatusModal';",
    "import { SyncStatusModal } from './SyncStatusModal';\nimport { useQueryClient } from '@tanstack/react-query';"
);

// 2 & 3. State and Query Client
content = content.replace(
    "    const { user, logout, isGlobalSyncing, syncStatus, localHealth } = useAuth();",
    "    const { user, logout, isGlobalSyncing, syncStatus, localHealth } = useAuth();\n    const [isRecovering, setIsRecovering] = useState(false);\n    const queryClient = useQueryClient();"
);

// 4. handleRecoverBackend
const recoverFunc = 
    const handleRecoverBackend = async () => {
        setIsRecovering(true);
        try {
            // @ts-ignore
            if (window.electronAPI?.recoverBackend) {
                // @ts-ignore
                const result = await window.electronAPI.recoverBackend();
                
                if (result?.recovered) {
                    toast.success('Servidor local recuperado');
                    queryClient.invalidateQueries({ queryKey: ['abonos-hydration'] });
                    queryClient.invalidateQueries({ queryKey: ['prices'] });
                    queryClient.invalidateQueries({ queryKey: ['vehicle-types'] });
                    queryClient.invalidateQueries({ queryKey: ['financial-config'] });
                } else {
                    toast.error(result?.error || 'No se pudo recuperar el servidor local.');
                }
            } else {
                window.location.reload();
            }
        } catch (e) {
            toast.error('Error al intentar recuperar el backend.');
        } finally {
            setIsRecovering(false);
        }
    };

    return (
;
content = content.replace("    return (", recoverFunc);

// 5. Replace Modal
const oldModalStr =                         <p className="text-gray-400 text-sm mb-6">
                            El motor local de GarageIA ha dejado de responder. La aplicación no puede operar hasta que se restablezca la conexión con la base de datos local.
                        </p>
                        <button 
                            onClick={() => window.location.reload()}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-md transition-colors shadow-lg"
                        >
                            Reintentar Conexión
                        </button>;

const newModalStr =                         <p className="text-gray-400 text-sm mb-6">
                            GarageIA perdió conexión con su motor local. Sus datos locales no fueron eliminados.
                        </p>
                        <button 
                            onClick={handleRecoverBackend}
                            disabled={isRecovering}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-md transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isRecovering ? 'REINTENTANDO...' : 'REINTENTAR CONEXIÓN'}
                        </button>;

content = content.replace(oldModalStr, newModalStr);

// 6. Replace Badges
const oldBadgesStr =                         {localHealth?.state === 'DOWN' ? (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-900/30 border border-red-700/50 rounded text-red-500 font-mono shadow-sm cursor-pointer" title="El servidor local dejó de responder">
                                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">ERROR LOCAL · BACKEND NO DISPONIBLE</span>
                            </div>
                        ) : localHealth?.state === 'SQLITE_ERROR' ? (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-900/30 border border-red-700/50 rounded text-red-500 font-mono shadow-sm cursor-pointer" title="Error crítico en base de datos local">
                                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">ERROR BASE LOCAL</span>
                            </div>
                        ) : (syncStatus?.state === 'BACKEND_UNREACHABLE' || syncStatus?.state === 'CLOUD_UNREACHABLE' || syncStatus?.state === 'OFFLINE') ? (
                            // @ts-ignore
                            syncStatus?.pending > 0 ? (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/30 border border-amber-700/50 rounded text-amber-500 font-mono shadow-sm cursor-pointer" title={\\ pendientes - Terminal offline\}>
                                    <WifiOff className="w-3.5 h-3.5" />
                                    {/* @ts-ignore */}
                                    <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">OFFLINE · {syncStatus?.pending} PEND.</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-900/30 border border-emerald-700/50 rounded text-emerald-600 font-mono shadow-sm cursor-pointer" title="Terminal offline - Modo Local Operativo">
                                    <WifiOff className="w-3.5 h-3.5" />
                                    <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">SIN INTERNET · LOCAL OK</span>
                                </div>
                            )
                        // @ts-ignore;

const newBadgesStr =                         {localHealth?.state === 'DOWN' ? (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/40 border border-amber-600/50 rounded text-amber-500 font-mono shadow-sm cursor-pointer" title="El servidor local dejó de responder">
                                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">ERROR LOCAL · BACKEND NO DISPONIBLE</span>
                            </div>
                        ) : localHealth?.state === 'SQLITE_ERROR' ? (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-900/30 border border-red-700/50 rounded text-red-500 font-mono shadow-sm cursor-pointer" title="Error crítico en base de datos local">
                                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">ERROR BASE LOCAL</span>
                            </div>
                        ) : (syncStatus?.state === 'BACKEND_UNREACHABLE' || syncStatus?.state === 'CLOUD_UNREACHABLE' || syncStatus?.state === 'OFFLINE') ? (
                            // @ts-ignore
                            syncStatus?.pending > 0 ? (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/30 border border-amber-700/50 rounded text-amber-500 font-mono shadow-sm cursor-pointer" title={\\ pendientes - Terminal offline\}>
                                    <WifiOff className="w-3.5 h-3.5" />
                                    {/* @ts-ignore */}
                                    <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">OFFLINE · {syncStatus?.pending} PEND.</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-lime-900/30 border border-lime-700/50 rounded text-lime-500 font-mono shadow-sm cursor-pointer" title="Terminal offline - Modo Local Operativo">
                                    <WifiOff className="w-3.5 h-3.5" />
                                    <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">SIN INTERNET · LOCAL OK</span>
                                </div>
                            )
                        // @ts-ignore;

content = content.replace(oldBadgesStr, newBadgesStr);

fs.writeFileSync('src/frontend/src/components/layout/MainLayout.tsx', content, 'utf8');
console.log('MainLayout patched successfully.');
