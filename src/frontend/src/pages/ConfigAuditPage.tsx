import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import {
    ShieldCheck,
    Car,
    Bike,
    Truck,
    Clock,
    Zap,
    Database,
    Server,
    Cloud,
    Lock
} from 'lucide-react';
import { toast } from 'sonner';

interface VehicleType {
    id: string;
    name: string;
    icon?: string;
}

interface Tariff {
    id: string;
    name: string; // Título principal (e.g. "Hora", "Estadia")
    type: string; // Subtítulo (e.g. "Auto", "General") - Check data
    priority: number;
}

// Price Matrix: { "Auto": { "Hora": 1000 }, "Moto": { ... } }
type PriceMatrix = Record<string, Record<string, number>>;

const ConfigAuditPage: React.FC = () => {
    const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
    const [tariffs, setTariffs] = useState<Tariff[]>([]);
    const [prices, setPrices] = useState<PriceMatrix>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [vRes, tRes, pRes] = await Promise.all([
                api.get('/tipos-vehiculo'),
                api.get('/tarifas'),
                api.get('/precios')
            ]);
            setVehicleTypes(vRes.data);
            setTariffs(tRes.data);
            setPrices(pRes.data);
        } catch (error) {
            console.error('Error loading config audit data', error);
            toast.error('Error cargando configuración sincronizada');
        } finally {
            setLoading(false);
        }
    };

    const getIcon = (iconName?: string) => {
        switch (iconName?.toLowerCase()) {
            case 'car': return <Car className="w-5 h-5" />;
            case 'bike': return <Bike className="w-5 h-5" />;
            case 'truck': return <Truck className="w-5 h-5" />;
            default: return <Car className="w-5 h-5" />;
        }
    };

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-gray-950">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
                    <p className="text-emerald-500 font-mono text-sm animate-pulse">Auditando Configuración...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 p-8 font-sans selection:bg-emerald-500/30">

            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <Database className="w-6 h-6 text-emerald-500" />
                        Auditoría de Configuración
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">Verificación de parámetros operativos sincronizados.</p>
                </div>

                <div className="flex items-center gap-2 bg-blue-900/20 border border-blue-500/30 px-3 py-1.5 rounded-full">
                    <Cloud className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-bold text-blue-300 uppercase tracking-wide">Sincronizado desde Nube</span>
                    <Lock className="w-3 h-3 text-blue-400/50 ml-1" />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* 1. Vehicle Types */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-lg">
                    <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Car className="w-5 h-5 text-purple-400" />
                        Tipos de Vehículo
                    </h2>
                    <div className="space-y-3">
                        {vehicleTypes.map((v) => (
                            <div key={v.id} className="flex items-center justify-between bg-gray-950 p-3 rounded-lg border border-gray-800/50">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                                        {getIcon(v.icon)}
                                    </div>
                                    <span className="font-medium text-gray-200">{v.name}</span>
                                </div>
                                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                            </div>
                        ))}
                        {vehicleTypes.length === 0 && <p className="text-gray-500 text-sm italic">Sin datos.</p>}
                    </div>
                </div>

                {/* 2. Tariffs */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-lg">
                    <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-amber-400" />
                        Tarifas Vigentes
                    </h2>
                    <div className="space-y-3">
                        {tariffs.map((t) => (
                            <div key={t.id} className="flex items-center justify-between bg-gray-950 p-3 rounded-lg border border-gray-800/50">
                                <div>
                                    {/* Nombre Principal (e.g. Hora) */}
                                    <p className="font-bold text-gray-200 text-sm">{t.name}</p>
                                    {/* Subtítulo Tipo (e.g. Estadía) */}
                                    {t.type && <p className="text-xs text-amber-500/80 uppercase tracking-wide mt-0.5">{t.type}</p>}
                                </div>
                                <span className="text-xs font-mono text-gray-500">Prio: {t.priority}</span>
                            </div>
                        ))}
                        {tariffs.length === 0 && <p className="text-gray-500 text-sm italic">Sin datos.</p>}
                    </div>
                </div>

                {/* 3. Price Matrix */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-lg">
                    <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Zap className="w-5 h-5 text-emerald-400" />
                        Matriz de Precios
                    </h2>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-400">
                            <thead className="text-xs text-gray-500 uppercase bg-gray-950/50">
                                <tr>
                                    <th className="px-4 py-3 rounded-tl-lg">Vehículo</th>
                                    <th className="px-4 py-3">Tarifa</th>
                                    <th className="px-4 py-3 text-right rounded-tr-lg">Precio</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {Object.entries(prices).map(([vehicle, pMap]) =>
                                    Object.entries(pMap).map(([tariff, amount], idx) => (
                                        <tr key={`${vehicle}-${tariff}`} className="hover:bg-gray-800/20 transition-colors">
                                            <td className="px-4 py-2 font-medium text-white">{vehicle}</td>
                                            <td className="px-4 py-2 text-gray-300">{tariff}</td>
                                            <td className="px-4 py-2 text-right font-mono text-emerald-400 font-bold">
                                                ${amount.toLocaleString()}
                                            </td>
                                        </tr>
                                    ))
                                )}
                                {Object.keys(prices).length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="px-4 py-4 text-center text-gray-500 italic">
                                            Matriz vacía.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default ConfigAuditPage;
