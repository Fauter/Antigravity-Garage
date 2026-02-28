import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { ShieldCheck } from 'lucide-react';

interface Stay {
    id: string;
    plate: string;
    entryTime: string;
    vehicleType?: string;
}

const AuditoriaVehiculos: React.FC = () => {
    // 1. Get Garage ID from Local Storage Configuration
    const configStr = localStorage.getItem('ag_terminal_config');
    let garageId = '';
    if (configStr) {
        try {
            const config = JSON.parse(configStr);
            garageId = config.garage_id;
        } catch (e) {
            console.error('Error parsing config', e);
        }
    }

    const { data: stays = [], isLoading: loading } = useQuery({
        queryKey: ['activeStays', garageId],
        queryFn: async () => {
            if (!garageId) return [];
            const res = await api.get<Stay[]>('/estadias', {
                params: { garageId }
            });
            // Filter strictly by no exitTime just in case backend returns all
            // Note: Backend /estadias should only return active, but double check
            return res.data.filter((s: any) => !s.exitTime && s.active !== false);
        },
        refetchInterval: 5000, // Real-time feel
        enabled: !!garageId
    });

    const calculateDuration = (entryTime: string) => {
        const start = new Date(entryTime);
        const now = new Date();
        const diffMs = now.getTime() - start.getTime();
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${diffHrs}h ${diffMins}m`;
    };

    return (
        <div className="p-6 h-full flex flex-col bg-slate-950 text-gray-200 font-sans">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
                    <ShieldCheck className="w-8 h-8 text-emerald-500" />
                    Auditoría de Vehículos
                </h2>
                <div className="bg-emerald-900/20 border border-emerald-500/30 px-5 py-3 rounded-xl flex items-center gap-3">
                    <div className="bg-emerald-500/20 p-2 rounded-lg text-emerald-500">
                        <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                        <span className="block text-emerald-500/80 text-xs font-bold uppercase tracking-widest">En Playa</span>
                        <span className="text-2xl font-black text-white tracking-tighter">{stays.length}</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col">
                <div className="p-4 border-b border-slate-800 bg-slate-900/50">
                    <h3 className="text-lg font-bold text-slate-300 flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5" /> Vehículos Activos
                    </h3>
                </div>
                <div className="overflow-auto flex-1">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-950 text-slate-400 uppercase text-xs font-bold sticky top-0 z-10">
                            <tr>
                                <th className="p-4 border-b border-slate-800">Patente</th>
                                <th className="p-4 border-b border-slate-800">Ingreso</th>
                                <th className="p-4 border-b border-slate-800">Tiempo</th>
                                <th className="p-4 border-b border-slate-800">Tipo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {loading && stays.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-slate-500 animate-pulse">
                                        Cargando auditoría...
                                    </td>
                                </tr>
                            ) : stays.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-slate-500">
                                        No hay vehículos en la playa.
                                    </td>
                                </tr>
                            ) : (
                                stays.map((stay) => (
                                    <tr key={stay.id} className="hover:bg-slate-800/50 transition-colors">
                                        <td className="p-4 font-mono font-bold text-white text-lg">
                                            {stay.plate}
                                        </td>
                                        <td className="p-4 font-mono text-slate-400">
                                            {new Date(stay.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                        <td className="p-4 font-mono font-medium text-emerald-400">
                                            {calculateDuration(stay.entryTime)}
                                        </td>
                                        <td className="p-4">
                                            <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-slate-800 border border-slate-700 text-slate-300">
                                                {stay.vehicleType || 'Auto'}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AuditoriaVehiculos;
