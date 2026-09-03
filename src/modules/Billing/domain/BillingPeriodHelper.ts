export class BillingPeriodHelper {
    /**
     * Devuelve el período canónico YYYY-MM para un timestamp, evaluado en el timezone indicado.
     * @param date Fecha/timestamp de entrada.
     * @param timezone Timezone (ej: 'America/Argentina/Buenos_Aires').
     */
    public static getBillingPeriod(date: string | number | Date, timezone: string = 'America/Argentina/Buenos_Aires'): string {
        const d = new Date(date);
        
        // Formatear en el timezone específico para evitar saltos de mes por UTC
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit'
        });
        
        // Intl.DateTimeFormat with 'en-CA' (Canadian) gives YYYY-MM by default
        // But to be absolutely safe, let's format parts
        const parts = formatter.formatToParts(d);
        const year = parts.find(p => p.type === 'year')?.value;
        const month = parts.find(p => p.type === 'month')?.value;
        
        if (!year || !month) {
            throw new Error('Invalid date for billing period calculation');
        }
        
        return `${year}-${month}`;
    }

    /**
     * Resuelve de forma segura el billingPeriod de un Debt, incluyendo fallback 
     * para registros legacy de NeDB que no lo poseen nativamente.
     */
    public static getLegacyBillingPeriod(debt: any): string {
        if (debt.billingPeriod) {
            return debt.billingPeriod;
        }
        if (!debt.dueDate) {
            throw new Error('Cannot determine billing period: missing dueDate in legacy debt');
        }
        // Legacy debts usaban fechas como 2026-05-01T02:59:59.999Z para representar Mayo
        // Por tanto, evaluando en UTC el mes coincide matemáticamente con el periodo histórico
        const d = new Date(debt.dueDate);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    }
}
