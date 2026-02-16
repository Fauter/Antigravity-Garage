import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../../../infrastructure/lib/supabase';
import { Mutation, SyncConflict, Vehicle, Customer, Subscription, Movement, Employee } from '../../../shared/schemas';
import { VehicleRepository } from '../../Garage/infra/VehicleRepository';
import { CustomerRepository } from '../../Garage/infra/CustomerRepository';
import { SubscriptionRepository } from '../../Garage/infra/SubscriptionRepository';
import { MovementRepository } from '../../Billing/infra/MovementRepository';
import { EmployeeModel, MutationModel, SyncConflictModel } from '../../../infrastructure/database/models';

class EmployeeRepository {
    async save(employee: Employee) {
        await EmployeeModel.findOneAndUpdate({ id: employee.id }, employee, { upsert: true, new: true });
    }
}

export class SyncService {
    private vehicleRepo = new VehicleRepository();
    private customerRepo = new CustomerRepository();
    private subRepo = new SubscriptionRepository();
    private movementRepo = new MovementRepository();
    private employeeRepo = new EmployeeRepository();

    private garageId: string | null = null;
    private isSyncing = false;

    constructor() {
        console.log('🔄 SyncService Initialized');
    }

    /**
     * Bootstrap: Hidratación inicial desde Supabase
     */
    async pullAllData(garageId: string) {
        this.garageId = garageId;
        console.log(`📡 [Sync] Iniciando hidratación para Garage ID: ${garageId}`);

        try {
            // 1. Fetch Data with consistent snake_case from DB
            const [vehicles, customers, subscriptions, movements, employees] = await Promise.all([
                this.fetchTable('vehicles', garageId),
                this.fetchTable('customers', garageId),
                this.fetchTable('subscriptions', garageId),
                this.fetchTable('movements', garageId),
                this.fetchTable('employee_accounts', garageId)
            ]);

            // 2. Log Sample Data for Verification
            console.log('👀 [Sync] Muestra de datos (Vehículos):', vehicles.slice(0, 3));
            console.log('👀 [Sync] Muestra de datos (Clientes):', customers.slice(0, 3));
            console.log('👀 [Sync] Muestra de datos (Empleados):', employees.slice(0, 3));

            // 3. Upsert Local with Mapping and Identity Enforcement
            await this.upsertLocalBatch(this.vehicleRepo, vehicles, 'Vehicle');
            await this.upsertLocalBatch(this.customerRepo, customers, 'Customer');
            await this.upsertLocalBatch(this.subRepo, subscriptions, 'Subscription');
            await this.upsertLocalBatch(this.movementRepo, movements, 'Movement');
            await this.upsertLocalBatch(this.employeeRepo, employees, 'Employee');

            console.log(`📡 [Sync] Hidratación completa: ${vehicles.length} v, ${customers.length} c, ${subscriptions.length} s, ${movements.length} m.`);
            console.log(`📡 [Sync] Cuentas de personal actualizadas: ${employees.length} operarios detectados.`);

        } catch (error) {
            console.error('❌ [Sync] Error en hidratación inicial:', error);
        }
    }

    private async fetchTable(table: string, garageId: string) {
        let query = supabase.from(table).select('*');

        if (table === 'employee_accounts') {
            // We assume employee_accounts has garage_id as per schema alignment requirements
            query = query.eq('garage_id', garageId);
        } else {
            query = query.eq('garage_id', garageId);
        }

        const { data, error } = await query;

        if (error) {
            console.error(`Error fetching ${table}:`, error.message);
            // Default to empty array for employees if scheme mismatch to avoid crashing core sync
            if (table === 'employee_accounts') return [];
            throw error;
        }
        return data || [];
    }

    private async upsertLocalBatch(repo: any, items: any[], type: string) {
        for (const item of items) {
            const mapped = this.mapRemoteToLocal(item, type);

            if (!mapped.id) {
                console.warn(`[Sync] Skipping item without ID in ${type}`, item);
                continue;
            }

            await repo.save(mapped);
        }
    }

