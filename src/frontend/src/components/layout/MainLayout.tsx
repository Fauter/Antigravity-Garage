import React, { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, Ticket, Wallet, LogOut, User as UserIcon, Eye, Database, Loader2, AlertTriangle, RefreshCw, Settings, Printer, Check, Wifi, WifiOff, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../../services/api';
import { toast } from 'sonner';

export const SyncRefreshContext = React.createContext<{ refreshKey: number }>({ refreshKey: 0 });

interface MainLayoutProps {
    children: React.ReactNode;
}

const SyncOverlay: React.FC<{ isVisible: boolean }> = ({ isVisible }) => {
    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center overflow-hidden">
            <div className="relative flex flex-col items-center p-12 border border-emerald-500/30 rounded-2xl bg-gray-950/90 shadow-[0_0_80px_-15px_rgba(4,120,87,0.4)]">

                {/* Rotating Elements */}
                <div className="absolute w-40 h-40 border-t-2 border-l-2 border-emerald-500/40 rounded-full animate-spin" style={{ animationDuration: '3s' }}></div>
                <div className="absolute w-32 h-32 border-b-2 border-r-2 border-emerald-400/40 rounded-full animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }}></div>

                <div className="relative bg-black rounded-full p-5 mb-8 border border-emerald-500/20 shadow-inner">
                    <Database className="w-12 h-12 text-emerald-400 animate-pulse" />
                </div>

                <h2 className="text-2xl font-mono font-bold text-emerald-400 tracking-[0.2em] mb-2 animate-pulse text-center">
                    SINCRONIZANDO
                </h2>
                <h3 className="text-xs font-mono text-emerald-500/60 tracking-widest text-center">
                    Pulleando datos...
                </h3>

                <div className="mt-10 flex items-center justify-center gap-3 bg-black/50 px-4 py-2 rounded-full border border-emerald-900/50">
                    <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                    <span className="text-emerald-500/80 font-mono text-[10px] uppercase tracking-wider font-bold">Por favor espere</span>
                </div>
            </div>
        </div>
    );
};

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    // Added 'config' back to activeTab
    const [activeTab, setActiveTab] = useState<'operador' | 'audit' | 'anticipados' | 'abonos' | 'caja' | 'incidentes' | 'config'>('operador');
    const [garageConfig, setGarageConfig] = useState<{ name: string; address: string; garage_id: string } | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
    const [incidentDescription, setIncidentDescription] = useState('');
    const [isSavingIncident, setIsSavingIncident] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
    const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);

    // ── Config Modal State ──
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

    // Printer State
    const [printerList, setPrinterList] = useState<Array<{ name: string; isDefault: boolean; status?: number }>>([]);
    const [isLoadingPrinters, setIsLoadingPrinters] = useState(false);
    const [selectedPrinter, setSelectedPrinter] = useState<string>(localStorage.getItem('selected_printer_name') || '');

    // Hardware State
    const [hwConfig, setHwConfig] = useState<any>(null);
    const [isLoadingHw, setIsLoadingHw] = useState(false);
    const [mockMode, setMockMode] = useState(true);
    const [hwStatus, setHwStatus] = useState<{ barrierOnline: boolean; cameraOnline: boolean }>({ barrierOnline: false, cameraOnline: false });

    const [configSaved, setConfigSaved] = useState(false);

    const location = useLocation();
    const { user, logout, isGlobalSyncing } = useAuth();
    const navigate = useNavigate();

    // Auto-refresh logic when sync completes
    const prevSyncingRef = useRef(isGlobalSyncing);

    useEffect(() => {
        if (prevSyncingRef.current && !isGlobalSyncing) {
            setRefreshKey(prev => prev + 1);
            window.dispatchEvent(new CustomEvent('ag:sync-completed', { detail: { timestamp: Date.now() } }));
        }
        prevSyncingRef.current = isGlobalSyncing;
    }, [isGlobalSyncing]);

    // Load Terminal Config for Branding
    useEffect(() => {
        const stored = localStorage.getItem('ag_terminal_config');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.name) {
                    setGarageConfig(parsed);
                }
            } catch (e) {
                console.error('Failed to parse terminal config for branding', e);
            }
        }
    }, []);

    // ── Mock Mode + Hardware Status Listeners ──
    useEffect(() => {
        let cleanupMock: (() => void) | undefined;
        let cleanupToast: (() => void) | undefined;

        if (window.electronAPI?.onMockModeChanged) {
            cleanupMock = window.electronAPI.onMockModeChanged((enabled: boolean) => {
                setMockMode(enabled);
            });
        }

        if (window.electronAPI?.onDriverStatusToast) {
            cleanupToast = window.electronAPI.onDriverStatusToast((data: { driverType: string; online: boolean; message: string }) => {
                if (data.online) {
                    toast.success(data.message, {
                        duration: 3000,
                        style: { background: '#022c22', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#34d399' },
                    });
                } else {
                    toast.error(data.message, {
                        duration: 4000,
                        style: { background: '#1c1917', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#f87171' },
                    });
                }
                // Update local hw status
                setHwStatus(prev => ({
                    ...prev,
                    barrierOnline: data.driverType === 'ETHERNET_RELAY' ? data.online : prev.barrierOnline,
                    cameraOnline: (data.driverType === 'ANPR_WEBHOOK' || data.driverType === 'HIKVISION_ISAPI') ? data.online : prev.cameraOnline,
                }));
            });
        }

        // Also listen for general status changes
        let cleanupStatus: (() => void) | undefined;
        if (window.electronAPI?.onHardwareStatusChanged) {
            cleanupStatus = window.electronAPI.onHardwareStatusChanged((status: any) => {
                setHwStatus({
                    barrierOnline: status.entryBarrierOnline ?? false,
                    cameraOnline: status.cameraOnline ?? false,
                });
            });
        }

        return () => {
            cleanupMock?.();
            cleanupToast?.();
            cleanupStatus?.();
        };
    }, []);

    // Sync active tab with URL 
    useEffect(() => {
        const path = location.pathname;
        if (path === '/' || path.startsWith('/estadias')) setActiveTab('operador');
        else if (path.startsWith('/audit')) setActiveTab('audit');
        else if (path.startsWith('/anticipados')) setActiveTab('anticipados');
        else if (path.startsWith('/abonos')) setActiveTab('abonos');
        else if (path.startsWith('/caja')) setActiveTab('caja');
        else if (path.startsWith('/incidentes')) setActiveTab('incidentes');
        else if (path.startsWith('/config')) setActiveTab('config');
    }, [location]);

    const handleTabChange = (tab: 'operador' | 'audit' | 'anticipados' | 'abonos' | 'caja' | 'incidentes' | 'config') => {
        setActiveTab(tab);
        if (tab === 'operador') navigate('/');
        if (tab === 'audit') navigate('/audit');
        if (tab === 'anticipados') navigate('/anticipados');
        if (tab === 'abonos') navigate('/abonos');
        if (tab === 'caja') navigate('/caja');
        if (tab === 'incidentes') navigate('/incidentes');
        if (tab === 'config') navigate('/config');
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    // Helper to calculate display name
    const getUserDisplayName = () => {
        if (!user) return 'GUEST';
        if (user.full_name) return user.full_name;
        if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`;
        return user.username;
    };

    const handleBackgroundSync = async () => {
        if (isBackgroundSyncing || isGlobalSyncing) return;

        const gId = user?.garage_id || garageConfig?.garage_id;
        if (!gId) return;

        setIsBackgroundSyncing(true);
        try {
            await api.post('/sync/background', { garageId: gId });
            setLastSyncTime(new Date());

            // Incrementamos la key silenciosamente. Esto NO desmontará el DOM principal, 
            // sino que proveerá el nuevo valor a los hijos mediante SyncRefreshContext y CustomEvent.
            setRefreshKey(prev => prev + 1);
            window.dispatchEvent(new CustomEvent('ag:sync-completed', { detail: { timestamp: Date.now() } }));

            toast.success('Datos actualizados en segundo plano', {
                duration: 2500,
                style: { background: '#022c22', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#34d399' },
                icon: <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin" style={{ animationDuration: '3s' }} />
            });
        } catch (error) {
            console.error('❌ Error en background sync:', error);
            toast.error('Error al sincronizar datos');
        } finally {
            setIsBackgroundSyncing(false);
        }
    };

    // Auto Background Sync cada 5 min
    const syncIntervalRef = useRef<(() => void) | undefined>(undefined);
    useEffect(() => {
        syncIntervalRef.current = handleBackgroundSync;
    });

    useEffect(() => {
        if (!user) return;
        const intervalId = setInterval(() => {
            if (syncIntervalRef.current) syncIntervalRef.current();
        }, 5 * 60 * 1000);
        return () => clearInterval(intervalId);
    }, [user]);

    // Timer local para "Hace X min"
    const [syncTimeStr, setSyncTimeStr] = useState('Recién');
    useEffect(() => {
        const updateStr = () => {
            const diffMs = Date.now() - lastSyncTime.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins === 0) setSyncTimeStr('Recién');
            else if (diffMins < 60) setSyncTimeStr(`${diffMins}m`);
            else setSyncTimeStr(`${Math.floor(diffMins / 60)}h ${diffMins % 60}m`);
        };
        updateStr();
        const interval = setInterval(updateStr, 60000); // Act. cada minuto
        return () => clearInterval(interval);
    }, [lastSyncTime]);

    const handleSaveIncident = async () => {
        console.log('🚀 [Incident] INICIO handleSaveIncident');

        // 1. Logs de inspección profunda
        console.log('👤 [DEBUG] User Object:', user);
        console.log('🆔 [DEBUG] user.garage_id:', user?.garage_id);
        console.log('🏢 [DEBUG] garageConfig.garage_id:', garageConfig?.garage_id);

        if (!incidentDescription.trim()) {
            console.warn('⚠️ [Incident] Validación falló: Descripción vacía');
            toast.error('La descripción no puede estar vacía');
            return;
        }

        // 2. Normalización del Garage ID — prioridad: user > terminal config
        const gId = user?.garage_id || garageConfig?.garage_id;
        console.log('🏢 [Incident] Garage ID resuelto:', gId, '| Fuente:', user?.garage_id ? 'user.garage_id' : garageConfig?.garage_id ? 'garageConfig (terminal)' : 'NINGUNA');

        if (!gId) {
            console.error('❌ [Incident] Validación falló: No se encontró garage_id en user ni en terminal config');
            toast.error('No se pudo determinar el garaje actual');
            return;
        }

        setIsSavingIncident(true);

        try {
            // 3. Fallback para crypto.randomUUID si no estás en HTTPS/Localhost
            const incidentId = (typeof crypto?.randomUUID === 'function')
                ? crypto.randomUUID()
                : `inc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            const newIncident = {
                id: incidentId,
                garageId: gId, // Enviamos como camelCase para el schema
                operator: getUserDisplayName(),
                description: incidentDescription,
                createdAt: new Date().toISOString(),
            };

            console.log('📤 [Incident] Intentando POST a /incidents con:', newIncident);

            const response = await api.post('/incidents', newIncident);

            console.log('✅ [Incident] ÉXITO. Respuesta del servidor:', response.data);

            toast.success('Incidente registrado correctamente');
            setIsIncidentModalOpen(false);
            setIncidentDescription('');

        } catch (error: any) {
            console.error('🔥 [Incident] ERROR FATAL EN EL FLUJO:', error);
            // Si el error es de Axios, mostramos la respuesta del servidor
            const errorMsg = error.response?.data?.error || error.message;
            toast.error(`Error al guardar: ${errorMsg}`);
        } finally {
            setIsSavingIncident(false);
        }
    };

    // ── Config Handlers ──
    const handleOpenConfigModal = async () => {
        setIsConfigModalOpen(true);
        setConfigSaved(false);

        // Load Printers
        setIsLoadingPrinters(true);
        try {
            if (window.electronAPI?.getPrinters) {
                const printers = await window.electronAPI.getPrinters();
                setPrinterList(printers);
                const saved = localStorage.getItem('selected_printer_name');
                if (saved && !printers.some((p: any) => p.name === saved)) {
                    toast.warning(`Impresora "${saved}" no encontrada en el sistema`, { duration: 4000 });
                    setSelectedPrinter('');
                }
            } else {
                toast.error('API de Electron no disponible (modo dev)');
            }
        } catch (err) {
            console.error('Error loading printers:', err);
            toast.error('Error al cargar impresoras');
        } finally {
            setIsLoadingPrinters(false);
        }

        // Load HW Config — with fallback to MOCK defaults
        const DEFAULT_MOCK_CONFIG = {
            mockMode: true,
            barrier: { driver: 'MOCK' },
            camera: { driver: 'MOCK' },
            scanner: { driver: 'MOCK' },
            reconnect: { enabled: true, intervalMs: 5000, maxAttempts: -1, backoffMultiplier: 1.5 },
        };

        setIsLoadingHw(true);
        try {
            if (window.electronAPI?.getHardwareConfig) {
                const cfg = await window.electronAPI.getHardwareConfig();
                if (cfg && cfg.barrier && cfg.camera) {
                    // Hydrate hikvision defaults into state if driver is ISAPI but config is missing/partial
                    if (cfg.camera.driver === 'HIKVISION_ISAPI') {
                        cfg.camera.hikvision = {
                            host: '192.168.100.77',
                            username: 'admin',
                            password: '',
                            channel: 101,
                            ...cfg.camera.hikvision,
                        };
                    }
                    setHwConfig(cfg);
                    setMockMode(cfg.mockMode ?? true);
                } else {
                    console.warn('[HW-UI] getHardwareConfig returned empty/invalid, falling back to MOCK defaults');
                    setHwConfig(DEFAULT_MOCK_CONFIG);
                    setMockMode(true);
                    toast.warning('Configuración de hardware vacía — usando modo simulador', { duration: 3000 });
                }
            } else {
                // Electron API not available (web dev mode)
                console.warn('[HW-UI] electronAPI.getHardwareConfig not available, using MOCK defaults');
                setHwConfig(DEFAULT_MOCK_CONFIG);
                setMockMode(true);
            }

            // Also fetch current hw status for indicators
            if (window.electronAPI?.getHardwareStatus) {
                const status = await window.electronAPI.getHardwareStatus();
                setHwStatus({
                    barrierOnline: status.entryBarrierOnline ?? false,
                    cameraOnline: status.cameraOnline ?? false,
                });
            }
        } catch (err) {
            console.error('[HW-UI] ❌ Error loading HW config, falling back to MOCK:', err);
            setHwConfig(DEFAULT_MOCK_CONFIG);
            setMockMode(true);
            toast.error('Error al cargar config de hardware — modo simulador activo');
        } finally {
            setIsLoadingHw(false);
        }
    };

    const handleSaveConfig = async () => {
        // Save Printer
        if (selectedPrinter) {
            localStorage.setItem('selected_printer_name', selectedPrinter);
        } else {
            localStorage.removeItem('selected_printer_name');
        }

        // Save HW
        if (hwConfig && window.electronAPI?.setHardwareConfig) {
            try {
                await window.electronAPI.setHardwareConfig(hwConfig);
            } catch (err) {
                toast.error('Error al guardar HW');
                return;
            }
        }

        setConfigSaved(true);
        toast.success(`Configuración guardada correctamente`);
        setTimeout(() => setIsConfigModalOpen(false), 800);
    };

    return (
        <div className="h-full min-h-0 overflow-hidden bg-black text-gray-200 font-sans selection:bg-emerald-500/30 flex flex-col">
            <SyncOverlay isVisible={isGlobalSyncing} />

            {/* --- HEADER --- */}
            <header className="h-14 border-b border-gray-800 bg-gray-950 flex items-center justify-between px-4 shrink-0 z-50 relative">

                {/* Brand - Dynamic per Terminal Config and Sync Status */}
                <div className="flex items-center gap-3 flex-1">
                    <div className="flex flex-col justify-center h-full max-w-[250px]">
                        <h1 className="text-white font-bold text-base leading-tight tracking-tight truncate pb-0.5">
                            {garageConfig?.name || 'ANTIGRAVITY'}
                        </h1>
                        <span className="text-[10px] text-gray-500 uppercase tracking-tighter truncate">
                            {garageConfig?.address || 'TERMINAL PROTOTYPE'}
                        </span>
                    </div>

                    {isGlobalSyncing ? (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-900/20 border border-emerald-500/30 rounded text-emerald-500 font-mono shadow-sm shadow-emerald-900/20 animate-pulse">
                            <span className="animate-spin text-[10px]">🔄</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest pt-0.5">Sinc. Inicial...</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 px-2 py-0.5 bg-gray-900/40 border border-emerald-500/20 rounded shadow-sm shadow-emerald-900/10">
                            <span className="text-[10px] hidden sm:inline text-emerald-500/70 font-mono tracking-widest">
                                {syncTimeStr}
                            </span>
                            <button
                                onClick={handleBackgroundSync}
                                disabled={isBackgroundSyncing}
                                className={`p-0.5 rounded transition-all ${isBackgroundSyncing ? 'text-emerald-400' : 'text-emerald-500/50 hover:text-emerald-400 hover:bg-emerald-500/10'}`}
                                title="Forzar sincronización rápida"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isBackgroundSyncing ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    )}
                </div>

                {/* Navigation Tabs Container - Centered */}
                <div className="absolute left-1/2 -translate-x-1/2">
                    <nav className="flex items-center gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-800/50">
                        <NavButton
                            active={activeTab === 'operador'}
                            onClick={() => handleTabChange('operador')}
                            icon={<LayoutDashboard className="w-4 h-4" />}
                            label="Operador"
                        />
                        <NavButton
                            active={activeTab === 'audit'}
                            onClick={() => handleTabChange('audit')}
                            icon={<Eye className="w-4 h-4" />}
                            label="Auditoría"
                        />
                        <NavButton
                            active={activeTab === 'abonos'}
                            onClick={() => handleTabChange('abonos')}
                            icon={<Ticket className="w-4 h-4" />}
                            label="Abonos"
                        />
                        <NavButton
                            active={activeTab === 'caja'}
                            onClick={() => handleTabChange('caja')}
                            icon={<Wallet className="w-4 h-4" />}
                            label="Caja"
                        />
                        <NavButton
                            active={activeTab === 'incidentes'}
                            onClick={() => setIsIncidentModalOpen(true)}
                            icon={<AlertTriangle className="w-4 h-4" />}
                            label="Incidente"
                        />
                        <NavButton
                            active={false}
                            onClick={handleOpenConfigModal}
                            icon={<Settings className="w-4 h-4" />}
                            label="Config"
                        />
                    </nav>
                </div>

                {/* User & Actions */}
                <div className="flex items-center gap-4 flex-1 justify-end">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 rounded-full border border-gray-800">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${user ? 'bg-emerald-500' : 'bg-gray-500'}`}></div>
                        <UserIcon className="w-3 h-3 text-gray-400" />
                        <span className="text-xs font-mono font-bold text-gray-400 uppercase truncate max-w-[150px]">
                            {getUserDisplayName()}
                        </span>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2 hover:bg-red-900/20 text-gray-500 hover:text-red-400 rounded-lg transition-colors"
                        title="Salir"
                    >
                        <LogOut className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* --- CONTENT AREA --- */}
            <SyncRefreshContext.Provider value={{ refreshKey }}>
                <main className={`flex-1 overflow-auto relative ${location.pathname.startsWith('/abonos') ? 'app-scrollbar' : ''}`}>
                    {children}
                </main>
            </SyncRefreshContext.Provider>

            {/* --- INCIDENT MODAL --- */}
            {isIncidentModalOpen && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-md bg-gray-950 border border-gray-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-3">
                            <div className="p-2 bg-red-900/20 rounded-lg">
                                <AlertTriangle className="w-5 h-5 text-red-500" />
                            </div>
                            <h2 className="text-lg font-bold text-white uppercase tracking-tight">Registrar Incidente</h2>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 px-1">
                                    Descripción del Incidente / Novedad
                                </label>
                                <textarea
                                    autoFocus
                                    value={incidentDescription}
                                    onChange={(e) => setIncidentDescription(e.target.value)}
                                    placeholder="Detalle lo sucedido..."
                                    className="w-full h-32 bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all resize-none placeholder:text-gray-600"
                                />
                            </div>

                            <div className="flex items-center gap-2 p-3 bg-gray-900/50 rounded-lg border border-gray-800/50 text-[10px] text-gray-400">
                                <span className="font-bold uppercase tracking-tight shrink-0">Operador:</span>
                                <span className="font-mono text-emerald-500 uppercase truncate">{getUserDisplayName()}</span>
                            </div>
                        </div>

                        <div className="px-6 py-4 bg-gray-900/30 border-t border-gray-800 flex items-center justify-end gap-3">
                            <button
                                onClick={() => {
                                    setIsIncidentModalOpen(false);
                                    setIncidentDescription('');
                                }}
                                disabled={isSavingIncident}
                                className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveIncident}
                                disabled={isSavingIncident || !incidentDescription.trim()}
                                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-bold uppercase tracking-widest rounded-lg shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
                            >
                                {isSavingIncident ? (
                                    <>
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Guardando...
                                    </>
                                ) : (
                                    'Guardar Incidente'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- CONFIG MODAL --- */}
            {isConfigModalOpen && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-gray-950 border border-gray-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-3">
                            <div className="p-2 bg-emerald-900/20 rounded-lg">
                                <Settings className="w-5 h-5 text-emerald-500" />
                            </div>
                            <h2 className="text-lg font-bold text-white uppercase tracking-tight">Configuración de Hardware</h2>
                        </div>

                        <div className="p-6 h-[480px] overflow-y-auto space-y-6">

                            {/* ══ IMPRESORA SECTION ══ */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
                                    <Printer className="w-4 h-4 text-emerald-500" />
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-500">Impresora</h3>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 px-1">
                                        Impresora Activa
                                    </label>
                                    {isLoadingPrinters ? (
                                        <div className="flex items-center gap-2 p-3 bg-gray-900 border border-gray-800 rounded-lg">
                                            <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                                            <span className="text-xs text-gray-400">Cargando impresoras...</span>
                                        </div>
                                    ) : (
                                        <select
                                            value={selectedPrinter}
                                            onChange={(e) => setSelectedPrinter(e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all appearance-none cursor-pointer"
                                        >
                                            <option value="">🖥️ Usar default del Sistema Operativo</option>
                                            {printerList.map((p) => (
                                                <option key={p.name} value={p.name}>
                                                    {p.name} {p.status === 0 ? '✅' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    {printerList.length === 0 && !isLoadingPrinters && (
                                        <p className="text-[10px] text-amber-500/80 px-1">No se detectaron impresoras en el sistema.</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 p-3 bg-gray-900/50 rounded-lg border border-gray-800/50 text-[10px] text-gray-400">
                                    <span className="font-bold uppercase tracking-tight shrink-0">Resumen:</span>
                                    <span className="font-mono text-emerald-500 truncate">
                                        {selectedPrinter || 'OS Default'}
                                    </span>
                                </div>
                            </div>

                            {isLoadingHw ? (
                                <div className="flex items-center justify-center p-8">
                                    <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                                </div>
                            ) : hwConfig ? (
                                <>
                                    {/* ══ CÁMARA SECTION ══ */}
                                    {/* Hidden: cameras are not used in this phase.
                                        Set `false` → `true` below to re-enable the UI.
                                        The config state and save handler remain intact. */}
                                    {true && (
                                        <div className="space-y-3 relative">
                                            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm">📷</span>
                                                    <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-500">Cámara</h3>
                                                </div>
                                                {!mockMode && (
                                                    <div className="flex items-center gap-1.5">
                                                        {hwStatus.cameraOnline ? (
                                                            <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                                                        ) : (
                                                            <WifiOff className="w-3.5 h-3.5 text-red-500" />
                                                        )}
                                                        <span className={`text-[9px] font-bold uppercase tracking-wider ${hwStatus.cameraOnline ? 'text-emerald-500' : 'text-red-500'}`}>
                                                            {hwStatus.cameraOnline ? 'Online' : 'Offline'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {mockMode ? (
                                                /* ── Mock Lock Overlay ── */
                                                <div className="relative">
                                                    <div className="p-4 bg-amber-950/20 border border-amber-500/20 rounded-lg flex items-center gap-3">
                                                        <div className="p-2 bg-amber-900/30 rounded-lg shrink-0">
                                                            <Lock className="w-4 h-4 text-amber-500" />
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-bold text-amber-500 uppercase tracking-wide">Modo Simulación Activo</p>
                                                            <p className="text-[10px] text-amber-500/60 mt-0.5">
                                                                Desactive el modo Mock desde el Simulador (Ctrl+Shift+D) para configurar la cámara real.
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                /* ── Hikvision ISAPI Config Fields ── */
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-3 gap-4 p-3 bg-gray-900/50 border border-emerald-900/30 rounded-lg">
                                                        <div className="space-y-1">
                                                            <label className="text-[9px] font-bold uppercase text-gray-500">IP de la Cámara</label>
                                                            <input
                                                                type="text"
                                                                value={hwConfig.camera.hikvision?.host || ''}
                                                                onChange={(e) => {
                                                                    const prevHik = hwConfig.camera.hikvision || { host: '', username: 'admin', password: '', channel: 101 };
                                                                    setHwConfig({ ...hwConfig, camera: { ...hwConfig.camera, driver: 'HIKVISION_ISAPI', hikvision: { ...prevHik, host: e.target.value } } });
                                                                }}
                                                                className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                                placeholder="192.168.100.77"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[9px] font-bold uppercase text-gray-500">Usuario</label>
                                                            <input
                                                                type="text"
                                                                value={hwConfig.camera.hikvision?.username || ''}
                                                                onChange={(e) => {
                                                                    const prevHik = hwConfig.camera.hikvision || { host: '', username: 'admin', password: '', channel: 101 };
                                                                    setHwConfig({ ...hwConfig, camera: { ...hwConfig.camera, driver: 'HIKVISION_ISAPI', hikvision: { ...prevHik, username: e.target.value } } });
                                                                }}
                                                                className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                                placeholder="admin"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[9px] font-bold uppercase text-gray-500">Contraseña</label>
                                                            <input
                                                                type="password"
                                                                value={hwConfig.camera.hikvision?.password || ''}
                                                                onChange={(e) => {
                                                                    const prevHik = hwConfig.camera.hikvision || { host: '', username: 'admin', password: '', channel: 101 };
                                                                    setHwConfig({ ...hwConfig, camera: { ...hwConfig.camera, driver: 'HIKVISION_ISAPI', hikvision: { ...prevHik, password: e.target.value } } });
                                                                }}
                                                                className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                                placeholder="••••••••"
                                                            />
                                                        </div>
                                                    </div>
                                                    {!hwStatus.cameraOnline && hwConfig.camera.driver === 'HIKVISION_ISAPI' && (
                                                        <p className="text-[10px] text-red-400/80 px-1 flex items-center gap-1">
                                                            <WifiOff className="w-3 h-3" /> No se detecta la cámara Hikvision en la red. Verifique la IP y las credenciales.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ══ BARRERAS SECTION ══ */}
                                    <div className="space-y-3 relative">
                                        <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm">🚧</span>
                                                <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-500">Barreras</h3>
                                            </div>
                                            {!mockMode && (
                                                <div className="flex items-center gap-1.5">
                                                    {hwStatus.barrierOnline ? (
                                                        <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                                                    ) : (
                                                        <WifiOff className="w-3.5 h-3.5 text-red-500" />
                                                    )}
                                                    <span className={`text-[9px] font-bold uppercase tracking-wider ${hwStatus.barrierOnline ? 'text-emerald-500' : 'text-red-500'}`}>
                                                        {hwStatus.barrierOnline ? 'Online' : 'Offline'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {mockMode ? (
                                            /* ── Mock Lock Overlay ── */
                                            <div className="relative">
                                                <div className="p-4 bg-amber-950/20 border border-amber-500/20 rounded-lg flex items-center gap-3">
                                                    <div className="p-2 bg-amber-900/30 rounded-lg shrink-0">
                                                        <Lock className="w-4 h-4 text-amber-500" />
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-bold text-amber-500 uppercase tracking-wide">Modo Simulación Activo</p>
                                                        <p className="text-[10px] text-amber-500/60 mt-0.5">
                                                            Desactive el modo Mock desde el Simulador (Ctrl+Shift+D) para configurar barreras reales.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            /* ── Real Config Fields ── */
                                            <div className="space-y-3">
                                                <div className="grid grid-cols-2 gap-4 p-3 bg-gray-900/50 border border-emerald-900/30 rounded-lg">
                                                    <div className="space-y-1">
                                                        <label className="text-[9px] font-bold uppercase text-gray-500">IP Módulo Relé</label>
                                                        <input
                                                            type="text"
                                                            value={hwConfig.barrier.ethernet?.host || '192.168.1.100'}
                                                            onChange={(e) => {
                                                                const prevEth = hwConfig.barrier.ethernet || { host: '', port: 23, relayEntryChannel: 0, relayExitChannel: 1, pulseDurationMs: 1000 };
                                                                setHwConfig({ ...hwConfig, barrier: { ...hwConfig.barrier, driver: 'ETHERNET_RELAY', ethernet: { ...prevEth, host: e.target.value } } });
                                                            }}
                                                            className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                            placeholder="192.168.1.100"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[9px] font-bold uppercase text-gray-500">Puerto TCP</label>
                                                        <input
                                                            type="number"
                                                            value={hwConfig.barrier.ethernet?.port || 23}
                                                            onChange={(e) => {
                                                                const prevEth = hwConfig.barrier.ethernet || { host: '', port: 23, relayEntryChannel: 0, relayExitChannel: 1, pulseDurationMs: 1000 };
                                                                setHwConfig({ ...hwConfig, barrier: { ...hwConfig.barrier, driver: 'ETHERNET_RELAY', ethernet: { ...prevEth, port: parseInt(e.target.value) || 23 } } });
                                                            }}
                                                            className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                        />
                                                    </div>
                                                </div>
                                                {!hwStatus.barrierOnline && hwConfig.barrier.driver === 'ETHERNET_RELAY' && (
                                                    <p className="text-[10px] text-red-400/80 px-1 flex items-center gap-1">
                                                        <WifiOff className="w-3 h-3" /> No se detecta el módulo relé en la red. Verifique la IP y el puerto.
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <p className="text-xs text-red-400">Error al cargar la configuración de hardware.</p>
                            )}

                        </div>

                        <div className="px-6 py-4 bg-gray-900/30 border-t border-gray-800 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                {mockMode ? (
                                    <>
                                        <Lock className="w-3 h-3 text-amber-500" />
                                        <span className="text-amber-500/80 uppercase tracking-wider font-bold">Mock Activo</span>
                                    </>
                                ) : (
                                    <>
                                        <Wifi className="w-3 h-3 text-emerald-500" />
                                        <span className="text-emerald-500/80 uppercase tracking-wider font-bold">Drivers Reales</span>
                                    </>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setIsConfigModalOpen(false)}
                                    className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSaveConfig}
                                    disabled={configSaved}
                                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white text-xs font-bold uppercase tracking-widest rounded-lg shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
                                >
                                    {configSaved ? (
                                        <>
                                            <Check className="w-3 h-3" />
                                            Guardado
                                        </>
                                    ) : (
                                        'Guardar Cambios'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper component
const NavButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
    <button
        onClick={onClick}
        className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2 ${active
            ? 'bg-gray-800 text-white shadow-sm border border-gray-700'
            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
    >
        {icon}
        <span className="hidden sm:inline">{label}</span>
    </button>
);

export default MainLayout;
