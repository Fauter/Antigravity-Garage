import React, { useState } from 'react';
import { Settings, CreditCard, Clock, Database, ChevronLeft, LayoutGrid, Car } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import TariffConfig from '../components/config/TariffConfig';
import PriceMatrix from '../components/config/PriceMatrix';
import SystemConfig from '../components/config/SystemConfig';
import VehicleConfig from '../components/config/VehicleConfig';
import { api } from '../services/api';
import { toast } from 'sonner';

const ConfigPage: React.FC = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'tarifas' | 'precios' | 'vehiculos' | 'sistema'>('tarifas');
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
        <div className="h-full bg-[#0a0a0a] flex flex-col text-white">
            {/* Header */}
            <div className="h-16 border-b border-gray-800 flex items-center justify-between px-6 bg-black/50 backdrop-blur-md sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/')}
                        className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
                        Configuración
                    </h1>
                </div>

                <div className="flex bg-gray-900 p-1 rounded-lg border border-gray-800">
                    <button
                        onClick={() => setActiveTab('tarifas')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'tarifas' ? 'bg-gray-800 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <Clock className="w-4 h-4" /> Tarifas
                    </button>
                    <button
                        onClick={() => setActiveTab('vehiculos')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'vehiculos' ? 'bg-gray-800 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <Car className="w-4 h-4" /> Vehículos
                    </button>
                    <button
                        onClick={() => setActiveTab('precios')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'precios' ? 'bg-gray-800 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <LayoutGrid className="w-4 h-4" /> Precios
                    </button>
                    <button
                        onClick={() => setActiveTab('sistema')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'sistema' ? 'bg-gray-800 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <Settings className="w-4 h-4" /> Sistema
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6 scrollbar-thin scrollbar-thumb-gray-800">
                <div className="max-w-6xl mx-auto">
                    {activeTab === 'tarifas' && <TariffConfig />}
                    {activeTab === 'vehiculos' && <VehicleConfig />}
                    {activeTab === 'precios' && <PriceMatrix />}
                    {activeTab === 'sistema' && (
                        <div className="space-y-12">
                            <SystemConfig />

                            {/* Danger Zone */}
                            <div className="border border-red-900/30 bg-red-950/10 rounded-xl p-6">
                                <h3 className="text-red-500 font-bold uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                                    <Database className="w-4 h-4" /> Zona de Peligro
                                </h3>
                                <p className="text-gray-400 text-sm mb-6">
                                    El reinicio de base de datos eliminará permanentemente todos los registros de movimientos, abonos y estadías activas.
                                    Esta acción no se puede deshacer.
                                </p>
                                <button
                                    onClick={handleReset}
                                    disabled={resetting}
                                    className="bg-red-500/10 hover:bg-red-500/20 text-red-500 hover:text-red-400 border border-red-500/50 px-6 py-3 rounded-lg font-bold text-sm transition-all flex items-center gap-2"
                                >
                                    {resetting ? 'Reiniciando...' : 'Reiniciar Base de Datos'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConfigPage;
