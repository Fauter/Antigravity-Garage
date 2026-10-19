/**
 * Normalizes a debt amount value that may come from Supabase as a string,
 * number, null, or undefined. Supabase returns `numeric` columns as strings
 * (e.g. "860000.00"), which breaks `typeof x === 'number'` checks.
 */
export function parseDebtAmount(value: any): number {
    if (value === null || value === undefined) return 0;
    const n = Number(value);
    return isNaN(n) ? 0 : n;
}

/**
 * Returns the effective pending balance for a debt.
 * Priority: remaining_amount (if present and valid) > amount (fallback).
 *
 * Handles Supabase returning numeric as string ("860000.00").
 */
export function getDebtRemaining(debt: any): number {
    if (!debt) return 0;
    const raw = debt.remaining_amount ?? debt.remainingAmount;
    if (raw !== null && raw !== undefined && raw !== '' && !isNaN(Number(raw))) {
        return Number(raw);
    }
    const amt = parseDebtAmount(debt.amount);
    const paid = parseDebtAmount(debt.amount_paid ?? debt.amountPaid ?? 0);
    return Math.max(0, amt - paid);
}
