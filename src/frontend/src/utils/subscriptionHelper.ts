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

    // Evaluate all candidates for their best match level
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
            candidates.push({ sub: s, level: 0 });
            continue;
        }

        // 1. Strict SPOT + Client match
        if (subSpotNumber && cocheraNumero && String(subSpotNumber) === String(cocheraNumero) && subClientId === cocheraClientId) {
            candidates.push({ sub: s, level: 1 });
            continue;
        }

        // 2. Strict Vehicle ID match
        if (subVehicleId && subVehicleId !== 'undefined' && cocheraVehicleIds.includes(subVehicleId)) {
            candidates.push({ sub: s, level: 2 });
            continue;
        }

        // 3. Strict Plate match
        if (subPlate && cleanCocheraPlates.includes(subPlate)) {
            candidates.push({ sub: s, level: 3 });
            continue;
        }

        // 4. Fallback Type match
        if (subClientId === cocheraClientId && normSubType === cocheraTipo) {
            candidates.push({ sub: s, level: 4 });
        }
    }

    if (candidates.length === 0) {
        return { subscription: null, matchType: 'NONE', isSafeForFinancialOperation: false };
    }

    // Sort candidates by match level (0 is highest priority)
    candidates.sort((a, b) => a.level - b.level);
    
    const bestLevel = candidates[0].level;
    const bestCandidates = candidates.filter(c => c.level === bestLevel);

    // Map level back to matchType
    const levelToType: Record<number, MatchResult['matchType']> = {
        0: 'COCHERA_ID',
        1: 'SPOT',
        2: 'VEHICLE_ID',
        3: 'PLATE',
        4: 'UNIQUE_FALLBACK'
    };

    if (bestCandidates.length === 1) {
        return { 
            subscription: bestCandidates[0].sub, 
            matchType: levelToType[bestLevel] || 'UNIQUE_FALLBACK', 
            isSafeForFinancialOperation: true 
        };
    }

    // If there are multiple candidates AT THE BEST LEVEL, it is ambiguous
    return { subscription: null, matchType: 'AMBIGUOUS', isSafeForFinancialOperation: false };
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

export type SubscriptionVisualState = 'CURRENT' | 'DEBT_PENDING' | 'ADVANCE_ELIGIBLE' | 'INCONSISTENT' | 'EXPIRED';

export function resolveSubscriptionVisualState(
    subscription: any,
    pendingDebtsForGarage: any[], // MUST be filtered by garage_id and CANON
    currentDate: Date = new Date()
): SubscriptionVisualState {
    if (!subscription || !subscription.active || !subscription.endDate) {
        return 'EXPIRED'; // Or inactive
    }

    const subId = String(subscription.id || subscription._id);
    const subDebts = pendingDebtsForGarage.filter(d => 
        String(d.subscriptionId) === subId || String(d.subscription_id) === subId
    );

    const hasPendingCanon = subDebts.some(d => d.type === 'CANON' && d.status === 'PENDING' && (d.remaining_amount ?? d.amount ?? 0) > 0);

    const endDate = new Date(subscription.endDate);
    const isExpired = endDate.getTime() < currentDate.getTime();

    if (hasPendingCanon) {
        return 'DEBT_PENDING';
    }

    if (isExpired && !hasPendingCanon) {
        // This is the ghost debt symptom (or an un-synced movement)
        return 'INCONSISTENT';
    }

    const advanceEval = getAdvanceEligibility(subscription, pendingDebtsForGarage, true, currentDate);
    if (advanceEval.eligible) {
        return 'ADVANCE_ELIGIBLE';
    }

    return 'CURRENT';
}

export const CANON_MONTH_NAMES = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
] as const;

export interface CanonPeriodInfo {
    label: string;
    time: number;
    period: string; // 'YYYY-MM'
}

