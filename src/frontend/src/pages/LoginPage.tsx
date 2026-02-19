import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, ShieldCheck, Settings, Save, MapPin, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
// IMPORT CORRECTO: Desde Infraestructura (Shared) con Fallbacks
import { supabase } from '../../../infrastructure/lib/supabase';

interface TerminalConfig {
    garage_id: string;
    owner_id: string;
    name: string;
    address: string;
}

const LoginPage: React.FC = () => {
    const { login } = useAuth();
    const navigate = useNavigate();

    // Auth State
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    // Error State for Visual Feedback
    const [authError, setAuthError] = useState<string | null>(null);

    // Config State
    const [config, setConfig] = useState<TerminalConfig | null>(null);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [configInputId, setConfigInputId] = useState('');
    const [verifying, setVerifying] = useState(false);

    // Load Config on Mount
    useEffect(() => {
        const stored = localStorage.getItem('ag_terminal_config');
        if (stored) {
            try {
                setConfig(JSON.parse(stored));
            } catch (e) {
                console.error('Config parsing error', e);
                localStorage.removeItem('ag_terminal_config');
            }
        }
    }, []);

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
        // Pass garage_id used for Isolation Validation
        const success = await login(username, password, config.garage_id);
        setLoading(false);

        if (success) {
            toast.success(`Bienvenido a ${config.name}`);
            navigate('/');
        } else {
            // Set Inline Error
            setAuthError('Credenciales Incorrectas');
            // Toast fallback optional, but inline is preferred now
            toast.error('Credenciales inválidas o Personal no autorizado.');
        }
    };

    const handleVerifyConfig = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!configInputId) return;

        setVerifying(true);
        try {
            // Fetch Garage details using the unified client
            const { data, error } = await supabase
                .from('garages')
                .select('*')
                .eq('id', configInputId)
                .single();

            if (error || !data) {
                throw new Error('Garaje no encontrado');
            }

            const newConfig: TerminalConfig = {
                garage_id: data.id,
                owner_id: data.owner_id,
                name: data.name,
                address: data.address
            };

            localStorage.setItem('ag_terminal_config', JSON.stringify(newConfig));
            setConfig(newConfig);
            setShowConfigModal(false);
            toast.success('Terminal Configurada Exitosamente');

        } catch (err: any) {
            toast.error('Error: ' + err.message);
        } finally {
            setVerifying(false);
        }
    };

    const clearConfig = () => {
        localStorage.removeItem('ag_terminal_config');
        setConfig(null);
        setUsername('');
        setPassword('');
    };

    return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center font-sans text-gray-100 p-4 relative overflow-hidden">

            {/* Background Effects */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-gray-950 to-gray-950"></div>

            {/* Config Button (Top Right) */}
            <button
                onClick={() => setShowConfigModal(true)}
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
                ) : (
                    /* Not Configured State */
                    <div className="text-center py-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-900/20 mb-6 border border-red-900/50">
                            <AlertTriangle className="w-10 h-10 text-red-500" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Terminal No Asignada</h2>
                        <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
                            Esta terminal no tiene un Garaje configurado. Configure un ID de Garaje válido para operar.
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
                        Antigravity Garage v2.0
                    </p>
                </div>
            </div>

            {/* Config Modal */}
            {showConfigModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in duration-200">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-white">Configurar Terminal</h3>
                            <button onClick={() => setShowConfigModal(false)} className="text-gray-500 hover:text-white">✕</button>
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
                                    <button type="button" onClick={clearConfig} className="text-red-400 text-xs mt-2 hover:underline">
                                        Desvincular
                                    </button>
                                </div>
                            )}

                            <div className="flex justify-end gap-2 mt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowConfigModal(false)}
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
