import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../services/api';

export interface EntryFormData {
    plate: string;
    vehicleType: string;
}

export const useEntryLogic = () => {
    const [plate, setPlate] = useState('');
    const [vehicleType, setVehicleType] = useState('');
    const queryClient = useQueryClient();

    // Mutation para registrar entrada
    const entryMutation = useMutation({
        mutationFn: async (data: EntryFormData) => {
            // TODO: Ajustar endpoint real según backend
            const response = await api.post('/estadias/entrada', data);
            return response.data;
        },
        onSuccess: (data) => {
            // Invalidate active stays query to refresh list
            queryClient.invalidateQueries({ queryKey: ['stays'] });
            queryClient.invalidateQueries({ queryKey: ['activeStays'] }); // Also invalidate audit list
            toast.success(`Ingreso registrado: ${data.plate || 'Vehículo'}`, {
                description: 'Entrada autorizada correctamente'
            });
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

        entryMutation.mutate({ plate, vehicleType });
    };

    // Mock de Tipos de Vehículo (luego vendrá de API)
    const vehicleTypes = [
        { id: 'auto', label: 'Auto' },
        { id: 'moto', label: 'Moto' },
        { id: 'camioneta', label: 'Camioneta' },
    ];

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
