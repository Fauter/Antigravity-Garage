import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { toast } from 'sonner';
import { Wallet, TrendingUp, Calendar, User, ArrowDownRight, LogOut, FileText, CheckCircle } from 'lucide-react';

interface Movement {
    id?: string;
    plate: string;
    amount: number;
    paymentMethod: string;
    payment_method?: string;
    invoiceType: string;
    operator: string;
    timestamp: string;
    type: string;
}

interface PartialClose {
    id: string;
    operator: string;
    amount: string | number;
    timestamp: string;
    recipient_name?: string;
    notes?: string;
}

type UnifiedRow =
    | (Movement & { _kind: 'movement' })
    | (PartialClose & { _kind: 'partial_close' });

const CajaPage: React.FC = () => {
    const { user, operatorName, logout } = useAuth();
    const [unifiedRows, setUnifiedRows] = useState<UnifiedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    // Modals state
    const [isShiftCloseModalOpen, setIsShiftCloseModalOpen] = useState(false);
    const [isPartialCloseModalOpen, setIsPartialCloseModalOpen] = useState(false);

    // Shift close form state
    const [shiftCloseStep, setShiftCloseStep] = useState<1 | 2>(1);
    const [totalInCash, setTotalInCash] = useState<number | ''>('');
    const [stayingInCash, setStayingInCash] = useState<number | ''>('');
    const renderedAmount = (Number(totalInCash) || 0) - (Number(stayingInCash) || 0);

    // Partial close form state
    const [partialCloseStep, setPartialCloseStep] = useState<1 | 2>(1);
    const [partialAmount, setPartialAmount] = useState<number | ''>('');
    const [recipientName, setRecipientName] = useState('');
    const [partialNotes, setPartialNotes] = useState('');

    useEffect(() => {
        loadMovements();
    }, [user, operatorName]);

    const loadMovements = async () => {
        try {
            const [movRes, pcRes, scRes] = await Promise.all([
                api.get('/caja/movimientos'),
                api.get('/caja/cierres-parciales'),
                api.get('/caja/cierres')
            ]);

            const today = new Date().toLocaleDateString();

            // Encontrar el "ancla": último cierre de caja final de este operador
            const myShiftCloses = (scRes.data || [])
                .filter((sc: any) => sc.operator === operatorName || sc.operator === user?.username)
                .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            const lastCloseTimestamp = myShiftCloses.length > 0
                ? new Date(myShiftCloses[0].timestamp).getTime()
                : null;

            // Función de filtrado: posterior al último cierre, o del día si no hay cierres
            const isInCurrentShift = (timestamp: string, operator: string) => {
                const isMyOp = operator === operatorName || operator === user?.username;
                if (!isMyOp) return false;

                if (lastCloseTimestamp) {
                    // Solo mostrar movimientos POSTERIORES al último cierre
                    return new Date(timestamp).getTime() > lastCloseTimestamp;
                } else {
                    // Sin cierres previos: fallback a movimientos de hoy
                    return new Date(timestamp).toLocaleDateString() === today;
                }
            };

            // Filtrar movimientos del turno activo
            const shiftMovements: UnifiedRow[] = movRes.data
                .filter((m: any) => isInCurrentShift(m.timestamp, m.operator))
                .map((m: any) => ({ ...m, _kind: 'movement' as const }));

            // Filtrar cierres parciales del turno activo
            const shiftPartials: UnifiedRow[] = (pcRes.data || [])
                .filter((pc: any) => isInCurrentShift(pc.timestamp, pc.operator))
                .map((pc: any) => ({ ...pc, _kind: 'partial_close' as const }));

            // Combinar y ordenar por timestamp descendente
            const combined = [...shiftMovements, ...shiftPartials];
            combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            setUnifiedRows(combined);

            // Fondo Inicial: staying_in_cash del último cierre global (cualquier operador)
            // Nota: los registros locales usan staying_in_cash (snake_case),
            // pero los sincronizados desde Supabase usan stayingInCash (camelCase)
            const allShiftClosesSorted = (scRes.data || [])
                .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            const lastGlobalClose = allShiftClosesSorted.length > 0 ? allShiftClosesSorted[0] : null;
            const fondoInicial = lastGlobalClose
                ? Number(lastGlobalClose.staying_in_cash ?? lastGlobalClose.stayingInCash) || 0
                : 0;
            console.log('[CajaPage] Fondo Inicial:', fondoInicial, '| Último cierre:', lastGlobalClose);

            // Cálculo: fondo inicial + suma de efectivo - suma de retiros parciales
            const cashSum = shiftMovements
                .filter((m) => {
                    const method = ((m as Movement).paymentMethod || (m as Movement).payment_method || '').toLowerCase();
                    return method === 'efectivo';
                })
                .reduce((acc, curr) => acc + Number(curr.amount), 0);

            const partialsSum = shiftPartials
                .reduce((acc, curr) => acc + Number(curr.amount), 0);

            setTotal(fondoInicial + cashSum - partialsSum);
        } catch (error) {
            console.error('Error loading movements', error);
        } finally {
            setLoading(false);
        }
    };

    const handleShiftClose = async () => {
        try {
            await api.post('/caja/cierre', {
                operator: operatorName,
                total_in_cash: Number(totalInCash),
                staying_in_cash: Number(stayingInCash),
                rendered_amount: renderedAmount
            });
            toast.success('CIERRE DE CAJA EXITOSO. La sesión se cerrará automáticamente.');
            logout(); // Cierre forzoso de sesión
        } catch (error) {
            console.error("Error al cerrar caja", error);
            toast.error('Error al procesar la operación');
        }
    };

    const handlePartialClose = async () => {
        try {
            await api.post('/caja/cierre-parcial', {
                operator: operatorName,
                amount: Number(partialAmount),
                recipient_name: recipientName,
                notes: partialNotes
            });
            toast.success('RETIRO PARCIAL REGISTRADO CORRECTAMENTE');
            setIsPartialCloseModalOpen(false);
            setPartialCloseStep(1);
            setPartialAmount('');
            setRecipientName('');
            setPartialNotes('');
            loadMovements(); // Refrescar movimientos + retiros
        } catch (error) {
            console.error("Error al registrar cierre parcial", error);
            toast.error('Error al procesar la operación');
        }
    };

    return (
        <div className="p-6 h-full flex flex-col bg-slate-950 text-gray-200 font-sans">

            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
                        <Wallet className="w-8 h-8 text-emerald-500" />
                        Caja del Turno
                    </h2>
                    <p className="text-gray-400 text-sm mt-2 flex items-center gap-2">
                        <User className="w-4 h-4 text-emerald-500" /> Operador: <span className="text-emerald-400 font-mono font-bold mr-2">{operatorName}</span>
                        |
                        <Calendar className="w-4 h-4 ml-2 text-emerald-500" /> Fecha: <span className="text-gray-300 font-mono">{new Date().toLocaleDateString()}</span>
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-emerald-900/20 border border-emerald-500/30 p-4 rounded-xl flex items-center gap-4">
                        <div className="bg-emerald-500/20 p-3 rounded-xl text-emerald-500">
                            <TrendingUp className="w-8 h-8" />
                        </div>
                        <div>
                            <span className="block text-emerald-500/80 text-xs font-bold uppercase tracking-widest">Cálculo de Caja</span>
                            <span className="text-4xl font-black text-white tracking-tighter">${total.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Acciones Rápidas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <button
                    onClick={() => setIsPartialCloseModalOpen(true)}
                    className="flex justify-center items-center gap-3 bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-xl border border-slate-700 transition-colors shadow-lg group"
                >
                    <ArrowDownRight className="w-6 h-6 text-amber-500 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-lg">Retiro Parcial</span>
                </button>

                <button
                    onClick={() => setIsShiftCloseModalOpen(true)}
                    className="flex justify-center items-center gap-3 bg-red-900/40 hover:bg-red-900/60 text-white p-4 rounded-xl border border-red-800/50 hover:border-red-500/50 transition-colors shadow-lg group"
                >
                    <LogOut className="w-6 h-6 text-red-400 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-lg text-red-100">Cierre de Caja Final</span>
                </button>
            </div>

            <div className="flex-1 overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col">
                <div className="p-4 border-b border-slate-800 bg-slate-900/50">
                    <h3 className="text-lg font-bold text-slate-300 flex items-center gap-2">
                        <FileText className="w-5 h-5" /> Movimientos del Turno
                    </h3>
                </div>
                <div className="overflow-auto flex-1">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-950 text-slate-400 uppercase text-xs font-bold sticky top-0 z-10">
                            <tr>
                                <th className="p-4 border-b border-slate-800">Hora</th>
                                <th className="p-4 border-b border-slate-800">Tipo</th>
                                <th className="p-4 border-b border-slate-800">Patente</th>
                                <th className="p-4 border-b border-slate-800">Pago</th>
                                <th className="p-4 border-b border-slate-800 text-right">Monto</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {loading ? (
                                <tr><td colSpan={5} className="p-8 text-center text-slate-500">Cargando movimientos...</td></tr>
                            ) : unifiedRows.length === 0 ? (
                                <tr><td colSpan={5} className="p-8 text-center text-slate-500">Sin movimientos en este turno.</td></tr>
                            ) : (
                                unifiedRows.map((row, idx) => {
                                    if (row._kind === 'partial_close') {
                                        return (
                                            <tr key={`pc-${idx}`} className="hover:bg-slate-800/50 transition-colors bg-slate-900/30">
                                                <td className="p-4 font-mono text-slate-400">
                                                    {new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className="p-4 text-amber-400 font-semibold flex items-center gap-1.5">
                                                    <ArrowDownRight className="w-4 h-4" /> Cierre Parcial
                                                </td>
                                                <td className="p-4 font-mono text-slate-600">---</td>
                                                <td className="p-4 text-slate-600">---</td>
                                                <td className="p-4 font-mono font-bold text-slate-500 text-right">
                                                    -${Number(row.amount).toLocaleString()}
                                                </td>
                                            </tr>
                                        );
                                    }

                                    // Movement row (existing behavior)
                                    const m = row as Movement & { _kind: 'movement' };
                                    return (
                                        <tr key={`mv-${idx}`} className="hover:bg-slate-800/50 transition-colors">
                                            <td className="p-4 font-mono text-slate-400">
                                                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td className="p-4 text-slate-300">
                                                {m.type === 'CobroEstadia' ? 'Hora' : m.type === 'CobroAbono' ? 'Abono' : m.type}
                                            </td>
                                            <td className="p-4 font-mono font-bold text-white">{m.plate || '---'}</td>
                                            <td className="p-4">
                                                <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-slate-800 border border-slate-700 text-slate-300">
                                                    {m.paymentMethod}
                                                </span>
                                            </td>
                                            <td className="p-4 font-mono font-bold text-emerald-400 text-right">
                                                ${m.amount?.toLocaleString()}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal Cierre de Caja */}
            {isShiftCloseModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl p-6 relative">
                        {shiftCloseStep === 1 && (
                            <>
                                <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                                    <LogOut className="text-red-500 w-6 h-6" /> Cierre de Caja
                                </h3>

                                <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 mb-6 flex items-center justify-between">
                                    <span className="text-slate-400 text-sm font-bold uppercase tracking-wide">Cálculo de Caja</span>
                                    <span className="text-2xl font-black text-emerald-400 font-mono">${total.toLocaleString()}</span>
                                </div>

                                <div className="space-y-4 mb-8">
                                    <div>
                                        <label className="block text-slate-400 text-sm font-bold mb-2">Total Efectivo en Caja</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                            <input
                                                type="number"
                                                value={totalInCash}
                                                onChange={e => setTotalInCash(e.target.value ? Number(e.target.value) : '')}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 pl-8 text-white font-mono text-xl focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 text-sm font-bold mb-2">Queda en Caja (Fondo)</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                            <input
                                                type="number"
                                                value={stayingInCash}
                                                onChange={e => setStayingInCash(e.target.value ? Number(e.target.value) : '')}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 pl-8 text-white font-mono text-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-3 mt-6">
                                    <button
                                        onClick={() => {
                                            setIsShiftCloseModalOpen(false);
                                            setTotalInCash('');
                                            setStayingInCash('');
                                        }}
                                        className="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold hover:bg-slate-700 transition"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (totalInCash === '' || stayingInCash === '') return toast.warning('Completa los montos');
                                            setShiftCloseStep(2)
                                        }}
                                        className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-500 transition"
                                    >
                                        Siguiente
                                    </button>
                                </div>
                            </>
                        )}

                        {shiftCloseStep === 2 && (
                            <>
                                <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                                    <CheckCircle className="text-emerald-500 w-6 h-6" /> Confirmar Cierre
                                </h3>

                                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 mb-6 relative overflow-hidden">
                                    <div className="flex justify-between items-center text-slate-300">
                                        <span>Total en Caja:</span>
                                        <span className="font-mono text-lg">${Number(totalInCash).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-slate-300">
                                        <span>Queda en Caja:</span>
                                        <span className="font-mono text-lg text-emerald-400">${Number(stayingInCash).toLocaleString()}</span>
                                    </div>
                                    <div className="h-px w-full bg-slate-800 my-2"></div>
                                    <div className="flex justify-between items-center text-white">
                                        <span className="font-bold text-lg text-amber-500">Monto Rendido:</span>
                                        <span className="font-mono font-black text-3xl text-amber-400">${renderedAmount.toLocaleString()}</span>
                                    </div>
                                </div>

                                <p className="text-slate-400 text-sm text-center mb-6">Por favor, entrega exactamente <strong className="text-amber-400">${renderedAmount.toLocaleString()}</strong> a la gerencia.</p>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShiftCloseStep(1)}
                                        className="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold hover:bg-slate-700 transition"
                                    >
                                        Atrás
                                    </button>
                                    <button
                                        onClick={handleShiftClose}
                                        className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-500 transition flex items-center justify-center gap-2"
                                    >
                                        Confirmar Cierre <LogOut className="w-5 h-5" />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Modal Retiro Parcial */}
            {isPartialCloseModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl p-6 relative">
                        {partialCloseStep === 1 && (
                            <>
                                <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                                    <ArrowDownRight className="text-amber-500 w-6 h-6" /> Retiro Parcial
                                </h3>

                                <div className="space-y-4 mb-8">
                                    <div>
                                        <label className="block text-slate-400 text-sm font-bold mb-2">Monto a retirar</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                            <input
                                                type="number"
                                                value={partialAmount}
                                                onChange={e => setPartialAmount(e.target.value ? Number(e.target.value) : '')}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 pl-8 text-white font-mono text-xl focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 text-sm font-bold mb-2">Nombre quien retira / Paga a</label>
                                        <input
                                            type="text"
                                            value={recipientName}
                                            onChange={e => setRecipientName(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                                            placeholder="Proveedor, Dueño, etc."
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 text-sm font-bold mb-2">Notas (Opcional)</label>
                                        <textarea
                                            value={partialNotes}
                                            onChange={e => setPartialNotes(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none min-h-[80px]"
                                            placeholder="Detalles del retiro..."
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-3 mt-6">
                                    <button
                                        onClick={() => setIsPartialCloseModalOpen(false)}
                                        className="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold hover:bg-slate-700 transition"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (partialAmount === '' || !recipientName.trim()) return toast.warning('Complete monto y destinatario');
                                            setPartialCloseStep(2);
                                        }}
                                        className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-500 transition"
                                    >
                                        Siguiente
                                    </button>
                                </div>
                            </>
                        )}

                        {partialCloseStep === 2 && (
                            <>
                                <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                                    <CheckCircle className="text-emerald-500 w-6 h-6" /> Confirmar Retiro
                                </h3>

                                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 mb-6 relative overflow-hidden">
                                    <div className="flex justify-between items-center text-slate-300">
                                        <span>Nombre:</span>
                                        <span className="font-bold text-white">{recipientName}</span>
                                    </div>
                                    <div className="flex flex-col text-slate-300 mt-2">
                                        <span className="mb-1 text-sm text-slate-500">Notas:</span>
                                        <p className="text-sm bg-slate-900 p-2 rounded border border-slate-800 italic">
                                            {partialNotes || 'Sin notas.'}
                                        </p>
                                    </div>
                                    <div className="h-px w-full bg-slate-800 my-4"></div>
                                    <div className="flex justify-between items-center text-white">
                                        <span className="font-bold text-lg text-amber-500">Monto a retirar:</span>
                                        <span className="font-mono font-black text-3xl text-amber-400">${Number(partialAmount).toLocaleString()}</span>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setPartialCloseStep(1)}
                                        className="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold hover:bg-slate-700 transition"
                                    >
                                        Atrás
                                    </button>
                                    <button
                                        onClick={handlePartialClose}
                                        className="flex-1 bg-amber-600 text-white py-3 rounded-xl font-bold hover:bg-amber-500 transition flex items-center justify-center gap-2"
                                    >
                                        Confirmar Retiro
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CajaPage;
