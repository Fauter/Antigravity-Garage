import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { toast } from 'sonner';
import { Camera, Car, Check, User, Phone, CreditCard, AlertTriangle, Wallet } from 'lucide-react';
import { WebcamModal } from '../common/WebcamModal';

const FormularioAbono: React.FC = () => {
    // --- STATE ---
    const [loading, setLoading] = useState(false);
    const [showCameraModal, setShowCameraModal] = useState(false);
    const [activePhotoField, setActivePhotoField] = useState<string | null>(null);
    const [photos, setPhotos] = useState<{ [key: string]: string }>({});

    // Load Vehicle Types once on mount
    useEffect(() => {
        api.get('/tipos-vehiculo')
            .then(res => {
                if (res.data && Array.isArray(res.data)) {
                    console.log("[Abonos] Tipos cargados:", res.data);
                    setVehicleTypes(res.data);
                    // Auto-selection removed

                }
            })
            .catch(e => console.error("Vehicle Type Load Error:", e));
    }, []);

    // Data
    const [basePriceDisplay, setBasePriceDisplay] = useState(0);
    const [proratedPrice, setProratedPrice] = useState(0);
    const [pricesMatrix, setPricesMatrix] = useState<any>({});
    const [vehicleTypes, setVehicleTypes] = useState<any[]>([]);

    const [formData, setFormData] = useState({
        // Cochera
        tipoCochera: 'Movil',
        numeroCochera: '',
        exclusivaOverride: false,

        // Personales
        nombre: '',
        dni: '',
        email: '',
        domicilio: '',
        localidad: '',
        domicilioTrabajo: '',
        telParticular: '',
        telEmergencia: '',
        telTrabajo: '',

        // Vehículo
        patente: '',
        marca: '',
        modelo: '',
        color: '',
        anio: '',
        companiaSeguro: '',
        tipoVehiculo: '',

        // Pago
        metodoPago: 'Efectivo',
        tipoFactura: 'Final',
    });

    useEffect(() => { loadConfig(); }, [formData.metodoPago]);
    useEffect(() => { calculatePrice(); }, [formData.tipoCochera, formData.exclusivaOverride, formData.tipoVehiculo, pricesMatrix]);

    const loadConfig = async () => {
        // Fetch prices based on current payment method
        const queryMethod = formData.metodoPago === 'Efectivo' ? 'efectivo' : 'otros';

        // Parallel independent fetches
        const fetchPrices = api.get(`/precios?metodo=${queryMethod}`).catch(e => { console.error("Price load error:", e); return null; });
        const fetchTypes = api.get('/tipos-vehiculo').catch(e => { console.error("Type load error:", e); return null; });

        const [priceRes, typeRes] = await Promise.all([fetchPrices, fetchTypes]);

        if (priceRes && priceRes.data) {
            // endpoint /precios?metodo=... returns the object directly
            setPricesMatrix(priceRes.data.efectivo || priceRes.data);
        }

        if (typeRes && typeRes.data && Array.isArray(typeRes.data)) {
            // Only update types if empty to avoid reset issues or just ensure list is fresh
            if (vehicleTypes.length === 0) {
                console.log("[Abonos] Tipos cargados:", typeRes.data);
                setVehicleTypes(typeRes.data);
                // Removed auto-selection logic
            }
        }
    };

    const calculatePrice = () => {
        const typeKey = formData.tipoVehiculo;
        if (!typeKey) {
            setBasePriceDisplay(0);
            setProratedPrice(0);
            return;
        }

        // Normalize helper
        const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        // 1. Determine Cochera Key in Matrix
        let cocheraKey = formData.tipoCochera; // 'Movil' or 'Fija'
        if (formData.exclusivaOverride) cocheraKey = 'Exclusiva';

        // 2. Find vehicle entry in matrix (Fuzzy Match)
        let vehiclePrices: any = null;
        if (pricesMatrix[typeKey]) {
            vehiclePrices = pricesMatrix[typeKey];
        } else {
            const normalizedType = normalize(typeKey);
            const foundKey = Object.keys(pricesMatrix).find(k => normalize(k) === normalizedType);
            if (foundKey) vehiclePrices = pricesMatrix[foundKey];
        }

        // 3. Find Price Value (Fuzzy Match for Tariff Key)
        let finalPrice = 0;
        if (vehiclePrices) {
            if (vehiclePrices[cocheraKey] !== undefined) {
                finalPrice = Number(vehiclePrices[cocheraKey]);
            } else {
                const normalizedCochera = normalize(cocheraKey);
                const foundCocheraKey = Object.keys(vehiclePrices).find(k => normalize(k) === normalizedCochera);
                if (foundCocheraKey) finalPrice = Number(vehiclePrices[foundCocheraKey]);
            }
        }

        // 4. Update Display
        setBasePriceDisplay(finalPrice);

        // 5. Calculate Prorated
        const now = new Date();
        const currentDay = now.getDate();
        const remainingDays = Math.max(0, 30 - currentDay + 1);
        const calc = Math.floor((finalPrice / 30) * remainingDays);
        setProratedPrice(calc);
    };

    const openCamera = (field: string) => { setActivePhotoField(field); setShowCameraModal(true); };
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

        // Validation for assigned spots
        if (formData.tipoCochera === 'Fija' && !formData.numeroCochera) {
            toast.error('Falta número de cochera');
            setLoading(false);
            return;
        }

        // Validate basic vehicle data to prevent junk
        if (!formData.tipoVehiculo || !formData.patente) {
            toast.error('Faltan datos del vehículo (Tipo o Patente)');
            setLoading(false);
            return;
        }

        try {
            // 1. CLIENT MANAGEMENT (Find or Create)
            let clientId = null;
            try {
                // Attempt to find existing client by DNI
                const searchRes = await api.get(`/clientes?dni=${formData.dni}`);
                if (searchRes.data && searchRes.data.length > 0) {
                    clientId = searchRes.data[0].id;
                    // Optional: Update client data if needed, but for now we assume existence is enough or we proceed.
                    // Ideally we'd PUT /clientes/:id to update latest info.
                    console.log(`Client found: ${clientId}`);
                } else {
                    // Create new client
                    const clientRes = await api.post('/clientes', {
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
                    });
                    clientId = clientRes.data.id;
                    console.log(`Client created: ${clientId}`);
                }
            } catch (err: any) {
                // Circuit Breaker: If checking/creating client fails, STOP everything.
                // Diagnosis: if HTML returned (404 on API), don't proceed.
                console.error("Client check/create failed. URL:", err.config?.url);
                if (err.response && typeof err.response.data === 'string' && err.response.data.includes('<!DOCTYPE html>')) {
                    toast.error('Error Crítico: El sistema no contacta al backend (/api/clientes devuelve HTML). Revise la conexión.');
                    throw new Error("API Route Error: Received HTML instead of JSON");
                }

                // Try creation as fallback only if it wasn't a structural 404 on the API root
                console.warn("Attempting fallback creation...", err);
                try {
                    const clientRes = await api.post('/clientes', {
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
                    });
                    clientId = clientRes.data.id;
                } catch (creationErr: any) {
                    console.error("Fallback creation also failed. URL:", creationErr.config?.url);
                    throw creationErr; // Stop execution
                }
            }

            if (!clientId) throw new Error("No se pudo obtener ID de cliente. Abortando.");

            // 2. SPOT MANAGEMENT (Mark as Occupied/Assigned)
            const finalType = formData.exclusivaOverride ? 'Exclusiva' : formData.tipoCochera;
            if (finalType !== 'Movil') {
                // Ensuring we verify valid spot number
                if (!formData.numeroCochera) throw new Error("Cochera number required for Fixed/Exclusive");

                // Assign spot to this vehicle/client (Mark occupied)
                await api.post('/cocheras', {
                    tipo: finalType,
                    numero: formData.numeroCochera,
                    vehiculos: [formData.patente], // Mark as occupied by this vehicle
                    precioBase: basePriceDisplay,
                    status: 'Ocupada',
                    clienteId: clientId
                });
            }

            // 3. SUBSCRIPTION CREATION (Full Payload)
            // Ensure totalInicial (proratedPrice) is sent
            const payload = {
                clientId: clientId, // Link to the real client ID
                customerData: { // Redundant but requested to be "Full Object"
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
                spotNumber: formData.numeroCochera, // Explicitly sending spot info
                paymentMethod: formData.metodoPago,
                amount: proratedPrice, // The calculated prorated amount
                totalInicial: proratedPrice, // Explicit naming for clarity
                billingType: formData.tipoFactura,
                photos: photos,
                startDate: new Date().toISOString()
            };

            await api.post('/abonos', payload);
            console.log("[Abonos] Iniciando guardado...", payload);

            // only show success on 200 OK (implied by awaiting promise not throwing)
            toast.success('ALTA DE ABONO EXITOSA');

            // Allow state reset
            setFormData(prev => ({
                ...prev,
                patente: '',
                nombre: '',
                dni: '',
                email: '',
                numeroCochera: '',
                marca: '',
                modelo: '',
                telParticular: ''
            }));
            setPhotos({});

        } catch (error: any) {
            console.error("Subscription Error:", error);
            toast.error('Error: ' + (error.response?.data?.error || error.message || "Fallo al procesar abono"));
        } finally {
            setLoading(false);
        }
    };

    // Shared Styles
    const inputStyle = "bg-gray-950/40 border border-gray-800/60 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/5 transition-all w-full placeholder-gray-700/50 font-medium h-9";
    const labelStyle = "block text-[10px] uppercase text-gray-500 font-bold mb-0.5 tracking-wider";

    return (
        <div className="h-full bg-[#0a0a0a] flex flex-col p-2 overflow-hidden text-white">
            <h1 className="text-base font-bold mb-2 flex items-center gap-2 pl-2 text-gray-300">
                <User className="text-emerald-500 w-4 h-4" /> Nueva Suscripción
            </h1>

            <div className="flex-1 bg-gray-900/50 border border-gray-800 rounded-xl flex overflow-hidden shadow-2xl relative">

                {/* --- MAIN FORM (LEFT) --- */}
                <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
                    <form id="abono-form" onSubmit={handleSubmit} className="space-y-3">

                        {/* 1. CONFIG COCHERA (Compact) */}
                        <div className="flex items-center gap-4 bg-black/40 py-1.5 px-3 rounded-lg border border-gray-800/60">
                            <span className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-widest">Config Cochera</span>
                            <div className="flex bg-gray-950 p-0.5 rounded border border-gray-800">
                                {['Movil', 'Fija'].map(type => (
                                    <button type="button" key={type}
                                        onClick={() => {
                                            if (type === 'Movil') {
                                                setFormData({ ...formData, tipoCochera: 'Movil', exclusivaOverride: false, numeroCochera: '' });
                                            } else {
                                                setFormData({ ...formData, tipoCochera: 'Fija' });
                                            }
                                        }}
                                        className={`px-3 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${formData.tipoCochera === type ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                                        {type}
                                    </button>
                                ))}
                            </div>
                            <div className={`flex items-center gap-2 ${formData.tipoCochera === 'Movil' ? 'opacity-30 pointer-events-none' : ''}`}>
                                <input placeholder="N°" className={`${inputStyle} w-14 text-center h-7`} value={formData.numeroCochera} onChange={e => setFormData({ ...formData, numeroCochera: e.target.value })} />
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" className="accent-purple-500 w-3.5 h-3.5" checked={formData.exclusivaOverride} onChange={e => setFormData({ ...formData, exclusivaOverride: e.target.checked })} />
                                    <span className="text-[10px] font-bold text-purple-400">EXCL</span>
                                </label>
                            </div>
                        </div>

                        {/* 2. DATOS PERSONALES (GRID 3 EQUAL) */}
                        <div>
                            <div className="flex items-center gap-2 mb-1.5 text-gray-500">
                                <User className="w-3 h-3" /> <span className="text-[10px] font-bold uppercase">Datos Cliente</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {/* Row 1 */}
                                <div><label className={labelStyle}>Nombre Completo</label><input className={inputStyle} value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })} required /></div>
                                <div><label className={labelStyle}>DNI / CUIT</label><input className={inputStyle} value={formData.dni} onChange={e => setFormData({ ...formData, dni: e.target.value })} required /></div>
                                <div><label className={labelStyle}>Email</label><input className={inputStyle} value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>

                                {/* Row 2 */}
                                <div><label className={labelStyle}>Domicilio Real</label><input className={inputStyle} value={formData.domicilio} onChange={e => setFormData({ ...formData, domicilio: e.target.value })} /></div>
                                <div><label className={labelStyle}>Localidad</label><input className={inputStyle} value={formData.localidad} onChange={e => setFormData({ ...formData, localidad: e.target.value })} /></div>
                                <div><label className={labelStyle}>Dom. Trabajo</label><input className={inputStyle} value={formData.domicilioTrabajo} onChange={e => setFormData({ ...formData, domicilioTrabajo: e.target.value })} /></div>

                                {/* Row 3 */}
                                <div className="relative"><label className={labelStyle}>Tel. Particular</label><Phone className="w-3 h-3 absolute top-[26px] left-2.5 text-gray-500 z-10" /><input className={`${inputStyle} pl-8`} value={formData.telParticular} onChange={e => setFormData({ ...formData, telParticular: e.target.value })} /></div>
                                <div className="relative"><label className={labelStyle}>Tel. Emergencia</label><Phone className="w-3 h-3 absolute top-[26px] left-2.5 text-red-500/50 z-10" /><input className={`${inputStyle} pl-8 border-red-900/20`} value={formData.telEmergencia} onChange={e => setFormData({ ...formData, telEmergencia: e.target.value })} /></div>
                                <div className="relative"><label className={labelStyle}>Tel. Trabajo</label><Phone className="w-3 h-3 absolute top-[26px] left-2.5 text-blue-500/50 z-10" /><input className={`${inputStyle} pl-8 border-blue-900/20`} value={formData.telTrabajo} onChange={e => setFormData({ ...formData, telTrabajo: e.target.value })} /></div>
                            </div>
                        </div>

                        {/* 3. DOCUMENTACION (Horizontal) */}
                        <div className="flex gap-2">
                            {['Seguro', 'DNI', 'Cédula'].map(doc => (
                                <button key={doc} type="button" onClick={() => openCamera(doc)}
                                    className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded border border-dashed text-[10px] font-bold uppercase transition-all ${photos[doc] ? 'border-emerald-500/50 bg-emerald-900/10 text-emerald-400' : 'border-gray-800 bg-gray-950/20 text-gray-500 hover:bg-white/5'}`}>
                                    {photos[doc] ? <Check className="w-3 h-3" /> : <Camera className="w-3 h-3" />} {doc}
                                </button>
                            ))}
                        </div>

                        {/* 4. VEHICULO (GRID 4x2) */}
                        <div className="pt-1.5 border-t border-gray-800/50">
                            <div className="flex items-center gap-2 mb-1.5 text-gray-500">
                                <Car className="w-3 h-3" /> <span className="text-[10px] font-bold uppercase">Datos Vehículo</span>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                                {/* Row 1: Patente, Marca, Modelo, Tipo */}
                                <div>
                                    <label className={labelStyle}>Patente</label>
                                    <input className={`${inputStyle} font-mono text-center font-bold tracking-widest uppercase border-l-[3px] border-l-emerald-500`}
                                        value={formData.patente} onChange={e => setFormData({ ...formData, patente: e.target.value.toUpperCase() })} required placeholder="AAA000" />
                                </div>
                                <div><label className={labelStyle}>Marca</label><input className={inputStyle} value={formData.marca} onChange={e => setFormData({ ...formData, marca: e.target.value })} /></div>
                                <div><label className={labelStyle}>Modelo</label><input className={inputStyle} value={formData.modelo} onChange={e => setFormData({ ...formData, modelo: e.target.value })} /></div>
                                <div>
                                    <label className={labelStyle}>Tipo</label>
                                    <select className={`${inputStyle} appearance-none`} value={formData.tipoVehiculo} onChange={e => setFormData({ ...formData, tipoVehiculo: e.target.value })}>
                                        <option value="" disabled hidden>Seleccione el tipo...</option>
                                        {vehicleTypes.length > 0 ? (
                                            vehicleTypes.map((v: any) => (
                                                <option key={v.id} value={v.nombre}>{v.nombre}</option>
                                            ))
                                        ) : (
                                            <option>Cargando vehículos...</option>
                                        )}
                                    </select>
                                </div>

                                {/* Row 2: Color, Año, Cia Seguro (span 2) */}
                                <div><label className={labelStyle}>Color</label><input className={inputStyle} value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} /></div>
                                <div><label className={labelStyle}>Año</label><input className={inputStyle} value={formData.anio} onChange={e => setFormData({ ...formData, anio: e.target.value })} /></div>
                                <div className="col-span-2"><label className={labelStyle}>Cía. Seguro</label><input className={inputStyle} value={formData.companiaSeguro} onChange={e => setFormData({ ...formData, companiaSeguro: e.target.value })} placeholder="Ej. La Caja / Federación Patronal" /></div>
                            </div>
                        </div>

                    </form>
                </div>

                {/* --- SIDEBAR (RIGHT) --- */}
                <div className="w-64 bg-gray-950 border-l border-gray-800 p-3 flex flex-col shrink-0 z-10 gap-4">

                    {/* Payment Config Section */}
                    <div className="space-y-3">
                        <h2 className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 mb-2">
                            <Wallet className="w-3 h-3" /> Facturación
                        </h2>

                        <div className="space-y-2">
                            <div>
                                <label className={labelStyle}>Método de Pago</label>
                                <select className={`${inputStyle} appearance-none bg-gray-900`} value={formData.metodoPago} onChange={e => setFormData({ ...formData, metodoPago: e.target.value })}>
                                    <option value="Efectivo">Efectivo</option>
                                    <option value="Transferencia">Transferencia</option>
                                    <option value="Debito">Débito</option>
                                    <option value="Credito">Crédito</option>
                                    <option value="QR">QR</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelStyle}>Tipo Factura</label>
                                <select className={`${inputStyle} appearance-none bg-gray-900`} value={formData.tipoFactura} onChange={e => setFormData({ ...formData, tipoFactura: e.target.value })}>
                                    <option value="CC">CC</option>
                                    <option value="A">A</option>
                                    <option value="Final">Final</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Summary Section */}
                    <div className="mt-auto">
                        <div className="space-y-1.5 bg-gray-900/40 p-3 rounded border border-gray-800/50">
                            <div className="flex justify-between border-b border-gray-800 pb-1">
                                <span className="text-[10px] text-gray-500 uppercase font-bold">Mensual</span>
                                <span className="text-xs text-white font-mono">${basePriceDisplay.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between pt-1">
                                <span className="text-[10px] text-gray-500 uppercase font-bold">Restante</span>
                                <span className="text-xs text-emerald-400 font-bold">{Math.max(0, 30 - new Date().getDate() + 1)}d</span>
                            </div>
                        </div>

                        <div className="bg-emerald-900/10 border border-emerald-500/20 p-3 rounded-lg mt-3 text-center">
                            <span className="block text-[9px] text-emerald-500/70 uppercase font-bold tracking-widest mb-0.5">Total Inicial</span>
                            <span className="block text-2xl font-black text-white tracking-tighter">${proratedPrice.toLocaleString()}</span>
                        </div>

                        <button form="abono-form" type="submit" disabled={loading}
                            className="w-full py-3 bg-white hover:bg-gray-200 text-black text-xs font-black uppercase tracking-widest rounded shadow-lg flex items-center justify-center gap-2 mt-3 transition-all active:scale-95">
                            {loading ? '...' : <><Check className="w-3.5 h-3.5" /> Confirmar</>}
                        </button>
                    </div>
                </div>
            </div>

            <WebcamModal isOpen={showCameraModal} onClose={() => setShowCameraModal(false)} onCapture={handleCapture} label={activePhotoField || 'Doc'} />
        </div>
    );
};

export default FormularioAbono;
