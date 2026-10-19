import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { toast } from 'sonner';
import { Wallet, TrendingUp, Calendar, User, ArrowDownRight, LogOut, FileText, CheckCircle, AlertCircle, CheckCircle2, Printer, Search, X, Loader2, RotateCcw } from 'lucide-react';
import { PrinterService } from '../services/PrinterService';
import { calculateCajaShift } from '../utils/cajaCalculations';

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

const getMovementDetail = (m: Movement): string => {
    if (m.type !== 'CobroAbono') {
        return m.plate || '---';
    }

    const notes = m.notes?.trim();
    if (!notes || notes.toUpperCase() === 'N/A') {
        if (m.plate && m.plate.toUpperCase() !== 'N/A' && m.plate !== '---') {
            return m.plate;
        }
        return '---';
    }

    try {
        // C) Cobro Abono Múltiples Meses
        const multiplesMesesMatch = notes.match(/^Cobro Abono \((Múltiples Meses:.*?)\)(.*)$/i);
        if (multiplesMesesMatch) {
            const monthsStr = multiplesMesesMatch[1];
            const rest = multiplesMesesMatch[2];
            
            const prefixMatch = monthsStr.match(/^(Múltiples Meses:\s*)/i);
            if (prefixMatch) {
                const prefix = prefixMatch[1];
                const datesPart = monthsStr.substring(prefix.length);
                const dates = datesPart.split(',').map(d => d.trim());
                const monthMap: Record<string, string> = {
                    '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun',
                    '07': 'Jul', '08': 'Ago', '09': 'Sept', '10': 'Oct', '11': 'Nov', '12': 'Dic'
                };
                
                const parsedMonths: string[] = [];
                let hasError = false;
                for (const d of dates) {
                    const parts = d.split('-');
                    if (parts.length === 2 && monthMap[parts[1]]) {
                        const mName = monthMap[parts[1]];
                        if (!parsedMonths.includes(mName)) {
                            parsedMonths.push(mName);
                        }
                    } else {
                        hasError = true;
                        break;
                    }
                }
                if (!hasError && parsedMonths.length > 0) {
                    return `${prefix.trim()} ${parsedMonths.join(', ')}${rest}`;
                }
            }
        }

        // D) Renovación Abono Anticipada
        const renovacionRegex = /^(.*?- Hasta\s+)\d{1,2}\/(\d{2})\/\d{4}(.*)$/i;
        const matchRenovacion = notes.match(renovacionRegex);
        if (matchRenovacion) {
            const prefix = matchRenovacion[1];
            const month = matchRenovacion[2];
            const suffix = matchRenovacion[3];
            const fullMonthMap: Record<string, string> = {
                '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio',
                '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
            };
            if (fullMonthMap[month]) {
                return `${prefix}${fullMonthMap[month]}${suffix}`;
            }
        }

        // E) Pago Parcial por Renovación
        if (notes.toLowerCase().startsWith('pago parcial por renovación')) {
            const saldoIndex = notes.toLowerCase().indexOf('saldo restante:');
            if (saldoIndex !== -1) {
                return notes.substring(0, saldoIndex).trim();
            }
        }
    } catch (e) {
        // Fallback to original notes on error
    }

    return notes;
};

const getAdvancePaymentDetail = (m: Movement): string | null => {
    if (m.type !== 'CobroEstadia') return null;
    const notes = m.notes?.trim();
    if (!notes) return null;

    const match = notes.match(/^Pago Anticipado\s*-\s*(.+)$/i);
    if (match) {
        const detail = match[1].trim();
        if (detail) {
            return detail;
        }
    }
    return null;
};

