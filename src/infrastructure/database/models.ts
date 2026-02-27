import mongoose, { Schema } from 'mongoose';
import {
    Vehicle, Customer, Subscription, Movement, Shift, Employee, Debt, Cochera, ShiftClose, PartialClose, Incident,
    Mutation, SyncConflict, VehicleType, Tariff, Price
} from '../../shared/schemas';

// --- Cochera ---
const CocheraSchema = new Schema<Cochera>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    tipo: { type: String, required: true, enum: ['Fija', 'Exclusiva', 'Movil'] },
    numero: { type: String },
    vehiculos: [{ type: String }],
    clienteId: { type: String },
    precioBase: { type: Number, default: 0 },
    status: { type: String, enum: ['Disponible', 'Ocupada'], default: 'Disponible' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const CocheraModel = mongoose.model<Cochera>('Cochera', CocheraSchema);

// --- Vehicle ---
const VehicleSchema = new Schema<Vehicle>({
    id: { type: String, required: true, unique: true, index: true },
    garageId: { type: String }, // Supabase compatibility
    ownerId: { type: String },  // Supabase compatibility
    plate: { type: String, required: true, unique: true, uppercase: true },
    type: { type: String, required: true, enum: ['Auto', 'Moto', 'Camioneta', 'Otro'] },
    brand: { type: String },
    model: { type: String },
    color: { type: String },
    year: { type: String },
    insurance: { type: String },
    description: { type: String },
    customerId: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const VehicleModel = mongoose.model<Vehicle>('Vehicle', VehicleSchema);

// --- Customer ---
const CustomerSchema = new Schema<Customer>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    dni: { type: String },
    address: { type: String },
    localidad: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const CustomerModel = mongoose.model<Customer>('Customer', CustomerSchema);

// --- Subscription ---
const SubscriptionSchema = new Schema<Subscription>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    customerId: { type: String, required: true },
    vehicleId: { type: String },
    type: { type: String, required: true, enum: ['Exclusiva', 'Fija', 'Movil'] },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    price: { type: Number, required: true },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const SubscriptionModel = mongoose.model<Subscription>('Subscription', SubscriptionSchema);

// --- Debt ---
const DebtSchema = new Schema<Debt>({
    id: { type: String, required: true, unique: true },
    subscriptionId: { type: String, required: true },
    customerId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    surchargeApplied: { type: Number, default: 0 },
    status: { type: String, enum: ['PENDING', 'PAID', 'CANCELLED'], default: 'PENDING' },
    dueDate: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const DebtModel = mongoose.model<Debt>('Debt', DebtSchema);

// --- Stay ---
const StaySchema = new Schema<import('../../shared/schemas').Stay>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    vehicleId: { type: String },
    plate: { type: String, required: true },
    entryTime: { type: Date, required: true },
    exitTime: { type: Date },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

export const StayModel = mongoose.model<import('../../shared/schemas').Stay>('Stay', StaySchema);

// --- Movement (Financial) ---
const MovementSchema = new Schema<Movement>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    relatedEntityId: { type: String },
    type: { type: String, required: true },
    timestamp: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, default: 'Efectivo' },
    ticketNumber: { type: Number },
    ticketPago: { type: Number },
    operator: { type: String },
    invoiceType: { type: String },
    plate: { type: String },
    notes: { type: String },
    shiftId: { type: String },
    createdAt: { type: Date, default: Date.now }
});

export const MovementModel = mongoose.model<Movement>('Movement', MovementSchema);

// --- Shift ---
const ShiftSchema = new Schema<Shift>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    operatorName: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    startCash: { type: Number, default: 0 },
    endCash: { type: Number },
    totalCollection: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    notes: { type: String }
});

export const ShiftModel = mongoose.model<Shift>('Shift', ShiftSchema);

// --- ShiftClose ---
const ShiftCloseSchema = new Schema<ShiftClose>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    operator: { type: String, required: true },
    total_in_cash: { type: Number, required: true },
    staying_in_cash: { type: Number, required: true },
    rendered_amount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});

export const ShiftCloseModel = mongoose.model<ShiftClose>('ShiftClose', ShiftCloseSchema);

// --- PartialClose ---
const PartialCloseSchema = new Schema<PartialClose>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    operator: { type: String, required: true },
    amount: { type: Number, required: true },
    recipient_name: { type: String, required: true },
    notes: { type: String },
    timestamp: { type: Date, default: Date.now }
});

export const PartialCloseModel = mongoose.model<PartialClose>('PartialClose', PartialCloseSchema);

// --- Incident ---
const IncidentSchema = new Schema<Incident>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String, required: true },
    operator: { type: String, required: true },
    description: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

export const IncidentModel = mongoose.model<Incident>('Incident', IncidentSchema);

// --- Employee ---
const EmployeeSchema = new Schema<Employee>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    username: { type: String },
    passwordHash: { type: String },
    role: { type: String, enum: ['ADMIN', 'MANAGER', 'OPERATOR'], default: 'OPERATOR' },
    permissions: { type: Schema.Types.Mixed }, // JSONB
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const EmployeeModel = mongoose.model<Employee>('Employee', EmployeeSchema);

// --- Mutation Queue ---
const MutationSchema = new Schema<Mutation>({
    id: { type: String, required: true, unique: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    operation: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now },
    synced: { type: Boolean, default: false },
    retryCount: { type: Number, default: 0 }
});

export const MutationModel = mongoose.model<Mutation>('Mutation', MutationSchema);

// --- Sync Conflict ---
const SyncConflictSchema = new Schema<SyncConflict>({
    id: { type: String, required: true, unique: true },
    mutationId: { type: String, required: true },
    error: { type: String, required: true },
    receivedPayload: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false }
});

export const SyncConflictModel = mongoose.model<SyncConflict>('SyncConflict', SyncConflictSchema);


// --- CONFIGURATION TABLES (Read-Only via Sync) ---

// Vehicle Types (Icon mapping)
const VehicleTypeSchema = new Schema<VehicleType>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    name: { type: String, required: true },
    icon: { type: String }, // Mapped from icon_key
    active: { type: Boolean, default: true }
});
export const VehicleTypeModel = mongoose.model<VehicleType>('VehicleType', VehicleTypeSchema);

// Tariffs (Rules)
const TariffSchema = new Schema<Tariff>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    name: { type: String, required: true },
    type: { type: String, required: true }, // 'Hora', 'Estadia', etc.
    priority: { type: Number, default: 0 }
});
export const TariffModel = mongoose.model<Tariff>('Tariff', TariffSchema);

// Prices (Matrix)
const PriceSchema = new Schema<Price>({
    id: { type: String, required: true, unique: true },
    garageId: { type: String },
    ownerId: { type: String },
    tariffId: { type: String, required: true },
    vehicleTypeId: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String }, // Mapped from price_list (e.g., 'EFECTIVO', 'MERCADO_PAGO')
    createdAt: { type: Date, default: Date.now }
});
export const PriceModel = mongoose.model<Price>('Price', PriceSchema);