    /**
     * CONVERSIÓN DE SNAKE_CASE (DB/Supabase) -> CAMELCASE (App/Mongo)
     */
    private mapRemoteToLocal(item: any, type: string): any {
        const mapped: any = { ...item };

        // Common Fields
        if (item.garage_id !== undefined) { mapped.garageId = item.garage_id; delete mapped.garage_id; }
        if (item.owner_id !== undefined) { mapped.ownerId = item.owner_id; delete mapped.owner_id; }
        if (item.created_at !== undefined) { mapped.createdAt = new Date(item.created_at); delete mapped.created_at; }
        if (item.updated_at !== undefined) { mapped.updatedAt = new Date(item.updated_at); delete mapped.updated_at; }

        // Entity Specifics
        if (type === 'Vehicle') {
            if (item.customer_id !== undefined) { mapped.customerId = item.customer_id; delete mapped.customer_id; }
            if (mapped.plate) mapped.plate = mapped.plate.toUpperCase();
        }

        if (type === 'Subscription') {
            if (item.customer_id !== undefined) { mapped.customerId = item.customer_id; delete mapped.customer_id; }
            if (item.vehicle_id !== undefined) { mapped.vehicleId = item.vehicle_id; delete mapped.vehicle_id; }
            if (item.start_date !== undefined) { mapped.startDate = new Date(item.start_date); delete mapped.start_date; }
            if (item.end_date !== undefined) { mapped.endDate = item.end_date ? new Date(item.end_date) : null; delete mapped.end_date; }
        }

        if (type === 'Movement') {
            if (item.related_entity_id !== undefined) { mapped.relatedEntityId = item.related_entity_id; delete mapped.related_entity_id; }
            if (item.payment_method !== undefined) { mapped.paymentMethod = item.payment_method; delete mapped.payment_method; }
            if (item.ticket_number !== undefined) { mapped.ticketNumber = item.ticket_number; delete mapped.ticket_number; }
            if (item.ticket_pago !== undefined) { mapped.ticketPago = item.ticket_pago; delete mapped.ticket_pago; }
            if (item.shift_id !== undefined) { mapped.shiftId = item.shift_id; delete mapped.shift_id; }
            if (item.invoice_type !== undefined) { mapped.invoiceType = item.invoice_type; delete mapped.invoice_type; }
        }

        if (type === 'Employee') {
            if (item.first_name !== undefined) { mapped.firstName = item.first_name; delete mapped.first_name; }
            if (item.last_name !== undefined) { mapped.lastName = item.last_name; delete mapped.last_name; }
            if (item.password_hash !== undefined) { mapped.passwordHash = item.password_hash; delete mapped.password_hash; }
        }

        // Identity Injection if missing (Safety Net)
        if (!mapped.garageId && this.garageId) {
            mapped.garageId = this.garageId;
        }

        return mapped;
    }

    /**
     * CONVERSIÓN DE CAMELCASE (App/Mongo) -> SNAKE_CASE (DB/Supabase)
     */
    private mapLocalToRemote(item: any, type: string): any {
        const mapped: any = { ...item };

        // Common Fields
        if (item.garageId !== undefined) { mapped.garage_id = item.garageId; delete mapped.garageId; }
        if (item.ownerId !== undefined) { mapped.owner_id = item.ownerId; delete mapped.ownerId; }
        if (item.createdAt !== undefined) { mapped.created_at = item.createdAt; delete mapped.createdAt; }
        if (item.updatedAt !== undefined) { mapped.updated_at = item.updatedAt; delete mapped.updatedAt; }

        if (type === 'Vehicle') {
            if (item.customerId !== undefined) { mapped.customer_id = item.customerId; delete mapped.customerId; }
        }

        if (type === 'Subscription') {
            if (item.customerId !== undefined) { mapped.customer_id = item.customerId; delete mapped.customerId; }
            if (item.vehicleId !== undefined) { mapped.vehicle_id = item.vehicleId; delete mapped.vehicleId; }
            if (item.startDate !== undefined) { mapped.start_date = item.startDate; delete mapped.startDate; }
            if (item.endDate !== undefined) { mapped.end_date = item.endDate; delete mapped.endDate; }
        }

        if (type === 'Movement') {
            if (item.relatedEntityId !== undefined) { mapped.related_entity_id = item.relatedEntityId; delete mapped.relatedEntityId; }
            if (item.paymentMethod !== undefined) { mapped.payment_method = item.paymentMethod; delete mapped.paymentMethod; }
            if (item.ticketNumber !== undefined) { mapped.ticket_number = item.ticketNumber; delete mapped.ticketNumber; }
            if (item.ticketPago !== undefined) { mapped.ticket_pago = item.ticketPago; delete mapped.ticketPago; }
            if (item.shiftId !== undefined) { mapped.shift_id = item.shiftId; delete mapped.shiftId; }
            if (item.invoiceType !== undefined) { mapped.invoice_type = item.invoiceType; delete mapped.invoiceType; }
        }

        if (type === 'Employee') {
            if (item.firstName !== undefined) { mapped.first_name = item.firstName; delete mapped.firstName; }
            if (item.lastName !== undefined) { mapped.last_name = item.lastName; delete mapped.lastName; }
            if (item.passwordHash !== undefined) { mapped.password_hash = item.passwordHash; delete mapped.passwordHash; }
        }

        return mapped;
    }

