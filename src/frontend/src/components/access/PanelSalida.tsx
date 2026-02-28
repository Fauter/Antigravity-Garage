import React, { useState, useEffect } from 'react';
import { Search, DollarSign, Wallet, CreditCard, QrCode, Printer, LogOut, Car, CheckCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../services/api';

import { useAuth } from '../../context/AuthContext';
import { PricingEngine } from '../../../../modules/Billing/domain/PricingEngine';
import { ApiTariffRepository } from '../../repositories/ApiTariffRepository';
import { ApiParamRepository } from '../../repositories/ApiParamRepository';
import { ApiPriceMatrixRepository } from '../../repositories/ApiPriceMatrixRepository';
import { PrinterService } from '../../services/PrinterService';

// Frontend Instance of Pricing Engine
const tariffRepo = new ApiTariffRepository();
const paramRepo = new ApiParamRepository();
const priceRepo = new ApiPriceMatrixRepository();
const pricingEngine = new PricingEngine(tariffRepo, paramRepo, priceRepo);

// API Hook simplified for this component
const useExitLogic = () => {
    const [loading, setLoading] = useState(false);
    const [stay, setStay] = useState<any>(null);
    const [price, setPrice] = useState<number>(0);
    const [basePrice, setBasePrice] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const { operatorName } = useAuth();

    const isSubscriber = Boolean(stay?.is_subscriber);

    const searchStay = async (plate: string) => {
        setLoading(true);
        setError(null);
        setStay(null);
        setPrice(0);
        setBasePrice(0);

        try {
            const res = await api.get(`/estadias/activa/${plate}`);
            console.log('📡 [API Response] Data recibida:', res.data);
            console.log('🔍 [Subscriber Check] Valor de is_subscriber:', res.data.is_subscriber);
            console.log('🏗️ [UI State] Seteando isSubscriber derivado como:', Boolean(res.data.is_subscriber));

            setStay(res.data);

            if (res.data) {
                if (!res.data.is_subscriber) {
                    setBasePrice(0);
                    setPrice(0); // Default to 0, wait for payment method
                }
            }

        } catch (err: any) {
            setError('Vehículo no encontrado o sin estadía activa.');
            setStay(null);
        } finally {
            setLoading(false);
        }
    };

    const processExit = async (plate: string, paymentMethod: string, invoiceType: string, promoPercentage: number) => {
        setLoading(true);
        try {
            // Include operator in the request
            const res = await api.post('/estadias/salida', {
                plate,
                paymentMethod,
                invoiceType,
                operator: operatorName,
                promoPercentage: promoPercentage || 0
            });
            return res.data;
        } catch (err: any) {
            setError(err.message);
            return null;
        } finally {
            setLoading(false);
        }
    };

    const resetLogic = () => {
        setStay(null);
        setPrice(0);
        setBasePrice(0);
        setError(null);
    };

    return { searchStay, stay, price, setPrice, basePrice, loading, error, isSubscriber, processExit: processExit as (plate: string, paymentMethod: string, invoiceType: string, promoPercentage: number) => Promise<any>, resetLogic };
};

const PanelSalida: React.FC = () => {
    const [plate, setPlate] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
    const [invoiceType, setInvoiceType] = useState<string | null>(null);
    const [promos, setPromos] = useState<any[]>([]);
    const [selectedPromo, setSelectedPromo] = useState<any>(null);
    const [showSuccess, setShowSuccess] = useState(false);

    const { searchStay, stay, price, setPrice, error, isSubscriber, processExit, resetLogic } = useExitLogic();
    const { isGlobalSyncing, operatorName } = useAuth();

    const handleCancel = () => {
        resetLogic(); // Limpia stay, price, error en el hook
        setPlate('');
        setPaymentMethod(null);
        setSelectedPromo(null);
        setInvoiceType(null);
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPaymentMethod(null);
        if (plate.length > 2) searchStay(plate);
    };

    // Load promos from local API on mount
    useEffect(() => {
        const fetchPromos = async () => {
            try {
                const res = await api.get('/promos');
                setPromos(res.data || []);
            } catch (err) {
                console.warn('[PanelSalida] No se pudieron cargar promos:', err);
                setPromos([]);
            }
        };
        fetchPromos();
    }, []);

    // Calculation Logic
    useEffect(() => {
        if (isSubscriber) return;

        const calculate = async () => {
            if (!stay || isSubscriber || !paymentMethod) return;

            const entryDate = new Date(stay.entryTime);
            const exitDate = new Date();

            // Log for debugging
            const durationMinutes = Math.ceil((exitDate.getTime() - entryDate.getTime()) / 60000);
            console.log(`[PanelSalida] Calculating for ${stay.plate} (${stay.vehicleType}) - Method: ${paymentMethod} - Duration: ${durationMinutes} min`);

            try {
                console.log("[PanelSalida] Llamando a PricingEngine con:", stay.plate, paymentMethod);
                let calculated = await pricingEngine.calculateParkingFee(
                    { ...stay, vehicleType: stay.vehicleType || 'Auto' },
                    exitDate,
                    paymentMethod
                );

                console.log(`[PanelSalida] Price Result: $${calculated}`);

                // Apply dynamic promo discount (percentage-based)
                if (selectedPromo && selectedPromo.porcentaje > 0) {
                    calculated = Math.round(calculated * (1 - selectedPromo.porcentaje / 100));
                }

                setPrice(calculated);
            } catch (err) {
                console.error("[PanelSalida] Calculation error:", err);
                setPrice(0);
            }
        };

        // Only run if we have a stay and it's not a subscriber 
        if (stay && !isSubscriber) {
            if (paymentMethod) {
                calculate();
            } else {
                setPrice(0);
            }
        }
    }, [paymentMethod, stay, selectedPromo, isSubscriber]);



    // ... other imports

    // ... inside handleExit
    const handleExit = async () => {
        if (!stay) return;

        const method = isSubscriber ? 'Efectivo' : (paymentMethod || 'Efectivo');
        const invoice = isSubscriber ? 'Final' : (invoiceType || 'Final');

        const result = await processExit(stay.plate, method, invoice, selectedPromo?.porcentaje || 0);
        if (result) {
            // TICKET (x2)
            // Even if subscriber, let's print the exit ticket (which has ABONADO title) as per the printer service support
            const exitStay = result.stay || { ...stay, exitTime: new Date() };
            const exitMovement = result.movement || {
                amount: price,
                paymentMethod: method,
                operator: operatorName,
                notes: isSubscriber ? 'Abonado' : 'Salida Registrada'
            };
            PrinterService.printExitTicket(exitStay, exitMovement);

            toast.success(`Salida ok: ${stay.plate}`, {
                description: isSubscriber ? 'Abonado (Sin Cargo)' : `Cobro: ${paymentMethod || 'Aut.'}`
            });

            setShowSuccess(true);

            setTimeout(() => {
                setShowSuccess(false);
                setPlate('');
                setPaymentMethod(null);
                setSelectedPromo(null);
                setInvoiceType(null);
                resetLogic();
            }, 2500);

        } else {
            toast.error('Error al registrar salida');
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden font-sans relative">

            {/* COMPACT HEADER */}
            <div className="px-3 py-2 bg-gray-950 border-b border-gray-800 shrink-0 flex justify-between items-center">
                <div className="flex items-center gap-2 text-blue-500">
                    <LogOut className="w-4 h-4 rotate-180" />
                    <h2 className="text-sm font-bold tracking-wide uppercase">Salida & Cobro</h2>
                </div>

                {stay && (
                    <button
                        onClick={handleCancel}
                        className="text-gray-500 hover:text-red-400 hover:bg-red-400/10 px-2 py-1 rounded-md transition-all flex items-center gap-1.5"
                    >
                        <X className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase">Cancelar</span>
                    </button>
                )}
            </div>

            {/* --- TOP SECTION (Compact Split) --- */}
            <div className="flex bg-gray-900 border-b border-gray-800" style={{ height: '35%' }}>

                {/* Evidence Viewer (Left) - NOT A LIVE CAMERA */}
                {/* ... Evidence Viewer code ... */}
                <div className="w-1/2 relative bg-gray-900 border-r border-gray-800 p-2 flex items-center justify-center overflow-hidden">
                    {stay ? (
                        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center bg-black/20 rounded-lg border border-gray-800/50">
                            {/* In a real app, this would be <img src={stay.photoUrl} /> */}
                            <Car className="w-16 h-16 text-gray-700 mb-2 opacity-50" />
                            <div className="text-gray-500 font-mono text-xs mb-1">FOTO DE ENTRADA</div>
                            <div className="text-white font-mono text-xl font-bold tracking-widest bg-black/50 px-3 py-1 rounded">
                                {stay.plate}
                            </div>
                            <span className="absolute top-2 left-2 text-[9px] font-bold text-gray-500 bg-black/50 px-1.5 py-0.5 rounded border border-gray-700">
                                {new Date(stay.entryTime).toLocaleDateString()}
                            </span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center opacity-30 text-center px-4">
                            <Search className="w-10 h-10 text-gray-500 mb-2" />
                            <span className="text-gray-400 font-medium text-[10px] uppercase tracking-wide">
                                Ingrese Patente<br />para ver foto
                            </span>
                        </div>
                    )}
                </div>

                {/* Data Panel (Right) */}
                <div className="w-1/2 p-4 flex flex-col relative bg-gray-900/50">
                    {stay ? (
                        <div className="flex flex-col h-full justify-center space-y-2">

                            {/* Time Data */}
                            <div className="space-y-2">
                                <div>
                                    <span className="text-gray-500 text-[9px] font-bold uppercase tracking-widest block mb-0.5">Vehículo</span>
                                    <span className="text-xl font-mono text-white font-bold">{stay.plate} - {stay.vehicleType || 'Auto'}</span>
                                </div>
                                <div className="flex justify-between text-sm border-b border-gray-800 pb-1">
                                    <span className="text-gray-500">Entrada</span>
                                    <span className="font-mono text-emerald-400">{new Date(stay.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="flex justify-between text-sm border-b border-gray-800 pb-1">
                                    <span className="text-gray-500">Salida</span>
                                    <span className="font-mono text-blue-400">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col justify-center items-center text-center">
                            <h3 className="text-gray-500 font-bold uppercase tracking-widest text-xs mb-2">Ingrese Patente</h3>
                            <form onSubmit={handleSearch} className="w-full flex gap-1">
                                <input
                                    type="text"
                                    value={plate}
                                    onChange={(e) => setPlate(e.target.value.toUpperCase())}
                                    className="flex-1 bg-gray-800 border border-gray-700 rounded p-2 text-xl font-mono text-center uppercase text-white outline-none focus:border-blue-500"
                                    maxLength={7}
                                    placeholder="AAA-000"
                                    autoFocus
                                />
                                <button type="submit" className="bg-blue-600 px-3 rounded">
                                    <Search className="w-4 h-4 text-white" />
                                </button>
                            </form>
                            {error && <p className="text-red-400 text-[10px] mt-1">{error}</p>}
                        </div>
                    )}
                </div>
            </div>

            {/* --- MIDDLE SECTION & FOOTER (STRICT BIFURCATION) --- */}
            {stay && isSubscriber ? (
                <>
                    <div className="flex-1 p-3 bg-gray-950 flex flex-col justify-center gap-3 overflow-y-auto">
                        <div className="flex-1 flex items-center justify-center bg-emerald-900/20 rounded-xl border border-dashed border-emerald-800/50 p-4">
                            <div className="text-center">
                                <h4 className="text-emerald-500 font-black text-3xl mb-2 tracking-widest">VEHÍCULO ABONADO</h4>
                                <p className="text-emerald-400/80 text-base">Salida confirmada sin cargo.</p>
                            </div>
                        </div>
                    </div>
                    <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-800 shrink-0">
                        <button
                            onClick={handleExit}
                            disabled={isGlobalSyncing || showSuccess}
                            className={`w-full h-14 rounded-xl font-bold text-2xl uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-3 active:scale-[0.98] ${(isGlobalSyncing || showSuccess)
                                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                                }`}
                        >
                            {isGlobalSyncing ? 'Sincronizando...' : showSuccess ? 'Confirmando...' : 'Liberar Salida'}
                        </button>
                    </div>
                </>
            ) : stay ? (
                <>
                    <div className="flex-1 p-3 bg-gray-950 flex flex-col justify-center gap-3 overflow-y-auto">
                        {/* Payment Row */}
                        <div>
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 block">Medio de Pago</label>
                            <div className="grid grid-cols-5 gap-1.5">
                                {[
                                    { id: 'Efectivo', label: 'Efectivo', icon: DollarSign, color: 'emerald' },
                                    { id: 'Transferencia', label: 'Transf.', icon: Wallet, color: 'indigo' },
                                    { id: 'Debito', label: 'Débito', icon: CreditCard, color: 'blue' },
                                    { id: 'Credito', label: 'Crédito', icon: CreditCard, color: 'violet' },
                                    { id: 'QR', label: 'QR', labelShort: 'QR', icon: QrCode, color: 'cyan' },
                                ].map((m) => (
                                    <button
                                        key={m.id}
                                        onClick={() => setPaymentMethod(m.id)}
                                        className={`h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all border ${paymentMethod === m.id
                                            ? `bg-${m.color}-900/40 border-${m.color}-500 text-${m.color}-300 shadow-lg scale-105`
                                            : 'bg-gray-900 border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                                            }`}
                                    >
                                        <m.icon className="w-4 h-4" />
                                        <span className="text-[10px] font-bold uppercase">{m.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Invoice Row */}
                        <div>
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 block">Tipo Factura</label>
                            <div className="grid grid-cols-3 gap-1.5">
                                {['Final', 'A', 'CC'].map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => setInvoiceType(t)}
                                        className={`h-10 rounded-lg text-xs font-bold uppercase transition-all border ${invoiceType === t
                                            ? 'bg-gray-800 border-gray-500 text-white shadow'
                                            : 'bg-gray-900 border-gray-800 text-gray-600 hover:bg-gray-800'
                                            }`}
                                    >
                                        <span className="flex items-center justify-center gap-2">
                                            <Printer className="w-3 h-3" /> {t}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-800 shrink-0">
                        <div className="bg-gray-950 border border-gray-800 rounded-xl p-3 flex justify-center items-center gap-8 mb-3 shadow-inner">
                            <div className="text-center">
                                <span className="text-gray-600 text-[10px] font-bold uppercase tracking-widest block mb-1">Total a Pagar</span>
                                <span className={`text-5xl font-black tracking-tighter block ${price > 0 ? 'text-white drop-shadow-md' : 'text-gray-700'}`}>
                                    ${price.toLocaleString()}
                                </span>
                            </div>

                            <div className="h-12 w-[1px] bg-gray-800"></div> {/* Divider */}

                            <div className="w-48">
                                <span className="text-gray-600 text-[10px] font-bold uppercase tracking-widest block mb-1">Descuento / Promo</span>
                                <select
                                    value={selectedPromo ? selectedPromo.id : ''}
                                    onChange={(e) => {
                                        const found = promos.find(p => p.id === e.target.value);
                                        setSelectedPromo(found || null);
                                    }}
                                    className="w-full h-12 bg-gray-900 border border-gray-700 text-white text-base rounded-lg px-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer hover:border-gray-600 transition-colors"
                                >
                                    <option value="">Sin Descuento</option>
                                    {promos.map(p => (
                                        <option key={p.id} value={p.id}>{p.nombre} ({p.porcentaje}%)</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <button
                            onClick={handleExit}
                            disabled={!paymentMethod || !invoiceType || isGlobalSyncing || showSuccess}
                            className={`w-full h-14 rounded-xl font-bold text-xl uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-3 active:scale-[0.98] ${(!paymentMethod || !invoiceType || isGlobalSyncing || showSuccess)
                                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30 ring-1 ring-white/10'
                                }`}
                        >
                            {isGlobalSyncing ? 'Sincronizando...' : showSuccess ? 'Confirmando...' : 'Registrar Salida'}
                        </button>
                    </div>
                </>
            ) : null}

            {/* SUCCESS OVERLAY */}
            {showSuccess && stay && (
                <div className="absolute inset-0 z-50 bg-gray-950/95 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
                    <div className={`w-28 h-28 mb-6 rounded-full flex items-center justify-center shadow-2xl ${isSubscriber ? 'bg-emerald-500/20 shadow-emerald-500/20' : 'bg-blue-500/20 shadow-blue-500/20'}`}>
                        <CheckCircle className={`w-16 h-16 animate-[pulse_1s_ease-in-out_infinite] ${isSubscriber ? 'text-emerald-500' : 'text-blue-500'}`} />
                    </div>
                    <div className="text-center font-bold">
                        <h2 className={`text-4xl font-black tracking-widest uppercase mb-3 ${isSubscriber ? 'text-emerald-400' : 'text-blue-400'}`}>
                            SALIDA REGISTRADA
                        </h2>
                        <div className="text-white font-mono text-5xl tracking-widest bg-black/60 px-6 py-3 rounded-lg border border-gray-800 inline-block mb-4 mt-2">
                            {stay.plate}
                        </div>
                        <p className="text-gray-400 uppercase tracking-widest text-sm font-bold">
                            {isSubscriber ? 'Vehículo Abonado' : `Cobro Efectuado - ${paymentMethod || 'Efectivo'}`}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PanelSalida;
