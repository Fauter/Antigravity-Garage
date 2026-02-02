import { Mutation, SyncConflict, Vehicle, Customer, Subscription, Movement } from '../../../shared/schemas';
import { VehicleRepository } from '../../Garage/infra/VehicleRepository';
import { CustomerRepository } from '../../Garage/infra/CustomerRepository';
import { SubscriptionRepository } from '../../Garage/infra/SubscriptionRepository';
import { MovementRepository } from '../../Billing/infra/MovementRepository';
import { SyncConflictModel } from '../../../infrastructure/database/models';
import { v4 as uuidv4 } from 'uuid';

export class SyncService {
    private vehicleRepo = new VehicleRepository();
    private customerRepo = new CustomerRepository();
    private subRepo = new SubscriptionRepository();
    private movementRepo = new MovementRepository();

    /**
     * Procesa un lote de mutaciones (Reconciliación).
     * Estrategia Last-Write-Wins: Si el timestamp de la mutación es más reciente 
     * que la entidad local, se aplica.
     */
    async processMutations(mutations: Mutation[]): Promise<{ processed: number; conflicts: number }> {
        let processedCount = 0;
        let conflictCount = 0;

        for (const mut of mutations) {
            try {
                // 1. Verificar si ya fue procesada/existe (Idempotencia básica)
                // En un escenario real, podríamos tener un log de 'processedMutationIds'.
                // Aquí asumiremos que si es UPDATE y el timestamp es viejo, se descarta.

                await this.applyMutation(mut);
                processedCount++;
            } catch (error: any) {
                console.error(`Error procesando mutación ${mut.id}:`, error);

                // 2. Registrar Conflicto
                const conflict: SyncConflict = {
                    id: uuidv4(),
                    mutationId: mut.id,
                    error: error.message || 'Unknown error',
                    receivedPayload: mut.payload,
                    timestamp: new Date(),
                    resolved: false
                };

                await SyncConflictModel.create(conflict);
                conflictCount++;
            }
        }

        return { processed: processedCount, conflicts: conflictCount };
    }

    private async applyMutation(mut: Mutation) {
        switch (mut.entityType) {
            case 'Vehicle':
                await this.handleVehicle(mut);
                break;
            case 'Customer':
                await this.handleCustomer(mut);
                break;
            case 'Movement':
                await this.handleMovement(mut);
                break;
            case 'Subscription':
                await this.handleSubscription(mut);
                break;
            default:
                throw new Error(`Entidad no soportada para sync: ${mut.entityType}`);
        }
    }

    // --- Handlers por Entidad ---

    private async handleVehicle(mut: Mutation) {
        if (mut.operation === 'DELETE') {
            // No implementado borrado físico aún en repos
            return;
        }

        const payload = mut.payload as Vehicle;

        // Estrategia LWW: Buscar local
        const local = await this.vehicleRepo.findById(mut.entityId);

        if (local) {
            // Si la versión local es más nueva que la mutación, IGNORAR (Winner: Local)
            if (local.updatedAt > mut.timestamp) {
                console.log(`[Sync] Ignorando mutación antigua para Vehicle ${mut.entityId}`);
                return;
            }
        }

        // Apply (Create or Update)
        await this.vehicleRepo.save(payload);
    }

    private async handleCustomer(mut: Mutation) {
        const payload = mut.payload as Customer;
        const local = await this.customerRepo.findById(mut.entityId);

        if (local && local.updatedAt > mut.timestamp) return;

        await this.customerRepo.save(payload);
    }

    private async handleSubscription(mut: Mutation) {
        const payload = mut.payload as Subscription;
        // SubscriptionRepo tiene lógica upsert
        const local = await this.subRepo.findById(mut.entityId);
        if (local && local.updatedAt > mut.timestamp) return;

        await this.subRepo.save(payload);
    }

    private async handleMovement(mut: Mutation) {
        const payload = mut.payload as Movement;
        // Movement usualmente es inmutable (append-only), pero si se corrige:
        const local = await this.movementRepo.findById(mut.entityId);

        // Asumimos que movement no tiene updatedAt explícito en schema, usamos createdAt o timestamp
        // Si ya existe, asumimos que no cambia (Append Only), salvo que sea corrección.
        if (local) return;

        await this.movementRepo.save(payload);
    }
}
