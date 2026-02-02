import { v4 as uuidv4 } from 'uuid';
import { Movement, Shift, ShiftSchema } from '../../../shared/schemas';

export class ShiftManager {
    static openShift(operatorName: string): Shift {
        const shift: Shift = {
            id: uuidv4(),
            operatorName,
            startDate: new Date(),
            startCash: 0,
            totalCollection: 0,
            active: true,
            notes: ''
        };
        return ShiftSchema.parse(shift);
    }

    static closeShift(shift: Shift, movements: Movement[], actualEndCash: number): Shift {
        // Calcular total recaudado por sistema
        // Sumamos todos los movimientos que sean cobros (amount > 0)
        // Con el nuevo schema, todos los Movements son financieros y tienen amount.
        // Aunque amount puede ser 0 (bonificado).

        // Filtrar solo movimientos de este turno si no vienen filtrados?
        // Asumiremos que 'movements' son los pertenecientes a este turno.

        const totalCollection = movements.reduce((sum, mov) => sum + (mov.amount || 0), 0);

        // Validar diferencia de caja podría ser una lógica extra, pero por ahora solo actualizamos

        const closedShift: Shift = {
            ...shift,
            endDate: new Date(),
            active: false,
            endCash: actualEndCash,
            totalCollection
        };

        return ShiftSchema.parse(closedShift);
    }
}
