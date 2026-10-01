import { describe, expect, it, vi } from 'vitest';
import { PricingEngine, TarifasConfig } from './PricingEngine';
import { SubscriptionType } from '../../../shared/schemas';

describe('PricingEngine', () => {
    const mockConfig: TarifasConfig = {
        mensual: {
            Exclusiva: { Efectivo: 10000, Tarjeta: 11000 },
            Fija: { Efectivo: 8000, Tarjeta: 8800 },
            Movil: { Efectivo: 5000, Tarjeta: 5500 },
        },
        mora: {
            nivel1: 500,
            nivel2: 1000,
        },
    };

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const dateOn = (day: number) => new Date(currentYear, currentMonth, day);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

    it('debe calcular cobro normal en Efectivo', () => {
        const startDate = dateOn(1);
        const endDate = endOfMonth;
        const paymentDate = dateOn(5);

        const price = PricingEngine.calculateSubscriptionFee(
            'Fija', startDate, endDate, mockConfig, paymentDate, 'Efectivo'
        );
        expect(price).toBe(8000);
    });

    it('debe calcular cobro diferenciado con Tarjeta', () => {
        const startDate = dateOn(1);
        const endDate = endOfMonth;
        const paymentDate = dateOn(5);

        const price = PricingEngine.calculateSubscriptionFee(
            'Fija', startDate, endDate, mockConfig, paymentDate, 'Tarjeta'
        );
        expect(price).toBe(8800);
    });

    it('debe aplicar recargo por mora explícito (Efectivo)', () => {
        const basePrice = mockConfig.mensual.Fija.Efectivo; // 8000
        const mockSurchargeConfig = { surchargeConfig: { global_default: { steps: [{ day: 10, percentage: 5 }] } } };
        // Simulate 'today' is 15th
        vi.setSystemTime(new Date(2023, 7, 15));
        const surcharge = PricingEngine.calculateSurcharge(basePrice, mockSurchargeConfig);
        expect(surcharge).toBe(400); // 5% of 8000
        vi.useRealTimers();
    });

    it('debe calcular correctamente cuota mensual base sin mora incrustada (Tarjeta)', () => {
        const startDate = dateOn(1);
        const endDate = endOfMonth;
        const paymentDate = dateOn(15); 

        const price = PricingEngine.calculateSubscriptionFee(
            'Fija', startDate, endDate, mockConfig, paymentDate, 'Tarjeta'
        );
        // Should be 8800 without surcharge
        expect(price).toBe(8800);
    });

    it('debe calcular tarifa optimizada (Camioneta, Transferencia, 24h)', async () => {
        const tariffs = [
            { id: 't1', name: 'Hora', type: 'hora', days: 0, hours: 1, minutes: 0 },
            { id: 't2', name: 'Media Estadía', type: 'hora', days: 0, hours: 12, minutes: 0 },
            { id: 't3', name: 'Estadía', type: 'hora', days: 1, hours: 0, minutes: 0 },
            { id: 't4', name: '5 Minutos', type: 'hora', days: 0, hours: 0, minutes: 5 }
        ];
        
        const electronicMatrix = {
            'Camioneta': {
                'Hora': 3300,
                'Media Estadía': 13200,
                'Estadía': 23100,
                '5 Minutos': 290
            },
            'Auto': {
                'Media Estadía': 8800
            }
        };

        const tariffRepo = { getAll: async () => tariffs };
        const paramRepo = { getParams: async () => ({ toleranciaInicial: 15, fraccionarDesde: 0 }) };
        const priceRepo = { getPrices: async () => electronicMatrix };

        const engine = new PricingEngine(tariffRepo as any, paramRepo as any, priceRepo as any);
        
        const entryTime = new Date('2026-09-01T00:00:00Z');
        const exitTime = new Date(entryTime.getTime() + (24 * 60 * 60 * 1000));
        
        const feeResult = await engine.calculateParkingFee(
            { entryTime, plate: 'FEO504', vehicleType: 'Camioneta' },
            exitTime,
            'Transferencia'
        );
        
        // 2x Media estadía = 26400
        // 1x Estadía = 23100
        // Should choose 23100
        expect(feeResult.price).toBe(23100);
    });

    it('debe calcular correctamente el caso complejo FEO504 (88589 min)', async () => {
        const tariffs = [
            { id: 't1', name: 'Hora', type: 'hora', days: 0, hours: 1, minutes: 0 },
            { id: 't2', name: 'Media Estadía', type: 'hora', days: 0, hours: 12, minutes: 0 },
            { id: 't3', name: 'Estadía', type: 'hora', days: 1, hours: 0, minutes: 0 },
            { id: 't4', name: '5 Minutos', type: 'hora', days: 0, hours: 0, minutes: 5 }
        ];

        const standardMatrix = {
            'Camioneta': {
                'Hora': 3000,
                'Media Estadía': 12000,
                'Estadía': 21000,
                '5 Minutos': 260
            }
        };

        const electronicMatrix = {
            'Camioneta': {
                'Hora': 3300,
                'Media Estadía': 13200,
                'Estadía': 23100,
                '5 Minutos': 290
            }
        };

        const tariffRepo = { getAll: async () => tariffs };
        const paramRepo = { getParams: async () => ({ toleranciaInicial: 15, fraccionarDesde: 0 }) };
        const priceRepo = { getPrices: async (method: string) => method === 'EFECTIVO' ? standardMatrix : electronicMatrix };

        const engine = new PricingEngine(tariffRepo as any, paramRepo as any, priceRepo as any);
        
        const entryTime = new Date('2026-09-01T00:00:00Z');
        // 88589 minutes
        const exitTime = new Date(entryTime.getTime() + (88589 * 60 * 1000));
        
        const standardResult = await engine.calculateParkingFee(
            { entryTime, plate: 'FEO504', vehicleType: 'Camioneta' },
            exitTime,
            'Efectivo'
        );

        const electronicResult = await engine.calculateParkingFee(
            { entryTime, plate: 'FEO504', vehicleType: 'Camioneta' },
            exitTime,
            'Transferencia'
        );

        expect(standardResult.price).toBe(1294560);
        expect(electronicResult.price).toBe(1424040);
    });
});
