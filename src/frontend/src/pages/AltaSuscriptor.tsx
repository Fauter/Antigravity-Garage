import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { toast } from 'sonner';
import { Camera, Car, Check, User, MapPin, Phone, CreditCard, AlertTriangle } from 'lucide-react';
import { WebcamModal } from '../components/common/WebcamModal';

const AltaSuscriptor: React.FC = () => {
    // --- STATE ---
    const [loading, setLoading] = useState(false);
    const [showCameraModal, setShowCameraModal] = useState(false);
    const [activePhotoField, setActivePhotoField] = useState<string | null>(null);
    const [photos, setPhotos] = useState<{ [key: string]: string }>({});

    // Data State
    const [basePriceDisplay, setBasePriceDisplay] = useState(0);
    const [proratedPrice, setProratedPrice] = useState(0);
    const [pricesMatrix, setPricesMatrix] = useState<any>({}); // For fetching real prices

    const [formData, setFormData] = useState({
        // 1. Cochera
        tipoCochera: 'Movil', // 'Movil' | 'Fija'
        numeroCochera: '',
        exclusivaOverride: false,

        // 2. Personales
        nombre: '',
        dni: '',
        email: '',
        domicilio: '',
        localidad: '',
        domicilioTrabajo: '',
        telParticular: '',
        telEmergencia: '',
        telTrabajo: '',

        // 3. Vehículo
        patente: '',
        marca: '',
        modelo: '',
        color: '',
        anio: '',
        companiaSeguro: '',
        tipoVehiculo: 'Auto', // Default

        // 4. Pago
        metodoPago: 'Efectivo',
        tipoFactura: 'B',
    });

    // --- EFFECTS ---
    useEffect(() => {
        loadConfig();
    }, []);

    // Recalculate Price when dependencies change
    useEffect(() => {
        calculatePrice();
    }, [formData.tipoCochera, formData.exclusivaOverride, formData.tipoVehiculo, pricesMatrix]);

    const loadConfig = async () => {
        try {
            const res = await api.get('/config/precios');
            if (res.data && res.data.efectivo) {
                setPricesMatrix(res.data.efectivo);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const calculatePrice = () => {
        // 1. Determine Base Price
        let base = 0;
        const typeKey = formData.tipoVehiculo; // 'Auto', 'Moto', etc.

        // Try to get from loaded matrix, else fallback
        const matrixPrice = pricesMatrix[typeKey]?.mensual;

        if (matrixPrice) {
            base = Number(matrixPrice);
        } else {
            // Fallback hardcoded if matrix fails
            base = typeKey === 'Moto' ? 20000 : 30000;
        }

        // Fija/Exclusiva surcharge logic (simplified for now, or fetch specific fixed price)
        if (formData.tipoCochera === 'Fija') {
            base = Math.floor(base * 1.2); // +20% for Fija example
            if (formData.exclusivaOverride) base = Math.floor(base * 1.5); // +50% Exclusiva
        }

        setBasePriceDisplay(base);

        // 2. Prorata Logic: (Base / 30) * Remaining Days
        const now = new Date();
        const currentDay = now.getDate();
        const remainingDays = 30 - currentDay + 1; // "Commercial Month" of 30 days

        // Safety: If day is 31, remaining is 0 or negative? Let's cap min at 1 day or 0 if end of month
        const validRemaining = Math.max(0, remainingDays);

        const calc = Math.floor((base / 30) * validRemaining);
        setProratedPrice(calc);
    };

    // --- HANDLERS ---
    const openCamera = (field: string) => {
        setActivePhotoField(field);
        setShowCameraModal(true);
    };

    const handleCapture = (img: string) => {
        if (activePhotoField) {
            setPhotos(prev => ({ ...prev, [activePhotoField]: img }));
            setShowCameraModal(false);
            setActivePhotoField(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        // Validations
        if (formData.tipoCochera === 'Fija' && !formData.numeroCochera) {
            toast.error('Cochera Fija requiere número.');
            setLoading(false);
            return;
        }

        try {
            const finalType = formData.exclusivaOverride ? 'Exclusiva' : formData.tipoCochera;

            // 1. Create Cochera (if not Movil)
            if (finalType !== 'Movil') {
                await api.post('/cocheras', {
                    tipo: finalType,
                    numero: formData.numeroCochera,
                    vehiculos: [],
                    precioBase: basePriceDisplay
                });
            }

            // 2. Create Subscription
            await api.post('/abonos', {
                customerData: {
                    nombreApellido: formData.nombre,
                    dni: formData.dni,
                    email: formData.email,
                    address: formData.domicilio,
                    localidad: formData.localidad,
                    workAddress: formData.domicilioTrabajo,
                    phones: {
                        particular: formData.telParticular,
                        emergency: formData.telEmergencia,
                        work: formData.telTrabajo
                    }
                },
                vehicleData: {
                    plate: formData.patente,
                    brand: formData.marca,
                    model: formData.modelo,
                    color: formData.color,
                    year: formData.anio,
                    insurance: formData.companiaSeguro,
                    type: formData.tipoVehiculo
                },
                subscriptionType: finalType,
                paymentMethod: formData.metodoPago,
                amount: proratedPrice,
                billingType: formData.tipoFactura,
                photos: photos // Send photos if backend supports it
            });

            toast.success('ALTA EXITOSA');
            // Cleanup
            setFormData(prev => ({ ...prev, numeroCochera: '', patente: '', nombre: '', dni: '' }));
            setPhotos({});
        } catch (error: any) {
            toast.error('Error en Alta: ' + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-full bg-[#0a0a0a] flex flex-col p-4 overflow-hidden text-white">
            <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <User className="text-emerald-500" /> Nuevo Suscriptor
            </h1>

            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-2xl flex overflow-hidden shadow-2xl">

                {/* --- FORM COLUMN (SCROLLABLE) --- */}
                <div className="flex-1 overflow-y-auto p-8 scrollbar-thin scrollbar-thumb-gray-700">
                    <form onSubmit={handleSubmit} className="space-y-8">

                        {/* 1. COCHERA (TOP) */}
                        <section className="bg-black/40 p-5 rounded-xl border border-gray-800 relative group">
                            <div className="absolute top-0 left-0 bg-emerald-600 text-xs font-bold px-2 py-1 rounded-br-lg">1. COCHERA</div>
                            <div className="mt-2 flex items-center gap-6">
                                <div className="flex bg-gray-800 p-1 rounded-lg">
                                    {['Movil', 'Fija'].map(type => (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, tipoCochera: type })}
                                            className={`px-8 py-2 rounded-md font-bold text-sm transition-all ${formData.tipoCochera === type ? 'bg-emerald-500 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            {type.toUpperCase()}
                                        </button>
                                    ))}
                                </div>

                                {formData.tipoCochera === 'Fija' && (
                                    <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-2">
                                        <input
                                            placeholder="N° (Ej. 104)"
                                            className="bg-gray-800 border-gray-700 rounded px-4 py-2 w-32 font-bold text-center focus:border-emerald-500 outline-none"
                                            value={formData.numeroCochera}
                                            onChange={e => setFormData({ ...formData, numeroCochera: e.target.value })}
                                        />
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="accent-purple-500 w-5 h-5"
                                                checked={formData.exclusivaOverride}
                                                onChange={e => setFormData({ ...formData, exclusivaOverride: e.target.checked })}
                                            />
                                            <span className="text-purple-400 font-bold">ES EXCLUSIVA</span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* 2. DATOS PERSONALES */}
                        <section>
                            <h3 className="text-gray-400 text-xs font-bold uppercase mb-3 flex items-center gap-2">
                                <User className="w-4 h-4" /> Datos Personales
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <input placeholder="Nombre Completo" className="input-field col-span-2" value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })} required />
                                <input placeholder="DNI / CUIT" className="input-field" value={formData.dni} onChange={e => setFormData({ ...formData, dni: e.target.value })} required />

                                <input placeholder="Domicilio Real" className="input-field col-span-2" value={formData.domicilio} onChange={e => setFormData({ ...formData, domicilio: e.target.value })} />
                                <input placeholder="Localidad" className="input-field" value={formData.localidad} onChange={e => setFormData({ ...formData, localidad: e.target.value })} />

                                <input placeholder="Domicilio Trabajo" className="input-field col-span-3" value={formData.domicilioTrabajo} onChange={e => setFormData({ ...formData, domicilioTrabajo: e.target.value })} />

                                <div className="col-span-3 grid grid-cols-3 gap-4 pt-2">
                                    <div className="relative">
                                        <Phone className="w-4 h-4 absolute top-3 left-3 text-gray-500" />
                                        <input placeholder="Tel. Particular" className="input-field pl-9" value={formData.telParticular} onChange={e => setFormData({ ...formData, telParticular: e.target.value })} />
                                    </div>
                                    <div className="relative">
                                        <Phone className="w-4 h-4 absolute top-3 left-3 text-red-500/60" />
                                        <input placeholder="Tel. Emergencia" className="input-field pl-9 border-red-900/30 focus:border-red-500" value={formData.telEmergencia} onChange={e => setFormData({ ...formData, telEmergencia: e.target.value })} />
                                    </div>
                                    <div className="relative">
                                        <Phone className="w-4 h-4 absolute top-3 left-3 text-blue-500/60" />
                                        <input placeholder="Tel. Trabajo" className="input-field pl-9 border-blue-900/30 focus:border-blue-500" value={formData.telTrabajo} onChange={e => setFormData({ ...formData, telTrabajo: e.target.value })} />
                                    </div>
                                </div>
                                <input placeholder="Email" type="email" className="input-field col-span-3" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                            </div>
                        </section>

                        {/* 3. FOTOS (MODAL) */}
                        <section>
                            <h3 className="text-gray-400 text-xs font-bold uppercase mb-3 flex items-center gap-2">
                                <Camera className="w-4 h-4" /> Documentación (Fotos)
                            </h3>
                            <div className="grid grid-cols-3 gap-4">
                                {['DNI', 'Cédula', 'Seguro'].map(doc => (
                                    <button
                                        key={doc}
                                        type="button"
                                        onClick={() => openCamera(doc)}
                                        className={`h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 ${photos[doc] ? 'border-emerald-500 bg-emerald-900/20' : 'border-gray-700 bg-black/20 hover:bg-white/5'}`}
                                    >
                                        {photos[doc] ? (
                                            <>
                                                <Check className="w-6 h-6 text-emerald-500" />
                                                <span className="text-xs font-bold text-emerald-400">{doc} OK</span>
                                            </>
                                        ) : (
                                            <>
                                                <Camera className="w-6 h-6 text-gray-500" />
                                                <span className="text-xs font-bold text-gray-500">Foto {doc}</span>
                                            </>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </section>

                        {/* 4. VEHICULO & PAGO */}
                        <section className="grid grid-cols-2 gap-8">
                            <div>
                                <h3 className="text-gray-400 text-xs font-bold uppercase mb-3 flex items-center gap-2">
                                    <Car className="w-4 h-4" /> Vehículo
                                </h3>
                                <div className="space-y-3">
                                    <input placeholder="PATENTE" className="input-field font-mono uppercase text-lg tracking-widest text-center border-l-4 border-l-emerald-500" value={formData.patente} onChange={e => setFormData({ ...formData, patente: e.target.value.toUpperCase() })} required />
                                    <div className="grid grid-cols-2 gap-3">
                                        <input placeholder="Marca" className="input-field" value={formData.marca} onChange={e => setFormData({ ...formData, marca: e.target.value })} />
                                        <input placeholder="Modelo" className="input-field" value={formData.modelo} onChange={e => setFormData({ ...formData, modelo: e.target.value })} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <input placeholder="Color" className="input-field" value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} />
                                        <input placeholder="Año" className="input-field" value={formData.anio} onChange={e => setFormData({ ...formData, anio: e.target.value })} />
                                    </div>
                                    <input placeholder="Cía. Seguro" className="input-field" value={formData.companiaSeguro} onChange={e => setFormData({ ...formData, companiaSeguro: e.target.value })} />
                                    <select className="input-field" value={formData.tipoVehiculo} onChange={e => setFormData({ ...formData, tipoVehiculo: e.target.value })}>
                                        <option value="Auto">Auto</option>
                                        <option value="Moto">Moto</option>
                                        <option value="Camioneta">Camioneta</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-gray-400 text-xs font-bold uppercase mb-3 flex items-center gap-2">
                                    <CreditCard className="w-4 h-4" /> Pago
                                </h3>
                                <div className="space-y-3">
                                    <select className="input-field" value={formData.metodoPago} onChange={e => setFormData({ ...formData, metodoPago: e.target.value })}>
                                        <option value="Efectivo">Efectivo</option>
                                        <option value="Tarjeta">Tarjeta</option>
                                        <option value="Transferencia">Transferencia</option>
                                    </select>
                                    <select className="input-field" value={formData.tipoFactura} onChange={e => setFormData({ ...formData, tipoFactura: e.target.value })}>
                                        <option value="B">Factura B</option>
                                        <option value="A">Factura A</option>
                                    </select>
                                </div>
                            </div>
                        </section>

                    </form>
                </div>

                {/* --- SUMMARY SIDEBAR --- */}
                <div className="w-80 bg-gray-950 border-l border-gray-800 p-6 flex flex-col justify-between">
                    <div>
                        <h2 className="text-white font-bold text-xl mb-6 sticky top-0">Resumen de Alta</h2>

                        <div className="space-y-4 text-sm">
                            <div className="flex justify-between border-b border-gray-800 pb-2">
                                <span className="text-gray-500">Base {formData.tipoCochera}</span>
                                <span className="text-white font-mono">${basePriceDisplay.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-800 pb-2">
                                <span className="text-gray-500">Días Restantes</span>
                                <span className="text-emerald-400 font-bold">{Math.max(0, 30 - new Date().getDate() + 1)} días</span>
                            </div>

                            <div className="bg-emerald-900/20 p-4 rounded-xl border border-emerald-500/30 mt-6">
                                <span className="block text-gray-400 text-xs mb-1 uppercase tracking-wider">A Pagar Hoy (Prorrateo)</span>
                                <span className="block text-4xl font-black text-white tracking-tighter">${proratedPrice.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 mt-4"
                    >
                        {loading ? 'Procesando...' : <><Check className="w-5 h-5" /> CONFIRMAR ALTA</>}
                    </button>

                    <style>{`
                        .input-field {
                            @apply w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500 transition-colors text-sm placeholder-gray-600;
                        }
                    `}</style>
                </div>
            </div>

            {/* MODAL */}
            <WebcamModal
                isOpen={showCameraModal}
                onClose={() => setShowCameraModal(false)}
                onCapture={handleCapture}
                label={activePhotoField || 'Doc'}
            />
        </div>
    );
};

export default AltaSuscriptor;
