/**
 * Utilidades puras para el cálculo y filtrado contable de la Caja de GarageIA.
 * 
 * Regla de Oro:
 * La caja pertenece al GARAGE, no al operador.
 * El último cierre final global del garaje determina el fondo inicial y el corte temporal
 * para todos los cobros, retiros y egresos del período abierto.
 */

export interface ShiftCloseRecord {
    id?: string;
    garageId?: string;
    garage_id?: string;
    operator?: string;
    staying_in_cash?: number | string;
    stayingInCash?: number | string;
    total_in_cash?: number | string;
    totalInCash?: number | string;
    rendered_amount?: number | string;
    renderedAmount?: number | string;
    timestamp: string | Date | number;
}

export interface MovementRecord {
    id?: string;
    garageId?: string;
    garage_id?: string;
    operator?: string;
    plate?: string;
    amount: number | string;
    paymentMethod?: string;
    payment_method?: string;
    invoiceType?: string;
    timestamp: string | Date | number;
    type: string;
    notes?: string;
    relatedEntityId?: string;
    receipt_number?: string;
    ticket_code?: string;
}

export interface PartialCloseRecord {
    id: string;
    garageId?: string;
    garage_id?: string;
    operator?: string;
    amount: number | string;
    timestamp: string | Date | number;
    recipient_name?: string;
    notes?: string;
    movement_type?: 'withdrawal' | 'expense';
}

export type UnifiedRow =
    | (MovementRecord & { _kind: 'movement' })
    | (PartialCloseRecord & { _kind: 'partial_close' });

export interface CalculateCajaOptions {
    movements: MovementRecord[];
    partialCloses: PartialCloseRecord[];
    shiftCloses: ShiftCloseRecord[];
    activeGarageId?: string;
    referenceDate?: Date;
}

export interface CajaCalculationResult {
    lastGlobalClose: ShiftCloseRecord | null;
    lastCloseTimestamp: number | null;
    fondoInicial: number;
    shiftMovements: (MovementRecord & { _kind: 'movement' })[];
    shiftPartials: (PartialCloseRecord & { _kind: 'partial_close' })[];
    unifiedRows: UnifiedRow[];
    cashSum: number;
    nonCashSum: number;
    partialsSum: number;
    totalCashInDrawer: number;
}

/**
 * Convierte un valor a timestamp numérico seguro en milisegundos.
 * Retorna 0 si es nulo, indefinido o no es una fecha válida.
 */
