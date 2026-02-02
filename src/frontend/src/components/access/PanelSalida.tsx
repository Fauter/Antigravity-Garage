import React, { useState, useEffect } from 'react';
import { Search, DollarSign, Wallet, CreditCard, QrCode, Camera, Printer, LogOut, Car } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../services/api';

import { useAuth } from '../../context/AuthContext';
import { PricingEngine } from '../../../../modules/Billing/domain/PricingEngine';

// API Hook simplified for this component
const useExitLogic = () => {
    const [loading, setLoading] = useState(false);
    const [stay, setStay] = useState<any>(null);
    const [price, setPrice] = useState<number>(0);
    const [basePrice, setBasePrice] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [isSubscriber, setIsSubscriber] = useState(false);
    const { user } = useAuth();

    const searchStay = async (plate: string) => {
        setLoading(true);
        setError(null);
        setIsSubscriber(false);
        setStay(null);
        setPrice(0);
        setBasePrice(0);

        try {
            const res = await api.get(`/estadias/activa/${plate}`);
            setStay(res.data);

            if (plate.startsWith('ABO')) {
                setIsSubscriber(true);
            } else {
                if (res.data) {
                    const entry = new Date(res.data.entryTime);
                    const now = new Date();
                    const hours = Math.ceil((now.getTime() - entry.getTime()) / (1000 * 60 * 60));
                    const estimated = hours * 3000;
                    setBasePrice(estimated);
                    setPrice(estimated); // Default to base
                }
            }

        } catch (err: any) {
            setError('Vehículo no encontrado o sin estadía activa.');
            setStay(null);
        } finally {
            setLoading(false);
        }
    };

    const processExit = async (plate: string, paymentMethod: string) => {
        setLoading(true);
        try {
            // Include operator in the request
            await api.post('/estadias/salida', {
                plate,
                paymentMethod,
                operator: user ? `${user.nombre} ${user.apellido}` : 'Unknown'
            });
            setStay(null);
            setPrice(0);
            return true;
        } catch (err: any) {
            setError(err.message);
            return false;
        } finally {
            setLoading(false);
        }
    };

    return { searchStay, stay, price, setPrice, basePrice, loading, error, isSubscriber, processExit };
};

const PanelSalida: React.FC = () => {
    const [plate, setPlate] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
    const [invoiceType, setInvoiceType] = useState('Final');
    const [promo, setPromo] = useState('NINGUNA');

    const { searchStay, stay, price, setPrice, basePrice, loading, error, isSubscriber, processExit } = useExitLogic();

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPaymentMethod(null);
        if (plate.length > 2) searchStay(plate);
    };

    // Calculation Logic
    useEffect(() => {
        if (stay && !isSubscriber) {
            // PRICING ENGINE INTEGRATION
            // Assuming strict hourly rate of 3000 for now as per previous logic
            const hourlyRate = 3000;
            const entryDate = new Date(stay.entryTime);
            const exitDate = new Date(); // Live calculation

            let calculated = PricingEngine.calculateParkingFee(
                entryDate,
                exitDate,
                hourlyRate,
                paymentMethod || 'Efectivo'
            );

            // Promos apply AFTER base calculation
            if (promo === 'VISITA') calculated = 0;
            if (promo === 'LOCAL') calculated = Math.max(0, calculated - 1000);

            setPrice(calculated);
        } else if (!paymentMethod && !isSubscriber && stay) {
            setPrice(0); // Default to 0
        }
    }, [paymentMethod, stay, basePrice, isSubscriber, promo]);

    const handleExit = async () => {
        if (!stay) return;
        const success = await processExit(stay.plate, paymentMethod || 'Efectivo');
        if (success) {
            toast.success(`Salida ok: ${stay.plate}`, {
                description: `Cobro: ${paymentMethod || 'Aut.'}`
            });
            setPlate('');
            setPaymentMethod(null);
            setPromo('NINGUNA');
        } else {
            toast.error('Error al registrar salida');
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden font-sans">

            {/* COMPACT HEADER */}
            <div className="px-3 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
                <div className="flex items-center gap-2 text-blue-500">
                    <LogOut className="w-4 h-4 rotate-180" />
                    <h2 className="text-sm font-bold tracking-wide uppercase">Salida & Cobro</h2>
                </div>
            </div>

            {/* --- TOP SECTION (Compact Split) --- */}
            <div className="flex bg-gray-900 border-b border-gray-800" style={{ height: '35%' }}>

                {/* Evidence Viewer (Left) - NOT A LIVE CAMERA */}
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
                                    <span className="text-gray-500 text-[9px] font-bold uppercase tracking-widest block mb-0.5">Patente</span>
                                    <span className="text-xl font-mono text-white font-bold">{stay.plate}</span>
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

            {/* --- MIDDLE SECTION (CONTROLS) --- */}
            <div className="flex-1 p-3 bg-gray-950 flex flex-col justify-center gap-3 overflow-y-auto">
                {stay && !isSubscriber && (
                    <>
                        {/* Payment Row */}
                        <div>
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 block">Medio de Pago</label>
                            <div className="grid grid-cols-5 gap-1.5">
                                {[
                                    { id: 'Efectivo', label: 'Efectivo', icon: DollarSign, color: 'emerald' },
                                    { id: 'Transfer', label: 'Transf.', icon: Wallet, color: 'indigo' },
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
                    </>
                )}

                {stay && isSubscriber && (
                    <div className="flex-1 flex items-center justify-center bg-gray-900/30 rounded-xl border border-dashed border-gray-800 p-4">
                        <div className="text-center">
                            <h4 className="text-emerald-500 font-bold text-lg mb-0.5">Abonado Verificado</h4>
                            <p className="text-gray-500 text-xs">Salida permitida sin cargo.</p>
                        </div>
                    </div>
                )}
            </div>

            {/* --- COMPACT FOOTER (ACTION + PRICE) --- */}
            <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-800 shrink-0">

                {/* Price & Promo (Centered & Imposing) */}
                {stay && !isSubscriber && (
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
                                value={promo}
                                onChange={(e) => setPromo(e.target.value)}
                                className="w-full h-12 bg-gray-900 border border-gray-700 text-white text-base rounded-lg px-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer hover:border-gray-600 transition-colors"
                            >
                                <option value="NINGUNA">Ninguna</option>
                                <option value="VISITA">Visita (100%)</option>
                                <option value="LOCAL">Local (-$1000)</option>
                            </select>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleExit}
                    disabled={!stay || (!isSubscriber && !paymentMethod)}
                    className={`w-full h-14 rounded-xl font-bold text-xl uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-3 active:scale-[0.98] ${!stay || (!isSubscriber && !paymentMethod)
                        ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                        : isSubscriber
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30 ring-1 ring-white/10'
                        }`}
                >
                    {isSubscriber ? 'Liberar Salida' : 'Registrar Salida'}
                </button>
            </div>

        </div>
    );
};

export default PanelSalida;
