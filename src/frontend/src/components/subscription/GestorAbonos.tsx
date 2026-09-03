import React, { useState } from 'react';
import ListaAbonados from './ListaAbonados';
import FormularioAbono from './FormularioAbono';
import CustomerDetailView from './CustomerDetailView';
import { useSubscription } from '../../hooks/useSubscription';

const GestorAbonos: React.FC = () => {
    const [view, setView] = useState<'list' | 'new' | 'detail'>('list');
    const [selectedSub, setSelectedSub] = useState<any>(null);
    const { subscribers, isLoading, error, refetch } = useSubscription();

    const handleCreate = async () => {
        // Alta is already fully managed by FormularioAbono (atomic POST, outbox, etc.)
        // We only need to refresh the list and switch view
        await refetch();
        setView('list');
    };

    const handleSelect = (sub: any) => {
        setSelectedSub(sub);
        setView('detail');
    };

    return (
        <div className="min-h-full flex flex-col bg-gray-950/50 backdrop-blur-sm">
            {view === 'list' && (
                <ListaAbonados
                    onNewClick={() => setView('new')}
                    onSelectSubscriber={handleSelect}
                    subscribers={subscribers || []}
                    isLoading={isLoading}
                />
            )}

            {view === 'new' && (
                <FormularioAbono
                    onCancel={() => setView('list')}
                    onSubmit={handleCreate}
                />
            )}

            {view === 'detail' && selectedSub && (
                <CustomerDetailView
                    subscriber={selectedSub}
                    onBack={() => setView('list')}
                />
            )}
        </div>
    );
};

export default GestorAbonos;
