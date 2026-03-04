import { useState, useMemo, useRef, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../services/api';
import { PrinterService } from '../services/PrinterService';
import { useVehiclePriceValidation } from './useVehiclePriceValidation';

export interface EntryFormData {
    plate: string;
    vehicleTypeId: string;
}

export interface ErrorInfo {
    message: string;
    isConflict: boolean;
    plate: string;
}

export const useEntryLogic = () => {
    const [plate, setPlateRaw] = useState('');
    const [vehicleType, setVehicleType] = useState('');
    const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
    const plateInputRef = useRef<HTMLInputElement>(null);
    const queryClient = useQueryClient();

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
        onSuccess: (data) => {
            // Invalidate active stays query to refresh list
            queryClient.invalidateQueries({ queryKey: ['stays'] });
            queryClient.invalidateQueries({ queryKey: ['activeStays'] });
            toast.success(`Ingreso registrado: ${data.plate || 'Vehículo'}`, {
                description: 'Entrada autorizada correctamente'
            });
            // TICKET
            PrinterService.printEntryTicket(data);

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
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!plate || !vehicleType) return;

        entryMutation.mutate({
            plate,
            vehicleTypeId: vehicleType
        });
    };

    return {
        plate,
        setPlate: handlePlateChange,
        vehicleType,
        setVehicleType,
        vehicleTypes,
        handleSubmit,
        isLoading: entryMutation.isPending,
        isSuccess: entryMutation.isSuccess,
        errorInfo,
        plateInputRef
    };
};
