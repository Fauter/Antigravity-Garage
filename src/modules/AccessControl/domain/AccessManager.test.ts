import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { AccessManager, AccessConfig } from './AccessManager';
import { Stay, Movement } from '../../../shared/schemas';

describe('AccessManager', () => {
    const mockConfig: AccessConfig = {
        tarifas: {
            mensual: {
                Exclusiva: { Efectivo: 100 },
                Fija: { Efectivo: 80 },
                Movil: { Efectivo: 50 },
            } as any, // Cast cheap mock
            mora: { nivel1: 10, nivel2: 20 }
        },
        hourlyRate: 500
    };

    it('debe registrar entrada como Stay', () => {
        const stay = AccessManager.processEntry('ABC-123');
        expect(stay.id).toBeDefined();
        expect(stay.plate).toBe('ABC-123');
        expect(stay.active).toBe(true);
        expect(stay.entryTime).toBeDefined();
    });

    it('debe procesar salida cerrando Stay y generando Movimiento', () => {
        // Mock Stay
        const now = new Date();
        const entryTime = new Date(now.getTime() - (2 * 60 * 60 * 1000)); // 2 horas

        const stay: Stay = {
            id: uuidv4(),
            plate: 'TEST-EXIT',
            entryTime: entryTime,
            active: true,
            createdAt: entryTime
        };

        const result = AccessManager.processExit(stay, now, mockConfig, 'Efectivo');

        expect(result.closedStay.active).toBe(false);
        expect(result.closedStay.exitTime).toBe(now);

        expect(result.exitMovement.type).toBe('CobroEstadia');
        expect(result.exitMovement.amount).toBe(1000); // 2 * 500
        expect(result.exitMovement.relatedEntityId).toBe(stay.id);
    });
});
