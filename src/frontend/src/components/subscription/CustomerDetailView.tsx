import React, { useEffect, useState } from 'react';
import {
    ArrowLeft,
    Car,
    Calendar,
    User,
    Phone,
    Plus,
    AlertTriangle,
    Check,
    ChevronDown,
    Trash2,
    Unlink
} from 'lucide-react';
import { api } from '../../services/api';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { PrinterService } from '../../services/PrinterService';

interface CustomerDetailViewProps {
    subscriber: any;
    onBack: () => void;
}

const CustomerDetailView: React.FC<CustomerDetailViewProps> = ({ subscriber, onBack }) => {
    const { operatorName } = useAuth();
    const [cocheras, setCocheras] = useState<any[]>([]);
    const [subscriptions, setSubscriptions] = useState<any[]>([]); // To enrich vehicle data
    const [realVehicles, setRealVehicles] = useState<any[]>([]); // Real vehicle table datastore
    const [debts, setDebts] = useState<any[]>([]); // Deudas pendientes
    const [loading, setLoading] = useState(true);

    // --- Configuration State ---
    const [vehicleTypes, setVehicleTypes] = useState<any[]>([]);
    const [pricesMatrix, setPricesMatrix] = useState<any>({});
    const [standardPricesMatrix, setStandardPricesMatrix] = useState<any>({});
    const [electronicPricesMatrix, setElectronicPricesMatrix] = useState<any>({});

    // --- Modal State ---
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedCochera, setSelectedCochera] = useState<any>(null);

    // --- Form Data State ---
    const [newVehicleData, setNewVehicleData] = useState({
        tipoVehiculo: '',
        patente: '',
        marca: '',
        modelo: '',
        color: '',
        anio: '',
        companiaSeguro: ''
    });

    // --- Financial Logic State (Upgrade) ---
    const [upgradeInfo, setUpgradeInfo] = useState({
        isUpgrade: false,
        diffToPay: 0,
        newBasePrice: 0
    });

    // --- NEW COCHERA MODAL STATE ---
    const [isNewCocheraOpen, setIsNewCocheraOpen] = useState(false);
    const [newCocheraData, setNewCocheraData] = useState({
        // Config
        tipo: 'Movil',
        numero: '',
        exclusiva: false,
        // Vehicle
        patente: '',
        marca: '',
        modelo: '',
        tipoVehiculo: '',
        color: '',
        anio: '',
        seguro: '',
        // Billing
        metodoPago: 'Efectivo',
        tipoFactura: 'Final'
    });
    const [newCocheraFinancials, setNewCocheraFinancials] = useState({
        basePrice: 0,
        proratedPrice: 0
    });
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // --- RENEWAL MODAL STATE ---
    const [isRenewalModalOpen, setIsRenewalModalOpen] = useState(false);
    const [selectedDebtSubId, setSelectedDebtSubId] = useState<string | null>(null);
    const [renewalData, setRenewalData] = useState({
        amountToPay: 0,
        metodoPago: 'Efectivo',
        tipoFactura: 'Final',
        cocheraDetails: null as any,
        hasPendingDebt: false
    });

    // --- Expanded Vehicles State (Accordion) ---
    const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());

    const toggleVehicle = (id: string) => {
        const next = new Set(expandedVehicles);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedVehicles(next);
    };


    // --- Initial Data Fetch (Config) ---
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const fetchStandardPrices = api.get('/precios?metodo=efectivo').catch(e => { console.error("Standard price load error:", e); return null; });
                const fetchElectronicPrices = api.get('/precios?metodo=otros').catch(e => { console.error("Electronic price load error:", e); return null; });
                const fetchTypes = api.get('/tipos-vehiculo').catch(e => { console.error("Type load error:", e); return null; });

                const [standardPricesRes, electronicPricesRes, typesRes] = await Promise.all([fetchStandardPrices, fetchElectronicPrices, fetchTypes]);

                if (typesRes && typesRes.data && vehicleTypes.length === 0) {
                    setVehicleTypes(typesRes.data);
                }
                if (standardPricesRes && standardPricesRes.data) {
                    setStandardPricesMatrix(standardPricesRes.data.efectivo || standardPricesRes.data);
                    setPricesMatrix(standardPricesRes.data.efectivo || standardPricesRes.data); // Fallback until refactored completely
                }
                if (electronicPricesRes && electronicPricesRes.data) {
                    setElectronicPricesMatrix(electronicPricesRes.data.otros || electronicPricesRes.data.efectivo || electronicPricesRes.data);
                }
            } catch (error) {
                console.error("Error loading configuration:", error);
                toast.error("Error cargando configuración de precios");
            }
        };
        loadConfig();
    }, []);

    // --- Business Logic: Price Calculation ---
    useEffect(() => {
        if (!selectedCochera || !newVehicleData.tipoVehiculo || Object.keys(pricesMatrix).length === 0) {
            setUpgradeInfo({ isUpgrade: false, diffToPay: 0, newBasePrice: 0 });
            return;
        }

        const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        // 1. Find price in matrix
        let matrixPrice = 0;
        const typeKey = Object.keys(pricesMatrix).find(k => normalize(k) === normalize(newVehicleData.tipoVehiculo));

        if (typeKey && pricesMatrix[typeKey]) {
            // Cochera type key: 'Movil', 'Fija', 'Exclusiva'
            const cocheraType = selectedCochera.tipo;
            const priceKey = Object.keys(pricesMatrix[typeKey]).find(k => normalize(k) === normalize(cocheraType));

            if (priceKey) {
                matrixPrice = Number(pricesMatrix[typeKey][priceKey]);
            }
        }

        // 2. Compare with current base price
        const currentPrice = selectedCochera.precioBase || 0;

        if (matrixPrice > currentPrice) {
            // Upgrade Logic
            const diff = matrixPrice - currentPrice;
            const today = new Date().getDate();
            // User requested: Math.floor(((precioMatriz - cochera.precioBase) / 30) * (31 - new Date().getDate()))
            // Assuming current month calculation (days remaining in hypothetical 30-day billing cycle or simply till end of month)
            // The formula provided by user is (31 - today), effectively days remaining.
            const proratedCharge = Math.floor((diff / 30) * (31 - today));

            setUpgradeInfo({
                isUpgrade: true,
                diffToPay: Math.max(0, proratedCharge),
                newBasePrice: matrixPrice
            });
        } else {
            setUpgradeInfo({
                isUpgrade: false,
                diffToPay: 0,
                newBasePrice: currentPrice // Keep old price if equal or lower
            });
        }

    }, [newVehicleData.tipoVehiculo, selectedCochera, pricesMatrix]);

    useEffect(() => {
        if (!isNewCocheraOpen || !newCocheraData.tipoVehiculo) {
            setNewCocheraFinancials({ basePrice: 0, proratedPrice: 0 });
            return;
        }

        const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        // 1. Determine Cochera Key
        let cocheraKey = newCocheraData.tipo;
        if (newCocheraData.exclusiva) cocheraKey = 'Exclusiva';

        // 2. Find Price Helper
        const findPrice = (matrix: any) => {
            const typeKey = Object.keys(matrix).find(k => normalize(k) === normalize(newCocheraData.tipoVehiculo));
            let finalPrice = 0;
            if (typeKey && matrix[typeKey]) {
                const priceKey = Object.keys(matrix[typeKey]).find(k => normalize(k) === normalize(cocheraKey));
                if (priceKey) {
                    finalPrice = Number(matrix[typeKey][priceKey]);
                }
            }
            return finalPrice;
        };

        const standardPrice = findPrice(standardPricesMatrix);
        const currentPrice = findPrice(pricesMatrix);

        // 3. Prorata (Exact current month exact rounding)
        const now = new Date();
        const currentDay = now.getDate();
        const ultimoDiaMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const diasRestantes = (ultimoDiaMes - currentDay) + 1;
        const exactCalc = (currentPrice / ultimoDiaMes) * diasRestantes;
        const roundedDown = Math.floor(exactCalc / 100) * 100;

        setNewCocheraFinancials({
            basePrice: standardPrice,
            proratedPrice: roundedDown
        });

    }, [newCocheraData.tipo, newCocheraData.exclusiva, newCocheraData.tipoVehiculo, pricesMatrix, standardPricesMatrix, isNewCocheraOpen]);

    useEffect(() => {
        setErrorMessage(null);
    }, [newCocheraData.numero, newCocheraData.tipo, newCocheraData.patente, isNewCocheraOpen]);

    const handleCreateCochera = async () => {
        if (!clientId) { toast.error("Error: Cliente no identificado"); return; }
        if (!newCocheraData.patente || !newCocheraData.tipoVehiculo) { toast.error("Patente y Tipo de Vehículo obligatorios"); return; }
        if ((newCocheraData.tipo === 'Fija' || newCocheraData.exclusiva) && !newCocheraData.numero) { toast.error("Número de cochera obligatorio"); return; }

        setErrorMessage(null);

        try {
            const finalType = newCocheraData.exclusiva ? 'Exclusiva' : newCocheraData.tipo;

            const rawEmail = subscriber.customerData?.email || subscriber.email || '';
            const rawAddress = subscriber.customerData?.address || subscriber.domicilio || subscriber.localidad || '';

            const payload = {
                customerData: {
                    nombreApellido: clientName,
                    dni: String(rawDni),
                    email: rawEmail,
                    address: rawAddress,
                    telefono: String(rawPhone)
                },
                vehicleData: {
                    plate: newCocheraData.patente.toUpperCase(),
                    brand: newCocheraData.marca,
                    model: newCocheraData.modelo,
                    color: newCocheraData.color,
                    year: newCocheraData.anio,
                    insurance: newCocheraData.seguro,
                    type: newCocheraData.tipoVehiculo
                },
                subscriptionType: finalType,
                spotNumber: newCocheraData.numero,
                paymentMethod: newCocheraData.metodoPago,
                basePrice: newCocheraFinancials.basePrice,
                amount: newCocheraFinancials.proratedPrice,
                billingType: newCocheraData.tipoFactura,
                operator: operatorName,
                startDate: new Date().toISOString()
            };

            await api.post('/abonos/alta-completa', payload);

            PrinterService.printSubscriptionTicket({
                nombreApellido: clientName,
                dni: rawDni,
                patente: newCocheraData.patente.toUpperCase(),
                marca: newCocheraData.marca,
                modelo: newCocheraData.modelo,
                tipoVehiculo: newCocheraData.tipoVehiculo,
                tipoCochera: finalType,
                numeroCochera: newCocheraData.numero,
                metodoPago: newCocheraData.metodoPago,
                basePriceDisplay: newCocheraFinancials.basePrice,
                proratedPrice: newCocheraFinancials.proratedPrice
            });

            toast.success("Cochera y Abono creados exitosamente");
            setIsNewCocheraOpen(false);

            // Refresh logic
            await refreshCustomerAssets();

            // Reset Form (Optional but good UX)
            setNewCocheraData(prev => ({ ...prev, patente: '', marca: '', modelo: '', numero: '' }));

        } catch (error: any) {
            console.error("Error creating cochera:", error);
            const msg = error.response?.data?.error || error.message;
            setErrorMessage(msg);
            toast.error("Error al crear cochera: " + msg);
        }
    };

    // --- ENPOINTS DESVINCULACION ---
    const handleReleaseCochera = async (cocheraId: string) => {
        if (!confirm("¿Seguro que deseas liberar esta cochera? Se desvincularán todos los vehículos y se cortará el abono (pero los vehículos seguirán registrados).")) return;
        try {
            await api.post('/cocheras/liberar', { cocheraId });
            toast.success("Cochera liberada con éxito");
            // FULL GLOBAL REFRESH TO PREVENT VISUAL ARTIFACTS
            refreshCustomerAssets();
        } catch (error) {
            console.error(error);
            toast.error("Error al liberar cochera");
        }
    };

    const handleUnlinkVehicle = async (cocheraId: string, plate: string) => {
        if (!confirm(`¿Seguro que deseas remover la patente ${plate} de esta cochera?`)) return;
        try {
            await api.post('/cocheras/desvincular-vehiculo', { cocheraId, plate });
            toast.success("Vehículo desvinculado");
            // FULL GLOBAL REFRESH TO PREVENT VISUAL ARTIFACTS
            refreshCustomerAssets();
        } catch (error) {
            console.error(error);
            toast.error("Error al desvincular vehículo");
        }
    };


    const handleOpenModal = (cochera: any) => {
        setSelectedCochera(cochera);
        setNewVehicleData({
            tipoVehiculo: '',
            patente: '',
            marca: '',
            modelo: '',
            color: '',
            anio: '',
            companiaSeguro: ''
        });
        setIsModalOpen(true);
    };

    const handleSaveVehicle = async () => {
        if (!selectedCochera) return;
        if (!newVehicleData.patente || !newVehicleData.tipoVehiculo) {
            toast.error("Patente y Tipo son obligatorios");
            return;
        }

        try {
            // CRITICAL: Always use raw 'vehiculos' from DB if available to avoid saving populated wrappers.
            // Fallback to vehicleDetails only if vehiculos is missing (unlikely if fetched from API).
            const currentVehicles = selectedCochera.vehiculos || [];

            // Construct new vehicle object
            const vehicleToAdd = {
                plate: newVehicleData.patente.toUpperCase(),
                brand: newVehicleData.marca,
                model: newVehicleData.modelo,
                color: newVehicleData.color,
                year: newVehicleData.anio,
                insurance: newVehicleData.companiaSeguro,
                type: newVehicleData.tipoVehiculo
            };

            const updatedVehicles = [...currentVehicles, vehicleToAdd];

            // Dynamic pricing will handle the new rate on the backend next time we fetch
            await api.patch(`/cocheras/${selectedCochera.id}`, {
                vehiculos: updatedVehicles
            });

            toast.success("Vehículo agregado correctamente");
            setIsModalOpen(false);

            // Refresh globally
            await refreshCustomerAssets();

        } catch (error) {
            console.error("Error saving vehicle:", error);
            toast.error("Error al guardar vehículo");
        }
    };

    const clientName =
        subscriber.customerData?.firstName ||
        subscriber.nombreApellido ||
        'Cliente';

    const rawDni = subscriber.customerData?.dni || subscriber.dni;
    const clientDni = rawDni
        ? new Intl.NumberFormat('es-AR').format(Number(String(rawDni).replace(/\D/g, '')))
        : '---';

    const rawPhone = subscriber.customerData?.phone || subscriber.phone;
    const formatPhone = (phone: any) => {
        if (!phone) return null;
        const p = String(phone).replace(/\D/g, '');
        if (p.length === 10) return `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`;
        if (p.length === 11) return `(${p.slice(0, 3)}) ${p.slice(3, 7)}-${p.slice(7)}`;
        return phone;
    };
    const clientPhone = formatPhone(rawPhone);

    const clientId =
        subscriber.customerData?.id ||
        subscriber.customerId ||
        subscriber.assignedTo;

    // Standardized Refresher for Global UI state
    const refreshCustomerAssets = async () => {
        if (!clientId) return;
        setLoading(true);
        try {
            const [cocherasRes, subsRes, vehiclesRes, debtsRes] = await Promise.all([
                api.get(`/cocheras?clienteId=${clientId}`),
                api.get(`/abonos?clientId=${clientId}`),
                api.get(`/vehiculos?customerId=${clientId}`),
                api.get(`/deudas/${clientId}`).catch(() => ({ data: [] }))
            ]);

            setCocheras(cocherasRes.data || []);
            setSubscriptions(subsRes.data || []);
            setRealVehicles(vehiclesRes.data || []);
            setDebts((debtsRes.data || []).filter((d: any) => d.status === 'PENDING'));
        } catch (err) {
            console.error('Error refreshing client assets:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshCustomerAssets();
    }, [clientId]);

    const handleOpenRenewalModal = (subId: string, cochera: any, amount: number, hasDebt: boolean) => {
        setSelectedDebtSubId(subId);
        setRenewalData({
            amountToPay: amount,
            metodoPago: 'Efectivo',
            tipoFactura: 'Final',
            cocheraDetails: cochera,
            hasPendingDebt: hasDebt
        });
        setIsRenewalModalOpen(true);
    };

    // --- Live Lookup para Renovaciones sin Deuda ---
    useEffect(() => {
        if (!isRenewalModalOpen || renewalData.hasPendingDebt || !selectedDebtSubId) return;

        const sub = subscriptions.find(s => s.id === selectedDebtSubId);
        if (!sub) return;

        const matrix = renewalData.metodoPago === 'Efectivo' ? standardPricesMatrix : electronicPricesMatrix;
        if (!matrix || Object.keys(matrix).length === 0) return;

        const normalize = (s: string) => s ? String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : '';

        // Determinar Vehículo
        let vKey = '';
        const cochera = renewalData.cocheraDetails;
        if (cochera && cochera.vehiculos && cochera.vehiculos.length > 0) {
            const plateStr = typeof cochera.vehiculos[0] === 'string' ? cochera.vehiculos[0] : (cochera.vehiculos[0] as any).plate;
            const v = realVehicles.find(rv => rv.plate === plateStr);
            if (v && v.type) vKey = normalize(v.type);
        } else if (sub.plate || sub.vehicleData?.plate) {
            const plateStr = sub.plate || sub.vehicleData?.plate;
            const v = realVehicles.find(rv => rv.plate === plateStr);
            if (v && v.type) vKey = normalize(v.type);
        }

        // Determinar Tarifa
        const subTypeRaw = sub.type || sub.subscriptionType || 'Movil';
        let tKey = normalize(subTypeRaw);
        if (subTypeRaw === 'Exclusiva') tKey = normalize('abono exclusivo');
        else tKey = normalize(`abono ${subTypeRaw}`);

        let foundPrice = 0;
        const typeKey = Object.keys(matrix).find(k => normalize(k) === vKey);
        if (typeKey && matrix[typeKey]) {
            const priceKey = Object.keys(matrix[typeKey]).find(k => normalize(k) === tKey || normalize(k) === normalize(subTypeRaw));
            if (priceKey) {
                foundPrice = Number(matrix[typeKey][priceKey]);
            }
        }

        if (foundPrice > 0) {
            setRenewalData(prev => ({ ...prev, amountToPay: foundPrice }));
        }

    }, [renewalData.metodoPago, isRenewalModalOpen, standardPricesMatrix, electronicPricesMatrix, selectedDebtSubId, subscriptions, realVehicles, renewalData.hasPendingDebt]);

    const handleRenewSubscription = async () => {
        if (!selectedDebtSubId || !renewalData.amountToPay) {
            toast.error("Error al procesar la renovación (Faltan datos)");
            return;
        }

        const btnSpinner = toast.loading("Procesando pago de deuda...");
        try {
            await api.post('/abonos/renovar', {
                subId: selectedDebtSubId,
                amountToPay: renewalData.amountToPay,
                paymentMethod: renewalData.metodoPago,
                billingType: renewalData.tipoFactura,
                operator: operatorName
            });

            toast.success("Renovación Exitosa! Imprimiendo Comprobante...", { id: btnSpinner });

            // Re-use Printer Logic if desired. Leaving basic trace message.
            setIsRenewalModalOpen(false);
            refreshCustomerAssets(); // Auto Refresh State entirely

        } catch (error: any) {
            console.error("Renewal Error:", error);
            const msg = error.response?.data?.error || error.message;
            toast.error("Error renovando abono: " + msg, { id: btnSpinner });
        }
    };



    // Helper to merge Cochera vehicle string/obj with Subscription data
    const getEnrichedVehicle = (vehicleVal: any) => {
        // 1. Resolve Plate
        let plate = '---';
        if (typeof vehicleVal === 'string') plate = vehicleVal;
        else if (vehicleVal && typeof vehicleVal === 'object') plate = vehicleVal.plate || '---';

        // 2. Base Object (from Cochera)
        const baseObj = typeof vehicleVal === 'object' ? vehicleVal : {};

        // 3. Find Primary Metadata from Database (realVehicles)
        const realMatch = realVehicles.find((v: any) => v.plate === plate);

        // 4. Find Subscription Match (Fallback)
        const subMatch = subscriptions.find((s: any) => {
            const sPlate = s.vehicleData?.plate || s.plate;
            return sPlate === plate;
        });

        // 5. Merge (realVehicles takes priority -> Subscription -> Cochera)
        return {
            plate,
            brand: realMatch?.brand || baseObj.brand || subMatch?.vehicleData?.brand || subMatch?.brand || 'No registrado',
            model: realMatch?.model || baseObj.model || subMatch?.vehicleData?.model || subMatch?.model || 'No registrado',
            color: realMatch?.color || baseObj.color || subMatch?.vehicleData?.color || subMatch?.color || 'No registrado',
            year: realMatch?.year || baseObj.year || subMatch?.vehicleData?.year || subMatch?.year || 'No registrado',
            insurance: realMatch?.insurance || baseObj.insurance || subMatch?.vehicleData?.insurance || subMatch?.insurance || 'No registrado',
            type: realMatch?.type || baseObj.type || subMatch?.vehicleData?.type || subMatch?.type || (subMatch?.subscriptionType === 'Exclusiva' ? 'Auto' : subMatch?.subscriptionType) || 'Generico'
        };
    };


    const inputStyle = "bg-gray-950/40 border border-gray-800/60 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/5 transition-all w-full placeholder-gray-700/50 font-medium h-9";
    const labelStyle = "block text-[10px] uppercase text-gray-500 font-bold mb-0.5 tracking-wider";

    return (
        <div className="flex-1 min-h-full border-none bg-[#050505] w-full flex flex-col">
            <div className="max-w-7xl mx-auto w-full p-8 space-y-12 animate-in fade-in duration-500 flex-1 pb-32">
                <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 border-b border-gray-800 pb-8">
                    <div className="flex items-start gap-6">
                        <button
                            onClick={onBack}
                            className="group p-3 bg-gray-900/50 hover:bg-gray-800 rounded-full border border-gray-800 text-gray-400 hover:text-white transition-all hover:scale-105"
                        >
                            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                        </button>

                        <div className="space-y-4">
                            <h2 className="text-4xl font-bold text-white tracking-tight">
                                {clientName}
                            </h2>

                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-800/50 border border-gray-700 rounded-full">
                                    <User className="w-3.5 h-3.5 text-indigo-400" />
                                    <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">DNI</span>
                                    <span className="font-mono text-sm text-gray-200">{clientDni}</span>
                                </div>

                                {clientPhone && (
                                    <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-800/50 border border-gray-700 rounded-full">
                                        <Phone className="w-3.5 h-3.5 text-emerald-400" />
                                        <span className="font-mono text-sm text-gray-200">{clientPhone}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* DEUDA BANNER PENDING */}
                {debts.length > 0 && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 backdrop-blur-sm flex items-center justify-between animate-in fade-in duration-500">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-red-500/20 rounded-full">
                                <AlertTriangle className="w-6 h-6 text-red-500" />
                            </div>
                            <div>
                                <h4 className="text-red-400 font-bold uppercase tracking-widest text-sm mb-1">Deuda Acumulada</h4>
                                <p className="text-gray-300 text-sm">Este cliente tiene {debts.length} abonos no pagados identificados. Consulte la sección de caja para abonarlos y recalcular recargos.</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="block text-2xl font-mono text-red-400 font-bold">
                                ${debts.reduce((sum, d) => sum + (d.amount || 0) + (d.surchargeApplied || 0), 0).toLocaleString()}
                            </span>
                            <span className="text-xs text-red-500/80 font-bold uppercase">Monto Base Sin Recargos Act.</span>
                        </div>
                    </div>
                )}

                <div className="space-y-8">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xl font-light text-gray-300 flex items-center gap-3">
                            <span className="p-2 bg-gray-800/50 rounded-lg border border-gray-700/50">
                                <Car className="w-5 h-5 text-indigo-400" />
                            </span>
                            Cocheras y Vehículos
                        </h3>

                        <button onClick={() => setIsNewCocheraOpen(true)} className="group flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg transition-all text-sm font-medium hover:shadow-lg hover:shadow-emerald-900/20 backdrop-blur-sm">
                            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                            Nueva Cochera
                        </button>
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-56 bg-gray-900/30 rounded-2xl animate-pulse border border-gray-800/50"></div>
                            ))}
                        </div>
                    ) : cocheras.length === 0 ? (
                        <div className="bg-gray-900/20 border border-dashed border-gray-800 rounded-2xl p-16 text-center backdrop-blur-sm">
                            <p className="text-gray-500 text-lg">Este cliente no tiene cocheras asignadas.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
                            {cocheras.map((cochera) => {
                                // Buscar los vehículos registrados en esta cochera para sacar sus IDs reales
                                const cocheraVehicles = realVehicles.filter(v => cochera.vehiculos && cochera.vehiculos.includes(v.plate));
                                const cocheraVehicleIds = cocheraVehicles.map(v => v.id);

                                // Encontrar la subscripción asociada
                                const associatedSub = subscriptions.find(s => {
                                    // 1. Por número de cochera (Fijas)
                                    if (s.spotNumber && cochera.numero && s.spotNumber === cochera.numero) return true;

                                    // 2. Por ID de vehículo o PATENTE
                                    const subVehicleId = s.vehicleId || (s as any).vehicle_id;
                                    const subPlate = s.vehicleData?.plate || s.plate;

                                    if (subVehicleId && cocheraVehicleIds.includes(subVehicleId)) return true;
                                    if (subPlate && cochera.vehiculos?.includes(subPlate)) return true;

                                    // 3. Por cliente y tipo
                                    const subClientId = s.customerId || (s as any).clientId;
                                    const isSameClient = subClientId === cochera.clienteId;

                                    const normalizeType = (t: string) => {
                                        if (!t) return '';
                                        const lower = t.toLowerCase();
                                        if (lower.includes('movil')) return 'Movil';
                                        if (lower.includes('fija')) return 'Fija';
                                        if (lower.includes('exclusiva')) return 'Exclusiva';
                                        return '';
                                    };

                                    if (isSameClient && normalizeType(s.type || s.subscriptionType) === normalizeType(cochera.tipo)) {
                                        return true;
                                    }

                                    return false;
                                });

                                // Logic for checking expiration: Compare to subscription endDate (if Exists), 
                                // otherwise assume standard month based calculation from startDate
                                const now = new Date();
                                let isExpired = false;
                                let expirationDate = "Sin Vencimiento";
                                let relatedDebtAmount = 0;

                                if (associatedSub) {
                                    let rawD: Date | null = null;
                                    if (associatedSub.endDate) {
                                        rawD = new Date(associatedSub.endDate);
                                    } else if (associatedSub.startDate) {
                                        const sDate = new Date(associatedSub.startDate);
                                        rawD = new Date(sDate.getFullYear(), sDate.getMonth() + 1, 0); // Fin de mes local extrapolado
                                    }

                                    if (rawD) {
                                        // Normalizar para ignorar desfases horarios / milisegundos
                                        const todayNorm = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                                        const expNorm = new Date(rawD.getFullYear(), rawD.getMonth(), rawD.getDate());

                                        isExpired = todayNorm > expNorm;
                                        expirationDate = rawD.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    }

                                    // Match all pending debts for the customer to force "Vencido" state
                                    // This prevents the issue of "orphaned" debts not blocking the user's active cocheras
                                    const pendingDebts = debts.filter(d => d.status === 'PENDING');
                                    if (pendingDebts.length > 0) {
                                        isExpired = true; // Force True if outstanding debts exist anywhere for this client
                                        relatedDebtAmount = pendingDebts.reduce((acc, curr) => acc + (curr.amount || 0) + (curr.surchargeApplied || 0), 0);
                                    }

                                } else {
                                    // Fallback to end of month if no sub found at all (Edge case)
                                    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                                    expirationDate = nextMonth.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    isExpired = false; // Cannot definitively say expired if no sub
                                }

                                console.log(`[DEBUG] Cochera #${cochera.numero || 'Movil ID: ' + cochera.id.slice(0, 4)} - Sub Asociada: ${associatedSub?.id || 'Ninguna'} - EndDate: ${associatedSub?.endDate || 'N/A'} - Expirada: ${isExpired} - Deuda: $${relatedDebtAmount}`);

                                return (
                                    <div key={cochera.id} className={`group relative backdrop-blur-md border ${isExpired ? 'bg-red-500/10 border-red-500/50 shadow-lg shadow-red-900/20' : 'bg-gray-900/40 border-gray-800 hover:border-indigo-500/50 hover:shadow-indigo-900/10'} rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl flex flex-col justify-between overflow-hidden`}>
                                        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleOpenModal(cochera)}
                                                className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg border border-emerald-500/20 backdrop-blur-sm transition-colors"
                                                title="Agregar Vehículo"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleReleaseCochera(cochera.id)}
                                                className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-lg border border-red-500/20 backdrop-blur-sm transition-colors"
                                                title="Liberar Cochera"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>

                                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl -z-10 group-hover:bg-indigo-500/10 transition-colors"></div>

                                        <div className="mb-8 relative">
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex flex-col">
                                                    <span className="text-xs uppercase text-gray-500 font-bold tracking-widest mb-1">
                                                        #{cochera.numero || 'S/N'}
                                                        {isExpired && <span className="ml-2 inline-flex items-center gap-1 bg-red-500 text-white text-[10px] px-2 py-0.5 rounded shadow-sm shadow-red-500/20 drop-shadow-md tracking-wider"><AlertTriangle className="w-3 h-3" />VENCIDO</span>}
                                                    </span>
                                                    <span className={`text-2xl font-bold tracking-tight ${cochera.tipo === 'Exclusiva' ? 'text-amber-400' : 'text-white'}`}>{cochera.tipo}</span>
                                                </div>
                                            </div>
                                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-gray-950/50 border border-gray-800/50">
                                                <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Base</span>
                                                <span className="font-mono text-emerald-400 font-bold">${cochera.precioBase?.toLocaleString()}</span>
                                            </div>
                                        </div>

                                        <div className="flex-1 mb-8 space-y-3">
                                            {(cochera.vehicleDetails || cochera.vehiculos || []).length > 0 ? (
                                                (cochera.vehicleDetails || cochera.vehiculos).map((v: any, idx: number) => {
                                                    // Enrich Data
                                                    const vehicleObj = getEnrichedVehicle(v);
                                                    const plateText = vehicleObj.plate;
                                                    const uniqueId = `${cochera.id}-${idx}`;
                                                    const isExpanded = expandedVehicles.has(uniqueId);

                                                    return (
                                                        <div key={idx} className="border border-gray-800/50 rounded-lg overflow-hidden transition-all duration-200 hover:border-gray-700 bg-gray-950/20">
                                                            {/* Header / Main Row */}
                                                            <div
                                                                onClick={() => toggleVehicle(uniqueId)}
                                                                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-900/40 transition-colors select-none"
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <span className="font-mono text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded border border-emerald-500/20 text-sm font-bold tracking-wider">
                                                                        {plateText}
                                                                    </span>
                                                                    {vehicleObj.type && (
                                                                        <span className="text-gray-500 text-xs font-medium uppercase tracking-wider flex items-center gap-1.5 opacity-80">
                                                                            <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                                                                            {vehicleObj.type}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleUnlinkVehicle(cochera.id, plateText); }}
                                                                        className="p-1.5 text-red-500/50 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                                                        title="Desvincular Vehículo"
                                                                    >
                                                                        <Unlink className="w-3.5 h-3.5" />
                                                                    </button>
                                                                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                                                </div>
                                                            </div>

                                                            {/* Expanded Details */}
                                                            {isExpanded && (
                                                                <div className="p-4 bg-gray-950/40 border-t border-gray-800/50 text-xs grid grid-cols-2 gap-y-3 gap-x-4 animate-in slide-in-from-top-1 fade-in duration-200">
                                                                    <div className="flex flex-col gap-1">
                                                                        <div>
                                                                            <span className="block text-[10px] text-gray-600 uppercase font-bold tracking-widest mb-0.5">Marca</span>
                                                                            <span className="text-gray-300 font-medium truncate">{vehicleObj.brand}</span>
                                                                        </div>
                                                                        <div>
                                                                            <span className="block text-[10px] text-gray-600 uppercase font-bold tracking-widest mb-0.5">Modelo</span>
                                                                            <span className="text-gray-300 font-medium truncate">{vehicleObj.model}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <span className="block text-[10px] text-gray-600 uppercase font-bold tracking-widest mb-0.5">Color</span>
                                                                        <span className="text-gray-300 font-medium">{vehicleObj.color || '-'}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="block text-[10px] text-gray-600 uppercase font-bold tracking-widest mb-0.5">Año</span>
                                                                        <span className="text-gray-300 font-medium">{vehicleObj.year || '-'}</span>
                                                                    </div>
                                                                    <div className="col-span-2">
                                                                        <span className="block text-[10px] text-gray-600 uppercase font-bold tracking-widest mb-0.5">Seguro</span>
                                                                        <span className="text-gray-300 font-medium truncate">{vehicleObj.insurance || '-'}</span>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <div className="flex items-center gap-2 text-gray-600/50 italic text-sm py-1"><div className="w-8 h-0.5 bg-gray-800 rounded-full"></div>Sin vehículos</div>
                                            )}
                                        </div>

                                        <div className="pt-5 border-t border-gray-800/50 flex flex-col gap-3">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-gray-500 font-medium uppercase tracking-wider">Vencimiento</span>
                                                <div className={`flex items-center gap-2 px-2 py-1 rounded border ${isExpired ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/10'}`}>
                                                    {isExpired ? <AlertTriangle className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}
                                                    <span className="font-mono font-medium">{expirationDate}</span>
                                                </div>
                                            </div>

                                            {isExpired && associatedSub && (
                                                <button
                                                    onClick={() => handleOpenRenewalModal(associatedSub.id, cochera, relatedDebtAmount > 0 ? relatedDebtAmount : 0, relatedDebtAmount > 0)}
                                                    className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
                                                >
                                                    {relatedDebtAmount > 0
                                                        ? `Renovar Abono ($${relatedDebtAmount.toLocaleString('es-AR')})`
                                                        : `Renovar Nuevo Ciclo`}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <Plus className="w-5 h-5 text-emerald-400" />
                                Agregar Vehículo
                            </h3>

                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelStyle}>Tipo Vehículo</label>
                                        <select
                                            className={`${inputStyle} appearance-none bg-gray-900`}
                                            value={newVehicleData.tipoVehiculo}
                                            onChange={e => setNewVehicleData({ ...newVehicleData, tipoVehiculo: e.target.value })}
                                        >
                                            <option value="" disabled>Seleccione...</option>
                                            {vehicleTypes.map((v: any) => (
                                                <option key={v.id} value={v.name}>{v.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelStyle}>Patente</label>
                                        <input
                                            className={`${inputStyle} font-mono uppercase text-center tracking-widest font-bold border-l-[3px] border-l-emerald-500`}
                                            value={newVehicleData.patente}
                                            onChange={e => setNewVehicleData({ ...newVehicleData, patente: e.target.value.toUpperCase() })}
                                            placeholder="AAA123"
                                            maxLength={7}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelStyle}>Marca</label>
                                        <input className={inputStyle} value={newVehicleData.marca} onChange={e => setNewVehicleData({ ...newVehicleData, marca: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelStyle}>Modelo</label>
                                        <input className={inputStyle} value={newVehicleData.modelo} onChange={e => setNewVehicleData({ ...newVehicleData, modelo: e.target.value })} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className={labelStyle}>Color</label>
                                        <input className={inputStyle} value={newVehicleData.color} onChange={e => setNewVehicleData({ ...newVehicleData, color: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelStyle}>Año</label>
                                        <input className={inputStyle} value={newVehicleData.anio} onChange={e => setNewVehicleData({ ...newVehicleData, anio: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelStyle}>Seguro</label>
                                        <input className={inputStyle} value={newVehicleData.companiaSeguro} onChange={e => setNewVehicleData({ ...newVehicleData, companiaSeguro: e.target.value })} />
                                    </div>
                                </div>

                                {newVehicleData.tipoVehiculo && (
                                    <div className={`p-4 rounded-lg border ${upgradeInfo.isUpgrade ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-gray-800/30 border-gray-700/30'} transition-all`}>
                                        {upgradeInfo.isUpgrade ? (
                                            <>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <AlertTriangle className="w-4 h-4 text-emerald-400" />
                                                    <span className="text-xs font-bold uppercase text-emerald-400 self-center">Upgrade Detectado</span>
                                                </div>
                                                <div className="flex justify-between items-end">
                                                    <span className="text-gray-400 text-xs">Cobrar hoy:</span>
                                                    <span className="text-xl font-mono font-bold text-white">${upgradeInfo.diffToPay.toLocaleString()}</span>
                                                </div>
                                                <div className="flex justify-between items-end mt-1">
                                                    <span className="text-gray-500 text-[10px] uppercase">Nuevo Precio Base (Matriz)</span>
                                                    <span className="text-xs font-mono text-emerald-300">${upgradeInfo.newBasePrice.toLocaleString()}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex items-center gap-2 text-gray-400">
                                                <Check className="w-4 h-4" />
                                                <span className="text-xs">Misma categoría en la matriz de precios.</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>

                            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-800">
                                <button onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-bold uppercase transition-colors">Cancelar</button>
                                <button onClick={handleSaveVehicle} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase transition-colors shadow-lg shadow-indigo-900/20">Confirmar</button>
                            </div>
                        </div>
                    </div>
                )}

                {isNewCocheraOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-4xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <Plus className="w-5 h-5 text-emerald-400" />
                                Nueva Cochera
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* COLUMNA IZQUIERDA: Configuración y Pagos */}
                                <div className="space-y-6">
                                    {/* 1. CONFIG COCHERA */}
                                    <div className="p-4 bg-gray-800/30 rounded-lg border border-gray-700/30 space-y-3">
                                        <div className="flex gap-4 items-end">
                                            <div className="flex-1">
                                                <label className={labelStyle}>Tipo</label>
                                                <div className="flex bg-gray-900 p-1 rounded-lg border border-gray-800">
                                                    {['Movil', 'Fija'].map(t => (
                                                        <button
                                                            key={t}
                                                            onClick={() => setNewCocheraData({ ...newCocheraData, tipo: t, exclusiva: false, numero: t === 'Movil' ? '' : newCocheraData.numero })}
                                                            className={`flex-1 py-1.5 rounded-md text-xs font-bold uppercase transition-all ${newCocheraData.tipo === t ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 hover:text-gray-300'}`}
                                                        >
                                                            {t}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className={`flex-1 transition-all ${newCocheraData.tipo === 'Movil' ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
                                                <label className={labelStyle}>Número</label>
                                                <input
                                                    className={`${inputStyle} text-center font-mono`}
                                                    value={newCocheraData.numero}
                                                    onChange={e => setNewCocheraData({ ...newCocheraData, numero: e.target.value })}
                                                    placeholder="N°"
                                                />
                                            </div>
                                            <div className={`flex items-center gap-2 pb-2 ${newCocheraData.tipo === 'Movil' ? 'opacity-50 pointer-events-none' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 accent-amber-500 bg-gray-900 border-gray-700 rounded cursor-pointer"
                                                    checked={newCocheraData.exclusiva}
                                                    disabled={newCocheraData.tipo === 'Movil'}
                                                    onChange={e => setNewCocheraData({ ...newCocheraData, exclusiva: e.target.checked })}
                                                />
                                                <span className="text-xs font-bold text-amber-500 uppercase tracking-wide cursor-pointer" onClick={() => { if (newCocheraData.tipo !== 'Movil') setNewCocheraData({ ...newCocheraData, exclusiva: !newCocheraData.exclusiva }) }}>Exclusiva</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 3. FACTURACION */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={labelStyle}>Método Pago</label>
                                            <select className={`${inputStyle} appearance-none bg-gray-900`} value={newCocheraData.metodoPago} onChange={e => setNewCocheraData({ ...newCocheraData, metodoPago: e.target.value })}>
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
                                            <select className={`${inputStyle} appearance-none bg-gray-900`} value={newCocheraData.tipoFactura} onChange={e => setNewCocheraData({ ...newCocheraData, tipoFactura: e.target.value })}>
                                                <option value="" disabled hidden>Seleccionar...</option>
                                                <option value="CC">CC</option>
                                                <option value="A">A</option>
                                                <option value="Final">Final</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* SUMMARY */}
                                    <div className="bg-emerald-900/10 border border-emerald-500/20 p-4 rounded-xl flex items-center justify-between">
                                        <div>
                                            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-widest">Precio Mensual</span>
                                            <span className="text-sm font-mono text-gray-300">${newCocheraFinancials.basePrice.toLocaleString()}</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="block text-[10px] text-emerald-500 uppercase font-bold tracking-widest">Total Inicial (Prorrateado)</span>
                                            <span className="text-2xl font-black text-white tracking-tighter">${newCocheraFinancials.proratedPrice.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* COLUMNA DERECHA: Vehiculo */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 mb-2 text-gray-500">
                                        <Car className="w-3.5 h-3.5" /> <span className="text-[10px] font-bold uppercase">Datos del Vehículo</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className={labelStyle}>Patente</label>
                                            <input
                                                className={`${inputStyle} font-mono uppercase text-center tracking-widest font-bold border-l-[3px] border-l-emerald-500`}
                                                value={newCocheraData.patente}
                                                onChange={e => setNewCocheraData({ ...newCocheraData, patente: e.target.value.toUpperCase() })}
                                                placeholder="AAA123"
                                                maxLength={7}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelStyle}>Tipo Vehículo</label>
                                            <select
                                                className={`${inputStyle} appearance-none bg-gray-900`}
                                                value={newCocheraData.tipoVehiculo}
                                                onChange={e => setNewCocheraData({ ...newCocheraData, tipoVehiculo: e.target.value })}
                                            >
                                                <option value="" disabled>Seleccione...</option>
                                                {vehicleTypes.map((v: any) => (
                                                    <option key={v.id} value={v.name}>{v.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <label className={labelStyle}>Marca</label>
                                            <input className={inputStyle} value={newCocheraData.marca} onChange={e => setNewCocheraData({ ...newCocheraData, marca: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelStyle}>Modelo</label>
                                            <input className={inputStyle} value={newCocheraData.modelo} onChange={e => setNewCocheraData({ ...newCocheraData, modelo: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelStyle}>Color</label>
                                            <input className={inputStyle} value={newCocheraData.color} onChange={e => setNewCocheraData({ ...newCocheraData, color: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className={labelStyle}>Año</label>
                                            <input className={inputStyle} value={newCocheraData.anio} onChange={e => setNewCocheraData({ ...newCocheraData, anio: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelStyle}>Seguro</label>
                                            <input className={inputStyle} value={newCocheraData.seguro} onChange={e => setNewCocheraData({ ...newCocheraData, seguro: e.target.value })} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {errorMessage && (
                                <div className="mt-4 bg-red-500/10 border border-red-500/50 p-3 rounded-xl flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                    <span className="text-xs text-red-400 font-medium leading-relaxed">{errorMessage}</span>
                                </div>
                            )}

                            <div className="flex gap-3 mt-8 pt-4 border-t border-gray-800">
                                <button onClick={() => setIsNewCocheraOpen(false)} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-bold uppercase transition-colors">Cancelar</button>
                                <button onClick={handleCreateCochera} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold uppercase transition-colors shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2">
                                    <Plus className="w-4 h-4" /> Crear Cochera
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- RENEWAL CHECKOUT MODAL --- */}
                {isRenewalModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-gray-900 border border-red-500/30 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative shadow-red-900/20">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-red-500" />
                                Renovar Abono
                            </h3>

                            <div className="space-y-6">
                                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex justify-between items-center ring-1 ring-inset ring-red-500/10">
                                    <div className="text-red-400">
                                        <span className="block text-[10px] uppercase tracking-widest font-bold mb-1">Deuda Total a Pagar</span>
                                        <span className="text-sm font-medium">Cochera {renewalData.cocheraDetails?.tipo} #{renewalData.cocheraDetails?.numero || 'S/N'}</span>
                                    </div>
                                    <div className="text-3xl font-black text-white font-mono tracking-tighter">
                                        ${renewalData.amountToPay.toLocaleString()}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className={labelStyle}>Método de Pago</label>
                                        <select
                                            className={`${inputStyle} appearance-none bg-gray-950`}
                                            value={renewalData.metodoPago}
                                            onChange={e => setRenewalData({ ...renewalData, metodoPago: e.target.value })}
                                        >
                                            <option value="Efectivo">Efectivo</option>
                                            <option value="Transferencia">Transferencia</option>
                                            <option value="Debito">Débito</option>
                                            <option value="Credito">Crédito</option>
                                            <option value="QR">QR</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelStyle}>Facturación</label>
                                        <select
                                            className={`${inputStyle} appearance-none bg-gray-950`}
                                            value={renewalData.tipoFactura}
                                            onChange={e => setRenewalData({ ...renewalData, tipoFactura: e.target.value })}
                                        >
                                            <option value="CC">Cuenta Corriente</option>
                                            <option value="A">Factura A</option>
                                            <option value="Final">Consumidor Final</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-3 mt-8 pt-4 border-t border-gray-800">
                                <button onClick={() => setIsRenewalModalOpen(false)} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-bold uppercase transition-colors">Cancelar</button>
                                <button onClick={handleRenewSubscription} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold uppercase transition-colors shadow-lg shadow-red-900/20 flex items-center justify-center gap-2">
                                    <Check className="w-4 h-4" /> Confirmar Pago
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomerDetailView;
