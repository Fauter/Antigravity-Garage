import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, ShieldCheck, Settings, Save, MapPin, AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';

interface TerminalConfig {
    garage_id: string;
    owner_id: string;
    name: string;
    address: string;
}

type TerminalConfigViewState =
    | 'LOADING'
    | 'CONFIGURED'
    | 'UNCONFIGURED'
    | 'BACKEND_UNREACHABLE'
    | 'CORRUPT'
    | 'REVOKED';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readLocalCachedConfig(): { config: TerminalConfig | null; corrupt: boolean } {
    const raw = localStorage.getItem('ag_terminal_config');
    if (!raw) return { config: null, corrupt: false };
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.garage_id === 'string' && UUID_REGEX.test(parsed.garage_id.trim())) {
            return {
                config: {
                    garage_id: parsed.garage_id.trim(),
                    owner_id: typeof parsed.owner_id === 'string' ? parsed.owner_id : '',
                    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Garaje Configurado',
                    address: typeof parsed.address === 'string' ? parsed.address : ''
                },
                corrupt: false
            };
        }
        return { config: null, corrupt: true };
    } catch {
        return { config: null, corrupt: true };
    }
}

const LoginPage: React.FC = () => {
    const { login, loginDetailed } = useAuth();
    const navigate = useNavigate();

    // Auth State
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    // Error State for Visual Feedback
    const [authError, setAuthError] = useState<string | null>(null);

    // Config State
    const [config, setConfig] = useState<TerminalConfig | null>(null);
    const [terminalState, setTerminalState] = useState<TerminalConfigViewState>('LOADING');
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [configInputId, setConfigInputId] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [confirmUnlink, setConfirmUnlink] = useState(false);
    const [unlinking, setUnlinking] = useState(false);

    const loadConfig = useCallback(async () => {
        const localCache = readLocalCachedConfig();

        try {
            // 1. Try to load from backend canonical source
            const res = await api.get('/terminal/config');
            const headerStatus = res.headers?.['x-terminal-config-status'];

            if (res.data && res.data.garage_id) {
                setConfig(res.data);
                setTerminalState('CONFIGURED');
                localStorage.setItem('ag_terminal_config', JSON.stringify(res.data));
                return;
            }

            // 2. Recovery / Migration: If backend returned null, check localStorage
            if (localCache.config) {
                // Immediately preserve local configuration in UI so transient failures never show "Terminal No Asignada"
                setConfig(localCache.config);
                setTerminalState('CONFIGURED');

                try {
                    const postRes = await api.post('/terminal/config', {
                        garage_id: localCache.config.garage_id,
                        owner_id: localCache.config.owner_id,
                        name: localCache.config.name,
                        address: localCache.config.address
                    });
                    if (postRes.data && postRes.data.config) {
                        setConfig(postRes.data.config);
                        localStorage.setItem('ag_terminal_config', JSON.stringify(postRes.data.config));
                    }
                } catch (migrationErr) {
                    console.warn('Deferred terminal config re-hydration to backend; using local copy:', migrationErr);
                }
                return;
            }

            if (headerStatus === 'CORRUPT' || localCache.corrupt) {
                setConfig(null);
                setTerminalState('CORRUPT');
                return;
            }

            setConfig(null);
            setTerminalState((prev) => (prev === 'REVOKED' ? 'REVOKED' : 'UNCONFIGURED'));
        } catch (err: any) {
            console.error('Config loading error:', err);

            // Fallback to valid localStorage config when backend fails or is starting up
            if (localCache.config) {
                setConfig(localCache.config);
                setTerminalState('CONFIGURED');
                return;
            }

            if (localCache.corrupt) {
                setConfig(null);
                setTerminalState('CORRUPT');
                return;
            }

            setConfig(null);
            setTerminalState('BACKEND_UNREACHABLE');
        }
    }, []);

    // Load Config on Mount
    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    // Automatic retry if local backend was temporarily unreachable during startup
    useEffect(() => {
        if (terminalState !== 'BACKEND_UNREACHABLE') return;
        const retryTimer = window.setInterval(() => {
            loadConfig();
        }, 3000);
        return () => window.clearInterval(retryTimer);
    }, [terminalState, loadConfig]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();

        // Reset previous errors
        setAuthError(null);

        if (!username || !password) return;
        if (!config) {
            toast.error('Terminal no configurada.');
            return;
        }

        setLoading(true);
        const result = loginDetailed
            ? await loginDetailed(username, password, config.garage_id)
            : { ok: await login(username, password, config.garage_id) };
        setLoading(false);

        if (result.ok) {
            toast.success(`Bienvenido a ${config.name}`);
            navigate('/');
        } else {
            if (result.code === 'BACKEND_UNAVAILABLE') {
                const msg = result.message || 'Servidor local temporalmente inaccesible. Reintente en unos segundos.';
                setAuthError(msg);
                toast.error(msg);
            } else if (result.code === 'OFFLINE_NO_LOCAL_USER') {
                const msg = result.message || 'Sin conexión: este usuario no registra sesiones previas en esta terminal.';
                setAuthError(msg);
                toast.error(msg);
            } else if (result.code === 'UNAUTHORIZED_GARAGE' || result.status === 403) {
                const msg = result.message || 'Personal no autorizado para operar en este garaje.';
                setAuthError(msg);
                toast.error(msg);
            } else {
                setAuthError('Credenciales Incorrectas');
                toast.error('Credenciales inválidas o Personal no autorizado.');
            }
        }
    };

    const handleVerifyConfig = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedId = configInputId.trim();
        if (!trimmedId) return;

        if (!UUID_REGEX.test(trimmedId)) {
            toast.error('El formato del Garaje UUID es inválido.');
            return;
        }

        setVerifying(true);
        try {
            // Save canonical via backend - It will validate (online or local evidence) and return metadata
            const postRes = await api.post('/terminal/config', { garage_id: trimmedId });
            
            if (postRes.data && postRes.data.config) {
                const validatedConfig = postRes.data.config;
                localStorage.setItem('ag_terminal_config', JSON.stringify(validatedConfig));
                
                setConfig(validatedConfig);
                setTerminalState('CONFIGURED');
                setShowConfigModal(false);
                setConfirmUnlink(false);
                toast.success('Terminal Configurada Exitosamente');
            } else {
                throw new Error('Configuración inválida recibida del backend');
            }

        } catch (err: any) {
            const errorCode = err.response?.data?.code;
            const errorMsg = err.response?.data?.error || err.message;
            if (errorCode === 'OFFLINE_UNVERIFIED' || (!navigator.onLine && !err.response)) {
                toast.error('Sin conexión a internet y sin datos locales previos para verificar este garaje.');
            } else {
                toast.error('Error: ' + errorMsg);
            }
        } finally {
            setVerifying(false);
        }
    };

    const clearConfig = async () => {
        if (!confirmUnlink) {
            setConfirmUnlink(true);
            return;
        }

        setUnlinking(true);
        try {
            const res = await api.post('/terminal/clear-config', { authorized: true });
            if (res.status === 200 && res.data?.success) {
                localStorage.removeItem('ag_terminal_config');
                setConfig(null);
                setTerminalState('REVOKED');
                setUsername('');
                setPassword('');
                setConfirmUnlink(false);
                setShowConfigModal(false);
                toast.success('Terminal desvinculada correctamente.');
            } else {
                toast.error('No se pudo confirmar la desvinculación en el servidor local. Se mantuvo la configuración actual.');
            }
        } catch (e: any) {
            toast.error('Error al desvincular la terminal: el servidor local no respondió. La configuración se mantuvo intacta.');
        } finally {
            setUnlinking(false);
        }
    };

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-gray-950 flex items-center justify-center font-sans text-gray-100 p-4 relative">

            {/* Background Effects */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-gray-950 to-gray-950"></div>

            {/* Config Button (Top Right) */}
            <button
                onClick={() => {
                    setConfirmUnlink(false);
                    setShowConfigModal(true);
                }}
                className="absolute top-4 right-4 p-2 text-gray-600 hover:text-emerald-500 transition-colors z-10"
                title="Configuración de Terminal"
            >
                <Settings className="w-6 h-6" />
            </button>

            <div className={`w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl relative z-10 animate-in fade-in duration-500`}>

                {/* Header Accent */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-emerald-500 to-blue-600"></div>

                {config ? (
                    <>
                        {/* Configured Header */}
                        <div className="text-center mb-8">
                            <div className="flex flex-col items-center">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800 mb-4 border border-gray-700 shadow-lg shadow-emerald-900/20">
                                    <ShieldCheck className="w-8 h-8 text-emerald-500" />
                                </div>
                                <h1 className="text-2xl font-bold tracking-tight text-white">{config.name}</h1>
                                <div className="flex items-center gap-1 text-gray-400 mt-1 text-xs uppercase tracking-wide">
                                    <MapPin className="w-3 h-3" />
                                    <span>{config.address}</span>
                                </div>
                            </div>
                        </div>

                        {/* Login Form */}
                        <form onSubmit={handleLogin} className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Usuario</label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => {
                                        setUsername(e.target.value);
                                        if (authError) setAuthError(null); // Clear error on type
                                    }}
                                    className={`w-full bg-gray-950 border rounded-lg p-3 text-white outline-none focus:ring-1 transition-all placeholder:text-gray-700 ${authError ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500' : 'border-gray-800 focus:border-emerald-500 focus:ring-emerald-500'}`}
                                    placeholder="Ingrese su usuario..."
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Contraseña</label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        if (authError) setAuthError(null); // Clear error on type
                                    }}
                                    className={`w-full bg-gray-950 border rounded-lg p-3 text-white outline-none focus:ring-1 transition-all placeholder:text-gray-700 font-mono ${authError ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500' : 'border-gray-800 focus:border-emerald-500 focus:ring-emerald-500'}`}
                                    placeholder="••••••••"
                                />
                            </div>

                            {/* INLINE ALERT COMPONENT */}
                            {authError && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3 animate-in slide-in-from-top-1 fade-in">
                                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                                    <span className="text-sm font-medium text-red-400">{authError}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                                {loading ? 'Validando...' : 'INICIAR SESIÓN'}
                            </button>
                        </form>
                    </>
                ) : terminalState === 'LOADING' ? (
                    <div className="text-center py-12">
                        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mx-auto mb-4" />
                        <p className="text-gray-400 text-sm">Verificando configuración local de la terminal...</p>
                    </div>
                ) : terminalState === 'BACKEND_UNREACHABLE' ? (
                    <div className="text-center py-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-900/20 mb-6 border border-amber-900/50">
                            <WifiOff className="w-10 h-10 text-amber-500" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Servidor Local Iniciando</h2>
                        <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
                            El servicio local de GarageIA está temporalmente inaccesible o iniciándose. Reintentando conexión automáticamente...
                        </p>
                        <button
                            onClick={() => loadConfig()}
                            className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Reintentar Ahora
                        </button>
                    </div>
                ) : terminalState === 'CORRUPT' ? (
                    <div className="text-center py-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-900/20 mb-6 border border-amber-900/50">
                            <AlertTriangle className="w-10 h-10 text-amber-500" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Configuración Local Inconsistente</h2>
                        <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
                            Se detectó un archivo de configuración dañado y no fue posible recuperarlo automáticamente. Ingrese nuevamente el UUID del Garaje para restaurar el vínculo.
                        </p>
                        <button
                            onClick={() => setShowConfigModal(true)}
                            className="bg-amber-600 hover:bg-amber-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            Restaurar Configuración
                        </button>
                    </div>
                ) : (
                    /* Not Configured or Explicitly Revoked State */
                    <div className="text-center py-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-900/20 mb-6 border border-red-900/50">
                            <AlertTriangle className="w-10 h-10 text-red-500" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">
                            {terminalState === 'REVOKED' ? 'Terminal Desvinculada' : 'Terminal No Asignada'}
                        </h2>
                        <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
                            {terminalState === 'REVOKED'
                                ? 'La vinculación de esta terminal fue revocada explícitamente. Configure un ID de Garaje válido para volver a operar.'
                                : 'Esta terminal no tiene un Garaje configurado. Configure un ID de Garaje válido para operar.'}
                        </p>
                        <button
                            onClick={() => setShowConfigModal(true)}
                            className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            Configurar Ahora
                        </button>
                    </div>
                )}

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-[10px] text-gray-600 uppercase tracking-widest">
                        GarageIA v{__APP_VERSION__}
                    </p>
                </div>
            </div>

            {/* Config Modal */}
            {showConfigModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in duration-200">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-white">Configurar Terminal</h3>
                            <button
                                onClick={() => {
                                    setConfirmUnlink(false);
                                    setShowConfigModal(false);
                                }}
                                className="text-gray-500 hover:text-white"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleVerifyConfig} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-400 mb-1">Garaje UUID</label>
                                <input
                                    type="text"
                                    value={configInputId}
                                    onChange={(e) => setConfigInputId(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-lg p-2 text-white font-mono text-xs focus:border-emerald-500 outline-none"
                                    placeholder="e.g. 123e4567-e89b..."
                                />
                            </div>

                            {config && (
                                <div className="bg-gray-800/50 p-3 rounded border border-gray-700">
                                    <p className="text-xs text-gray-400">Actual:</p>
                                    <p className="text-sm font-bold text-emerald-400">{config.name}</p>
                                    <p className="text-[10px] text-gray-500">{config.garage_id}</p>
                                    {!confirmUnlink ? (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmUnlink(true)}
                                            className="text-red-400 text-xs mt-2 hover:underline"
                                        >
                                            Desvincular
                                        </button>
                                    ) : (
                                        <div className="mt-2 pt-2 border-t border-gray-700 flex items-center justify-between">
                                            <span className="text-[11px] text-amber-400">¿Confirmar desvinculación?</span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmUnlink(false)}
                                                    className="text-xs text-gray-400 hover:text-white"
                                                >
                                                    No
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={unlinking}
                                                    onClick={clearConfig}
                                                    className="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-0.5 rounded"
                                                >
                                                    {unlinking ? '...' : 'Sí, desvincular'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="flex justify-end gap-2 mt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setConfirmUnlink(false);
                                        setShowConfigModal(false);
                                    }}
                                    className="px-4 py-2 text-gray-400 hover:text-white text-sm"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={verifying}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                                >
                                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Guardar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoginPage;
