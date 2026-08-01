import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../services/api';
import { PrinterService } from '../services/PrinterService';
import { useVehiclePriceValidation } from './useVehiclePriceValidation';
import { useAuth } from '../context/AuthContext';

export interface EntryFormData {
    plate: string;
    vehicleTypeId: string;
    photoPath?: string;
    operator?: string;
    // Prepaid / Anticipado
    prepaidTariffId?: string;
    prepaidPaymentMethod?: string;
    prepaidInvoiceType?: string;
    prepaidPromoPercentage?: number;
}

export interface ErrorInfo {
    message: string;
    isConflict: boolean;
    plate: string;
}

export const useEntryLogic = () => {
    const { operatorName } = useAuth();
    const [plate, setPlateRaw] = useState('');
    const [vehicleType, setVehicleType] = useState('');
    const [photoPath, setPhotoPath] = useState('');
    const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
    const plateInputRef = useRef<HTMLInputElement>(null);
    const queryClient = useQueryClient();

    // --- Prepaid / Anticipado State ---
    const [isPrepaid, setIsPrepaid] = useState(false);
    const [prepaidTariffId, setPrepaidTariffId] = useState('');
    const [prepaidPaymentMethod, setPrepaidPaymentMethod] = useState('');
    const [prepaidInvoiceType, setPrepaidInvoiceType] = useState('');

    const [promos, setPromos] = useState<any[]>([]);
    const [selectedPromo, setSelectedPromo] = useState<any>(null);

    useEffect(() => {
        api.get('/promos').then(res => setPromos(res.data)).catch(console.error);
    }, []);

    // Fetch Vehicle Types
    const { data: rawVehicleTypes = [] } = useQuery({
        queryKey: ['vehicleTypes'],
        queryFn: async () => {
            const res = await api.get('/tipos-vehiculo');
            // Map to simplified structure
            return (res.data || []).map((v: any) => ({
                id: v.id, // Use UUID from DB
                label: v.name // Display Name
            }));
        }
    });

    // Price integrity validation + smart sorting for 'hora' tariffs
    const { getSortedVehicleTypes } = useVehiclePriceValidation('hora');

    // Enrich and sort vehicle types: valid first → price asc → alpha
    const vehicleTypes = useMemo(() =>
        getSortedVehicleTypes(rawVehicleTypes.map((v: any) => ({ id: v.id, name: v.label }))),
        [rawVehicleTypes, getSortedVehicleTypes]
    );

    // --- Dual Fetch Prices (for dynamic display in Prepaid UI) ---
    const { data: pricesStd = {} } = useQuery({
        queryKey: ['prices', 'standard'],
        queryFn: async () => {
            const res = await api.get('/precios');
            return res.data?.standard || {};
        }
    });

    const { data: pricesElec = {} } = useQuery({
        queryKey: ['prices', 'electronic'],
        queryFn: async () => {
            const res = await api.get('/precios');
            return res.data?.electronic || {};
        }
    });

    // --- Fetch Turno Tariffs (for Prepaid selector) ---
    const { data: turnoTariffs = [] } = useQuery({
        queryKey: ['tariffs-turno'],
        queryFn: async () => {
            const res = await api.get('/tarifas');
            const all = res.data || [];
            // Filter to 'turno' type and map totalMinutes
            const turnoRaw = all
                .filter((t: any) => (t.type || '').toLowerCase() === 'turno')
                .map((t: any) => {
                    const d = Number(t.days || 0);
                    const h = Number(t.hours || 0);
                    const m = Number(t.minutes || 0);
                    const totalMinutes = (d * 1440) + (h * 60) + m;
                    return { ...t, totalMinutes };
                });

            // Deduplicate by name (case-insensitive) - keep the first one found
            const uniqueTariffs = Array.from(
                new Map(
                    turnoRaw.map((t: any) => [(t.name || '').trim().toLowerCase(), t])
                ).values()
            );

            // Sort by duration ascending
            return uniqueTariffs.sort((a: any, b: any) => a.totalMinutes - b.totalMinutes);
        }
    });



    // Clear error when user starts typing a new plate
    const handlePlateChange = useCallback((value: string) => {
        setPlateRaw(value);
        if (errorInfo) {
            setErrorInfo(null);
        }
    }, [errorInfo]);

    // Mutation para registrar entrada
    const entryMutation = useMutation({
        mutationFn: async (data: EntryFormData) => {
            const response = await api.post('/estadias/entrada', data);
            return response.data;
        },
        onSuccess: async (data) => {
            const stay = data.stay;
            const prepaidMovement = data.prepaidMovement;

            // Invalidate active stays query to refresh list
            queryClient.invalidateQueries({ queryKey: ['stays'] });
            queryClient.invalidateQueries({ queryKey: ['activeStays'] });
            toast.success(`Ingreso registrado: ${stay.plate || 'Vehículo'}`, {
                description: 'Entrada autorizada correctamente'
            });

            // NOTE: Entry registration does NOT open the physical barrier.
            // The barrier opens automatically when the hardware detects the vehicle
            // (via HardwareOrchestrator → hw:entry-detected → openBarrier('ENTRY')).
            // This decouples the operator's registration action from the physical gate.

            // TICKET
            if (prepaidMovement) {
                // Find tariff name for ticket using the active state BEFORE reset
                const selectedTariff = turnoTariffs.find((t: any) => String(t.id) === String(prepaidTariffId));
                const tariffName = selectedTariff?.name || 'Pago Anticipado';
                PrinterService.printPrepaidEntryTicket(stay, prepaidMovement, tariffName);
            } else {
                PrinterService.printEntryTicket(stay);
            }

            setErrorInfo(null);
            resetForm();
        },
        onError: (error: any) => {
            const status = error.response?.status;
            const currentPlate = plate;

            if (status === 409) {
                // Conflict: vehicle already has an active stay
                const friendlyMessage = `El vehículo ${currentPlate} ya se encuentra dentro del estacionamiento.`;
                setErrorInfo({
                    message: friendlyMessage,
                    isConflict: true,
                    plate: currentPlate
                });
                toast.error('Vehículo duplicado', {
                    description: friendlyMessage
                });
                // Auto-select plate text for quick correction
                setTimeout(() => {
                    plateInputRef.current?.select();
                }, 50);
            } else {
                // Generic fallback for non-409 errors
                const genericMessage = error.response?.data?.error || 'Ocurrió un error al registrar la entrada. Intente nuevamente.';
                setErrorInfo({
                    message: genericMessage,
                    isConflict: false,
                    plate: currentPlate
                });
                toast.error('Error al registrar entrada', {
                    description: genericMessage
                });
            }
        }
    });

    const resetForm = () => {
        setPlateRaw('');
        setVehicleType('');
        setPhotoPath('');
        setIsPrepaid(false);
        setPrepaidTariffId('');
        setPrepaidPaymentMethod('');
        setPrepaidInvoiceType('');
        setSelectedPromo(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (plate.trim().length < 3) {
            setErrorInfo({
                message: 'La patente debe tener al menos 3 caracteres.',
                isConflict: false,
                plate: plate
            });
            setTimeout(() => {
                plateInputRef.current?.select();
            }, 50);
            return;
        }

        if (!plate || !vehicleType) return;

        // Validate prepaid completeness
        if (isPrepaid && (!prepaidTariffId || !prepaidPaymentMethod || !prepaidInvoiceType)) {
            setErrorInfo({
                message: 'Complete todos los datos del pago anticipado.',
                isConflict: false,
                plate: plate
            });
            return;
        }

        const formData: EntryFormData = {
            plate,
            vehicleTypeId: vehicleType,
            photoPath: photoPath,
            operator: operatorName || 'Sistema'
        };

        // Attach prepaid fields only when active
        if (isPrepaid && prepaidTariffId) {
            formData.prepaidTariffId = prepaidTariffId;
            formData.prepaidPaymentMethod = prepaidPaymentMethod;
            formData.prepaidInvoiceType = prepaidInvoiceType;
            formData.prepaidPromoPercentage = selectedPromo?.porcentaje || 0;
        }

        entryMutation.mutate(formData);
    };

    return {
        plate,
        setPlate: handlePlateChange,
        vehicleType,
        setVehicleType,
        photoPath,
        setPhotoPath,
        vehicleTypes,
        handleSubmit,
        isLoading: entryMutation.isPending,
        isSuccess: entryMutation.isSuccess,
        errorInfo,
        plateInputRef,
        // Prepaid / Anticipado
        isPrepaid,
        setIsPrepaid,
        prepaidTariffId,
        setPrepaidTariffId,
        prepaidPaymentMethod,
        setPrepaidPaymentMethod,
        prepaidInvoiceType,
        setPrepaidInvoiceType,
        turnoTariffs,
        pricesStd,
        pricesElec,
        promos,
        selectedPromo,
        setSelectedPromo
    };
};