const CajaPage: React.FC = () => {
    const { user, operatorName, logout } = useAuth();
    const [unifiedRows, setUnifiedRows] = useState<UnifiedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [total, setTotal] = useState(0);

    // Prevenir dobles clics y carreras concurrentes
    const [isSubmittingShiftClose, setIsSubmittingShiftClose] = useState(false);
    const [isSubmittingPartialClose, setIsSubmittingPartialClose] = useState(false);

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
    const [reprintOffset, setReprintOffset] = useState(0);
    const [hasMoreReprint, setHasMoreReprint] = useState(true);
    const REPRINT_LIMIT = 50;

    // Keep raw movements for reprint cross-reference
    const [rawMovements, setRawMovements] = useState<Movement[]>([]);
    const [recentStays, setRecentStays] = useState<RecentStay[]>([]);

    useEffect(() => {
        loadMovements();
    }, [user, operatorName]);

    // Recargar automáticamente cuando se complete una sincronización en segundo plano
    useEffect(() => {
        const handleSync = () => {
            console.log('[CajaPage] Sincronización en segundo plano completada, refrescando caja...');
            loadMovements();
        };
        window.addEventListener('ag:sync-completed', handleSync);
        return () => window.removeEventListener('ag:sync-completed', handleSync);
    }, [user, operatorName]);

    const loadMovements = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [movRes, pcRes, scRes] = await Promise.all([
                api.get('/caja/movimientos'),
                api.get('/caja/cierres-parciales'),
                api.get('/caja/cierres')
            ]);

            if (!Array.isArray(movRes.data) || !Array.isArray(pcRes.data) || !Array.isArray(scRes.data)) {
                throw new Error('Respuesta no válida del servidor.');
            }

            // La caja pertenece al GARAGE, no al operador.
            // Se calcula el estado del turno abierto utilizando como ancla el último cierre global.
            const result = calculateCajaShift({
                movements: movRes.data,
                partialCloses: pcRes.data,
                shiftCloses: scRes.data,
                activeGarageId: user?.garage_id
            });

            setUnifiedRows(result.unifiedRows as UnifiedRow[]);
            setRawMovements(movRes.data || []);
            setTotal(result.totalCashInDrawer);
            console.log('[CajaPage] Fondo Inicial:', result.fondoInicial, '| Último cierre global:', result.lastGlobalClose, '| Efectivo en caja:', result.totalCashInDrawer);
        } catch (error: any) {
            console.error('Error loading movements', error);
            const msg = error?.response?.data?.error || error?.message || 'Error al cargar los datos de caja';
            setLoadError(msg);
            toast.error('Error al cargar datos de caja');
        } finally {
            setLoading(false);
        }
    };

    // Load reprint data when modal opens or offset changes
    useEffect(() => {
        if (isReprintModalOpen) {
            loadReprintData(reprintOffset === 0);
        }
    }, [isReprintModalOpen, reprintOffset]);

    // Handle Search debounce
    useEffect(() => {
        if (!isReprintModalOpen) return;
        const delayDebounceFn = setTimeout(() => {
            setReprintOffset(0);
            loadReprintData(true);
        }, 500);
        return () => clearTimeout(delayDebounceFn);
    }, [reprintSearch]);

    const loadReprintData = async (reset = false) => {
        setReprintLoading(true);
        try {
            const currentOffset = reset ? 0 : reprintOffset;
            const res = await api.get(`/reimpresion/buscar?limit=${REPRINT_LIMIT}&offset=${currentOffset}&search=${encodeURIComponent(reprintSearch)}`);
            const data = res.data || [];
            
            // Backend already unified and sorted them!
            if (reset) {
                setReprintItems(data);
            } else {
                setReprintItems(prev => {
                    const existingIds = new Set(prev.map(i => i.id));
                    const newItems = data.filter((i: any) => !existingIds.has(i.id));
                    return [...prev, ...newItems];
                });
            }
            setHasMoreReprint(data.length === REPRINT_LIMIT);
        } catch (error) {
            console.error('Error loading reprint items:', error);
            toast.error('Error al cargar tickets');
        } finally {
            setReprintLoading(false);
        }
    };

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

        if (stay.is_prepaid || stay.isPrepaid) {
            const mov = item._movement || {};
            PrinterService.printPrepaidEntryTicket(stay, mov, 'Pago Anticipado');
            toast.success(`Reimprimiendo Ticket Anticipado: ${stay.plate}`);
        } else {
            PrinterService.printEntryTicket(stay);
            toast.success(`Reimprimiendo Ticket Entrada: ${stay.plate}`);
        }
    };

    const handleReprintExit = (item: ReprintItem) => {
        const mov = item._movement;
        if (!mov) {
            toast.error('Datos de movimiento no disponibles para reimpresión');
            return;
        }

        const matchingStay = item._stay;
        if (!matchingStay) {
            toast.error('No se encontraron los datos originales necesarios para reimprimir este ticket.');
            return;
        }

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

        PrinterService.printExitTicket(matchingStay, movementForPrint);
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

    // Filtered reprint items by search (handled by backend now)
    const filteredReprintItems = reprintItems;

    const handleShiftClose = async () => {
        if (loadError) {
            toast.error('No se puede cerrar la caja con errores pendientes de carga.');
            return;
        }
        if (isSubmittingShiftClose) return;
        setIsSubmittingShiftClose(true);

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
            setIsSubmittingShiftClose(false);
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
        if (isSubmittingPartialClose) return;
        setIsSubmittingPartialClose(true);

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
        } finally {
            setIsSubmittingPartialClose(false);
        }
    };

    // --- Helpers ---
    const cashFormatter = new Intl.NumberFormat('es-AR', {
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    });

    const formatCashDisplay = (val: number): string => {
        const absRounded = Math.round(Math.abs(val));
        const isNegative = val < 0 && absRounded > 0;
        const formatted = cashFormatter.format(absRounded);
        return (isNegative ? '-$' : '$') + formatted;
    };

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
        <div className="px-6 py-4 h-full flex flex-col bg-slate-950 text-gray-200 font-sans">

            <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                        <Wallet className="w-7 h-7 text-emerald-500" />
                        Caja del Turno
                    </h2>
                    <p className="text-gray-400 text-sm mt-1 flex items-center gap-2">
                        <User className="w-4 h-4 text-emerald-500" /> Operador: <span className="text-emerald-400 font-mono font-bold mr-2">{operatorName}</span>
                        |
                        <Calendar className="w-4 h-4 ml-2 text-emerald-500" /> Fecha: <span className="text-gray-300 font-mono">{new Date().toLocaleDateString()}</span>
                        <button
                            onClick={() => loadMovements()}
                            disabled={loading}
                            title="Actualizar movimientos de caja"
                            className="ml-2 p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
                        >
                            <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
                        </button>
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-emerald-900/20 border border-emerald-500/30 px-4 py-2.5 rounded-xl flex items-center gap-3.5">
                        <div className="bg-emerald-500/20 p-2.5 rounded-xl text-emerald-500">
                            <TrendingUp className="w-6 h-6" />
                        </div>
                        <div>
                            <span className="block text-emerald-500/80 text-xs font-bold uppercase tracking-widest">Efectivo en Caja</span>
                            <span className="text-3xl font-black text-white tracking-tight">{formatCashDisplay(total)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {loadError && (
                <div className="bg-red-950/80 border border-red-700 text-red-200 p-4 rounded-xl mb-4 flex items-center justify-between shadow-lg">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                        <div>
                            <p className="font-semibold text-red-100">Error al sincronizar datos de caja</p>
                            <p className="text-xs text-red-300/80 mt-0.5">{loadError}</p>
                        </div>
                    </div>
                    <button
                        onClick={loadMovements}
                        disabled={loading}
                        className="bg-red-800 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
                    >
                        <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Reintentar
                    </button>
                </div>
            )}

            {/* Acciones Rápidas */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <button
                    onClick={() => {
                        resetPartialCloseForm();
                        setIsPartialCloseModalOpen(true);
                    }}
                    className="flex justify-center items-center gap-3 bg-slate-800 hover:bg-slate-700 text-white py-2.5 px-4 rounded-xl border border-slate-700 transition-colors shadow-lg group"
                >
                    <ArrowDownRight className="w-6 h-6 text-amber-500 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-lg">Retiro Parcial</span>
                </button>

                <button
                    onClick={() => setIsReprintModalOpen(true)}
                    className="flex justify-center items-center gap-3 bg-slate-800 hover:bg-slate-700 text-white py-2.5 px-4 rounded-xl border border-slate-700 transition-colors shadow-lg group"
                >
                    <Printer className="w-6 h-6 text-sky-400 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-lg">Reimprimir Tickets</span>
                </button>

                <button
                    onClick={() => setIsShiftCloseModalOpen(true)}
                    className="flex justify-center items-center gap-3 bg-red-900/40 hover:bg-red-900/60 text-white py-2.5 px-4 rounded-xl border border-red-800/50 hover:border-red-500/50 transition-colors shadow-lg group"
                >
                    <LogOut className="w-6 h-6 text-red-400 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-lg text-red-100">Cierre de Caja Final</span>
                </button>
            </div>

            <div className="flex-1 overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col">
                <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/50">
                    <h3 className="text-base font-bold text-slate-300 flex items-center gap-2">
                        <FileText className="w-5 h-5" /> Movimientos del Turno
                    </h3>
                </div>
                <div className="overflow-auto flex-1 app-scrollbar">
                    <table className="w-full table-fixed text-left border-collapse">
                        <colgroup>
                            <col className="w-[10%]" />
                            <col className="w-[14%]" />
                            <col className="w-[46%]" />
                            <col className="w-[14%]" />
                            <col className="w-[16%]" />
                        </colgroup>
                        <thead className="bg-slate-950 text-slate-400 uppercase text-xs font-bold sticky top-0 z-10">
                            <tr>
                                <th scope="col" className="p-4 border-b border-slate-800 text-center">Hora</th>
                                <th scope="col" className="p-4 border-b border-slate-800 text-center">Tipo</th>
                                <th scope="col" className="p-4 border-b border-slate-800 text-left">Detalle</th>
                                <th scope="col" className="p-4 border-b border-slate-800 text-center">Pago</th>
                                <th scope="col" className="p-4 border-b border-slate-800 text-right">Monto</th>
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
                                                <td className="px-4 py-3 align-middle font-mono text-slate-400 text-center tabular-nums">
                                                    {new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className={`px-4 py-3 align-middle font-semibold ${isExpense ? 'text-sky-400' : 'text-amber-400'}`}>
                                                    <div className="flex items-center justify-center gap-1.5">
                                                        <ArrowDownRight className="w-4 h-4" />
                                                        <span>{isExpense ? 'Egreso' : 'Cierre Parcial'}</span>
                                                    </div>
                                                </td>
                                                <td
                                                    className="px-4 py-3 align-middle text-left min-w-0"
                                                    aria-label={`Referencia del ${isExpense ? 'egreso' : 'retiro'}: ${reference.text}`}
                                                >
                                                    <div
                                                        className={`min-w-0 whitespace-normal break-words leading-snug ${
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
                                                </td>
                                                <td className="px-4 py-3 align-middle text-center">
                                                    <span className="text-slate-600">—</span>
                                                </td>
                                                <td className="px-4 py-3 align-middle font-mono font-bold text-slate-500 text-right tabular-nums">
                                                    -${Number(row.amount).toLocaleString()}
                                                </td>
                                            </tr>
                                        );
                                    }

                                    // Movement row (existing behavior)
                                    const m = row as Movement & { _kind: 'movement' };
                                    const detail = getMovementDetail(m);
                                    const advanceDetail = getAdvancePaymentDetail(m);
                                    
                                    return (
                                        <tr key={`mv-${idx}`} className="hover:bg-slate-800/50 transition-colors">
                                            <td className="px-4 py-3 align-middle font-mono text-slate-400 text-center tabular-nums">
                                                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td className="px-4 py-3 align-middle text-slate-300 text-center">
                                                {m.type === 'CobroEstadia' ? 'Hora' : m.type === 'CobroAbono' ? 'Abono' : m.type}
                                            </td>
                                            <td className="px-4 py-3 align-middle text-left min-w-0">
                                                {m.type === 'CobroAbono' ? (
                                                    <div className="text-slate-200 font-medium text-sm leading-snug whitespace-normal break-words">
                                                        {detail}
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                                        <span className="inline-flex items-center font-mono font-bold text-white text-sm px-2 py-0.5 rounded-md bg-slate-800/50 border border-slate-700/60">
                                                            {detail}
                                                        </span>
                                                        {advanceDetail && (
                                                            <span className="text-[11px] font-light text-slate-500 leading-none whitespace-nowrap">
                                                                (Pago Anticipado - {advanceDetail})
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 align-middle text-center">
                                                <div className="flex items-center justify-center">
                                                    <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-slate-800 border border-slate-700 text-slate-300">
                                                        {m.paymentMethod}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 align-middle font-mono font-bold text-emerald-400 text-right tabular-nums">
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
                                    <span className="text-2xl font-black text-emerald-400 font-mono">{formatCashDisplay(total)}</span>
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
                                        disabled={isSubmittingShiftClose}
                                        className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-500 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSubmittingShiftClose ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" /> Procesando...
                                            </>
                                        ) : (
                                            <>
                                                Confirmar Cierre <LogOut className="w-5 h-5" />
                                            </>
                                        )}
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
                                        disabled={isSubmittingPartialClose}
                                        className={`flex-1 text-white py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${movementType === 'expense' ? 'bg-sky-600 hover:bg-sky-500' : 'bg-amber-600 hover:bg-amber-500'}`}
                                    >
                                        {isSubmittingPartialClose ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" /> Procesando...
                                            </>
                                        ) : (
                                            <>
                                                {movementType === 'expense' ? 'Confirmar Egreso' : 'Confirmar Retiro'}
                                            </>
                                        )}
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
                                    onClick={() => { setReprintOffset(0); loadReprintData(true); }}
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
                                    {hasMoreReprint && (
                                        <div className="pt-4 pb-2 flex justify-center">
                                            <button
                                                onClick={() => setReprintOffset(prev => prev + REPRINT_LIMIT)}
                                                disabled={reprintLoading}
                                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700 hover:text-white flex items-center gap-2"
                                            >
                                                {reprintLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                                Mostrar anteriores
                                            </button>
                                        </div>
                                    )}
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
