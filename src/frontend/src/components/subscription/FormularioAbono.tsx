import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../services/api';
import { toast } from 'sonner';
import { Camera, Car, Check, User, Phone, AlertTriangle, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { WebcamModal } from '../common/WebcamModal';
import { PrinterService } from '../../services/PrinterService';
import { useVehiclePriceValidation } from '../../hooks/useVehiclePriceValidation';
import { compressPhotos } from '../../utils/imageCompression';
import { calculateInitialSubscriptionAmount } from '../../utils/subscriptionPricing';
import { getLastTwoDaysEligibility } from '../../../../shared/utils/dateEligibility';

interface FormularioAbonoProps {
    onCancel?: () => void;
    onSubmit?: (data: any) => void;
}

const FormularioAbono: React.FC<FormularioAbonoProps> = ({ onCancel, onSubmit }) => {
    // --- STATE ---
    const [loading, setLoading] = useState(false);
    const [showCameraModal, setShowCameraModal] = useState(false);
    const [activePhotoField, setActivePhotoField] = useState<string | null>(null);
    const [photos, setPhotos] = useState<{ [key: string]: string }>({});
    const [showSuccessScreen, setShowSuccessScreen] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const { operatorName } = useAuth();

    // Financial Config State
    const [financialConfig, setFinancialConfig] = useState<any>(null);
    const [configLoading, setConfigLoading] = useState(true);
    const [configError, setConfigError] = useState<string | null>(null);

    // Price integrity validation + smart sorting for 'abono' tariffs
    const { getSortedVehicleTypes } = useVehiclePriceValidation('abono');

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
    const [montoAbonado, setMontoAbonado] = useState(0); // Partial payment support
    const [pricesMatrix, setPricesMatrix] = useState<any>({});
    const [standardPricesMatrix, setStandardPricesMatrix] = useState<any>({});
    const [vehicleTypes, setVehicleTypes] = useState<any[]>([]);
    const [remainingDays, setRemainingDays] = useState(0);
    const [isFullMonthCharge, setIsFullMonthCharge] = useState(false);
    
    // Exoneration State
    const [exonerateLastDays, setExonerateLastDays] = useState(false);
    const [lastDaysEligibility, setLastDaysEligibility] = useState(() => getLastTwoDaysEligibility(new Date()));

    useEffect(() => {
        const checkEligibility = () => setLastDaysEligibility(getLastTwoDaysEligibility(new Date()));
        const interval = setInterval(checkEligibility, 60000); // Check every minute
        
        // Also check on window focus
        const onFocus = () => checkEligibility();
        window.addEventListener('focus', onFocus);
        
        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    useEffect(() => {
        if (!lastDaysEligibility.isLastTwoDays && exonerateLastDays) {
            setExonerateLastDays(false);
        }
    }, [lastDaysEligibility.isLastTwoDays, exonerateLastDays]);

    // Sorted + enriched vehicle types (valid first → price asc → alpha)
    const sortedVehicleTypes = useMemo(() =>
        getSortedVehicleTypes(vehicleTypes.map((v: any) => ({ id: v.id || v.name, name: v.name }))),
        [vehicleTypes, getSortedVehicleTypes]
    );


    const [formData, setFormData] = useState({
        // Cochera
        tipoCochera: '',
        numeroCochera: '',
        piso: '',
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
        metodoPago: '',
        tipoFactura: '',
    });

    useEffect(() => { loadConfig(); }, [formData.metodoPago]);
    
    // Load Financial Config once on mount (or garage change if supported via context)
    useEffect(() => {
        setConfigLoading(true);
        setConfigError(null);
        api.get('/parametros')
            .then(res => {
                const raw = res.data?.financialConfig ?? res.data?.config ?? res.data;
                const rawEnabled = raw?.subscriptionFullPriceEnabled ?? raw?.subscription_full_price_enabled;
                const rawUntilDay = raw?.subscriptionFullPriceUntilDay ?? raw?.subscription_full_price_until_day ?? null;
                
                const enabled = rawEnabled === true;
                const parsedDay = rawUntilDay === null ? null : Number(rawUntilDay);
                const untilDay = Number.isInteger(parsedDay) && parsedDay! >= 1 && parsedDay! <= 31 ? parsedDay : null;

                if (!('subscriptionFullPriceEnabled' in raw) && !('subscription_full_price_enabled' in raw)) {
                    console.warn('[Abonos] /parametros no incluyó la política de precio inicial', res.data);
                }

                setFinancialConfig({
                    ...raw,
                    subscriptionFullPriceEnabled: enabled,
                    subscriptionFullPriceUntilDay: untilDay
                });
                setConfigLoading(false);
            })
            .catch(err => {
                console.error("Financial Config Load Error:", err);
                setConfigError("Error al cargar la configuración financiera.");
                setConfigLoading(false);
            });
    }, []);

    useEffect(() => { calculatePrice(); }, [formData.tipoCochera, formData.exclusivaOverride, formData.tipoVehiculo, pricesMatrix, standardPricesMatrix, financialConfig]);
    useEffect(() => { setErrorMessage(null); }, [formData.numeroCochera, formData.tipoCochera, formData.tipoVehiculo, formData.patente]);

    // Sync montoAbonado whenever proratedPrice changes (default: full amount)
    useEffect(() => { setMontoAbonado(proratedPrice); }, [proratedPrice]);

    // --- Building Levels ---
    const [buildingLevels, setBuildingLevels] = useState<any[]>([]);
    useEffect(() => {
        api.get('/building-levels')
            .then(res => {
                const sorted = (res.data || []).sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                setBuildingLevels(sorted);
            })
            .catch(e => console.error('Building Levels Load Error:', e));
    }, []);

    // --- DNI Duplicate Validation ---
    const [existingDnis, setExistingDnis] = useState<string[]>([]);
    const [isDniDuplicate, setIsDniDuplicate] = useState(false);

    useEffect(() => {
        api.get('/clientes')
            .then(res => {
                const dnis = (res.data || []).map((c: any) => String(c.dni || '').replace(/\D/g, '')).filter(Boolean);
                setExistingDnis(dnis);
            })
            .catch(e => console.error('DNI list load error:', e));
    }, []);

    useEffect(() => {
        const cleanDni = formData.dni.replace(/\D/g, '');
        if (cleanDni.length > 0 && existingDnis.includes(cleanDni)) {
            setIsDniDuplicate(true);
        } else {
            setIsDniDuplicate(false);
        }
    }, [formData.dni, existingDnis]);

    const loadConfig = async () => {
        // Fetch prices once (contains both standard and electronic)
        const fetchPrices = api.get('/precios').catch(e => { console.error("Price load error:", e); return null; });
        const fetchTypes = api.get('/tipos-vehiculo').catch(e => { console.error("Type load error:", e); return null; });

        const [priceRes, typeRes] = await Promise.all([fetchPrices, fetchTypes]);

        if (priceRes && priceRes.data) {
            // New canonical DTO: { standard: Matrix, electronic: Matrix }
            const standardMatrix = priceRes.data.standard || {};
            const electronicMatrix = priceRes.data.electronic || {};
            
            setStandardPricesMatrix(standardMatrix);
            // Current price matrix depends on payment method
            const isEfectivo = formData.metodoPago === 'Efectivo';
            setPricesMatrix(isEfectivo ? standardMatrix : electronicMatrix);
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

        // Helper to find price in a given matrix
        const findPrice = (matrix: any) => {
            let vehiclePrices: any = null;
            if (matrix[typeKey]) {
                vehiclePrices = matrix[typeKey];
            } else {
                const normalizedType = normalize(typeKey);
                const foundKey = Object.keys(matrix).find(k => normalize(k) === normalizedType);
                if (foundKey) vehiclePrices = matrix[foundKey];
            }

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
            return finalPrice;
        };

        // We don't need standardPrice directly anymore because pricesMatrix is already dynamically set to standard or electronic based on metodoPago
        const selectedMonthlyPrice = findPrice(pricesMatrix);

        // 4. Update Display to show the actual monthly price for the selected method
        setBasePriceDisplay(selectedMonthlyPrice);

        // 5. Calculate Initial Amount using pure function
        if (financialConfig) {
            const pricing = calculateInitialSubscriptionAmount({
                monthlyPrice: selectedMonthlyPrice,
                currentDate: new Date(),
                fullPriceEnabled: financialConfig.subscriptionFullPriceEnabled,
                fullPriceUntilDay: financialConfig.subscriptionFullPriceUntilDay
            });
            setProratedPrice(pricing.totalInitial);
            setRemainingDays(pricing.remainingDays);
            setIsFullMonthCharge(pricing.isFullMonthCharge);
        } else {
            // Fallback while loading or error (Confirm will be disabled anyway)
            setProratedPrice(0);
            setRemainingDays(0);
            setIsFullMonthCharge(false);
        }
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
        setErrorMessage(null);

        // Validation for assigned spots
        if (!formData.tipoCochera) {
            toast.error('Seleccione el tipo de cochera (Móvil / Fija)');
            setLoading(false);
            return;
        }

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

        if (formData.tipoCochera !== 'Movil' && !formData.piso) {
            toast.error('Debe seleccionar un Piso para cocheras fijas o exclusivas');
            setLoading(false);
            return;
        }

        if (isDniDuplicate) {
            toast.error('El DNI ingresado ya pertenece a un cliente registrado.');
            setLoading(false);
            return;
        }

        // Validate billing type (hard block)
        if (!formData.tipoFactura) {
            toast.error('Seleccione el tipo de factura antes de confirmar.');
            setLoading(false);
            return;
        }

        // ── GUARD: Cochera Occupation Check (Fija / Exclusiva) ──
        if (formData.tipoCochera === 'Fija' && formData.numeroCochera) {
            try {
                const cocherasRes = await api.get('/cocheras');
                const cocheras: any[] = cocherasRes.data || [];
                const target = cocheras.find(
                    (c: any) => String(c.numero) === String(formData.numeroCochera)
                );
                if (target && target.status === 'Ocupada') {
                    const msg = `La cochera N° ${formData.numeroCochera} ya se encuentra ocupada por otro cliente. Libere la cochera antes de asignar un nuevo abono.`;
                    toast.error(msg);
                    setErrorMessage(msg);
                    setLoading(false);
                    return;
                }
            } catch (checkErr) {
                console.error('[Abonos] Error verificando disponibilidad de cochera:', checkErr);
                toast.error('No se pudo verificar la disponibilidad de la cochera. Intente nuevamente.');
                setLoading(false);
                return;
            }
        }

        try {
            const finalType = formData.exclusivaOverride ? 'Exclusiva' : formData.tipoCochera;

            // Ensuring we verify valid spot number for Fixed/Exclusive
            if (finalType !== 'Movil' && !formData.numeroCochera) {
                throw new Error("Cochera number required for Fixed/Exclusive");
            }

            // Compress photos client-side (800px max, q=0.7) before sending
            const hasPhotos = Object.values(photos).some(v => v && v.length > 0);
            const compressedPhotos = hasPhotos ? await compressPhotos(photos) : {};

            // SUBSCRIPTION CREATION (Full Payload)
            const payload = {
                customerData: {
                    name: formData.nombre,
                    dni: formData.dni,
                    email: formData.email,
                    address: formData.domicilio,
                    localidad: formData.localidad,
                    work_address: formData.domicilioTrabajo,
                    phone: formData.telParticular,
                    emergency_phone: formData.telEmergencia,
                    work_phone: formData.telTrabajo
                },
                vehicleData: {
                    plate: formData.patente,
                    brand: formData.marca,
                    model: formData.modelo,
                    color: formData.color,
                    year: formData.anio,
                    insurance: formData.companiaSeguro,
                    type: formData.tipoVehiculo,
                    photos: compressedPhotos
                },
                subscriptionType: finalType,
                spotNumber: finalType === 'Movil' ? '' : formData.numeroCochera,
                piso: formData.piso,
                paymentMethod: formData.metodoPago,
                operator: operatorName,
                billingType: formData.tipoFactura,
                basePrice: basePriceDisplay,
                totalInicial: proratedPrice,
                montoAbonado: exonerateLastDays ? 0 : montoAbonado,
                exonerateLastDays,
                initialChargeExemptionReason: exonerateLastDays ? 'LAST_TWO_DAYS_OF_MONTH' : null,
                photos: {
                    ...photos
                },
                startDate: new Date().toISOString()
            };

            console.log("[Abonos] Iniciando guardado unificado...", payload);
            const response = await api.post('/abonos/alta-completa', payload);

            let expirationText = "Fin de mes";
            if (response.data && response.data.endDate) {
                const ed = new Date(response.data.endDate);
                expirationText = ed.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }

            // Exonerated operation doesn't have a payment ticket to print
            if (!response.data.exonerated && response.data.ticket_code) {
                try {
                    await PrinterService.printSubscriptionTicket({
                        ...response.data,
                        customerName: formData.nombre,
                        customerDni: formData.dni,
                        plate: formData.patente,
                        vehicleBrand: formData.marca,
                        vehicleModel: formData.modelo,
                        montoCobrado: montoAbonado, // Print the actual amount paid
                        fechaEmision: new Date().toISOString()
                    });
                } catch (printerErr) {
                    console.warn('[Abonos] Error al imprimir, continuando de todos modos:', printerErr);
                    toast.warning('Abono creado pero falló la impresión (Verificar impresora local)');
                }
            } else if (response.data.exonerated) {
                // Optionally print a simple informational receipt without financial ticket_code
                try {
                    await PrinterService.printSubscriptionTicket({
                        ...response.data,
                        ticket_code: 'EXONERADO',
                        customerName: formData.nombre,
                        customerDni: formData.dni,
                        plate: formData.patente,
                        vehicleBrand: formData.marca,
                        vehicleModel: formData.modelo,
                        montoCobrado: 0,
                        fechaEmision: new Date().toISOString(),
                        notes: 'ALTA EXONERADA - SIN COBRO INICIAL\nMotivo: últimos dos días del mes'
                    });
                } catch (printerErr) {
                    console.warn('[Abonos] Error al imprimir ticket exonerado, continuando:', printerErr);
                }
            }

            // only show success on 200 OK (implied by awaiting promise not throwing)
            toast.success(`ALTA DE ABONO EXITOSA. Vencimiento: ${expirationText}`);

            // Allow state reset only on success
            setShowSuccessScreen(true);

            if (onSubmit) {
                onSubmit(payload);
            }

            setTimeout(() => {
                setShowSuccessScreen(false);
                if (onCancel) onCancel();
                setExonerateLastDays(false); // Reset on success
                setFormData({
                    tipoCochera: '',
                    numeroCochera: '',
                    piso: '',
                    exclusivaOverride: false,

                    nombre: '',
                    dni: '',
                    email: '',
                    domicilio: '',
                    localidad: '',
                    domicilioTrabajo: '',
                    telParticular: '',
                    telEmergencia: '',
                    telTrabajo: '',

                    patente: '',
                    marca: '',
                    modelo: '',
                    color: '',
                    anio: '',
                    companiaSeguro: '',
                    tipoVehiculo: '',

                    metodoPago: '',
                    tipoFactura: '',
                });
                setPhotos({});
                setBasePriceDisplay(0);
                setProratedPrice(0);
            }, 2500);

        } catch (error: any) {
            console.error("Subscription Error:", error);
            const errorMsg = error.response?.data?.error || error.message || "Fallo al procesar abono";
            setErrorMessage(errorMsg);
            toast.error('Error: ' + errorMsg);
            // IMPORTANT: Do NOT clear form data here to allow user to fix the issue
        } finally {
            setLoading(false);
        }
    };

    // Shared Styles
    const inputStyle = "bg-gray-950/40 border border-gray-800/60 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/5 transition-all w-full placeholder-gray-700/50 font-medium h-9";
    const labelStyle = "block text-[10px] uppercase text-gray-500 font-bold mb-0.5 tracking-wider";

    return (
        <div className="h-[calc(100vh-64px)] bg-[#0a0a0a] flex flex-col p-2 overflow-hidden text-white relative">
            <h1 className="text-base font-bold mb-2 flex items-center gap-2 pl-2 text-gray-300">
                <User className="text-emerald-500 w-4 h-4" /> Nueva Suscripción
                {onCancel && (
                    <button type="button" onClick={onCancel} className="ml-auto mr-2 text-[10px] bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded">
                        Cancelar
                    </button>
                )}
            </h1>

            <div className="flex-1 min-h-0 bg-gray-900/50 border border-gray-800 rounded-xl flex overflow-hidden shadow-2xl relative">

                {/* --- MAIN FORM (LEFT) --- */}
                <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
                    <form id="abono-form" onSubmit={handleSubmit} className="space-y-6">

                        {/* 1. CONFIG COCHERA (Compact) */}
                        <div className="flex items-center gap-4 bg-black/40 py-1.5 px-3 rounded-lg border border-gray-800/60">
                            <span className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-widest">Config Cochera</span>
                            <div className="flex bg-gray-950 p-0.5 rounded border border-gray-800">
                                {['Movil', 'Fija'].map((type: any) => (
                                    <button type="button" key={type}
                                        onClick={() => {
                                            if (type === 'Movil') {
                                                setFormData({ ...formData, tipoCochera: 'Movil', exclusivaOverride: false, numeroCochera: '', piso: '' });
                                            } else {
                                                setFormData({ ...formData, tipoCochera: 'Fija' });
                                            }
                                        }}
                                        className={`px-3 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${formData.tipoCochera === type ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                                        {type}
                                    </button>
                                ))}
                            </div>
                            <div className={`flex items-center gap-2 ${formData.tipoCochera !== 'Fija' ? 'opacity-30 pointer-events-none' : ''}`}>
                                <input
                                    placeholder="N°"
                                    className={`${inputStyle} w-14 text-center h-7 bg-gray-800 border-gray-600 placeholder-gray-500`}
                                    value={formData.numeroCochera}
                                    onChange={e => setFormData({ ...formData, numeroCochera: e.target.value })}
                                    disabled={formData.tipoCochera !== 'Fija'}
                                    required={formData.tipoCochera === 'Fija'}
                                />
                                <label className={`flex items-center gap-1.5 cursor-pointer`}>
                                    <input type="checkbox" className="accent-purple-500 w-3.5 h-3.5" checked={formData.exclusivaOverride} onChange={e => setFormData({ ...formData, exclusivaOverride: e.target.checked })} disabled={formData.tipoCochera !== 'Fija'} />
                                    <span className="text-[10px] font-bold text-purple-400">EXCL</span>
                                </label>
                            </div>
                            <select
                                className={`${inputStyle} w-32 h-7 text-[10px] bg-gray-800 ${formData.tipoCochera === 'Movil' ? 'opacity-50' : (formData.tipoCochera !== 'Movil' && !formData.piso ? 'border-amber-500/50' : 'border-gray-600')}`}
                                value={formData.piso}
                                onChange={e => setFormData({ ...formData, piso: e.target.value })}
                                disabled={formData.tipoCochera === 'Movil'}
                                required={formData.tipoCochera !== 'Movil'}
                            >
                                <option value="" disabled>Piso...</option>
                                {buildingLevels.map((level: any) => (
                                    <option key={level.id} value={level.displayName || level.display_name}>{level.displayName || level.display_name}</option>
                                ))}
                            </select>
                        </div>

                        {/* 2. DATOS PERSONALES (GRID 3 EQUAL) */}
                        <div>
                            <div className="flex items-center gap-2 mb-1.5 text-gray-500">
                                <User className="w-3 h-3" /> <span className="text-[10px] font-bold uppercase">Datos Cliente</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {/* Row 1 */}
                                <div><label className={labelStyle}>Nombre Completo</label><input className={inputStyle} value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })} required /></div>
                                <div>
                                    <label className={labelStyle}>DNI / CUIT</label>
                                    <input className={`${inputStyle} ${isDniDuplicate ? 'border-red-500 ring-1 ring-red-500/30' : ''}`} value={formData.dni} onChange={e => setFormData({ ...formData, dni: e.target.value })} required />
                                    {isDniDuplicate && (
                                        <div className="flex items-center gap-1 mt-1">
                                            <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                                            <span className="text-[10px] text-red-500 font-medium">Este DNI ya pertenece a un cliente registrado</span>
                                        </div>
                                    )}
                                </div>
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
                            {['Seguro', 'DNI', 'Cédula'].map((doc: any) => (
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
                                        {sortedVehicleTypes.length > 0 ? (
                                            sortedVehicleTypes.map((v: any) => (
                                                <option key={v.name} value={v.name} disabled={v.disabled}>{v.label}</option>
                                            ))
                                        ) : (
                                            <option>Cargando vehículos...</option>
                                        )}
                                    </select>
                                </div>

                                {/* Row 2: Color, Año, RFID Tag, Cia Seguro */}
                                <div><label className={labelStyle}>Color</label><input className={inputStyle} value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} /></div>
                                <div><label className={labelStyle}>Año</label><input className={inputStyle} value={formData.anio} onChange={e => setFormData({ ...formData, anio: e.target.value })} /></div>
                                <div><label className={labelStyle}>Cía. Seguro</label><input className={inputStyle} value={formData.companiaSeguro} onChange={e => setFormData({ ...formData, companiaSeguro: e.target.value })} placeholder="Ej. La Caja" /></div>
                            </div>
                        </div>

                    </form>
                </div>

                {/* --- SIDEBAR (RIGHT) --- */}
                <div className="w-64 h-full bg-gray-950 border-l border-gray-800 p-3 flex flex-col shrink-0 z-10 gap-4">

                    {/* Payment Config Section */}
                    <div className="space-y-3">
                        <h2 className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 mb-2">
                            <Wallet className="w-3 h-3" /> Facturación
                        </h2>

                        <div className="space-y-2">
                            <div>
                                <label className={labelStyle}>Método de Pago</label>
                                <select className={`${inputStyle} appearance-none bg-gray-900`} value={formData.metodoPago} onChange={e => setFormData({ ...formData, metodoPago: e.target.value })}>
                                    <option value="" disabled hidden>Seleccionar...</option>
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
                                    <option value="" disabled hidden>Seleccionar...</option>
                                    <option value="CC">CC</option>
                                    <option value="A">A</option>
                                    <option value="Final">Final</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Summary Section (Conditional) */}
                    {formData.tipoVehiculo && formData.metodoPago && formData.tipoCochera ? (
                        <div className="mt-auto flex flex-col">
                            <div className="space-y-1.5 bg-gray-900/40 p-3 rounded border border-gray-800/50">
                                {lastDaysEligibility.isLastTwoDays && (
                                    <div className="mb-2 bg-gray-900/50 p-2 rounded border border-gray-700/50">
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 bg-gray-950 border-gray-700 rounded text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-gray-900"
                                                checked={exonerateLastDays}
                                                onChange={(e) => setExonerateLastDays(e.target.checked)}
                                            />
                                            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-300">
                                                Exonerar últimos días
                                            </span>
                                        </label>
                                        {exonerateLastDays && (
                                            <span className="block mt-1 pl-6 text-[9px] font-medium text-emerald-400">
                                                Alta sin cobro inicial
                                            </span>
                                        )}
                                    </div>
                                )}

                                <div className="flex justify-between border-b border-gray-800 pb-1">
                                    <span className="text-[10px] text-gray-500 uppercase font-bold">Mensual</span>
                                    <span className="text-xs text-white font-mono">${basePriceDisplay.toLocaleString()}</span>
                                </div>
                                {!isFullMonthCharge && (
                                    <div className="flex justify-between pt-1">
                                        <span className="text-[10px] text-gray-500 uppercase font-bold">Restante</span>
                                        <span className="text-xs text-emerald-400 font-bold">
                                            {remainingDays}d
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="bg-emerald-900/10 border border-emerald-500/20 p-3 rounded-lg mt-3 text-center">
                                <span className="block text-[9px] text-emerald-500/70 uppercase font-bold tracking-widest mb-0.5">Total Inicial</span>
                                <span className="block text-2xl font-black text-white tracking-tighter">${(exonerateLastDays ? 0 : proratedPrice).toLocaleString()}</span>
                                {exonerateLastDays && (
                                    <span className="block text-[9px] text-emerald-400 mt-1 uppercase font-bold tracking-widest">
                                        Alta exonerada — sin cobro inicial
                                    </span>
                                )}
                            </div>

                            {/* Monto a Abonar (Partial Payment Input) */}
                            <div className="mt-3">
                                <label className={labelStyle}>Monto a Abonar</label>
                                <div className="relative">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">$</span>
                                    <input
                                        type="number"
                                        className={`${inputStyle} pl-7 text-xl font-mono font-bold text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${(montoAbonado < proratedPrice && !exonerateLastDays) ? 'border-amber-500/40 bg-amber-950/15 text-amber-300' : ''}`}
                                        value={exonerateLastDays ? '0' : (montoAbonado || '')}
                                        onChange={e => {
                                            if (exonerateLastDays) return;
                                            let val = Number(e.target.value) || 0;
                                            if (val > proratedPrice) val = proratedPrice;
                                            setMontoAbonado(val);
                                        }}
                                        disabled={exonerateLastDays}
                                        min={0}
                                        max={exonerateLastDays ? 0 : proratedPrice}
                                    />
                                </div>
                            </div>

                            {/* Debt Preview for Partial Payment */}
                            {montoAbonado > 0 && montoAbonado < proratedPrice && !exonerateLastDays && (
                                <div className="mt-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 animate-in fade-in slide-in-from-top-2">
                                    <span className="block text-[9px] text-amber-400 uppercase font-bold tracking-widest mb-1">Deuda a Crear</span>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-amber-300/70">Saldo pendiente:</span>
                                        <span className="font-mono font-bold text-amber-400">${(proratedPrice - montoAbonado).toLocaleString()}</span>
                                    </div>
                                </div>
                            )}

                            {configLoading && (
                                <div className="mt-3 bg-gray-800/50 p-2 rounded flex items-center justify-center gap-2">
                                    <span className="text-[10px] text-gray-400 uppercase font-bold animate-pulse">Cargando política...</span>
                                </div>
                            )}

                            {configError && (
                                <div className="mt-3 bg-red-500/10 border border-red-500/50 p-3 rounded flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                    <span className="text-xs text-red-400 font-medium leading-relaxed">{configError}</span>
                                </div>
                            )}

                            {errorMessage && (
                                <div className="mt-3 bg-red-500/10 border border-red-500/50 p-3 rounded flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                    <span className="text-xs text-red-400 font-medium leading-relaxed">{errorMessage}</span>
                                </div>
                            )}

                            {(() => {
                                const isConfirmDisabled = loading || configLoading || !!configError || isDniDuplicate || !formData.tipoFactura || (!exonerateLastDays && montoAbonado <= 0);
                                return (
                                    <button form="abono-form" type="submit" disabled={isConfirmDisabled}
                                        className={`w-full py-3 text-xs font-black uppercase tracking-widest rounded shadow-lg flex items-center justify-center gap-2 mt-3 transition-all active:scale-95 ${isConfirmDisabled ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : (montoAbonado < proratedPrice && !exonerateLastDays) ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-white hover:bg-gray-200 text-black'}`}>
                                        {loading ? '...' : <><Check className="w-3.5 h-3.5" /> {exonerateLastDays ? 'Confirmar Alta Exonerada' : (montoAbonado < proratedPrice ? 'Confirmar (Parcial)' : 'Confirmar')}</>}
                                    </button>
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="mt-auto items-center justify-center text-center p-4 border border-dashed border-gray-800/50 rounded flex flex-col gap-2">
                            <Car className="w-5 h-5 text-gray-700 mx-auto" />
                            <span className="text-[10px] text-gray-600 uppercase font-bold">Seleccione Vehículo, Cochera y Método de Pago para continuar</span>
                        </div>
                    )}
                </div>
            </div>

            {showSuccessScreen && (
                <div className="absolute inset-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300">
                    <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
                        <Check className="w-10 h-10 text-emerald-500 animate-[pulse_1s_ease-in-out_infinite]" />
                    </div>
                    <h2 className="text-2xl font-black text-white tracking-widest uppercase mb-2">Operación Exitosa</h2>
                    <p className="text-emerald-500/80 font-bold uppercase tracking-wider text-sm">El abono ha sido registrado correctamente</p>
                </div>
            )}
            <WebcamModal isOpen={showCameraModal} onClose={() => setShowCameraModal(false)} onCapture={handleCapture} label={activePhotoField || 'Doc'} />
        </div>
    );
};

export default FormularioAbono;
