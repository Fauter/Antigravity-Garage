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

// --- Entities ---

/**
 * Customer / Cliente
 * Representa a la persona físico/jurídica responsable.
 */
export const CustomerSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1, "El nombre es obligatorio"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  dni: z.string().optional(),
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
  plate: z.string().min(1, "La patente es obligatoria").toUpperCase(),
  type: VehicleTypeEnum.default('Auto'),
  brand: z.string().optional(),
  model: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  customerId: UuidSchema.optional().nullable(), // Nullable si es rotativo anónimo
  createdAt: TimestampSchema.default(() => new Date()),
  updatedAt: TimestampSchema.default(() => new Date()),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

/**
 * Subscription / Abono
 * Define la relación contractual (Exclusiva, Fija, Móvil) y sus fechas.
 */
export const SubscriptionSchema = z.object({
  id: UuidSchema,
  customerId: UuidSchema,
  vehicleId: UuidSchema.optional().nullable(), // Algunas suscripciones podrían no estar atadas a una patente fija inmediatamente
  type: SubscriptionTypeEnum,
  startDate: TimestampSchema,
  endDate: TimestampSchema.optional().nullable(), // Null si es indefinida, aunque usualmente se renueva mensualmente
  price: z.number().min(0),
  active: z.boolean().default(true),
  createdAt: TimestampSchema.default(() => new Date()),
  updatedAt: TimestampSchema.default(() => new Date()),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

/**
 * Stay / Estancia
 * Registro de la presencia física de un vehículo. (Entrada/Salida física)
 */
export const StaySchema = z.object({
  id: UuidSchema,
  vehicleId: UuidSchema.optional().nullable(),
  plate: z.string(),
  entryTime: TimestampSchema,
  exitTime: TimestampSchema.optional().nullable(),
  active: z.boolean().default(true),
  createdAt: TimestampSchema.default(() => new Date()),
});
export type Stay = z.infer<typeof StaySchema>;

/**
 * Movement / Movimiento Financiero
 * Estrictamente un evento de cobro o movimiento de caja.
 */
export const MovementSchema = z.object({
  id: UuidSchema,
  relatedEntityId: UuidSchema.optional().nullable(), // ID de Stay o Subscription relacionado
  type: MovementTypeEnum,
  timestamp: TimestampSchema,

  amount: z.number().min(0),
  paymentMethod: PaymentMethodEnum.default('Efectivo'),

  ticketNumber: z.number().int().optional(),
  ticketPago: z.number().int().optional(),

  // Traceability
  operator: z.string().optional(),
  invoiceType: z.enum(['A', 'B', 'C', 'CC', 'Final']).optional(), // Final = Consumidor Final
  plate: z.string().optional(), // Patente para búsqueda rápida


  notes: z.string().optional(),
  shiftId: UuidSchema.optional(), // Turno que cobró

  createdAt: TimestampSchema.default(() => new Date()),
});
export type Movement = z.infer<typeof MovementSchema>;

/**
 * Shift / Turno de Caja
 * Representa el turno de un operador.
 */
export const ShiftSchema = z.object({
  id: UuidSchema,
  operatorName: z.string().min(1, "El nombre del operador es obligatorio"),
  startDate: TimestampSchema,
  endDate: TimestampSchema.optional().nullable(),
  startCash: z.number().min(0).default(0), // Caja inicial
  endCash: z.number().min(0).optional(),     // Caja final declarada o calculada
  totalCollection: z.number().default(0),    // Total recaudado por sistema
  active: z.boolean().default(true),

  // Auditoría
  notes: z.string().optional(),
});
export type Shift = z.infer<typeof ShiftSchema>;

/**
 * MutationQueue / Cola de Sincronización
 * Registra intenciones de cambio para sincronización offline-online.
 */
export const MutationSchema = z.object({
  id: UuidSchema,
  entityType: z.enum(['Customer', 'Vehicle', 'Subscription', 'Movement', 'Shift']),
  entityId: UuidSchema,
  operation: z.enum(['CREATE', 'UPDATE', 'DELETE']),
  payload: z.any(), // Datos del cambio (snapshot o diff)
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
