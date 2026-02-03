import React, { useState } from 'react';
import { api } from '../../services/api';
import { toast } from 'sonner';
import { Database, AlertTriangle } from 'lucide-react';

const SystemConfig: React.FC = () => {
    const [resetting, setResetting] = useState(false);

    const handleReset = async () => {
        if (!confirm('⚠️ PELIGRO: ESTO BORRARÁ TODOS LOS ABONOS Y MOVIMIENTOS\n\n¿Estás seguro de reiniciar la base de datos?')) return;

        setResetting(true);
        try {
            await api.post('/config/reset');
            toast.success('Bases de datos reiniciadas correctamente');
            window.location.reload();
        } catch (error: any) {
            toast.error('Error: ' + (error.response?.data?.error || error.message));
        } finally {
            setResetting(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8 pt-10">
            {/* Danger Zone */}
            <div className="border border-red-900/30 bg-red-950/10 rounded-xl p-8 text-center">
                <div className="flex justify-center mb-4">
                    <div className="w-12 h-12 rounded-full bg-red-900/20 flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6 text-red-500" />
                    </div>
                </div>
                <h3 className="text-red-500 font-bold uppercase text-lg tracking-wider mb-2">
                    Zona de Peligro
                </h3>
                <p className="text-gray-400 text-sm mb-8 max-w-md mx-auto">
                    El reinicio de base de datos eliminará permanentemente todos los registros de movimientos, abonos y estadías activas.
                    <br /><br />
                    <strong className="text-red-400">Esta acción no se puede deshacer.</strong>
                </p>
                <button
                    onClick={handleReset}
                    disabled={resetting}
                    className="bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20 px-8 py-3 rounded-lg font-bold text-sm transition-all flex items-center gap-2 mx-auto"
                >
                    <Database className="w-4 h-4" />
                    {resetting ? 'Reiniciando...' : 'Reiniciar Base de Datos'}
                </button>
            </div>
        </div>
    );
};

export default SystemConfig;
