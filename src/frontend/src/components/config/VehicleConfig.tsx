import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Car } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../services/api';

const VehicleConfig: React.FC = () => {
    const [types, setTypes] = useState<any[]>([]);
    const [newType, setNewType] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchTypes();
    }, []);

    const fetchTypes = async () => {
        try {
            const res = await api.get('/tipos-vehiculo');
            setTypes(res.data || []);
        } catch (error) {
            console.error(error);
            toast.error('Error al cargar vehículos');
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newType.trim()) return;

        setLoading(true);
        try {
            // ID is generated from name, normalized
            const id = newType.toLowerCase().replace(/\s+/g, '-');
            await api.post('/tipos-vehiculo', { id, nombre: newType });
            toast.success('Vehículo agregado');
            setNewType('');
            fetchTypes();
        } catch (error) {
            toast.error('Error al agregar vehículo');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Eliminar este tipo de vehículo?')) return;
        try {
            await api.delete(`/tipos-vehiculo/${id}`);
            toast.success('Vehículo eliminado');
            fetchTypes();
        } catch (error) {
            toast.error('Error al eliminar vehículo');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Header / Add Form */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Car className="w-5 h-5 text-emerald-500" />
                            Tipos de Vehículo
                        </h2>
                        <p className="text-gray-400 text-sm">Define las categorías de vehículos aceptadas.</p>
                    </div>
                </div>

                <form onSubmit={handleAdd} className="flex gap-2">
                    <input
                        type="text"
                        value={newType}
                        onChange={(e) => setNewType(e.target.value)}
                        placeholder="Ej. Cuatriciclo..."
                        className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-4 py-2 text-white outline-none focus:border-emerald-500 transition-all font-mono"
                    />
                    <button
                        type="submit"
                        disabled={loading || !newType}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50 transition-all"
                    >
                        <Plus className="w-4 h-4" /> Agregar
                    </button>
                </form>
            </div>

            {/* List */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden backdrop-blur-sm">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-950/50 border-b border-gray-800 text-xs uppercase tracking-wider text-gray-500">
                            <th className="p-4 font-bold">ID</th>
                            <th className="p-4 font-bold">Nombre</th>
                            <th className="p-4 font-bold text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {types.map((t) => (
                            <tr key={t.id} className="group hover:bg-gray-800/30 transition-colors">
                                <td className="p-4 font-mono text-gray-500 text-sm">{t.id}</td>
                                <td className="p-4 font-bold text-white">{t.nombre}</td>
                                <td className="p-4 text-right">
                                    <button
                                        onClick={() => handleDelete(t.id)}
                                        className="text-red-500 hover:text-red-400 p-2 rounded-lg hover:bg-red-900/20 transition-all opacity-0 group-hover:opacity-100"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {types.length === 0 && (
                            <tr>
                                <td colSpan={3} className="p-8 text-center text-gray-500 italic">
                                    No hay vehículos definidos.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default VehicleConfig;
