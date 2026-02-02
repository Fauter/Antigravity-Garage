import React, { useState } from 'react';
import { resetDatabase } from '../services/api';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

const ConfigPage: React.FC = () => {
    const [confirming, setConfirming] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleReset = async () => {
        setLoading(true);
        try {
            await resetDatabase();
            toast.success('Base de datos reiniciada correctamente');
            setConfirming(false);
            // Optional: Reload window to clear client state
            setTimeout(() => window.location.reload(), 1000);
        } catch (error) {
            console.error('Reset failed', error);
            toast.error('Error al reiniciar base de datos');
            setLoading(false);
        }
    };

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
                <RefreshCw className="w-8 h-8 text-emerald-500" />
                Configuración del Sistema
            </h2>

            <div className="bg-gray-900 border border-red-900/30 rounded-2xl p-6 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                    <AlertTriangle className="w-32 h-32 text-red-500" />
                </div>

                <h3 className="text-xl font-bold text-red-400 mb-2">Zona de Peligro</h3>
                <p className="text-gray-400 mb-6">
                    Estas acciones son irreversibles y afectan a toda la operación.
                </p>

                <div className="flex items-center justify-between bg-black/40 p-4 rounded-xl border border-red-900/20">
                    <div>
                        <h4 className="text-white font-bold">Reiniciar Base de Datos</h4>
                        <p className="text-sm text-gray-500">Borra estadías, movimientos y abonos. Mantiene usuarios.</p>
                    </div>

                    {!confirming ? (
                        <button
                            onClick={() => setConfirming(true)}
                            className="px-4 py-2 bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white rounded-lg transition-all font-bold text-sm border border-red-800"
                        >
                            Reset DB
                        </button>
                    ) : (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setConfirming(false)}
                                className="px-3 py-2 text-gray-400 hover:text-white text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleReset}
                                disabled={loading}
                                className={`px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm flex items-center gap-2 relative z-10 transition-all ${loading ? 'opacity-50 cursor-not-allowed' : 'animate-pulse hover:scale-105'
                                    }`}
                            >
                                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                {loading ? 'Limpiando...' : 'Confirmar'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConfigPage;