    /**
     * Process Local Mutations (Push to Cloud)
     */
    async processMutations(mutations: Mutation[]): Promise<{ processed: number; conflicts: number }> {
        if (!this.garageId) {
            console.warn('[Sync] Cannot process mutations without garageId');
            return { processed: 0, conflicts: 0 };
        }

        let processedCount = 0;
        let conflictCount = 0;

        for (const mut of mutations) {
            try {
                // Determine Table
                const table = this.getTableName(mut.entityType);
                if (!table) continue;

                // LWW Check (Last Write Wins)
                const { data: remote } = await supabase
                    .from(table)
                    .select('updated_at')
                    .eq('id', mut.entityId)
                    .single();

                if (remote && new Date(remote.updated_at) > new Date(mut.timestamp)) {
                    console.log(`[Sync] Conflict LWW: Remote is newer for ${mut.entityId}. Discarding local mutation.`);
                    processedCount++;
                    continue;
                }

                // Apply Change
                const payload = this.mapLocalToRemote(mut.payload, mut.entityType);

                // Enforce Context (Garage)
                payload.garage_id = this.garageId;

                const { error } = await supabase.from(table).upsert(payload);

                if (error) throw error;

                processedCount++;
            } catch (error: any) {
                console.error(`[Sync] Mutation Failed ${mut.id}:`, error.message);

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

    private getTableName(type: string): string | null {
        switch (type) {
            case 'Vehicle': return 'vehicles';
            case 'Customer': return 'customers';
            case 'Subscription': return 'subscriptions';
            case 'Movement': return 'movements';
            case 'Shift': return 'shifts';
            case 'Employee': return 'employee_accounts';
            default: return null;
        }
    }

    /**
     * Realtime Listener using Supabase
     */
    initRealtime(garageId: string) {
        console.log('📡 [Realtime] Subscribing to changes...');
        supabase.channel('public:any')
            .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
                // Filter by garage_id
                if (payload.new && (payload.new as any).garage_id === garageId) {
                    this.handleRemoteChange(payload.table, payload.new);
                }
            })
            .subscribe();
    }

    private async handleRemoteChange(table: string, newItem: any) {
        let type = '';
        let repo: any = null;

        switch (table) {
            case 'vehicles': type = 'Vehicle'; repo = this.vehicleRepo; break;
            case 'customers': type = 'Customer'; repo = this.customerRepo; break;
            case 'subscriptions': type = 'Subscription'; repo = this.subRepo; break;
            case 'movements': type = 'Movement'; repo = this.movementRepo; break;
            case 'employee_accounts': type = 'Employee'; repo = this.employeeRepo; break;
        }

        if (repo && type) {
            console.log(`✨ Realtime Update for ${type}`);
            const mapped = this.mapRemoteToLocal(newItem, type);
            await repo.save(mapped);
        }
    }
}
