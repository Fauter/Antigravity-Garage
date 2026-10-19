import { describe, it, expect } from 'vitest';
import {
    getCanonPeriodLabel,
    getDebtBillingPeriod,
    formatCanonDebtLabels,
    CANON_MONTH_NAMES
} from '../src/frontend/src/utils/subscriptionHelper';

describe('CANON Debt Period Labels & Formatting', () => {
    // 1. 2026-07-01T02:59:59.999Z (ART: 30/06 23:59:59.999) => label Jul
    it('1. maps 2026-07-01T02:59:59.999Z (vencimiento 30/06 en ART) to Jul', () => {
        const debtCamel = { dueDate: '2026-07-01T02:59:59.999Z' };
        const debtSnake = { due_date: '2026-07-01T02:59:59.999Z' };
        
        expect(getCanonPeriodLabel(debtCamel)).toBe('Jul');
        expect(getCanonPeriodLabel(debtSnake)).toBe('Jul');
        expect(getCanonPeriodLabel('2026-07-01T02:59:59.999Z')).toBe('Jul');

        const info = getDebtBillingPeriod(debtCamel);
        expect(info.label).toBe('Jul');
        expect(info.period).toBe('2026-07');
    });

    // 2. 2026-08-01T02:59:59.999Z (ART: 31/07 23:59:59.999) => label Ago
    it('2. maps 2026-08-01T02:59:59.999Z (vencimiento 31/07 en ART) to Ago', () => {
        const debtCamel = { dueDate: '2026-08-01T02:59:59.999Z' };
        const debtSnake = { due_date: '2026-08-01T02:59:59.999Z' };

        expect(getCanonPeriodLabel(debtCamel)).toBe('Ago');
        expect(getCanonPeriodLabel(debtSnake)).toBe('Ago');
        expect(getCanonPeriodLabel('2026-08-01T02:59:59.999Z')).toBe('Ago');

        const info = getDebtBillingPeriod(debtCamel);
        expect(info.label).toBe('Ago');
        expect(info.period).toBe('2026-08');
    });

    // 3. 2026-09-01T02:59:59.999Z (ART: 31/08 23:59:59.999) => label Sep
    it('3. maps 2026-09-01T02:59:59.999Z (vencimiento 31/08 en ART) to Sep', () => {
        const debtCamel = { dueDate: '2026-09-01T02:59:59.999Z' };
        const debtSnake = { due_date: '2026-09-01T02:59:59.999Z' };

        expect(getCanonPeriodLabel(debtCamel)).toBe('Sep');
        expect(getCanonPeriodLabel(debtSnake)).toBe('Sep');
        expect(getCanonPeriodLabel('2026-09-01T02:59:59.999Z')).toBe('Sep');

        const info = getDebtBillingPeriod(debtCamel);
        expect(info.label).toBe('Sep');
        expect(info.period).toBe('2026-09');
    });

    // 4. Tres debts anteriores: => Jul-Ago-Sep (independiente del orden de entrada)
    it('4. formats three debts chronologically into Jul-Ago-Sep', () => {
        const debts = [
            { dueDate: '2026-09-01T02:59:59.999Z' }, // Sep
            { dueDate: '2026-07-01T02:59:59.999Z' }, // Jul
            { dueDate: '2026-08-01T02:59:59.999Z' }, // Ago
        ];

        const formatted = formatCanonDebtLabels(debts);
        expect(formatted).toBe('Jul-Ago-Sep');
    });

    // 5. Dos debts: 2026-08-01T02:59:59.999Z y 2026-09-01T02:59:59.999Z => Ago-Sep
    it('5. formats two debts (agosto y septiembre) into Ago-Sep', () => {
        const debts = [
            { dueDate: '2026-09-01T02:59:59.999Z' }, // Sep
            { dueDate: '2026-08-01T02:59:59.999Z' }, // Ago
        ];

        const formatted = formatCanonDebtLabels(debts);
        expect(formatted).toBe('Ago-Sep');
    });

    // 6. Si existe billingPeriod explícito: 2026-09 => Sep y debe tener prioridad sobre dueDate
    it('6. explicit billingPeriod 2026-09 resolves to Sep and takes priority over dueDate', () => {
        // Here dueDate would say Jul, but billingPeriod explicitly says 2026-09
        const debtWithConflict = {
            billingPeriod: '2026-09',
            dueDate: '2026-07-01T02:59:59.999Z'
        };

        expect(getCanonPeriodLabel(debtWithConflict)).toBe('Sep');
        expect(getDebtBillingPeriod(debtWithConflict).period).toBe('2026-09');

        // Also test snake_case billing_period
        const debtSnake = {
            billing_period: '2026-09',
            due_date: '2026-07-01T02:59:59.999Z'
        };
        expect(getCanonPeriodLabel(debtSnake)).toBe('Sep');
    });

    // 7. Verificar que cambiar timezone del entorno no altere el resultado
    it('7. environment timezone changes do NOT alter the calculated labels', () => {
        const originalTZ = process.env.TZ;
        const testTimezones = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/London', 'America/Argentina/Buenos_Aires', 'Pacific/Honolulu'];

        try {
            for (const tz of testTimezones) {
                process.env.TZ = tz;

                expect(getCanonPeriodLabel({ dueDate: '2026-07-01T02:59:59.999Z' })).toBe('Jul');
                expect(getCanonPeriodLabel({ dueDate: '2026-08-01T02:59:59.999Z' })).toBe('Ago');
                expect(getCanonPeriodLabel({ dueDate: '2026-09-01T02:59:59.999Z' })).toBe('Sep');
                expect(getCanonPeriodLabel({ billingPeriod: '2026-09' })).toBe('Sep');

                const debts = [
                    { dueDate: '2026-09-01T02:59:59.999Z' },
                    { dueDate: '2026-07-01T02:59:59.999Z' },
                    { dueDate: '2026-08-01T02:59:59.999Z' }
                ];
                expect(formatCanonDebtLabels(debts)).toBe('Jul-Ago-Sep');
            }
        } finally {
            process.env.TZ = originalTZ;
        }
    });

    // Fixture customer scenarios validation
    describe('Validation with Real Customer Scenarios', () => {
        it('Carlos Eugoberto (vencimiento 31/07, debts agosto + septiembre) => Ago-Sep', () => {
            const carlosDebts = [
                { id: 'carlos-1', type: 'CANON', dueDate: '2026-08-01T02:59:59.999Z' }, // Ago
                { id: 'carlos-2', type: 'CANON', dueDate: '2026-09-01T02:59:59.999Z' }, // Sep
            ];
            expect(formatCanonDebtLabels(carlosDebts)).toBe('Ago-Sep');
        });

        it('Troblio (vencimiento 30/06, debts julio + agosto + septiembre) => Jul-Ago-Sep', () => {
            const troblioDebts = [
                { id: 'troblio-1', type: 'CANON', dueDate: '2026-07-01T02:59:59.999Z' }, // Jul
                { id: 'troblio-2', type: 'CANON', dueDate: '2026-08-01T02:59:59.999Z' }, // Ago
                { id: 'troblio-3', type: 'CANON', dueDate: '2026-09-01T02:59:59.999Z' }, // Sep
            ];
            expect(formatCanonDebtLabels(troblioDebts)).toBe('Jul-Ago-Sep');
        });

        it('Pedryto (vencimiento 31/08, debt septiembre) => Sep', () => {
            const pedrytoDebts = [
                { id: 'pedryto-1', type: 'CANON', dueDate: '2026-09-01T02:59:59.999Z' }, // Sep
            ];
            expect(formatCanonDebtLabels(pedrytoDebts)).toBe('Sep');
        });
    });

    describe('Edge Cases and Safety', () => {
        it('handles null, undefined, empty object gracefully', () => {
            expect(getCanonPeriodLabel(null)).toBe('');
            expect(getCanonPeriodLabel(undefined)).toBe('');
            expect(getCanonPeriodLabel({})).toBe('');
            expect(formatCanonDebtLabels([])).toBe('');
        });

        it('handles invalid date strings gracefully', () => {
            expect(getCanonPeriodLabel({ dueDate: 'invalid-date' })).toBe('');
        });

        it('correctly crosses year boundaries in chronological sorting', () => {
            const debts = [
                { dueDate: '2027-01-01T02:59:59.999Z' }, // Ene 2027 (vencimiento 31/12/2026)
                { dueDate: '2026-12-01T02:59:59.999Z' }, // Dic 2026 (vencimiento 30/11/2026)
            ];
            expect(formatCanonDebtLabels(debts)).toBe('Dic-Ene');
        });
    });
});
