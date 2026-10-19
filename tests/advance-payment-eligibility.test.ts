import { describe, it, expect } from 'vitest';
import { BillingPeriodHelper } from '../src/modules/Billing/domain/BillingPeriodHelper';

describe('ADVANCE payment eligibility (Timezone Safe)', () => {
    it('permite ADVANCE cuando endDate UTC cae el día 1 pero representa fin del mes comercial anterior', () => {
        // endDate comercial guardado en Supabase/SQLite para el 30/09/2026 23:59:59 ART
        // Equivale al 01 de Octubre a las 02:59:59 UTC
        const storedEndDate = '2026-10-01T02:59:59.999Z';
        
        // Simular el "now" para el 17 de Septiembre (17/09/2026)
        const now = '2026-09-17T15:00:00.000Z';
        
        const currentEndDateObj = new Date(storedEndDate);
        const nowObj = new Date(now);
        
        // Ejecutar helper
        const coveredPeriod = BillingPeriodHelper.getBillingPeriod(currentEndDateObj, 'America/Argentina/Buenos_Aires');
        const businessCurrentPeriod = BillingPeriodHelper.getBillingPeriod(nowObj, 'America/Argentina/Buenos_Aires');
        
        // Verificar que reconoció SEPTIEMBRE a pesar de que el .getMonth() UTC de storedEndDate devolvería 9 (Octubre)
        expect(coveredPeriod).toBe('2026-09');
        expect(businessCurrentPeriod).toBe('2026-09');
        
        // Lógica de eligibility usada en GarageController:
        // if (coveredPeriod > businessCurrentPeriod) throw Error;
        const isEligible = coveredPeriod <= businessCurrentPeriod;
        
        expect(isEligible).toBe(true);
    });

    it('rechaza doble pago ADVANCE (ej: intentar pagar Octubre cuando ya está cubierto)', () => {
        // Después de pagar Octubre, el endDate será 31/10/2026 23:59:59 ART
        const storedEndDate = '2026-11-01T02:59:59.999Z'; 
        
        // Mismo "now" en Septiembre
        const now = '2026-09-17T15:00:00.000Z';
        
        const currentEndDateObj = new Date(storedEndDate);
        const nowObj = new Date(now);
        
        const coveredPeriod = BillingPeriodHelper.getBillingPeriod(currentEndDateObj, 'America/Argentina/Buenos_Aires');
        const businessCurrentPeriod = BillingPeriodHelper.getBillingPeriod(nowObj, 'America/Argentina/Buenos_Aires');
        
        expect(coveredPeriod).toBe('2026-10');
        expect(businessCurrentPeriod).toBe('2026-09');
        
        const isEligible = coveredPeriod <= businessCurrentPeriod;
        
        // El usuario ya tiene Octubre pago. NO puede anticipar Noviembre todavía (en nuestro modelo de un solo advance).
        expect(isEligible).toBe(false);
    });
});
