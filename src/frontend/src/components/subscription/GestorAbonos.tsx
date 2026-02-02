import React, { useState } from 'react';
import ListaAbonados from './ListaAbonados';
import FormularioAbono from './FormularioAbono';
import { useSubscription } from '../../hooks/useSubscription';

const GestorAbonos: React.FC = () => {
    const [view, setView] = useState<'list' | 'new'>('list');
    const { subscribers, createSubscription } = useSubscription();

    const handleCreate = async (data: any) => {
        await createSubscription(data);
        setView('list');
    };

    return (
        <div className="h-full flex flex-col bg-gray-950/50 backdrop-blur-sm">
            {view === 'list' ? (
                <ListaAbonados
                    onNewClick={() => setView('new')}
                    subscribers={subscribers || []}
                />
            ) : (
                <FormularioAbono
                    onCancel={() => setView('list')}
                    onSubmit={handleCreate}
                />
            )}
        </div>
    );
};

export default GestorAbonos;
