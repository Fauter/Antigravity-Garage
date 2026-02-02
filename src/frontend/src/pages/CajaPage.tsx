import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Wallet, TrendingUp, Calendar, User } from 'lucide-react';

interface Movement {
    id?: string;
    plate: string;
    amount: number;
    paymentMethod: string;
    invoiceType: string;
    operator: string;
    timestamp: string;
    type: 'ENTRY' | 'EXIT';
}

const CajaPage: React.FC = () => {
    const { user } = useAuth();
    const [movements, setMovements] = useState<Movement[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        loadMovements();
    }, []);

    const loadMovements = async () => {
        try {
            // In a real app we would have a specific endpoint for movements
            // For now, let's assume we can fetch them or we interpret them from a "movimientos.json" exposed via API
            // Since we don't have a dedicated movements endpoint yet in the plan, I will simulate it 
            // OR I should have added it to the backend plan.
            // Requirement says: "Vista de Caja... tabla con estos movimientos".
            // I'll assume GET /api/movimientos exists or I need to add it. 
            // I'll add the endpoint to the backend plan/implementation shortly. 
            // For now, I'll code the frontend to expect it.
            const res = await api.get('/movimientos');
            // Filter by current shift implies today for now
            const today = new Date().toLocaleDateString();
            const todaysMovements = res.data.filter((m: any) => new Date(m.timestamp).toLocaleDateString() === today);

            setMovements(todaysMovements);
            const sum = todaysMovements.reduce((acc: number, curr: Movement) => acc + (curr.amount || 0), 0);
            setTotal(sum);
        } catch (error) {
            console.error('Error loading movements', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 h-full flex flex-col bg-black text-gray-200 font-sans">

            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
                        <Wallet className="w-8 h-8 text-emerald-500" />
                        Caja del Turno
                    </h2>
                    <p className="text-gray-500 text-sm mt-1 flex items-center gap-2">
                        <User className="w-4 h-4" /> Operador: <span className="text-emerald-400 font-mono font-bold">{user?.username}</span>
                        <span className="mx-2">|</span>
                        <Calendar className="w-4 h-4" /> Fecha: {new Date().toLocaleDateString()}
                    </p>
                </div>

                <div className="bg-emerald-900/20 border border-emerald-500/30 p-4 rounded-2xl flex items-center gap-4">
                    <div className="bg-emerald-500/20 p-3 rounded-xl text-emerald-500">
                        <TrendingUp className="w-8 h-8" />
                    </div>
                    <div>
                        <span className="block text-emerald-500/70 text-xs font-bold uppercase tracking-widest">Recaudación Total</span>
                        <span className="text-4xl font-black text-white tracking-tighter">${total.toLocaleString()}</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl shadow-xl flex flex-col">
                <div className="overflow-auto flex-1">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-950 text-gray-400 uppercase text-xs font-bold sticky top-0 z-10">
                            <tr>
                                <th className="p-4 border-b border-gray-800">Hora</th>
                                <th className="p-4 border-b border-gray-800">Patente</th>
                                <th className="p-4 border-b border-gray-800">Operador</th>
                                <th className="p-4 border-b border-gray-800">Pago</th>
                                <th className="p-4 border-b border-gray-800">Factura</th>
                                <th className="p-4 border-b border-gray-800 text-right">Monto</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {loading ? (
                                <tr><td colSpan={6} className="p-8 text-center text-gray-500">Cargando movimientos...</td></tr>
                            ) : movements.length === 0 ? (
                                <tr><td colSpan={6} className="p-8 text-center text-gray-500">Sin movimientos en este turno.</td></tr>
                            ) : (
                                movements.map((m, idx) => (
                                    <tr key={idx} className="hover:bg-gray-800/50 transition-colors">
                                        <td className="p-4 font-mono text-gray-400">
                                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                        <td className="p-4 font-mono font-bold text-white">{m.plate}</td>
                                        <td className="p-4 text-gray-400 text-sm">{m.operator}</td>
                                        <td className="p-4">
                                            <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-gray-800 border border-gray-700 text-gray-300">
                                                {m.paymentMethod}
                                            </span>
                                        </td>
                                        <td className="p-4 text-gray-400 text-sm">{m.invoiceType}</td>
                                        <td className="p-4 font-mono font-bold text-white text-right">
                                            ${m.amount?.toLocaleString()}
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

export default CajaPage;
