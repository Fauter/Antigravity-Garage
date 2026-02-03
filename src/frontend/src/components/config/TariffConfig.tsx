import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { toast } from 'sonner';
import { Trash2, Plus, Clock, Calendar, Check } from 'lucide-react';

interface Tariff {
    id?: string;
    nombre: string;
    tipo: 'hora' | 'turno' | 'abono' | 'estadia';
    dias: number;
    horas: number;
    minutos: number;
    tolerancia: number;
}

const TariffConfig: React.FC = () => {
    const [tarifas, setTarifas] = useState<Tariff[]>([]);
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);

    // New Tariff State
    const [newTariff, setNewTariff] = useState<Tariff>({
        nombre: '',
        tipo: 'hora',
        dias: 0,
        horas: 0,
        minutos: 0,
        tolerancia: 0
    });

    useEffect(() => { loadTarifas(); }, []);

    const loadTarifas = async () => {
        try {
            const res = await api.get('/tarifas');
            setTarifas(res.data);
        } catch (e) { console.error(e); }
    };

    const handleSave = async () => {
        if (!newTariff.nombre) return toast.error('Nombre requerido');
        setLoading(true);
        try {
            await api.post('/tarifas', newTariff);
            toast.success('Tarifa creada');
            setShowModal(false);
            loadTarifas();
            setNewTariff({ nombre: '', tipo: 'hora', dias: 0, horas: 0, minutos: 0, tolerancia: 0 });
        } catch (e) { toast.error('Error al guardar'); }
        finally { setLoading(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Eliminar tarifa?')) return;
        try {
            await api.delete(`/tarifas/${id}`);
            toast.success('Eliminada');
            loadTarifas();
        } catch (e) { toast.error('Error al eliminar'); }
    };

    const renderSection = (title: string, items: Tariff[], icon: React.ReactNode, colorClass: string) => {
        if (items.length === 0) return null;

        return (
            <div className="space-y-3">
                <h4 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${colorClass}`}>
                    {icon} {title}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map(t => (
                        <div key={t.id} className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl hover:border-emerald-500/30 transition-all group">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-white">{t.nombre}</span>
                                </div>
                                <button onClick={() => handleDelete(t.id!)} className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="text-sm text-gray-400 space-y-1">
                                <div className="flex justify-between"><span>Duración:</span> <span className="text-emerald-400 font-mono">
                                    {t.dias > 0 && `${t.dias}d `}
                                    {t.horas > 0 && `${t.horas}h `}
                                    {t.minutos > 0 && `${t.minutos}m`}
                                </span></div>
                                <div className="flex justify-between"><span>Tolerancia:</span> <span className="text-gray-300">{t.tolerancia} min</span></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const tariffsByType = {
        hora: tarifas.filter(t => t.tipo === 'hora'),
        turno: tarifas.filter(t => t.tipo === 'turno' || t.tipo === 'estadia'), // Treating 'estadia' as 'turno'/Anticipado visually if needed, or separate.
        // User requested 'Anticipado' for 'Turno'. 'Estadia' usually falls under fixed blocks -> Anticipado.
        abono: tarifas.filter(t => t.tipo === 'abono')
    };

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Clock className="w-6 h-6 text-emerald-500" /> Configuración de Bloques
                </h3>
                <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-all font-bold">
                    <Plus className="w-4 h-4" /> Nuevo Bloque
                </button>
            </div>

            <div className="space-y-10">
                {renderSection('Tarifas por Hora', tariffsByType.hora, <Clock className="w-4 h-4" />, 'text-emerald-400')}
                {renderSection('Tarifas por Anticipado', tariffsByType.turno, <Calendar className="w-4 h-4" />, 'text-blue-400')}
                {/* Abono tariffs are hidden from Config Blocks as they are protected system tariffs */}
            </div>

            {/* MODAL */}
            {showModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <h4 className="text-lg font-bold text-white mb-4">Nuevo Bloque de Tiempo</h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Nombre</label>
                                <input className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-white focus:border-emerald-500 outline-none"
                                    value={newTariff.nombre} onChange={e => setNewTariff({ ...newTariff, nombre: e.target.value })} placeholder="Ej. Media Estadía" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Tipo</label>
                                    <select className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-white focus:border-emerald-500 outline-none"
                                        value={newTariff.tipo} onChange={e => setNewTariff({ ...newTariff, tipo: e.target.value as any })}>
                                        <option value="hora">Por Hora</option>
                                        <option value="abono">Abono</option>
                                        <option value="turno">Anticipado</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Tolerancia (min)</label>
                                    <input type="number" className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-white focus:border-emerald-500 outline-none"
                                        value={newTariff.tolerancia} onChange={e => setNewTariff({ ...newTariff, tolerancia: Number(e.target.value) })} />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Días</label>
                                    <input type="number" className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-white focus:border-emerald-500 outline-none"
                                        value={newTariff.dias} onChange={e => setNewTariff({ ...newTariff, dias: Number(e.target.value) })} />
                                </div>
                                <div>
                                    <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Horas</label>
                                    <input type="number" className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-white focus:border-emerald-500 outline-none"
                                        value={newTariff.horas} onChange={e => setNewTariff({ ...newTariff, horas: Number(e.target.value) })} />
                                </div>
                                <div>
                                    <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Min</label>
                                    <input type="number" className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-white focus:border-emerald-500 outline-none"
                                        value={newTariff.minutos} onChange={e => setNewTariff({ ...newTariff, minutos: Number(e.target.value) })} />
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancelar</button>
                                <button onClick={handleSave} disabled={loading} className="px-4 py-2 bg-emerald-600 rounded hover:bg-emerald-500 text-white font-bold transition-colors">
                                    {loading ? 'Guardando...' : 'Crear Bloque'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TariffConfig;
