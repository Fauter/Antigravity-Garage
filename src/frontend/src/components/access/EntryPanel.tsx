import React from 'react';
import { useEntryLogic } from '../../hooks/useEntryLogic';
import { useAuth } from '../../context/AuthContext';
import { Car, CheckCircle } from 'lucide-react';

const EntryPanel: React.FC = () => {
    const {
        plate,
        setPlate,
        vehicleType,
        setVehicleType,
        vehicleTypes,
        handleSubmit,
        isLoading,
        isSuccess,
        error
    } = useEntryLogic();

    const { isGlobalSyncing } = useAuth();

    return (
        <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800 font-sans overflow-hidden">

            {/* COMPACT HEADER */}
            <div className="px-3 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
                <div className="flex items-center gap-2 text-emerald-500">
                    <Car className="w-4 h-4" />
                    <h2 className="text-sm font-bold tracking-wide uppercase">Ingreso</h2>
                </div>
            </div>

            {/* Content Container - Compact */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* Camera - Slightly smaller to ensure fit */}
                <div className="h-40 bg-black flex items-center justify-center border-b border-gray-800 shrink-0 relative">
                    <span className="text-gray-700 font-mono text-xs">OFFLINE</span>
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-500/5 to-transparent opacity-30 pointer-events-none animate-scan"></div>
                </div>

                {/* Form Area - Flex center with tight gaps */}
                <div className="flex-1 p-6 flex flex-col justify-center gap-4">
                    <form onSubmit={handleSubmit} className="space-y-4">

                        {/* Plate Input */}
                        <div>
                            <label className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-1 block">Patente</label>
                            <input
                                type="text"
                                value={plate}
                                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                                placeholder="AAA-000"
                                className="w-full h-14 bg-gray-800 border-2 border-gray-700 rounded-xl text-center text-3xl font-mono text-white font-bold focus:border-emerald-500 outline-none uppercase"
                                maxLength={7}
                                autoFocus
                            />
                        </div>

                        {/* Vehicle Type Dropdown */}
                        <div>
                            <label className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-1 block">Tipo Vehículo</label>
                            <div className="relative">
                                <select
                                    value={vehicleType}
                                    onChange={(e) => setVehicleType(e.target.value)}
                                    className="w-full h-12 bg-gray-800 border border-gray-700 rounded-xl px-4 text-white text-lg appearance-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                                >
                                    <option value="" disabled>Seleccione el tipo...</option>
                                    {vehicleTypes.map((type) => (
                                        <option key={type.id} value={type.id}>{type.label}</option>
                                    ))}
                                </select>
                                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-gray-400">
                                    ▼
                                </div>
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={!plate || !vehicleType || isLoading || isGlobalSyncing}
                                className={`w-full h-14 rounded-xl font-bold text-xl uppercase tracking-wide flex items-center justify-center gap-3 transition-all ${(!plate || !vehicleType || isGlobalSyncing)
                                    ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'
                                    }`}
                            >
                                {isLoading ? '...' : isGlobalSyncing ? 'Sincronizando...' : 'Dar Entrada'}
                                {!isLoading && !isGlobalSyncing && <CheckCircle className="w-5 h-5" />}
                            </button>
                        </div>

                    </form>

                    {/* Feedback - Compact */}
                    {isSuccess && (
                        <div className="p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-lg text-emerald-400 text-center text-xs font-bold">
                            ENTRADA REGISTRADA
                        </div>
                    )}
                    {(error as any) && (
                        <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-center text-xs font-bold">
                            {(error as any)?.message || 'Error'}
                        </div>
                    )}
                </div>
            </div>

            {/* Minimal Footer */}
            <div className="p-2 border-t border-gray-800 flex justify-between text-[10px] text-gray-600 font-mono tracking-widest shrink-0">
                <span>FRONT-01</span>
                <span>ONLINE</span>
            </div>

        </div>
    );
};

export default EntryPanel;
