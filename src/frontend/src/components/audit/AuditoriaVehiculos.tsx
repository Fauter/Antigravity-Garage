import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

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
        <div className="flex flex-col h-full bg-gray-950 p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-emerald-400 flex items-center gap-2">
                    🛡️ Auditoría de Vehículos
                </h2>
                <span className="text-gray-500 text-sm">
                    {stays.length} vehículos en playa
                </span>
            </div>

            <div className="flex-1 overflow-auto bg-gray-900 rounded-xl border border-gray-800 shadow-2xl relative">
                <table className="w-full text-left text-sm text-gray-400">
                    <thead className="bg-gray-800 text-gray-200 uppercase text-xs sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 font-bold tracking-wider">Patente</th>
                            <th className="px-6 py-4 font-bold tracking-wider">Ingreso</th>
                            <th className="px-6 py-4 font-bold tracking-wider">Tiempo</th>
                            <th className="px-6 py-4 font-bold tracking-wider">Tipo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {loading && stays.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-10 text-center animate-pulse">
                                    Cargando auditoría...
                                </td>
                            </tr>
                        ) : stays.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-10 text-center text-gray-600">
                                    No hay vehículos en la playa.
                                </td>
                            </tr>
                        ) : (
                            stays.map((stay) => (
                                <tr key={stay.id} className="hover:bg-gray-800/50 transition-colors">
                                    <td className="px-6 py-4 font-mono font-bold text-white text-lg">
                                        {stay.plate}
                                    </td>
                                    <td className="px-6 py-4">
                                        {new Date(stay.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="px-6 py-4 font-medium text-emerald-400">
                                        {calculateDuration(stay.entryTime)}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="px-2 py-1 bg-gray-800 rounded text-xs">
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
    );
};

export default AuditoriaVehiculos;
