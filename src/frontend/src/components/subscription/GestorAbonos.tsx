import React, { useState } from 'react';
import ListaAbonados from './ListaAbonados';
import FormularioAbono from './FormularioAbono';
import CustomerDetailView from './CustomerDetailView';
import { useSubscription } from '../../hooks/useSubscription';

const GestorAbonos: React.FC = () => {
    const [view, setView] = useState<'list' | 'new' | 'detail'>('list');
    const [selectedSub, setSelectedSub] = useState<any>(null);
    const { subscribers, createSubscription } = useSubscription();

    const handleCreate = async (data: any) => {
        await createSubscription(data);
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