export const parseSafeTimestamp = (ts: string | Date | number | undefined | null): number => {
    if (ts === null || ts === undefined || ts === '') return 0;
    if (typeof ts === 'number') {
        return Number.isFinite(ts) && ts > 0 ? ts : 0;
    }
    const parsed = new Date(ts).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Convierte un importe a número flotante seguro.
 * Retorna 0 si es nulo, indefinido, NaN o infinito.
 */
export const parseSafeAmount = (val: any): number => {
    if (val === null || val === undefined || val === '') return 0;
    const num = Number(val);
    return Number.isFinite(num) ? num : 0;
};

/**
 * Redondea a 2 decimales para evitar imprecisiones de coma flotante.
 */
export const roundCurrency = (amount: number): number => {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
};

/**
 * Verifica si un método de pago corresponde a efectivo.
 */
export const isCashPaymentMethod = (paymentMethod?: string, payment_method?: string): boolean => {
    const raw = (paymentMethod || payment_method || '').trim().toLowerCase();
    return raw === 'efectivo';
};

/**
 * Comprueba el aislamiento por garageId.
 * Si activeGarageId está definido y el registro posee garageId/garage_id definido, deben coincidir.
 * Si el registro no tiene garageId (ej. registros legacy mono-garaje locales), se acepta.
 */
export const matchesGarage = (itemGarageId?: string, activeGarageId?: string): boolean => {
    if (!activeGarageId) return true;
    if (!itemGarageId) return true;
    return itemGarageId === activeGarageId;
};

/**
 * Comprueba si un timestamp pertenece al mismo día calendario local que la fecha de referencia.
 */
export const isSameCalendarDay = (timestampMs: number, referenceDate: Date = new Date()): boolean => {
    if (timestampMs <= 0) return false;
    const itemDate = new Date(timestampMs);
    return (
        itemDate.getFullYear() === referenceDate.getFullYear() &&
        itemDate.getMonth() === referenceDate.getMonth() &&
        itemDate.getDate() === referenceDate.getDate()
    );
};

/**
 * Obtiene el último cierre final global del garaje, ordenado determinísticamente
 * por timestamp descendente (y desempate por id).
 */
export const getLatestShiftClose = (
    shiftCloses: ShiftCloseRecord[],
    activeGarageId?: string
): ShiftCloseRecord | null => {
    if (!Array.isArray(shiftCloses) || shiftCloses.length === 0) {
        return null;
    }

    const filtered = shiftCloses.filter(sc => {
        const itemGarage = sc.garageId || sc.garage_id;
        const validTime = parseSafeTimestamp(sc.timestamp) > 0;
        return validTime && matchesGarage(itemGarage, activeGarageId);
    });

    if (filtered.length === 0) return null;

    filtered.sort((a, b) => {
        const diff = parseSafeTimestamp(b.timestamp) - parseSafeTimestamp(a.timestamp);
        if (diff !== 0) return diff;
        return String(b.id || '').localeCompare(String(a.id || ''));
    });

    return filtered[0] || null;
};

/**
 * Calcula de forma pura y determinista el estado de caja del turno actual.
 */
export const calculateCajaShift = (options: CalculateCajaOptions): CajaCalculationResult => {
    const {
        movements = [],
        partialCloses = [],
        shiftCloses = [],
        activeGarageId,
        referenceDate = new Date()
    } = options;

    // 1. Obtener el último cierre final válido del garaje (ancla del período contable)
    const lastGlobalClose = getLatestShiftClose(shiftCloses, activeGarageId);

    const lastCloseTimestamp = lastGlobalClose
        ? parseSafeTimestamp(lastGlobalClose.timestamp)
        : null;

    // 2. Fondo inicial = staying_in_cash del último cierre (o stayingInCash en formato camelCase)
    // Si no hay cierre previo, el fondo inicial es 0.
    const fondoInicial = lastGlobalClose
        ? parseSafeAmount(lastGlobalClose.staying_in_cash ?? lastGlobalClose.stayingInCash)
        : 0;

    // 3. Función de pertenencia al turno activo:
    // - Si existe un cierre previo: estrictamente posterior a su timestamp (timestamp > lastCloseTimestamp).
    // - Si no existe ningún cierre previo: fallback a movimientos del día actual.
    // - Siempre respetando el aislamiento por garageId.
    const isInCurrentPeriod = (timestampVal: any, itemGarageId?: string): boolean => {
        if (!matchesGarage(itemGarageId, activeGarageId)) {
            return false;
        }

        const time = parseSafeTimestamp(timestampVal);
        if (time <= 0) return false;

        if (lastCloseTimestamp !== null) {
            return time > lastCloseTimestamp;
        } else {
            return isSameCalendarDay(time, referenceDate);
        }
    };

    // 4. Filtrar cobros (movements) del período
    const safeMovements = Array.isArray(movements) ? movements : [];
    const shiftMovements: (MovementRecord & { _kind: 'movement' })[] = safeMovements
        .filter(m => isInCurrentPeriod(m.timestamp, m.garageId || m.garage_id))
        .map(m => ({ ...m, _kind: 'movement' as const }));

    // 5. Filtrar salidas de dinero (partial_closes: retiros y egresos) del período
    const safePartials = Array.isArray(partialCloses) ? partialCloses : [];
    const shiftPartials: (PartialCloseRecord & { _kind: 'partial_close' })[] = safePartials
        .filter(pc => isInCurrentPeriod(pc.timestamp, pc.garageId || pc.garage_id))
        .map(pc => ({ ...pc, _kind: 'partial_close' as const }));

    // 6. Construir filas unificadas ordenadas cronológicamente descendente
    const unifiedRows: UnifiedRow[] = [...shiftMovements, ...shiftPartials].sort((a, b) => {
        const diff = parseSafeTimestamp(b.timestamp) - parseSafeTimestamp(a.timestamp);
        if (diff !== 0) return diff;
        return String(b.id || '').localeCompare(String(a.id || ''));
    });

    // 7. Cálculos financieros:
    // Cobros en efectivo
    const cashSum = roundCurrency(
        shiftMovements
            .filter(m => isCashPaymentMethod(m.paymentMethod, m.payment_method))
            .reduce((acc, curr) => acc + parseSafeAmount(curr.amount), 0)
    );

    // Cobros no en efectivo (transferencias, débito, crédito, QR) — visibles en la lista pero no suman al efectivo
    const nonCashSum = roundCurrency(
        shiftMovements
            .filter(m => !isCashPaymentMethod(m.paymentMethod, m.payment_method))
            .reduce((acc, curr) => acc + parseSafeAmount(curr.amount), 0)
    );

    // Retiros y egresos posteriores al corte (se descuentan del efectivo)
    const partialsSum = roundCurrency(
        shiftPartials.reduce((acc, curr) => acc + parseSafeAmount(curr.amount), 0)
    );

    // Saldo teórico final en efectivo de la caja:
    // Efectivo en caja = Fondo inicial + Cobros en efectivo posteriores − Retiros y egresos posteriores
    const totalCashInDrawer = roundCurrency(fondoInicial + cashSum - partialsSum);

    return {
        lastGlobalClose,
        lastCloseTimestamp,
        fondoInicial,
        shiftMovements,
        shiftPartials,
        unifiedRows,
        cashSum,
        nonCashSum,
        partialsSum,
        totalCashInDrawer
    };
};
