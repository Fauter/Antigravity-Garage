import { describe, it, expect } from 'vitest';
import { ShiftManager } from './ShiftManager';
import { Movement, Shift } from '../../../shared/schemas';

describe('ShiftManager', () => {
    it('debe abrir un turno correctamente', () => {
        const shift = ShiftManager.openShift('Carlos');
        expect(shift.active).toBe(true);
        expect(shift.operatorName).toBe('Carlos');
        expect(shift.id).toBeDefined();
    });

    it('debe cerrar turno y calcular totales', () => {
        const shift = ShiftManager.openShift('Carlos');

        // Mock Movements (Financial)
        const movements: Movement[] = [
            {
                id: '1',
                type: 'CobroEstadia',
                amount: 500,
                timestamp: new Date(),
                paymentMethod: 'Efectivo',
                createdAt: new Date()
            },
            {
                id: '2',
                type: 'CobroAbono',
                amount: 8000,
                timestamp: new Date(),
                paymentMethod: 'Tarjeta',
                createdAt: new Date()
            },
            {
                id: '3',
                type: 'CobroRenovacion',
                amount: 0, // Bonificado
                timestamp: new Date(),
                paymentMethod: 'Efectivo',
                createdAt: new Date()
            }
        ];

        const closedShift = ShiftManager.closeShift(shift, movements, 8500);

        expect(closedShift.active).toBe(false);
        expect(closedShift.totalCollection).toBe(8500); // 500 + 8000
        expect(closedShift.endDate).toBeDefined();
    });
});
