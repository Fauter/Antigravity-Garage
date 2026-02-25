import { z } from 'zod';

// --- Shared / Primitives ---
export const UuidSchema = z.string().uuid();
export const TimestampSchema = z.date();

// --- Enums ---
export const SubscriptionTypeEnum = z.enum(['Exclusiva', 'Fija', 'Movil']);
export type SubscriptionType = z.infer<typeof SubscriptionTypeEnum>;

export const VehicleTypeEnum = z.string();
export type VehicleType = z.infer<typeof VehicleTypeEnum>;

export const PaymentMethodEnum = z.enum(['Efectivo', 'Transferencia', 'Debito', 'Credito', 'QR']);
export type PaymentMethod = z.infer<typeof PaymentMethodEnum>;

export const MovementTypeEnum = z.enum(['CobroEstadia', 'CobroAbono', 'CobroRenovacion', 'IngresoVarios', 'EgresoVarios']);
export type MovementType = z.infer<typeof MovementTypeEnum>;

export const CocheraTypeEnum = z.enum(['Fija', 'Exclusiva', 'Movil']);
export type CocheraType = z.infer<typeof CocheraTypeEnum>;

// --- Entities ---

/**
 * Customer / Cliente
 * Representa a la persona físico/jurídica responsable.
 */
export const CustomerSchema = z.object({
  id: UuidSchema,
  garageId: UuidSchema.optional(), // Vinculación con Garage (Supabase: garage_id)
  ownerId: UuidSchema.optional(),  // Vinculación con Owner (Supabase: owner_id)
  name: z.string().min(1, "El nombre es obligatorio"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  dni: z.string().optional(),
  address: z.string().optional(),
  localidad: z.string().optional(),
  createdAt: TimestampSchema.default(() => new Date()),
  updatedAt: TimestampSchema.default(() => new Date()),
});
export type Customer = z.infer<typeof CustomerSchema>;

/**
 * Vehicle / Vehículo
 * La unidad física. Puede estar vinculada a un cliente (mensual) o ser anónima (rotativo).
 */
export const VehicleSchema = z.object({
  id: UuidSchema,
  garageId: UuidSchema.optional(), // Supabase: garage_id
  ownerId: UuidSchema.optional(),  // Supabase: owner_id
  plate: z.string().min(1, "La patente es obligatoria").toUpperCase(),
  type: VehicleTypeEnum.default('Auto'),
  brand: z.string().optional(),
  model: z.string().optional(),
  color: z.string().optional(),
  year: z.string().optional(),
  insurance: z.string().optional(),
  description: z.string().optional(),
  customerId: UuidSchema.optional().nullable(),
  isSubscriber: z.boolean().default(false),
  createdAt: TimestampSchema.default(() => new Date()),
  updatedAt: TimestampSchema.default(() => new Date()),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

/**
 * Cochera / Parking Spot
 * Representa un espacio físico asignado a un cliente.
 */
export const CocheraSchema = z.object({
  id: UuidSchema,
  garageId: UuidSchema.optional(), // Supabase: garage_id
  ownerId: UuidSchema.optional(),  // Supabase: owner_id
  tipo: CocheraTypeEnum,
  numero: z.string().optional(),
  vehiculos: z.array(z.string()).default([]), // Lista de patentes
  clienteId: UuidSchema.optional().nullable(), // Supabase: cliente_id
  precioBase: z.number().default(0), // Supabase: precio_base
  status: z.enum(['Disponible', 'Ocupada']).default('Disponible'),
  createdAt: TimestampSchema.default(() => new Date()),
  updatedAt: TimestampSchema.default(() => new Date()),
});
export type Cochera = z.infer<typeof CocheraSchema>;

/**
 * Subscription / Abono
 * Define la relación contractual (Exclusiva, Fija, Móvil) y sus fechas.
 */
export const SubscriptionSchema = z.object({
  id: UuidSchema,
  garageId: UuidSchema.optional(), // Supabase: garage_id
  ownerId: UuidSchema.optional(),  // Supabase: owner_id
  customerId: UuidSchema,
  vehicleId: UuidSchema.optional().nullable(),
  type: SubscriptionTypeEnum,
  startDate: TimestampSchema,
  endDate: TimestampSchema.optional().nullable(),
  price: z.number().min(0),
  active: z.boolean().default(true),
  createdAt: TimestampSchema.default(() => new Date()),
  updatedAt: TimestampSchema.default(() => new Date()),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

/**
 * Debt / Deuda
 * Almacena las deudas generadas por falta de pago de abonos.
 */
export const DebtStatusEnum = z.enum(['PENDING', 'PAID', 'CANCELLED']);
export type DebtStatus = z.infer<typeof DebtStatusEnum>;

export const DebtSchema = z.object({
  id: UuidSchema,
  subscriptionId: UuidSchema,
  customerId: UuidSchema,
  amount: z.number().min(0),
  surchargeApplied: z.number().min(0).default(0),
  status: DebtStatusEnum.default('PENDING'),
  dueDate: TimestampSchema,
  createdAt: TimestampSchema.default(() => new Date()),
  updatedAt: TimestampSchema.default(() => new Date()),
});
export type Debt = z.infer<typeof DebtSchema>;


/**
 * Stay / Estancia
 * Registro de la presencia física de un vehículo. (Entrada/Salida física)
 */
export const StaySchema = z.object({
  id: UuidSchema,
  garageId: UuidSchema.optional(),
  ownerId: UuidSchema.optional(),
  vehicleId: UuidSchema.optional().nullable(),
  plate: z.string(),
  entryTime: TimestampSchema,
  exitTime: TimestampSchema.optional().nullable(),
  active: z.boolean().default(true),
  isSubscriber: z.boolean().default(false),
  subscriptionId: UuidSchema.optional().nullable(),
  createdAt: TimestampSchema.default(() => new Date()),
});
export type Stay = z.infer<typeof StaySchema>;

/**
 * Movement / Movimiento Financiero
 * Estrictamente un evento de cobro o movimiento de caja.
 */
export const MovementSchema = z.object({
  id: UuidSchema,
  garageId: UuidSchema.optional(), // Supabase: garage_id
  ownerId: UuidSchema.optional(),  // Supabase: owner_id
  relatedEntityId: UuidSchema.optional().nullable(),
  type: MovementTypeEnum,
  timestamp: TimestampSchema,

  amount: z.number().min(0),
  paymentMethod: PaymentMethodEnum.default('Efectivo'),

  ticketNumber: z.number().int().optional(),
  ticketPago: z.number().int().optional(),

  // Traceability
  operator: z.string().optional(),
  invoiceType: z.enum(['A', 'B', 'C', 'CC', 'Final']).optional(),
  plate: z.string().optional(),

  notes: z.string().optional(),
  shiftId: UuidSchema.optional(),

  createdAt: TimestampSchema.default(() => new Date()),
});
export type Movement = z.infer<typeof MovementSchema>;

/**
 * Shift / Turno de Caja
 * Representa el turno de un operador.
 */
export const ShiftSchema = z.object({
  id: UuidSchema,
  garageId: UuidSchema.optional(),
  ownerId: UuidSchema.optional(),
  operatorName: z.string().min(1, "El nombre del operador es obligatorio"),
  startDate: TimestampSchema,
  endDate: TimestampSchema.optional().nullable(),
  startCash: z.number().min(0).default(0),
  endCash: z.number().min(0).optional(),
  totalCollection: z.number().default(0),
  active: z.boolean().default(true),
  notes: z.string().optional(),
});
export type Shift = z.infer<typeof ShiftSchema>;

/**
 * Employee / User
 * Compatible with Supabase EmployeeAccount
 */
export const EmployeePermissionsSchema = z.object({
  sections: z.array(z.string()),
  allowed_garages: z.array(z.string())
});

export const EmployeeSchema = z.object({
  id: UuidSchema,
  garageId: UuidSchema.optional(),
  ownerId: UuidSchema.optional(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  username: z.string().optional(), // Added for Auth
  passwordHash: z.string().optional(), // Added for Auth
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR']),
  permissions: EmployeePermissionsSchema.optional(), // JSONB compat
  active: z.boolean().default(true),
  createdAt: TimestampSchema.default(() => new Date()),
  updatedAt: TimestampSchema.default(() => new Date()),
});
export type Employee = z.infer<typeof EmployeeSchema>;

/**
 * MutationQueue / Cola de Sincronización
 * Registra intenciones de cambio para sincronización offline-online.
 */
export const MutationSchema = z.object({
  id: UuidSchema,
  entityType: z.enum(['Customer', 'Vehicle', 'Subscription', 'Movement', 'Shift', 'Employee', 'Cochera']),
  entityId: UuidSchema,
  operation: z.enum(['CREATE', 'UPDATE', 'DELETE']),
  payload: z.any(),
  timestamp: TimestampSchema,
  synced: z.boolean().default(false),
  retryCount: z.number().default(0),
});
export type Mutation = z.infer<typeof MutationSchema>;

export const SyncConflictSchema = z.object({
  id: UuidSchema,
  mutationId: UuidSchema,
  error: z.string(),
  receivedPayload: z.any(),
  timestamp: TimestampSchema,
  resolved: z.boolean().default(false),
});
export type SyncConflict = z.infer<typeof SyncConflictSchema>;
