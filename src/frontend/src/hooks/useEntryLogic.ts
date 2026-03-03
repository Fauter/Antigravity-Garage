import { useState, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../services/api';
import { PrinterService } from '../services/PrinterService';
import { useVehiclePriceValidation } from './useVehiclePriceValidation';

export interface EntryFormData {
    plate: string;
    vehicleTypeId: string;
}

export const useEntryLogic = () => {
    const [plate, setPlate] = useState('');
    const [vehicleType, setVehicleType] = useState('');
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

            resetForm();
        },
        onError: (error: any) => {
            toast.error('Error al registrar entrada', {
                description: error.response?.data?.error || error.message
            });
        }
    });

    const resetForm = () => {
        setPlate('');
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
        setPlate,
        vehicleType,
        setVehicleType,
        vehicleTypes,
        handleSubmit,
        isLoading: entryMutation.isPending,
        isSuccess: entryMutation.isSuccess,
        error: entryMutation.error
    };
};
