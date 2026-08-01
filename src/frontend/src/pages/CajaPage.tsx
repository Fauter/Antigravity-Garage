import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { toast } from 'sonner';
import { Wallet, TrendingUp, Calendar, User, ArrowDownRight, LogOut, FileText, CheckCircle, AlertCircle, CheckCircle2, Printer, Search, X, Loader2, RotateCcw } from 'lucide-react';
import { PrinterService } from '../services/PrinterService';

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
    notes?: string;
    relatedEntityId?: string;
    receipt_number?: string;
    ticket_code?: string;
}

interface PartialClose {
    id: string;
    operator: string;
    amount: string | number;
    timestamp: string;
    recipient_name?: string;
    notes?: string;
    movement_type?: 'withdrawal' | 'expense';
}

interface RecentStay {
    id?: string;
    _id?: string;
    plate: string;
    entryTime: string;
    exitTime?: string;
    vehicleType?: string;
    active?: boolean;
    isSubscriber?: boolean;
    is_subscriber?: boolean;
    ticket_code?: string;
    garageId?: string;
}

// Unified Row for the main Caja movements table
type UnifiedRow =
    | (Movement & { _kind: 'movement' })
    | (PartialClose & { _kind: 'partial_close' });

// Unified Reprint Item — normalizes stays + movements into a single reprintable list
interface ReprintItem {
    id: string;
    type: 'Entrada' | 'CobroEstadia' | 'CobroAbono' | 'Upgrade';
    plate: string;
    timestamp: string;
    amount?: number;
    paymentMethod?: string;
    operator?: string;
    notes?: string;
    // Source data for reconstruction
    _stay?: RecentStay;
    _movement?: Movement;
}

const getPartialCloseReference = (
    partialClose: PartialClose
): {
    recipient: string;
    notes: string;
    text: string;
    hasReference: boolean;
} => {
    const rawRecipient = partialClose.recipient_name?.trim() || '';

    const recipient =
        rawRecipient.toLocaleLowerCase('es') === 'desconocido'
            ? ''
            : rawRecipient;

    const notes = partialClose.notes?.trim() || '';

    const text =
        recipient && notes
            ? `${recipient} - ${notes}`
            : recipient || notes || 'Sin referencia';

    return {
        recipient,
        notes,
        text,
        hasReference: Boolean(recipient || notes),
    };
};

