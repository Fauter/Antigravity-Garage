import { PricingEngine } from '../../modules/Billing/domain/PricingEngine';
import assert from 'assert';

console.log('🧪 Iniciando Simulated Time-Travel Test (Deudas Y Recargos)');

// --- Test 2: PricingEngine calculateSurcharge Mocks ---
const baseAmount = 40000;
const config = {
    apartirdia11: 10,  // 10%
    apartirdia22: 20   // 20%
};

// Override nativo de Date para el test (Mocking)
const originalDate = global.Date;

function mockDate(isoString: string) {
    global.Date = class extends originalDate {
        constructor(dateStr?: string | number | Date) {
            super();
            if (dateStr) return new originalDate(dateStr) as any;
            return new originalDate(isoString) as any;
        }
    } as any;
    global.Date.now = () => new originalDate(isoString).getTime();
}

try {
    // Escenario A: Día 5 (Sin mora)
    mockDate('2026-03-05T12:00:00Z');
    let surcharge = PricingEngine.calculateSurcharge(baseAmount, config);
    assert.strictEqual(surcharge, 0, `Escenario A falló: Día 5 debería ser 0, fue ${surcharge}`);
    console.log('✅ Escenario A (Día 5) pasó: Sin recargo ($0).');

    // Escenario B: Día 15 (Aplicar apartirdia11 -> 10%)
    mockDate('2026-03-15T12:00:00Z');
    surcharge = PricingEngine.calculateSurcharge(baseAmount, config);
    assert.strictEqual(surcharge, 4000, `Escenario B falló: Día 15 debería ser 4000, fue ${surcharge}`);
    console.log('✅ Escenario B (Día 15) pasó: Recargo 10% ($4000).');

    // Escenario C: Día 25 (Aplicar apartirdia22 -> 20%)
    mockDate('2026-03-25T12:00:00Z');
    surcharge = PricingEngine.calculateSurcharge(baseAmount, config);
    assert.strictEqual(surcharge, 8000, `Escenario C falló: Día 25 debería ser 8000, fue ${surcharge}`);
    console.log('✅ Escenario C (Día 25) pasó: Recargo 20% ($8000).');

    // Restore Array
    global.Date = originalDate;

    console.log('🎉 Todos los tests de tiempo pasaron exitosamente.');
    process.exit(0);
} catch (error: any) {
    console.error('❌ Falló un test:', error.message);
    global.Date = originalDate;
    process.exit(1);
}
