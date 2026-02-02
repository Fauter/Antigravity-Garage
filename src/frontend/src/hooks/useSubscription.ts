import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MutationQueue } from '../lib/MutationQueue';
import { api } from '../services/api';

export const useSubscription = () => {
    const queryClient = useQueryClient();
    // const mutationQueue = new MutationQueue();

    // Fetch Subscriptions (Online)
    const { data: subscribers, isLoading, error } = useQuery({
        queryKey: ['subscriptions'],
        queryFn: async () => {
            const res = await api.get('/abonos');
            return res.data;
        }
    });

    // Create Subscription (Offline First)
    const createSubscription = async (formData: any) => {
        // 1. Optimistic Update or Local Mutation
        // We construct the payload that Backend expects
        const payload = {
            customerData: formData.customer,
            vehicleData: formData.vehicle,
            subscriptionType: formData.billing.type,
            paymentMethod: formData.billing.method
        };

        // 2. Add to Queue
        await MutationQueue.addMutation(
            'Subscription',
            formData.customer.dni, // Temporary ID or Key
            'create',
            payload
        );

        // 3. Trigger Sync (Queue does this, but good to know)
        // 4. Invalidate Queries to refetch (if online) or show pending state
        // For simple offline demo, we might want to manually update cache
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] });

        return true;
    };

    return {
        subscribers,
        isLoading,
        error,
        createSubscription
    };
};
