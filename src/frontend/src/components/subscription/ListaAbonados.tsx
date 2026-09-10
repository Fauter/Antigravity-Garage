import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, Plus, ArrowUp, ArrowDown, AlertCircle, RefreshCw, User as UserIcon } from 'lucide-react';
import { api } from '../../services/api';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';

// --- TypeScript Interfaces ---

interface Debt {
    id: string;
    subscriptionId: string;
    customerId: string;
    amount: number | string;
    remaining_amount?: number | string | null;
    amount_paid?: number | string | null;
    status: string;
    type?: string;
    dueDate: string;
}

interface AggregatedValues {
    name: string;
    dni: string;
    avatar: string;
    isActive: boolean;
    balance: number;
    plates: string[];
    email: string;
    phone: string;
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
    isLoading?: boolean;
}

const SubscriberList: React.FC<SubscriberListProps> = ({ onNewClick, onSelectSubscriber, subscribers, isLoading: isParentLoading = false }) => {
    const { user } = useAuth();
    const garageId = user?.garage_id || (user as any)?.garageId || 'test';

    const { data: hydrationData, isLoading: isHydrationLoading, isError, error, refetch: loadData } = useQuery({
        queryKey: ['abonos-hydration', garageId],
        queryFn: async () => {
            const res = await api.get('/abonos/hydration');
            return res.data;
        },
        staleTime: 60000,
        refetchOnWindowFocus: false,
    });

    const cocheras = hydrationData?.cocheras || [];
    const subscriptions = hydrationData?.subscriptions || [];
    const realVehicles = hydrationData?.vehicles || [];
    const debts = hydrationData?.debts || [];
    const hydrationStatus = isError ? 'error' : (isHydrationLoading ? 'loading' : 'ready');
    const errorMessage = isError ? (error as any)?.response?.data?.error || (error as any)?.message || "Error al cargar datos" : null;
    const isLoading = isParentLoading || isHydrationLoading;

    const [searchTerm, setSearchTerm] = useState('');
    const [balanceSort, setBalanceSort] = useState<'default' | 'desc' | 'asc'>('default');

    // --- Unique Client Aggregation Logic ---
    const uniqueSubscribers = useMemo((): AggregatedSubscriber[] => {
        const map = new Map<string, AggregatedSubscriber>();
        const rawList = subscriptions && subscriptions.length > 0 ? subscriptions : [];
        
        // Build O(1) lookup map for customers using hydration data
        const customersById = new Map<string, any>();
        const customersData = hydrationData?.customers || [];
        customersData.forEach((c: any) => {
            const cid = c.id || c._id;
            if (cid) customersById.set(cid, c);
        });

        let resolvedLinks = 0;
        let unresolvedLinks = 0;

        rawList.forEach((sub: any) => {
            // RULE: Identity must be customer.id, NEVER subscription.id
            const customerId = sub.customerId || sub.customer_id || sub.clientId || sub.customerData?.id;
            if (!customerId) return;
            
            const realCustomer = customersById.get(customerId) || sub.customerData;
            
            if (realCustomer) {
                resolvedLinks++;
            } else {
                unresolvedLinks++;
            }

            if (!map.has(customerId)) {
                // Read from real Customer object, not from raw subscription fallback
                const name = realCustomer?.firstName || realCustomer?.name || sub.nombreApellido || 'Cliente Desconocido';
                const rawDni = realCustomer?.dni || sub.dni || '';
                const email = realCustomer?.email || sub.email || '';
                const phone = realCustomer?.phone || sub.phone || '';

                // --- Plate Mapping ---
                const clientCocheras = cocheras.filter(c => (c.clienteId === customerId || c.cliente_id === customerId) && c.status === 'Ocupada');
                const uniquePlates = new Set<string>();
                clientCocheras.forEach(c => {
                    if (c.vehiculos && Array.isArray(c.vehiculos)) {
                        c.vehiculos.forEach((v: any) => {
                            if (typeof v === 'string' && v.trim() !== '' && v !== '---') uniquePlates.add(v);
                            else if (typeof v === 'object' && v.plate && v.plate !== '---' && v.plate.trim() !== '') uniquePlates.add(v.plate);
                        });
                    }
                });
                const plates = Array.from(uniquePlates);

                // --- REGLA ABSOLUTA DE NEGOCIO (Espejo de DetailView) ---
                const now = new Date();
                const expiredClientSubIds = new Set<string>();

                clientCocheras.forEach(cochera => {
                    const cleanCocheraPlates = (cochera.vehiculos || []).map((v: any) => typeof v === 'string' ? v.trim() : v.plate?.trim());
                    const cocheraVehicles = realVehicles.filter(v => v.plate && cleanCocheraPlates.includes(v.plate.trim()));
                    const cocheraVehicleIds = cocheraVehicles.map(v => v.id);

                    const associatedSub = subscriptions.find(s => {
                        if (s.active === false && s.status !== 'active') return false;
                        const subClientId = s.customerId || s.customer_id || s.clientId;
                        const cocheraClienteId = cochera.clienteId || cochera.cliente_id;
                        
                        // Priority 1: Exact Cochera ID match (modern model)
                        if (s.cocheraId && cochera.id && s.cocheraId === cochera.id) return true;
                        
                        // Priority 2: Spot Number Match
                        if (s.spotNumber && cochera.numero && String(s.spotNumber) === String(cochera.numero)) {
                            if (subClientId === cocheraClienteId) return true;
                        }
                        
                        // Priority 3: Vehicle Match
                        const subVehicleId = s.vehicleId || s.vehicle_id;
                        const subPlate = s.vehicleData?.plate || s.plate;
                        
                        if (subVehicleId && cocheraVehicleIds.includes(subVehicleId)) return true;
                        if (subPlate && cleanCocheraPlates.includes(subPlate.trim())) return true;
                        
                        // Fallback relajado: Si coinciden cliente y tipo, lo tomamos como válido
                        if (subClientId === cocheraClienteId) {
                            const norm = (t: string) => t ? t.toLowerCase().replace(/fija/g, 'fija').replace(/movil/g, 'movil').replace(/exclusiva/g, 'exclusiva') : '';
                            if (norm(s.type || s.subscriptionType) === norm(cochera.tipo)) return true;
                        }
                        return false;
                    });

                    if (associatedSub) {
                        let isExpired = false;
                        // Soporte nativo para flat DB rows y populaciones
                        const rawEndDate = associatedSub.endDate || associatedSub.end_date;
                        const rawStartDate = associatedSub.startDate || associatedSub.start_date;

                        if (rawEndDate) {
                            isExpired = now > new Date(rawEndDate);
                        } else if (rawStartDate) {
                            const sDate = new Date(rawStartDate);
                            isExpired = now > new Date(sDate.getFullYear(), sDate.getMonth() + 1, 0, 23, 59, 59, 999);
                        }
                        
                        if (isExpired) {
                            expiredClientSubIds.add(associatedSub.id || associatedSub._id);
                        }
                    }
                });

                const isEmptyClient = clientCocheras.length === 0;

                const allCustomerDebts = debts.filter((d: any) => {
                    const isClientMatch = (d.customerId === customerId || d.customer_id === customerId);
                    if (!isClientMatch || d.status !== 'PENDING') return false;

                    if (d.type === 'CANON') {
                        const subId = d.subscriptionId || d.subscription_id;
                        return subId && expiredClientSubIds.has(subId);
                    }
                    return true; // MANUAL_MIGRATION pasa siempre
                });

                const visibleDebts = isEmptyClient 
                    ? allCustomerDebts.filter((d: any) => d.type !== 'CANON') 
                    : allCustomerDebts;

                const balance = visibleDebts.reduce((sum, d) => {
                    const remRaw = d.remaining_amount;
                    const debtValue = (remRaw !== undefined && remRaw !== null && !isNaN(Number(remRaw))) 
                        ? Number(remRaw) 
                        : Number(d.amount || 0);
                    return sum + debtValue;
                }, 0);

                // --- Status Resolutivo Exacto ---
                let isClientActive = false;
                if (!isEmptyClient) {
                    isClientActive = true;
                    // Opcionalmente se puede cruzar con if the customer has an active subscription
                }

                map.set(customerId, {
                    id: sub.id,
                    clientId: customerId,
                    customerData: realCustomer,
                    nombreApellido: name,
                    dni: rawDni,
                    active: isClientActive,
                    aggregatedValues: {
                        name,
                        dni: rawDni,
                        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${name}`,
                        isActive: isClientActive,
                        balance,
                        plates,
                        email,
                        phone
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

        if (import.meta.env.DEV) {
            console.log('[ABONOS HYDRATION]');
            console.log(`subscriptions: ${rawList.length}`);
            console.log(`customers: ${customersData.length}`);
            console.log(`resolved: ${resolvedLinks}`);
            console.log(`unresolved: ${unresolvedLinks}`);
        }

        return all;
    }, [cocheras, debts, subscriptions, realVehicles, hydrationData?.customers]);

    // --- Reactive Search Filtering ---
    const filteredSubscribers = useMemo((): AggregatedSubscriber[] => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return uniqueSubscribers;

        return uniqueSubscribers.filter(sub => {
            const { name, dni, plates, email, phone } = sub.aggregatedValues;
            if (name.toLowerCase().includes(term)) return true;
            if (dni && dni.toLowerCase().includes(term)) return true;
            if (email && email.toLowerCase().includes(term)) return true;
            if (phone && phone.toLowerCase().includes(term)) return true;
            if (plates.some(p => p.toLowerCase().includes(term))) return true;
            return false;
        });
    }, [uniqueSubscribers, searchTerm]);

    const sortedAndFilteredSubscribers = useMemo(() => {
        if (balanceSort === 'default') return filteredSubscribers;
        
        return [...filteredSubscribers].sort((a, b) => {
            const aHas = a.aggregatedValues.plates.length > 0 ? 0 : 1;
            const bHas = b.aggregatedValues.plates.length > 0 ? 0 : 1;
            if (aHas !== bHas) return aHas - bHas;

            const balA = a.aggregatedValues.balance;
            const balB = b.aggregatedValues.balance;
            
            if (balA !== balB) {
                if (balanceSort === 'desc') {
                    return balB - balA;
                } else {
                    return balA - balB;
                }
            }

            return a.aggregatedValues.name.localeCompare(b.aggregatedValues.name, 'es');
        });
    }, [filteredSubscribers, balanceSort]);

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
                    Nuevo Cliente
                </button>
            </div>

            {/* Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-800/60 text-gray-400 text-xs uppercase tracking-wider">
                            <th className="py-4 px-4 font-medium border-b border-gray-700">Cliente</th>
                            <th className="py-4 px-4 font-medium border-b border-gray-700">Contacto</th>
                            <th className="py-4 px-4 font-medium border-b border-gray-700">Patentes</th>
                            <th className="py-4 px-4 font-medium border-b border-gray-700">Estado</th>
                            <th 
                                className="py-4 px-4 font-medium border-b border-gray-700 cursor-pointer select-none"
                                onClick={() => {
                                    setBalanceSort(prev => {
                                        if (prev === 'default') return 'desc';
                                        if (prev === 'desc') return 'asc';
                                        return 'default';
                                    });
                                }}
                            >
                                <div className="flex items-center justify-end gap-1">
                                    Balance
                                    {balanceSort === 'desc' && <ArrowDown className="w-4 h-4 text-gray-400" />}
                                    {balanceSort === 'asc' && <ArrowUp className="w-4 h-4 text-gray-400" />}
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                        {hydrationStatus === 'error' ? (
                            /* ─── 1. ERROR STATE ─── */
                            <tr>
                                <td colSpan={5} className="py-12 px-4 text-center">
                                    <div className="flex flex-col items-center justify-center gap-3 text-red-400 max-w-sm mx-auto">
                                        <AlertCircle className="w-8 h-8 text-red-500/80" />
                                        <p className="text-sm font-medium">{errorMessage || "Error al sincronizar datos de abonados."}</p>
                                        <button
                                            onClick={loadData}
                                            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-bold uppercase transition-all shadow-sm"
                                        >
                                            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ) : (hydrationStatus === 'loading' || isLoading) ? (
                            /* ─── 2. SKELETON LOADING STATE ─── */
                            Array.from({ length: 6 }).map((_, idx) => (
                                <tr key={`skeleton-${idx}`} className="animate-pulse">
                                    <td className="py-5 px-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-gray-800 shrink-0" />
                                            <div className="flex flex-col gap-1.5 flex-1">
                                                <div className="h-4 bg-gray-800 rounded w-28" />
                                                <div className="h-3 bg-gray-800/60 rounded w-16" />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-5 px-4">
                                        <div className="flex flex-col gap-1.5">
                                            <div className="h-3.5 bg-gray-800 rounded w-24" />
                                            <div className="h-2.5 bg-gray-800/60 rounded w-32" />
                                        </div>
                                    </td>
                                    <td className="py-5 px-4">
                                        <div className="flex gap-2">
                                            <div className="h-6 bg-gray-800 rounded w-16" />
                                        </div>
                                    </td>
                                    <td className="py-5 px-4">
                                        <div className="h-5 bg-gray-800 rounded-full w-16" />
                                    </td>
                                    <td className="py-5 px-4 text-right">
                                        <div className="h-5 bg-gray-800 rounded w-16 ml-auto" />
                                    </td>
                                </tr>
                            ))
                        ) : sortedAndFilteredSubscribers.length === 0 ? (
                            /* ─── 3. EMPTY STATE ─── */
                            <tr>
                                <td colSpan={5} className="py-12 px-4 text-center text-gray-500 text-sm">
                                    {searchTerm ? 'No se encontraron abonados que coincidan con la búsqueda.' : 'No hay abonados registrados.'}
                                </td>
                            </tr>
                        ) : (
                            /* ─── 4. READY STATE (Render Fully Hydrated Data) ─── */
                            sortedAndFilteredSubscribers.map((sub) => {
                                const { name, dni, avatar, balance, plates, email, phone } = sub.aggregatedValues;
                                const hasNoVehicles = plates.length === 0;
                                const isActive = hasNoVehicles ? false : sub.aggregatedValues.isActive;

                                return (
                                    <tr key={sub.id || sub._id}
                                        onClick={() => onSelectSubscriber && onSelectSubscriber(sub)}
                                        className="group hover:bg-gray-800/30 transition-colors duration-200 cursor-pointer">
                                        <td className="py-5 px-4 font-medium text-white">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-emerald-950/50 flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-emerald-900/40">
                                                    <UserIcon className="w-[14px] h-[14px] text-emerald-500/80" aria-hidden="true" />
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
                                            <div className="flex flex-col">
                                                {phone ? (
                                                    <span className="text-gray-200 text-sm">{phone}</span>
                                                ) : (
                                                    <span className="text-gray-600 text-sm italic">Sin teléfono</span>
                                                )}
                                                {email && (
                                                    <span className="text-gray-500 text-xs">{email}</span>
                                                )}
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
                                            ) : hasNoVehicles ? (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-800/40 text-gray-500 border border-gray-700/40">
                                                    -
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                    AL DÍA
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
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
