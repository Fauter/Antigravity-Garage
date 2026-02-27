import React, { useEffect, useState, useMemo } from 'react';
import { Edit, Trash2, Search, Plus } from 'lucide-react';
import { api } from '../../services/api';

interface SubscriberListProps {
    onNewClick: () => void;
    onSelectSubscriber?: (sub: any) => void;
    subscribers: any[];
}

const SubscriberList: React.FC<SubscriberListProps> = ({ onNewClick, onSelectSubscriber, subscribers }) => {
    // Local state for cocheras lookup
    const [cocheras, setCocheras] = useState<any[]>([]);

    useEffect(() => {
        // Silent background sweep for debts when entering the list
        api.post('/abonos/evaluar-deudas', {})
            .then(res => console.log("Silent debt sweep completed:", res.data))
            .catch(err => console.error("Error running debt sweep:", err));

        // Fetch all cocheras to map plates correctly
        api.get('/cocheras')
            .then(res => setCocheras(res.data || []))
            .catch(err => console.error("Error loading cocheras list:", err));
    }, []);

    // Unique Client Aggregation Logic
    const uniqueSubscribers = useMemo(() => {
        const map = new Map();

        const rawList = subscribers && subscribers.length > 0 ? subscribers : [];

        rawList.forEach((sub: any) => {
            // Priority for ID: sub.clientId (from Abono) > sub.customerData.id > sub.id
            const customerId = sub.clientId || sub.customerData?.id || sub.id;

            if (!customerId) return;

            if (!map.has(customerId)) {
                // Initialize unique entry
                map.set(customerId, {
                    ...sub, // Keep base data
                    // Ensure robust Customer Data
                    aggregatedValues: {
                        name: sub.customerData?.firstName || sub.customerData?.name || sub.nombreApellido || 'Cliente Desconocido',
                        avatar: (sub.customerData?.firstName || sub.customerData?.name || sub.nombreApellido || '?').charAt(0).toUpperCase(),
                        isActive: sub.status === 'active' || sub.active === true
                    }
                });
            } else {
                // Merge logic if needed (e.g. if one sub is active, client is active)
                const existing = map.get(customerId);
                if (sub.status === 'active' || sub.active === true) {
                    existing.aggregatedValues.isActive = true;
                }
            }
        });

        return Array.from(map.values());
    }, [subscribers]);

    return (
        <div className="max-w-7xl mx-auto space-y-6 w-full p-6">

            {/* Toolbar */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-gray-900/50 p-4 rounded-xl border border-gray-800">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, patente o DNI..."
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-10 pr-4 py-2.5 text-gray-200 focus:ring-2 focus:ring-indigo-500/50 outline-none placeholder-gray-600 transition-all"
                    />
                </div>

                <button
                    onClick={onNewClick}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-900/40 hover:shadow-indigo-900/60 active:scale-95 whitespace-nowrap"
                >
                    <Plus className="w-4 h-4" />
                    Nuevo Suscriptor
                </button>
            </div>

            {/* Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-800/80 text-gray-400 text-xs uppercase tracking-wider">
                            <th className="p-4 font-medium border-b border-gray-700">Cliente</th>
                            <th className="p-4 font-medium border-b border-gray-700">Patentes</th>
                            <th className="p-4 font-medium border-b border-gray-700">Estado</th>
                            <th className="p-4 font-medium text-right border-b border-gray-700">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {uniqueSubscribers.map((sub: any) => {
                            const customerId = sub.clientId || sub.customerData?.id || sub.id;
                            const isActive = sub.aggregatedValues.isActive;

                            // --- COMIENZO DEL BLOQUE CORREGIDO ---
                            // Lookup Vehicles ONLY from Cocheras and ONLY if they are 'Ocupada'
                            const clientCocheras = cocheras.filter(c => c.clienteId === customerId && c.status === 'Ocupada');

                            // Extract unique plates EXCLUSIVELY from Physical Cocheras
                            const uniquePlates = new Set<string>();
                            clientCocheras.forEach(c => {
                                if (c.vehiculos && Array.isArray(c.vehiculos)) {
                                    c.vehiculos.forEach((v: any) => {
                                        // Strict filter: No "---", empty or null
                                        if (typeof v === 'string' && v.trim() !== '' && v !== '---') {
                                            uniquePlates.add(v);
                                        }
                                        else if (typeof v === 'object' && v.plate && v.plate !== '---' && v.plate.trim() !== '') {
                                            uniquePlates.add(v.plate);
                                        }
                                    });
                                }
                            });

                            // FALLBACKS FROM SUBSCRIPTIONS COMPLETELY REMOVED PER REQUIREMENT

                            const displayPlates = Array.from(uniquePlates);
                            // --- FIN DEL BLOQUE CORREGIDO ---

                            return (
                                <tr key={sub.id || sub._id}
                                    onClick={() => onSelectSubscriber && onSelectSubscriber(sub)}
                                    className="group hover:bg-gray-800/40 transition-colors cursor-pointer">
                                    <td className="p-4 font-medium text-white">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-indigo-900/50 flex items-center justify-center text-indigo-300 font-bold text-xs ring-1 ring-indigo-500/30">
                                                {sub.aggregatedValues.avatar}
                                            </div>
                                            {sub.aggregatedValues.name}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex gap-2 flex-wrap">
                                            {displayPlates.length > 0 ? (
                                                displayPlates.map((plate: any, i: number) => (
                                                    <span key={i} className="font-mono bg-gray-950 px-2 py-1 rounded text-emerald-400 border border-emerald-900/30 text-xs tracking-wider font-bold shadow-sm">
                                                        {plate}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-gray-600 text-xs italic">Sin vehículos</span>
                                            )}
                                        </div>
                                    </td>
                                    {/* Removed 'Vehículo' and 'Días Restantes' columns */}
                                    <td className="p-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${isActive
                                            ? 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50'
                                            : 'bg-red-900/20 text-red-400 border-red-900/50'
                                            }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isActive ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                                            {isActive ? 'Activo' : 'Inactivo'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button className="p-2 hover:bg-gray-800 text-gray-500 hover:text-indigo-400 rounded-lg transition-colors border border-transparent hover:border-gray-700" title="Editar">
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button className="p-2 hover:bg-gray-800 text-gray-500 hover:text-red-400 rounded-lg transition-colors border border-transparent hover:border-gray-700" title="Eliminar">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 text-center">
                <button className="text-sm text-gray-500 hover:text-gray-300 transition-colors border-b border-dashed border-gray-600 hover:border-gray-400 pb-0.5">
                    Cargar más suscriptores
                </button>
            </div>
        </div >
    );
};

export default SubscriberList;
