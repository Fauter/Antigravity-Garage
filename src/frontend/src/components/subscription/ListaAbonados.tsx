import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, Plus } from 'lucide-react';
import { api } from '../../services/api';

// --- TypeScript Interfaces ---

interface Debt {
    id: string;
    subscriptionId: string;
    customerId: string;
    amount: number | string;
    status: string;
    dueDate: string;
}

interface AggregatedValues {
    name: string;
    dni: string;
    avatar: string;
    isActive: boolean;
    balance: number;
    plates: string[];
}

interface AggregatedSubscriber {
    id: string;
    _id?: string;
    clientId?: string;
    customerData?: {
        id?: string;
        firstName?: string;
        name?: string;
        dni?: string;
        email?: string;
        phone?: string;
        [key: string]: any;
    };
    nombreApellido?: string;
    dni?: string;
    status?: string;
    active?: boolean;
    aggregatedValues: AggregatedValues;
    [key: string]: any;
}

interface SubscriberListProps {
    onNewClick: () => void;
    onSelectSubscriber?: (sub: any) => void;
    subscribers: any[];
}

const SubscriberList: React.FC<SubscriberListProps> = ({ onNewClick, onSelectSubscriber, subscribers }) => {
    // Local state
    const [cocheras, setCocheras] = useState<any[]>([]);
    const [debts, setDebts] = useState<Debt[]>([]);
    const [debtsLoaded, setDebtsLoaded] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    // --- Initial Effects: Debt sweep + Cocheras fetch ---
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

    // --- Extract unique customer IDs from subscribers ---
    const uniqueCustomerIds = useMemo(() => {
        const ids = new Set<string>();
        (subscribers || []).forEach((sub: any) => {
            const id = sub.clientId || sub.customerData?.id || sub.id;
            if (id) ids.add(id);
        });
        return Array.from(ids);
    }, [subscribers]);

    // --- Batch fetch debts for all unique customers (N+1 safe with allSettled) ---
    const fetchAllDebts = useCallback(async (customerIds: string[]) => {
        if (customerIds.length === 0) {
            setDebts([]);
            setDebtsLoaded(true);
            return;
        }

        try {
            const results = await Promise.allSettled(
                customerIds.map(id => api.get(`/deudas/${id}`).catch(() => ({ data: [] })))
            );

            const allDebts: Debt[] = [];
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    const data = result.value?.data || [];
                    allDebts.push(...data);
                }
            });

            setDebts(allDebts);
        } catch (err) {
            console.error("Error fetching debts batch:", err);
            setDebts([]);
        } finally {
            setDebtsLoaded(true);
        }
    }, []);

    useEffect(() => {
        if (uniqueCustomerIds.length > 0 && !debtsLoaded) {
            fetchAllDebts(uniqueCustomerIds);
        }
    }, [uniqueCustomerIds, debtsLoaded, fetchAllDebts]);

    // --- Unique Client Aggregation Logic ---
    const uniqueSubscribers = useMemo((): AggregatedSubscriber[] => {
        const map = new Map<string, AggregatedSubscriber>();
        const rawList = subscribers && subscribers.length > 0 ? subscribers : [];

        rawList.forEach((sub: any) => {
            const customerId = sub.clientId || sub.customerData?.id || sub.id;
            if (!customerId) return;

            if (!map.has(customerId)) {
                const name = sub.customerData?.firstName || sub.customerData?.name || sub.nombreApellido || 'Cliente Desconocido';
                const rawDni = sub.customerData?.dni || sub.dni || '';

                // --- Balance Calculation ---
                const customerDebts = debts.filter(d => d.customerId === customerId && d.status === 'PENDING');
                const balance = customerDebts.reduce((sum, d) => sum + Number(d.amount || 0), 0);

                // --- Plate Mapping from Cocheras ---
                const clientCocheras = cocheras.filter(c => c.clienteId === customerId && c.status === 'Ocupada');
                const uniquePlates = new Set<string>();
                clientCocheras.forEach(c => {
                    if (c.vehiculos && Array.isArray(c.vehiculos)) {
                        c.vehiculos.forEach((v: any) => {
                            if (typeof v === 'string' && v.trim() !== '' && v !== '---') {
                                uniquePlates.add(v);
                            } else if (typeof v === 'object' && v.plate && v.plate !== '---' && v.plate.trim() !== '') {
                                uniquePlates.add(v.plate);
                            }
                        });
                    }
                });

                const plates = Array.from(uniquePlates);

                map.set(customerId, {
                    ...sub,
                    aggregatedValues: {
                        name,
                        dni: rawDni,
                        avatar: (name || '?').charAt(0).toUpperCase(),
                        isActive: sub.status === 'active' || sub.active === true,
                        balance,
                        plates,
                    }
                });
            } else {
                const existing = map.get(customerId)!;
                if (sub.status === 'active' || sub.active === true) {
                    existing.aggregatedValues.isActive = true;
                }
            }
        });

        // --- Sorting: Vehicles first, then Sin vehículos. Alphabetical within each group ---
        const all = Array.from(map.values());
        all.sort((a, b) => {
            const aHas = a.aggregatedValues.plates.length > 0 ? 0 : 1;
            const bHas = b.aggregatedValues.plates.length > 0 ? 0 : 1;
            if (aHas !== bHas) return aHas - bHas;
            return a.aggregatedValues.name.localeCompare(b.aggregatedValues.name, 'es');
        });

        return all;
    }, [subscribers, cocheras, debts]);

    // --- Reactive Search Filtering ---
    const filteredSubscribers = useMemo((): AggregatedSubscriber[] => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return uniqueSubscribers;

        return uniqueSubscribers.filter(sub => {
            const { name, dni, plates } = sub.aggregatedValues;
            if (name.toLowerCase().includes(term)) return true;
            if (dni && dni.toLowerCase().includes(term)) return true;
            if (plates.some(p => p.toLowerCase().includes(term))) return true;
            return false;
        });
    }, [uniqueSubscribers, searchTerm]);

    return (
        <div className="max-w-7xl mx-auto space-y-6 w-full p-6">

            {/* Toolbar */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-gray-900/50 p-4 rounded-xl border border-gray-800">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, patente o DNI..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
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
                        <tr className="bg-gray-800/60 text-gray-400 text-xs uppercase tracking-wider">
                            <th className="py-4 px-4 font-medium border-b border-gray-700">Cliente</th>
                            <th className="py-4 px-4 font-medium border-b border-gray-700">Patentes</th>
                            <th className="py-4 px-4 font-medium border-b border-gray-700">Estado</th>
                            <th className="py-4 px-4 font-medium text-right border-b border-gray-700">Balance</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                        {filteredSubscribers.map((sub) => {
                            const isActive = sub.aggregatedValues.isActive;
                            const { name, dni, avatar, balance, plates } = sub.aggregatedValues;

                            return (
                                <tr key={sub.id || sub._id}
                                    onClick={() => onSelectSubscriber && onSelectSubscriber(sub)}
                                    className="group hover:bg-gray-800/30 transition-colors duration-200 cursor-pointer">
                                    <td className="py-5 px-4 font-medium text-white">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-indigo-900/50 flex items-center justify-center text-indigo-300 font-bold text-xs ring-1 ring-indigo-500/30">
                                                {avatar}
                                            </div>
                                            <div className="flex flex-col">
                                                <span>{name}</span>
                                                {dni && (
                                                    <span className="text-gray-500 text-xs">DNI {dni}</span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-5 px-4">
                                        <div className="flex gap-2 flex-wrap">
                                            {plates.length > 0 ? (
                                                plates.map((plate, i) => (
                                                    <span key={i} className="font-mono bg-gray-950 px-2 py-1 rounded text-emerald-400 border border-emerald-900/30 text-xs tracking-wider font-bold shadow-sm">
                                                        {plate}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-gray-600 text-xs italic">Sin vehículos</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-5 px-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${isActive
                                            ? 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50'
                                            : 'bg-red-900/20 text-red-400 border-red-900/50'
                                            }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isActive ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                                            {isActive ? 'Activo' : 'Inactivo'}
                                        </span>
                                    </td>
                                    <td className="py-5 px-4 text-right">
                                        {balance > 0 ? (
                                            <span className="text-red-400 font-semibold font-mono">
                                                ${balance.toLocaleString('es-AR')}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                AL DÍA
                                            </span>
                                        )}
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
