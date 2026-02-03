import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { toast } from 'sonner';
import { DollarSign, Wallet, CreditCard, Clock, Calendar, Check, Save } from 'lucide-react';

interface Tariff {
    id: string;
    nombre: string;
    tipo: 'hora' | 'turno' | 'abono' | 'estadia';
}

interface VehicleType {
    _id: string;
    nombre: string;
}

const PriceMatrix: React.FC = () => {
    const [tarifas, setTarifas] = useState<Tariff[]>([]);
    const [vehiculos, setVehiculos] = useState<VehicleType[]>([]);
    const [precios, setPrecios] = useState<any>({}); // { [vehicleName]: { [tariffName]: price } }
    const [params, setParams] = useState({
        recargoDia11: 10,
        recargoDia22: 20,
    }); // Only recargos needed here

    const [loading, setLoading] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'otros'>('efectivo');
    const [editing, setEditing] = useState<{ v: string, t: string } | null>(null);

    useEffect(() => {
        loadData();
    }, [paymentMethod]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [resTarifas, resVehiculos, resPrecios, resParams] = await Promise.all([
                api.get('/tarifas'),
                api.get('/tipos-vehiculo'),
                api.get(`/precios?metodo=${paymentMethod}`),
                api.get('/parametros')
            ]);
            setTarifas(resTarifas.data);
            setVehiculos(resVehiculos.data);
            setPrecios(resPrecios.data);
            setParams(prev => ({ ...prev, recargoDia11: resParams.data.recargoDia11, recargoDia22: resParams.data.recargoDia22 }));
        } catch (e) {
            console.error(e);
            toast.error('Error cargando datos');
        } finally {
            setLoading(false);
        }
    };

    const handlePriceChange = async (vehicleName: string, tariffName: string, value: string) => {
        const numValue = parseInt(value) || 0;
        const currentVehiclePrices = precios[vehicleName] || {};
        const newVehiclePrices = { ...currentVehiclePrices, [tariffName]: numValue };

        // Optimistic update
        setPrecios((prev: any) => ({
            ...prev,
            [vehicleName]: newVehiclePrices
        }));

        try {
            await api.put(`/precios/${vehicleName}?metodo=${paymentMethod}`, newVehiclePrices);
        } catch (e) {
            toast.error('Error al guardar precio');
        }
    };

    const handleParamSave = async () => {
        try {
            await api.post('/parametros', params);
            toast.success('Recargos actualizados');
        } catch (e) {
            toast.error('Error guardando recargos');
        }
    };

    const renderTable = (title: string, type: string, tariffs: Tariff[], icon: React.ReactNode, colorClass: string) => {
        if (tariffs.length === 0) return null;

        return (
            <div className="space-y-4">
                <h4 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${colorClass}`}>
                    {icon} {title}
                </h4>
                <div className="overflow-x-auto border border-gray-800 rounded-xl shadow-lg">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-950/80 text-gray-400 text-xs uppercase tracking-wider">
                                <th className="p-3 border-b border-gray-800 font-bold sticky left-0 bg-gray-950 z-10 w-48">CONCEPTO</th>
                                {vehiculos.map(v => (
                                    <th key={v._id} className="p-3 border-b border-gray-800 border-l border-gray-800/50 text-center min-w-[100px]">
                                        {v.nombre}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/50">
                            {tariffs.map(t => (
                                <tr key={t.id} className="group hover:bg-white/5 transition-colors">
                                    <td className="p-3 font-bold text-gray-300 text-sm sticky left-0 bg-[#0a0a0a] group-hover:bg-[#111] transition-colors border-r border-gray-800 z-10">
                                        {t.nombre}
                                    </td>
                                    {vehiculos.map(v => {
                                        const vName = v.nombre;
                                        // Dynamic key matching with normalization (NFD)
                                        const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                                        const vehiclePrices = precios[vName] || {};

                                        let price = vehiclePrices[t.nombre];
                                        if (price === undefined) {
                                            const targetNorm = normalize(t.nombre);
                                            const foundKey = Object.keys(vehiclePrices).find(k => normalize(k) === targetNorm);
                                            if (foundKey) price = vehiclePrices[foundKey];
                                        }
                                        const isEditing = editing?.v === vName && editing?.t === t.nombre;

                                        return (
                                            <td key={`${v._id}-${t.id}`}
                                                className="p-0 border-l border-gray-800/50 relative"
                                                onClick={() => setEditing({ v: vName, t: t.nombre })}
                                            >
                                                {isEditing ? (
                                                    <input
                                                        autoFocus
                                                        className="w-full h-full bg-emerald-900/20 text-emerald-400 font-bold text-center outline-none py-3"
                                                        defaultValue={price || ''}
                                                        onBlur={(e) => {
                                                            handlePriceChange(vName, t.nombre, e.target.value);
                                                            setEditing(null);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                handlePriceChange(vName, t.nombre, (e.target as HTMLInputElement).value);
                                                                setEditing(null);
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full py-3 text-center cursor-pointer select-none text-gray-400 font-mono group-hover:text-white transition-colors">
                                                        {price ? `$${price.toLocaleString()}` : '-'}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const tariffsByType = {
        hora: tarifas.filter(t => t.tipo === 'hora'),
        turno: tarifas.filter(t => t.tipo === 'turno'),
        abono: tarifas.filter(t => t.tipo === 'abono')
    };

    return (
        <div className="space-y-8 pb-12">
            {/* Header / Controls */}
            <div className="flex justify-between items-center bg-gray-900/50 p-4 rounded-xl border border-gray-800 backdrop-blur-sm sticky top-0 z-20">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <DollarSign className="w-6 h-6 text-emerald-500" /> Matriz de Precios
                </h3>

                {/* Method Toggle */}
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-1 flex">
                    <button
                        onClick={() => setPaymentMethod('efectivo')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-xs uppercase tracking-wider transition-all ${paymentMethod === 'efectivo' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <Wallet className="w-4 h-4" /> Efectivo
                    </button>
                    <button
                        onClick={() => setPaymentMethod('otros')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-xs uppercase tracking-wider transition-all ${paymentMethod === 'otros' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <CreditCard className="w-4 h-4" /> Otros
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-20 text-gray-500 animate-pulse">Cargando matriz...</div>
            ) : (
                <div className="space-y-10">
                    {renderTable('Por Hora', 'hora', tariffsByType.hora, <Clock className="w-4 h-4" />, 'text-emerald-400')}
                    {renderTable('Abonos Mensuales', 'abono', tariffsByType.abono, <Check className="w-4 h-4" />, 'text-purple-400')}
                    {renderTable('Por Anticipado', 'turno', tariffsByType.turno, <Calendar className="w-4 h-4" />, 'text-blue-400')}

                    {/* Surcharges Section (Moved here) */}
                    <div className="border-t border-gray-800 pt-8 mt-8">
                        <div className="flex justify-between items-center mb-6">
                            <h4 className="text-emerald-400 font-bold uppercase tracking-wider text-sm flex items-center gap-2">
                                <DollarSign className="w-4 h-4" /> Recargos por Mora (Abonos)
                            </h4>
                            <button onClick={handleParamSave} className="text-xs bg-gray-800 hover:bg-emerald-900 text-emerald-400 px-3 py-1.5 rounded flex items-center gap-1 transition-colors">
                                <Save className="w-3 h-3" /> Guardar Recargos
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-6 bg-gray-900/30 p-6 rounded-xl border border-gray-800">
                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-bold mb-2">Recargo Día 11 (%)</label>
                                <div className="relative">
                                    <input type="number" className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-white text-lg font-mono focus:border-emerald-500 outline-none transition-colors"
                                        value={params.recargoDia11} onChange={e => setParams({ ...params, recargoDia11: Number(e.target.value) })} />
                                    <span className="absolute right-4 top-3.5 text-gray-600 font-bold">%</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-bold mb-2">Recargo Día 22 (%)</label>
                                <div className="relative">
                                    <input type="number" className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-white text-lg font-mono focus:border-emerald-500 outline-none transition-colors"
                                        value={params.recargoDia22} onChange={e => setParams({ ...params, recargoDia22: Number(e.target.value) })} />
                                    <span className="absolute right-4 top-3.5 text-gray-600 font-bold">%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PriceMatrix;
