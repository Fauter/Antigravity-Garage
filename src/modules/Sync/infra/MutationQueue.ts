import { v4 as uuidv4 } from 'uuid';
import { MutationModel } from '../../../infrastructure/database/models';
import { Mutation } from '../../../shared/schemas';

type EntityType = 'Customer' | 'Vehicle' | 'Subscription' | 'Movement' | 'Shift';
type OperationType = 'CREATE' | 'UPDATE' | 'DELETE';

export class MutationQueue {
    /**
     * Registra una intención de cambio en la cola de sincronización.
     * Debe llamarse dentro de las transacciones de negocio.
     */
    static async addToQueue(
        entityType: EntityType,
        entityId: string,
        operation: OperationType,
        payload: any
    ): Promise<Mutation> {
        const mutation: Mutation = {
            id: uuidv4(),
            entityType,
            entityId,
            operation,
            payload,
            timestamp: new Date(),
            synced: false,
            retryCount: 0
        };

        const result = await MutationModel.create(mutation);
        return result.toObject() as Mutation;
    }
}
