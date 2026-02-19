import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../services/api';
import { PrinterService } from '../services/PrinterService';

export interface EntryFormData {
    plate: string;
    vehicleTypeId: string;
}

export const useEntryLogic = () => {
    const [plate, setPlate] = useState('');
    const [vehicleType, setVehicleType] = useState('');
    const queryClient = useQueryClient();

    // Fetch Vehicle Types
    const { data: vehicleTypes = [] } = useQuery({
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

    // Auto-select first type if available and none selected
    useEffect(() => {
        if (!vehicleType && vehicleTypes.length > 0) {
            setVehicleType(vehicleTypes[0].id);
        }
    }, [vehicleTypes, vehicleType]);

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
        // Keep vehicle type selected or reset to first? User preference usually to keep last.
        // But for safety let's keep current.
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