/**
 * Normalizes and derives the canonical period label (e.g. 'Jul', 'Ago', 'Sep')
 * for a CANON debt.
 *
 * Priority rules:
 * 1. If explicit billingPeriod / billing_period is provided (e.g. '2026-09'),
 *    parse it directly -> 'Sep'. Has priority over dueDate.
 * 2. If billingPeriod is missing, derive it from dueDate / due_date:
 *    dueDate represents the last millisecond of the PREVIOUS covered period
 *    (e.g., 2026-09-01T02:59:59.999Z = 31/08/2026 23:59:59.999 in America/Argentina/Buenos_Aires).
 *    Adding +1 ms advances into the owed period (01/09/2026 00:00:00.000 in ART),
 *    evaluated strictly in 'America/Argentina/Buenos_Aires'.
 */
export function getDebtBillingPeriod(debtOrDue: any): CanonPeriodInfo {
    if (!debtOrDue) {
        return { label: '', time: 0, period: '' };
    }

    // Direct YYYY-MM string input (e.g. '2026-09')
    if (typeof debtOrDue === 'string') {
        const trimmed = debtOrDue.trim();
        const match = trimmed.match(/^(\d{4})-(\d{1,2})$/);
        if (match) {
            const year = parseInt(match[1], 10);
            const month = parseInt(match[2], 10);
            const monthIndex = month - 1;
            if (monthIndex >= 0 && monthIndex < 12) {
                return {
                    label: CANON_MONTH_NAMES[monthIndex],
                    time: Date.UTC(year, monthIndex, 1),
                    period: `${year}-${String(month).padStart(2, '0')}`
                };
            }
        }
    }

    // Priority 1: Check for explicit billingPeriod / billing_period on object
    if (typeof debtOrDue === 'object') {
        const rawBp = debtOrDue.billingPeriod || debtOrDue.billing_period;
        if (typeof rawBp === 'string') {
            const match = rawBp.trim().match(/^(\d{4})-(\d{1,2})$/);
            if (match) {
                const year = parseInt(match[1], 10);
                const month = parseInt(match[2], 10);
                const monthIndex = month - 1;
                if (monthIndex >= 0 && monthIndex < 12) {
                    return {
                        label: CANON_MONTH_NAMES[monthIndex],
                        time: Date.UTC(year, monthIndex, 1),
                        period: `${year}-${String(month).padStart(2, '0')}`
                    };
                }
            }
        }
    }

    // Priority 2: Fallback to dueDate / due_date
    let rawDue: any = undefined;
    if (typeof debtOrDue === 'object' && !(debtOrDue instanceof Date)) {
        rawDue = debtOrDue.dueDate || debtOrDue.due_date;
    } else {
        rawDue = debtOrDue;
    }

    if (rawDue) {
        const due = new Date(rawDue);
        if (!isNaN(due.getTime())) {
            // Advance 1 ms from the end of the previous period to enter the owed period
            const billingInstant = new Date(due.getTime() + 1);
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Argentina/Buenos_Aires',
                year: 'numeric',
                month: 'numeric',
            }).formatToParts(billingInstant);

            const yearStr = parts.find(p => p.type === 'year')?.value;
            const monthStr = parts.find(p => p.type === 'month')?.value;
            if (yearStr && monthStr) {
                const year = parseInt(yearStr, 10);
                const month = parseInt(monthStr, 10);
                const monthIndex = month - 1;
                if (monthIndex >= 0 && monthIndex < 12) {
                    return {
                        label: CANON_MONTH_NAMES[monthIndex],
                        time: Date.UTC(year, monthIndex, 1),
                        period: `${year}-${String(month).padStart(2, '0')}`
                    };
                }
            }
        }
    }

    return { label: '', time: 0, period: '' };
}

export function getCanonPeriodLabel(debtOrDue: any): string {
    return getDebtBillingPeriod(debtOrDue).label;
}

export function formatCanonDebtLabels(debts: any[]): string {
    if (!Array.isArray(debts) || debts.length === 0) return '';
    return debts
        .map(d => getDebtBillingPeriod(d))
        .filter(info => info.label.length > 0)
        .sort((a, b) => a.time - b.time)
        .map(info => info.label)
        .join('-');
}