const CajaPage: React.FC = () => {
    const { user, operatorName, logout } = useAuth();
    const [unifiedRows, setUnifiedRows] = useState<UnifiedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    // Modals state
    const [isShiftCloseModalOpen, setIsShiftCloseModalOpen] = useState(false);
    const [isPartialCloseModalOpen, setIsPartialCloseModalOpen] = useState(false);
    const [isReprintModalOpen, setIsReprintModalOpen] = useState(false);

    // Shift close form state
    const [shiftCloseStep, setShiftCloseStep] = useState<1 | 2>(1);
    const [totalInCash, setTotalInCash] = useState<number | ''>('');
    const [stayingInCash, setStayingInCash] = useState<number | ''>('');
    const renderedAmount = (Number(totalInCash) || 0) - (Number(stayingInCash) || 0);
    const difference = totalInCash !== '' ? Number(totalInCash) - total : null;

    // Partial close form state
    const [partialCloseStep, setPartialCloseStep] = useState<1 | 2>(1);
    const [partialAmount, setPartialAmount] = useState<number | ''>('');
    const [recipientName, setRecipientName] = useState('');
    const [partialNotes, setPartialNotes] = useState('');
    const [movementType, setMovementType] = useState<'withdrawal' | 'expense' | null>(null);

    // Reprint Center state
    const [reprintItems, setReprintItems] = useState<ReprintItem[]>([]);
    const [reprintLoading, setReprintLoading] = useState(false);
    const [reprintSearch, setReprintSearch] = useState('');
    const [reprintingId, setReprintingId] = useState<string | null>(null);

    // Keep raw movements for reprint cross-reference
    const [rawMovements, setRawMovements] = useState<Movement[]>([]);
    const [recentStays, setRecentStays] = useState<RecentStay[]>([]);

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

            // Guardar movimientos raw para reprint cross-reference
            setRawMovements(movRes.data || []);

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

    // Fetch recent stays for Reprint Center
    useEffect(() => {
        if (isReprintModalOpen) {
            loadReprintData();
        }
    }, [isReprintModalOpen]);

    const loadReprintData = async () => {
        setReprintLoading(true);
        try {
            const staysRes = await api.get('/estadias/recientes');
            setRecentStays(staysRes.data || []);
        } catch (error) {
            console.error('Error loading recent stays for reprint:', error);
            toast.error('Error al cargar estadías recientes');
        } finally {
            setReprintLoading(false);
        }
    };

    // Build unified reprint list from stays + movements
    useEffect(() => {
        const items: ReprintItem[] = [];
        const seenIds = new Set<string>();

        // 1. Add Entry tickets from recent stays (entries that have NO corresponding CobroEstadia movement)
        for (const stay of recentStays) {
            const stayId = stay.id || stay._id || '';
            if (!stayId || seenIds.has(`entry-${stayId}`)) continue;

            // Every stay is a potential Entry ticket reprint
            items.push({
                id: `entry-${stayId}`,
                type: 'Entrada',
                plate: stay.plate,
                timestamp: stay.entryTime,
                _stay: stay,
            });
            seenIds.add(`entry-${stayId}`);
        }

        // 2. Add Exit/Abono/Upgrade tickets from movements
        for (const mov of rawMovements) {
            const movId = mov.id || '';
            if (!movId) continue;

            if (mov.type === 'CobroEstadia') {
                if (seenIds.has(`exit-${movId}`)) continue;
                items.push({
                    id: `exit-${movId}`,
                    type: 'CobroEstadia',
                    plate: mov.plate,
                    timestamp: mov.timestamp,
                    amount: mov.amount,
                    paymentMethod: mov.paymentMethod || mov.payment_method,
                    operator: mov.operator,
                    notes: mov.notes,
                    _movement: mov,
                });
                seenIds.add(`exit-${movId}`);
            } else if (mov.type === 'CobroAbono') {
                // Distinguish Upgrade vs regular Abono based on notes
                const isUpgrade = mov.notes && mov.notes.toLowerCase().includes('upgrade');
                if (seenIds.has(`abono-${movId}`)) continue;
                items.push({
                    id: isUpgrade ? `upgrade-${movId}` : `abono-${movId}`,
                    type: isUpgrade ? 'Upgrade' : 'CobroAbono',
                    plate: mov.plate,
                    timestamp: mov.timestamp,
                    amount: mov.amount,
                    paymentMethod: mov.paymentMethod || mov.payment_method,
                    operator: mov.operator,
                    notes: mov.notes,
                    _movement: mov,
                });
                seenIds.add(isUpgrade ? `upgrade-${movId}` : `abono-${movId}`);
            }
        }

        // Sort by timestamp descending
        items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        setReprintItems(items);
    }, [recentStays, rawMovements]);

    // --- Reprint Handlers ---

    const handleReprint = async (item: ReprintItem) => {
        setReprintingId(item.id);
        try {
            switch (item.type) {
                case 'Entrada':
                    handleReprintEntry(item);
                    break;
                case 'CobroEstadia':
                    handleReprintExit(item);
                    break;
                case 'CobroAbono':
                    handleReprintSubscription(item);
                    break;
                case 'Upgrade':
                    handleReprintUpgrade(item);
                    break;
            }
        } catch (error) {
            console.error('Error reprinting ticket:', error);
            toast.error('Error al reimprimir ticket');
        } finally {
            // Small delay to show spinner feedback
            setTimeout(() => setReprintingId(null), 800);
        }
    };

    const handleReprintEntry = (item: ReprintItem) => {
        const stay = item._stay;
        if (!stay) {
            toast.error('Datos de estadía no disponibles para reimpresión');
            return;
        }

        PrinterService.printEntryTicket({
            id: stay.id || stay._id,
            plate: stay.plate,
            entryTime: stay.entryTime,
            entry_time: stay.entryTime,
            vehicleType: stay.vehicleType || 'Auto',
            ticket_code: stay.ticket_code,
        });
        toast.success(`Reimprimiendo Ticket Entrada: ${stay.plate}`);
    };

    const handleReprintExit = (item: ReprintItem) => {
        const mov = item._movement;
        if (!mov) {
            toast.error('Datos de movimiento no disponibles para reimpresión');
            return;
        }

        // Find matching stay for this exit movement (by plate, closest timestamp)
        const matchingStay = recentStays.find(s =>
            s.plate === mov.plate && s.exitTime
        ) || recentStays.find(s => s.plate === mov.plate);

        // Reconstruct the stay object for printExitTicket
        const stayForPrint: any = {
            id: matchingStay?.id || matchingStay?._id || 'UNKNOWN',
            plate: mov.plate,
            entryTime: matchingStay?.entryTime || mov.timestamp,
            entry_time: matchingStay?.entryTime || mov.timestamp,
            exitTime: matchingStay?.exitTime || mov.timestamp,
            exit_time: matchingStay?.exitTime || mov.timestamp,
            isSubscriber: matchingStay?.isSubscriber || matchingStay?.is_subscriber || false,
            is_subscriber: matchingStay?.isSubscriber || matchingStay?.is_subscriber || false,
            ticket_code: matchingStay?.ticket_code,
        };

        // Parse duration from notes if contains "Por Xhs" pattern
        let durationNote = mov.notes || 'N/A';
        const durationMatch = mov.notes?.match(/Por\s+(\d+[\w\s]*)/i);
        if (durationMatch) {
            durationNote = durationMatch[0];
        }

        const movementForPrint: any = {
            ...mov,
            notes: durationNote,
            amount: mov.amount,
            paymentMethod: mov.paymentMethod || mov.payment_method || 'N/A',
            operator: mov.operator || 'Sys',
            receipt_number: mov.receipt_number || mov.ticket_code,
        };

        PrinterService.printExitTicket(stayForPrint, movementForPrint);
        toast.success(`Reimprimiendo Ticket Salida: ${mov.plate}`);
    };

    const handleReprintSubscription = (item: ReprintItem) => {
        const mov = item._movement;
        if (!mov) {
            toast.error('Datos de movimiento no disponibles para reimpresión');
            return;
        }

        // Reconstruct from movement notes + available data
        // Notes typically contain: "Pago Total por Renovación - Cochera #X" or "Renovación Abono Anticipada"
        const cocheraMatch = mov.notes?.match(/Cochera\s+([#\d\w]+|Móvil)/i);
        const cocheraText = cocheraMatch ? cocheraMatch[1] : 'Móvil';

        PrinterService.printSubscriptionTicket({
            nombreApellido: mov.operator || 'Cliente',
            patente: mov.plate || '---',
            tipoCochera: cocheraText.includes('Móvil') ? 'Movil' : 'Fija',
            numeroCochera: cocheraText.replace('#', ''),
            metodoPago: mov.paymentMethod || mov.payment_method || 'Efectivo',
            basePriceDisplay: mov.amount,
            proratedPrice: mov.amount,
            montoRecibido: mov.amount,
            tipoVehiculo: 'Auto',
            marca: '',
            modelo: '',
            ticket_code: mov.receipt_number || mov.ticket_code || null,
            // Minimal fields — the ticket renders what's available
            dni: '',
        });
        toast.success(`Reimprimiendo Ticket Abono: ${mov.plate}`);
    };

    const handleReprintUpgrade = (item: ReprintItem) => {
        const mov = item._movement;
        if (!mov) {
            toast.error('Datos de movimiento no disponibles para reimpresión');
            return;
        }

        // Parse upgrade details from notes: "Upgrade de vehículo: AAA111 (Lista: Standard)"
        const vehicleTypeMatch = mov.notes?.match(/Lista:\s*(\w+)/i);
        const listType = vehicleTypeMatch ? vehicleTypeMatch[1] : 'Standard';

        PrinterService.printUpgradeTicket({
            titular: mov.operator || 'Cliente',
            patente: mov.plate || '---',
            precioAnterior: 0, // Not available from movement alone
            precioNuevo: mov.amount,
            montoCobrado: mov.amount,
            metodoPago: mov.paymentMethod || mov.payment_method || 'Efectivo',
            operador: mov.operator || 'Sys',
            tipoVehiculo: listType === 'Electronic' ? 'Auto' : 'Auto',
            ticket_code: mov.receipt_number || mov.ticket_code || null,
        });
        toast.success(`Reimprimiendo Ticket Upgrade: ${mov.plate}`);
    };

    // Filtered reprint items by search
    const filteredReprintItems = reprintSearch.trim()
        ? reprintItems.filter(item =>
            item.plate?.toLowerCase().includes(reprintSearch.toLowerCase().trim())
        )
        : reprintItems;

    const handleShiftClose = async () => {
        try {
            await api.post('/caja/cierre', {
                operator: operatorName,
                total_in_cash: Number(totalInCash),
                staying_in_cash: Number(stayingInCash),
                rendered_amount: renderedAmount
            });
            toast.success('CIERRE DE CAJA EXITOSO. La sesión se cerrará automáticamente en breve.');
            PrinterService.printShiftCloseTicket({
                timestamp: new Date().toISOString(),
                operatorName: operatorName,
                total: total,
                totalInCash: Number(totalInCash),
                difference: difference,
                stayingInCash: Number(stayingInCash),
                renderedAmount: renderedAmount
            });
            setTimeout(() => logout(), 2000); // Give printing time before unmount
        } catch (error) {
            console.error("Error al cerrar caja", error);
            toast.error('Error al procesar la operación');
        }
    };

    const validatePartialCloseForm = (): boolean => {
        if (!movementType) {
            toast.warning('Seleccioná si el movimiento es un retiro o un egreso.');
            return false;
        }

        const amountNum = Number(partialAmount);
        if (partialAmount === '' || !Number.isFinite(amountNum) || amountNum <= 0) {
            toast.warning('Ingresá un monto mayor a cero.');
            return false;
        }

        const normalizedName = recipientName.trim();
        const normalizedNotes = partialNotes.trim();

        if (normalizedName.length === 0 && normalizedNotes.length === 0) {
            toast.warning('Completá el nombre o las notas para continuar.');
            return false;
        }

        return true;
    };

    const resetPartialCloseForm = () => {
        setPartialCloseStep(1);
        setPartialAmount('');
        setRecipientName('');
        setPartialNotes('');
        setMovementType(null);
    };

    const closePartialCloseModal = () => {
        setIsPartialCloseModalOpen(false);
        resetPartialCloseForm();
    };

    const handlePartialClose = async () => {
        if (!validatePartialCloseForm()) return;

        const normalizedName = recipientName.trim();
        const normalizedNotes = partialNotes.trim();

        try {
            await api.post('/caja/cierre-parcial', {
                operator: operatorName,
                amount: Number(partialAmount),
                recipient_name: normalizedName,
                notes: normalizedNotes,
                movement_type: movementType
            });
            toast.success(movementType === 'expense' ? 'EGRESO REGISTRADO CORRECTAMENTE' : 'RETIRO PARCIAL REGISTRADO CORRECTAMENTE');
            PrinterService.printPartialCloseTicket({
                timestamp: new Date().toISOString(),
                operatorName: operatorName,
                recipientName: normalizedName,
                partialNotes: normalizedNotes,
                partialAmount: Number(partialAmount),
                movement_type: movementType
            });
            closePartialCloseModal();
            loadMovements(); // Refrescar movimientos + retiros
        } catch (error) {
            console.error("Error al registrar cierre parcial", error);
            toast.error('Error al procesar la operación');
        }
    };

    // --- Helpers ---
    const formatNumberWithDots = (val: number | string): string => {
        if (val === '') return '';
        return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    };

    const getReprintTypeBadge = (type: ReprintItem['type']) => {
        switch (type) {
            case 'Entrada':
                return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-sky-500/15 border border-sky-500/30 text-sky-400">Entrada</span>;
            case 'CobroEstadia':
                return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">Salida</span>;
            case 'CobroAbono':
                return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-violet-500/15 border border-violet-500/30 text-violet-400">Abono</span>;
            case 'Upgrade':
                return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-amber-500/15 border border-amber-500/30 text-amber-400">Upgrade</span>;
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
                            <span className="block text-emerald-500/80 text-xs font-bold uppercase tracking-widest">Efectivo en Caja</span>
                            <span className="text-4xl font-black text-white tracking-tighter">${total.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Acciones Rápidas */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <button
                    onClick={() => {
                        resetPartialCloseForm();
                        setIsPartialCloseModalOpen(true);
                    }}
                    className="flex justify-center items-center gap-3 bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-xl border border-slate-700 transition-colors shadow-lg group"
                >
                    <ArrowDownRight className="w-6 h-6 text-amber-500 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-lg">Retiro Parcial</span>
                </button>

                <button
                    onClick={() => setIsReprintModalOpen(true)}
                    className="flex justify-center items-center gap-3 bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-xl border border-slate-700 transition-colors shadow-lg group"
                >
                    <Printer className="w-6 h-6 text-sky-400 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-lg">Reimprimir Tickets</span>
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
                <div className="overflow-auto flex-1 app-scrollbar">
                    <table className="w-full table-fixed text-left border-collapse">
                        <colgroup>
                            <col className="w-[15%]" />
                            <col className="w-[20%]" />
                            <col className="w-[25%]" />
                            <col className="w-[25%]" />
                            <col className="w-[15%]" />
                        </colgroup>
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
                                        const isExpense = row.movement_type === 'expense';
                                        const reference = getPartialCloseReference(row);

                                        return (
                                            <tr key={`pc-${idx}`} className="hover:bg-slate-800/50 transition-colors bg-slate-900/30">
                                                <td className="p-4 font-mono text-slate-400">
                                                    {new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className={`p-4 font-semibold ${isExpense ? 'text-sky-400' : 'text-amber-400'}`}>
                                                    <div className="flex items-center gap-1.5">
                                                        <ArrowDownRight className="w-4 h-4" />
                                                        <span>{isExpense ? 'Egreso' : 'Cierre Parcial'}</span>
                                                    </div>
                                                </td>
                                                <td
                                                    colSpan={2}
                                                    className="p-4 align-middle min-w-0"
                                                    aria-label={`Referencia del ${isExpense ? 'egreso' : 'retiro'}: ${reference.text}`}
                                                >
                                                    <div className="grid w-full min-w-0 grid-cols-2">
                                                        <div className="col-start-1 min-w-0 flex justify-center">
                                                            <div
                                                                className={`max-w-full min-w-0 truncate text-center ${
                                                                    reference.hasReference ? 'text-slate-300' : 'text-slate-600 italic'
                                                                }`}
                                                                title={reference.text}
                                                            >
                                                                {reference.recipient && reference.notes ? (
                                                                    <>
                                                                        <span className="font-semibold text-slate-200">
                                                                            {reference.recipient}
                                                                        </span>
                                                                        <span className="text-slate-500">
                                                                            {' - '}
                                                                        </span>
                                                                        <span className="text-slate-400">
                                                                            {reference.notes}
                                                                        </span>
                                                                    </>
                                                                ) : (
                                                                    reference.text
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div aria-hidden="true" />
                                                    </div>
                                                </td>
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
                                                type="text"
                                                inputMode="numeric"
                                                value={formatNumberWithDots(totalInCash)}
                                                onChange={e => {
                                                    const rawValue = e.target.value.replace(/\D/g, '');
                                                    setTotalInCash(rawValue === '' ? '' : Number(rawValue));
                                                }}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 pl-8 text-white font-mono text-xl focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                                                placeholder="0.00"
                                            />
                                        </div>
                                        {difference !== null && (
                                            <div className="mt-2 flex items-center gap-1.5 font-mono text-sm font-bold">
                                                {difference === 0 && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Caja Cuadrada</span>}
                                                {difference < 0 && <span className="text-amber-500 flex items-center gap-1"><AlertCircle className="w-4 h-4" /> Faltante: -${Math.abs(difference).toLocaleString()}</span>}
                                                {difference > 0 && <span className="text-emerald-400 flex items-center gap-1"><TrendingUp className="w-4 h-4" /> Sobrante: +${difference.toLocaleString()}</span>}
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 text-sm font-bold mb-2">Queda en Caja (Fondo)</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={formatNumberWithDots(stayingInCash)}
                                                onChange={e => {
                                                    const rawValue = e.target.value.replace(/\D/g, '');
                                                    setStayingInCash(rawValue === '' ? '' : Number(rawValue));
                                                }}
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
                                    <div className="flex justify-between items-start text-slate-300">
                                        <span className="pt-1">Total en Caja:</span>
                                        <div className="flex flex-col items-end">
                                            <span className="font-mono text-lg">${Number(totalInCash).toLocaleString()}</span>
                                            {difference !== null && (
                                                <div className="flex items-center gap-1 font-mono text-xs font-bold mt-0.5">
                                                    {difference === 0 && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Caja Cuadrada</span>}
                                                    {difference < 0 && <span className="text-amber-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Faltante: -${Math.abs(difference).toLocaleString()}</span>}
                                                    {difference > 0 && <span className="text-emerald-400 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Sobrante: +${difference.toLocaleString()}</span>}
                                                </div>
                                            )}
                                        </div>
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
                                    <ArrowDownRight className={movementType === 'expense' ? 'text-sky-400 w-6 h-6' : 'text-amber-500 w-6 h-6'} /> {movementType === 'expense' ? 'Registrar Egreso' : (movementType === 'withdrawal' ? 'Registrar Retiro Parcial' : 'Registrar Retiro')}
                                </h3>

                                <div className="space-y-4 mb-8">
                                    <div>
                                        <label className="block text-slate-400 text-sm font-bold mb-2">
                                            Tipo de movimiento <span className="text-amber-500">*</span>
                                        </label>
                                        <div 
                                            role="radiogroup" 
                                            aria-label="Tipo de movimiento"
                                            className="flex p-1 bg-slate-950 border border-slate-700 rounded-xl"
                                        >
                                            <button
                                                type="button"
                                                role="radio"
                                                aria-checked={movementType === 'withdrawal'}
                                                onClick={() => setMovementType('withdrawal')}
                                                className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                                                    movementType === 'withdrawal' 
                                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-sm' 
                                                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800 border border-transparent'
                                                }`}
                                            >
                                                Retiro
                                            </button>
                                            <button
                                                type="button"
                                                role="radio"
                                                aria-checked={movementType === 'expense'}
                                                onClick={() => setMovementType('expense')}
                                                className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                                                    movementType === 'expense' 
                                                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/50 shadow-sm' 
                                                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800 border border-transparent'
                                                }`}
                                            >
                                                Egreso
                                            </button>
                                        </div>
                                    </div>

                                    {!movementType && (
                                        <p className="text-slate-400 text-sm italic mb-2">Seleccioná Retiro o Egreso para habilitar los campos.</p>
                                    )}

                                    <fieldset 
                                        disabled={!movementType}
                                        className={`space-y-4 transition-opacity duration-300 ${!movementType ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <div>
                                            <label className="block text-slate-400 text-sm font-bold mb-2">Monto</label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={formatNumberWithDots(partialAmount)}
                                                    onChange={e => {
                                                        const rawValue = e.target.value.replace(/\D/g, '');
                                                        setPartialAmount(rawValue === '' ? '' : Number(rawValue));
                                                    }}
                                                    className={`w-full bg-slate-950 border border-slate-700 rounded-xl p-3 pl-8 text-white font-mono text-xl outline-none ${movementType ? 'focus:border-amber-500 focus:ring-1 focus:ring-amber-500' : ''} disabled:bg-slate-900 disabled:text-slate-500 disabled:cursor-not-allowed`}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-slate-400 text-sm font-bold mb-2">{movementType === 'expense' ? 'Pagado a / Beneficiario' : 'Nombre de quien retira / Paga a'}</label>
                                            <input
                                                type="text"
                                                value={recipientName}
                                                onChange={e => setRecipientName(e.target.value)}
                                                className={`w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white outline-none ${movementType ? 'focus:border-amber-500 focus:ring-1 focus:ring-amber-500' : ''} disabled:bg-slate-900 disabled:text-slate-500 disabled:cursor-not-allowed`}
                                                placeholder={movementType === 'expense' ? 'Nombre del proveedor, entidad, etc.' : 'Proveedor, Dueño, etc.'}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-slate-400 text-sm font-bold mb-2">{movementType === 'expense' ? 'Concepto / Notas del egreso' : 'Notas del retiro'}</label>
                                            <textarea
                                                value={partialNotes}
                                                onChange={e => setPartialNotes(e.target.value)}
                                                className={`w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white outline-none min-h-[80px] ${movementType ? 'focus:border-amber-500 focus:ring-1 focus:ring-amber-500' : ''} disabled:bg-slate-900 disabled:text-slate-500 disabled:cursor-not-allowed`}
                                                placeholder="Detalles..."
                                            />
                                        </div>
                                        <p className="text-slate-500 text-xs italic">Completá al menos uno de estos dos campos.</p>
                                    </fieldset>
                                </div>
                                <div className="flex gap-3 mt-6">
                                    <button
                                        onClick={closePartialCloseModal}
                                        className="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold hover:bg-slate-700 transition"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (validatePartialCloseForm()) {
                                                setPartialCloseStep(2);
                                            }
                                        }}
                                        className={`flex-1 text-white py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 ${!movementType ? 'bg-slate-700 hover:bg-slate-600' : movementType === 'expense' ? 'bg-sky-600 hover:bg-sky-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                                    >
                                        Siguiente
                                    </button>
                                </div>
                            </>
                        )}

                        {partialCloseStep === 2 && (
                            <>
                                <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                                    <CheckCircle className={movementType === 'expense' ? 'text-sky-500 w-6 h-6' : 'text-emerald-500 w-6 h-6'} /> {movementType === 'expense' ? 'Confirmar Egreso' : 'Confirmar Retiro'}
                                </h3>

                                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 mb-6 relative overflow-hidden">
                                    <div className="flex justify-between items-center text-slate-300">
                                        <span>Nombre:</span>
                                        <span className="font-bold text-white">{recipientName.trim() || 'No informado'}</span>
                                    </div>
                                    <div className="flex flex-col text-slate-300 mt-2">
                                        <span className="mb-1 text-sm text-slate-500">Notas:</span>
                                        <p className="text-sm bg-slate-900 p-2 rounded border border-slate-800 italic">
                                            {partialNotes.trim() || 'Sin notas.'}
                                        </p>
                                    </div>
                                    <div className="h-px w-full bg-slate-800 my-4"></div>
                                    <div className="flex justify-between items-center text-white">
                                        <span className="font-bold text-lg text-amber-500">{movementType === 'expense' ? 'Importe del egreso:' : 'Monto a retirar:'}</span>
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
                                        className={`flex-1 text-white py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 ${movementType === 'expense' ? 'bg-sky-600 hover:bg-sky-500' : 'bg-amber-600 hover:bg-amber-500'}`}
                                    >
                                        {movementType === 'expense' ? 'Confirmar Egreso' : 'Confirmar Retiro'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Modal Reimprimir Tickets */}
            {isReprintModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col relative" style={{ maxHeight: '85vh' }}>
                        {/* Header */}
                        <div className="p-6 pb-4 border-b border-slate-800 flex items-center justify-between shrink-0">
                            <h3 className="text-2xl font-bold text-white flex items-center gap-3">
                                <div className="bg-sky-500/20 p-2 rounded-xl">
                                    <Printer className="text-sky-400 w-6 h-6" />
                                </div>
                                Centro de Reimpresión
                            </h3>
                            <button
                                onClick={() => {
                                    setIsReprintModalOpen(false);
                                    setReprintSearch('');
                                }}
                                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Search */}
                        <div className="px-6 py-3 border-b border-slate-800/50 shrink-0">
                            <div className="relative">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                <input
                                    type="text"
                                    value={reprintSearch}
                                    onChange={e => setReprintSearch(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 pl-10 text-white text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none placeholder-slate-600"
                                    placeholder="Buscar por patente..."
                                    autoFocus
                                />
                                {reprintSearch && (
                                    <button
                                        onClick={() => setReprintSearch('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center justify-between mt-2">
                                <p className="text-slate-500 text-xs">
                                    {filteredReprintItems.length} ticket{filteredReprintItems.length !== 1 ? 's' : ''} disponible{filteredReprintItems.length !== 1 ? 's' : ''}
                                </p>
                                <button
                                    onClick={loadReprintData}
                                    disabled={reprintLoading}
                                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-sky-400 transition-colors disabled:opacity-50"
                                >
                                    <RotateCcw className={`w-3 h-3 ${reprintLoading ? 'animate-spin' : ''}`} />
                                    Actualizar
                                </button>
                            </div>
                        </div>

                        {/* List */}
                        <div className="overflow-auto flex-1 px-2 app-scrollbar">
                            {reprintLoading ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                                    <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                                    <span className="text-sm font-medium">Cargando tickets...</span>
                                </div>
                            ) : filteredReprintItems.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-500">
                                    <Printer className="w-10 h-10 opacity-30" />
                                    <span className="text-sm font-medium">
                                        {reprintSearch ? 'Sin resultados para esta patente' : 'Sin tickets disponibles'}
                                    </span>
                                </div>
                            ) : (
                                <div className="py-2 space-y-1">
                                    {filteredReprintItems.map(item => (
                                        <div
                                            key={item.id}
                                            className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/60 transition-colors group"
                                        >
                                            {/* Time */}
                                            <div className="w-[52px] shrink-0 text-center">
                                                <span className="font-mono text-xs text-slate-500">
                                                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                <div className="font-mono text-[10px] text-slate-600">
                                                    {new Date(item.timestamp).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                                                </div>
                                            </div>

                                            {/* Badge */}
                                            <div className="w-[80px] shrink-0">
                                                {getReprintTypeBadge(item.type)}
                                            </div>

                                            {/* Plate */}
                                            <div className="flex-1 min-w-0">
                                                <span className="font-mono font-bold text-white text-sm">
                                                    {item.plate || '---'}
                                                </span>
                                                {item.notes && (
                                                    <p className="text-[10px] text-slate-600 truncate mt-0.5">
                                                        {item.notes}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Amount (if applicable) */}
                                            <div className="w-[80px] text-right shrink-0">
                                                {item.amount !== undefined && item.amount > 0 ? (
                                                    <span className="font-mono font-bold text-emerald-400 text-sm">
                                                        ${item.amount.toLocaleString()}
                                                    </span>
                                                ) : item.type === 'Entrada' ? (
                                                    <span className="text-[10px] text-slate-600">---</span>
                                                ) : (
                                                    <span className="font-mono text-slate-500 text-sm">$0</span>
                                                )}
                                            </div>

                                            {/* Reprint Button */}
                                            <button
                                                onClick={() => handleReprint(item)}
                                                disabled={reprintingId === item.id}
                                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-bold hover:bg-sky-500/20 hover:border-sky-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed group-hover:bg-sky-500/20"
                                            >
                                                {reprintingId === item.id ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <Printer className="w-3.5 h-3.5" />
                                                )}
                                                Reimprimir
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-slate-800 shrink-0">
                            <button
                                onClick={() => {
                                    setIsReprintModalOpen(false);
                                    setReprintSearch('');
                                }}
                                className="w-full bg-slate-800 text-slate-300 py-3 rounded-xl font-bold hover:bg-slate-700 transition"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CajaPage;
