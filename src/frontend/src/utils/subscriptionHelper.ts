export interface MatchResult {
    subscription: any | null;
    matchType: 'COCHERA_ID' | 'SPOT' | 'VEHICLE_ID' | 'PLATE' | 'UNIQUE_FALLBACK' | 'AMBIGUOUS' | 'NONE';
    isSafeForFinancialOperation: boolean;
}

export function resolveSubscriptionForCochera(cochera: any, subscriptions: any[], realVehicles: any[]): MatchResult {
    const activeSubs = subscriptions.filter(s => s.active !== false || s.status === 'active');
    if (activeSubs.length === 0) {
        return { subscription: null, matchType: 'NONE', isSafeForFinancialOperation: false };
    }

    const cocheraClientId = cochera.clienteId || cochera.cliente_id;
    const cocheraNumero = cochera.numero;
    const cocheraTipo = cochera.tipo ? cochera.tipo.toLowerCase().replace(/fija/g, 'fija').replace(/movil/g, 'movil').replace(/exclusiva/g, 'exclusiva') : '';

    const cleanCocheraPlates = (cochera.vehiculos || []).map((v: any) => typeof v === 'string' ? v.trim() : v.plate?.trim()).filter(Boolean);
    const cocheraVehicles = realVehicles.filter(v => v.plate && cleanCocheraPlates.includes(v.plate.trim()));
    const cocheraVehicleIds = cocheraVehicles.map(v => String(v.id));

    const candidates = [];

    for (const s of activeSubs) {
        const subClientId = s.customerId || s.customer_id || s.clientId;
        const subVehicleId = String(s.vehicleId || s.vehicle_id);
        const subPlate = (s.vehicleData?.plate || s.plate)?.trim();
        const subSpotNumber = s.spotNumber;
        const subType = s.type || s.subscriptionType;
        const normSubType = subType ? subType.toLowerCase().replace(/fija/g, 'fija').replace(/movil/g, 'movil').replace(/exclusiva/g, 'exclusiva') : '';
        const subCocheraId = s.cocheraId || s.cochera_id;

        // 0. Strict COCHERA ID match (Canonical Identity)
        if (subCocheraId && String(subCocheraId) === String(cochera.id)) {
            return { subscription: s, matchType: 'COCHERA_ID', isSafeForFinancialOperation: true };
        }

        // 1. Strict SPOT + Client match
        if (subSpotNumber && cocheraNumero && String(subSpotNumber) === String(cocheraNumero) && subClientId === cocheraClientId) {
            return { subscription: s, matchType: 'SPOT', isSafeForFinancialOperation: true };
        }

        // 2. Strict Vehicle ID match
        if (subVehicleId && subVehicleId !== 'undefined' && cocheraVehicleIds.includes(subVehicleId)) {
            return { subscription: s, matchType: 'VEHICLE_ID', isSafeForFinancialOperation: true };
        }

        // 3. Strict Plate match
        if (subPlate && cleanCocheraPlates.includes(subPlate)) {
            return { subscription: s, matchType: 'PLATE', isSafeForFinancialOperation: true };
        }

        // 4. Fallback Type match (Collect as candidates)
        if (subClientId === cocheraClientId && normSubType === cocheraTipo) {
            candidates.push(s);
        }
    }

    if (candidates.length === 1) {
        return { subscription: candidates[0], matchType: 'UNIQUE_FALLBACK', isSafeForFinancialOperation: true };
    }

    if (candidates.length > 1) {
        return { subscription: null, matchType: 'AMBIGUOUS', isSafeForFinancialOperation: false };
    }

    return { subscription: null, matchType: 'NONE', isSafeForFinancialOperation: false };
}

export interface EligibilityResult {
    eligible: boolean;
    reason?: string;
    nextCoverageEnd?: Date;
    nextMonthLabel?: string;
    nextPeriodLabel?: string;
    currentEndDateStr?: string;
    nextEndDateStr?: string;
}

export function getAdvanceEligibility(
    subscription: any,
    pendingDebts: any[],
    matchSafety: boolean,
    currentDate: Date = new Date()
): EligibilityResult {
    if (!subscription) {
        return { eligible: false, reason: 'NO_SUBSCRIPTION' };
    }
    if (subscription.active === false || subscription.status === 'inactive') {
        return { eligible: false, reason: 'INACTIVE' };
    }
    if (!matchSafety) {
        return { eligible: false, reason: 'AMBIGUOUS_MATCH' };
    }

    const endDate = subscription.endDate ? new Date(subscription.endDate) : null;
    if (!endDate) {
        return { eligible: false, reason: 'NO_END_DATE' };
    }

    // Is it expired? (End date is before today)
    const nowTimestamp = currentDate.getTime();
    if (endDate.getTime() < nowTimestamp) {
        return { eligible: false, reason: 'EXPIRED' };
    }

    // Is it covered exactly until the end of the current month?
    // In our system, usually end dates are the last day of a month (e.g., 2026-09-30)
    // A subscription is eligible for ADVANCE if its endDate is in the same calendar month and year as currentDate.
    if (
        endDate.getFullYear() !== currentDate.getFullYear() ||
        endDate.getMonth() !== currentDate.getMonth()
    ) {
        // If it's already extended beyond the current month, we block it in V1.
        return { eligible: false, reason: 'NOT_CURRENT_MONTH_END' };
    }

    const subId = String(subscription.id || subscription._id);
    const canonDebts = pendingDebts.filter(d => 
        (String(d.subscriptionId) === subId || String(d.subscription_id) === subId) && 
        d.status === 'PENDING' && 
        d.type === 'CANON'
    );

    if (canonDebts.length > 0) {
        return { eligible: false, reason: 'PENDING_DEBTS' };
    }

    // Calculate next month label robustly
    // E.g. if endDate is 2026-09-30, next month is Octubre
    // We add 15 days to the endDate to safely land in the middle of the next month, avoiding 29/30/31 wrapping bugs
    const midNextMonth = new Date(endDate);
    midNextMonth.setDate(15);
    midNextMonth.setMonth(midNextMonth.getMonth() + 1);

    const formatter = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'America/Argentina/Buenos_Aires' });
    let nextMonthLabel = formatter.format(midNextMonth);
    nextMonthLabel = nextMonthLabel.charAt(0).toUpperCase() + nextMonthLabel.slice(1);

    // Calculate next period string and exact end dates
    const nextPeriodLabel = `${nextMonthLabel} ${midNextMonth.getFullYear()}`;
    
    // nextEndDate is the last day of the next month (local time)
    const nextEndDate = new Date(midNextMonth.getFullYear(), midNextMonth.getMonth() + 1, 0, 23, 59, 59, 999);

    const formatDateStr = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    return {
        eligible: true,
        nextMonthLabel,
        nextPeriodLabel,
        currentEndDateStr: formatDateStr(endDate),
        nextEndDateStr: formatDateStr(nextEndDate)
    };
}
