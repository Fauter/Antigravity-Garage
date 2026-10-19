import { describe, it, expect } from 'vitest';
import {
    calculateCajaShift,
    getLatestShiftClose,
    isCashPaymentMethod,
    matchesGarage,
    parseSafeAmount,
    parseSafeTimestamp,
    roundCurrency,
    ShiftCloseRecord,
    MovementRecord,
    PartialCloseRecord
} from './cajaCalculations';

describe('cajaCalculations — Auditoría Contable y Control de Caja', () => {

    describe('Prueba de Aceptación Bogotá (Caso Crítico Confirmado)', () => {
        const garageBogota = '632e27b6-3b34-450e-9c60-c513aae48e10';

        // Cierre previo de Asdrúbal (05/10)
        const asdrubalOldClose: ShiftCloseRecord = {
            id: 'sc-asdrubal-old',
            garageId: garageBogota,
            operator: 'ASDRUBAL G.',
            staying_in_cash: 500000,
            timestamp: '2026-10-05T20:00:00.000Z'
        };

        // Retiros históricos de Asdrúbal acumulados entre 05/10 y 14/10 18:20 ($6.991.870)
        const historicalWithdrawals: PartialCloseRecord[] = [
            {
                id: 'pc-hist-1',
                garageId: garageBogota,
                operator: 'ASDRUBAL G.',
                amount: 3000000,
                timestamp: '2026-10-08T15:00:00.000Z',
                movement_type: 'withdrawal',
                recipient_name: 'Gerencia'
            },
            {
                id: 'pc-hist-2',
                garageId: garageBogota,
                operator: 'ASDRUBAL G.',
                amount: 3991870,
                timestamp: '2026-10-12T16:00:00.000Z',
                movement_type: 'withdrawal',
                recipient_name: 'Gerencia'
            }
        ];

        // Último cierre final global: José Torres (14/10/2026 18:27 Argentina = 21:27:00.814Z)
        const joseFinalClose: ShiftCloseRecord = {
            id: 'sc-jose-bogota-final',
            garageId: garageBogota,
            operator: 'JOSE TORRES',
            staying_in_cash: 1583986,
            total_in_cash: 2000000,
            rendered_amount: 416014,
            timestamp: '2026-10-14T21:27:00.814Z'
        };

        // Movimiento posterior: Asdrúbal retiro a las 18:54 (21:54:05.800Z) por $1.450.000
        const asdrubalWithdrawal: PartialCloseRecord = {
            id: 'pc-asdrubal-bogota-target',
            garageId: garageBogota,
            operator: 'ASDRUBAL G.',
            amount: 1450000,
            timestamp: '2026-10-14T21:54:05.800Z',
            movement_type: 'withdrawal',
            recipient_name: 'Patrón'
        };

        it('debe calcular exactamente $133.986 de efectivo en caja para Bogotá y NUNCA -$5.407.884', () => {
            const shiftCloses = [asdrubalOldClose, joseFinalClose];
            const partialCloses = [...historicalWithdrawals, asdrubalWithdrawal];
            const movements: MovementRecord[] = [];

            const result = calculateCajaShift({
                movements,
                partialCloses,
                shiftCloses,
                activeGarageId: garageBogota
            });

            // 1. El último cierre debe ser el de José Torres (no el antiguo de Asdrúbal)
            expect(result.lastGlobalClose?.id).toBe('sc-jose-bogota-final');
            expect(result.lastGlobalClose?.operator).toBe('JOSE TORRES');

            // 2. El fondo inicial debe ser $1.583.986
            expect(result.fondoInicial).toBe(1583986);

            // 3. Los retiros del período deben ser SOLAMENTE el posterior al cierre de José ($1.450.000)
            expect(result.shiftPartials.length).toBe(1);
            expect(result.shiftPartials[0].id).toBe('pc-asdrubal-bogota-target');
            expect(result.partialsSum).toBe(1450000);

            // 4. Cobros = $0
            expect(result.cashSum).toBe(0);

            // 5. Total = $1.583.986 - $1.450.000 = $133.986
            expect(result.totalCashInDrawer).toBe(133986);

            // 6. La lista unificada debe contener exactamente 1 movimiento (el retiro posterior)
            expect(result.unifiedRows.length).toBe(1);
            expect(result.unifiedRows[0].id).toBe('pc-asdrubal-bogota-target');
        });
    });

    describe('Escenarios de Regresión Obligatorios', () => {

        it('Escenario 1: José cierra y no hay operaciones posteriores -> Fondo heredado, lista vacía', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-1',
                    operator: 'JOSE TORRES',
                    staying_in_cash: 500000,
                    timestamp: '2026-10-14T10:00:00Z'
                }],
                movements: [],
                partialCloses: []
            });

            expect(result.fondoInicial).toBe(500000);
            expect(result.totalCashInDrawer).toBe(500000);
            expect(result.unifiedRows).toEqual([]);
        });

        it('Escenario 2: Asdrúbal retira dinero luego del cierre -> Fondo menos retiro', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-1',
                    operator: 'JOSE TORRES',
                    staying_in_cash: 1000000,
                    timestamp: '2026-10-14T10:00:00Z'
                }],
                movements: [],
                partialCloses: [{
                    id: 'pc-1',
                    operator: 'ASDRUBAL G.',
                    amount: 300000,
                    movement_type: 'withdrawal',
                    timestamp: '2026-10-14T11:00:00Z'
                }]
            });

            expect(result.fondoInicial).toBe(1000000);
            expect(result.partialsSum).toBe(300000);
            expect(result.totalCashInDrawer).toBe(700000);
            expect(result.unifiedRows.length).toBe(1);
        });

        it('Escenario 3: José cobra y realiza un retiro antes de cerrar -> Operaciones excluidas tras el cierre', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-close-1',
                    operator: 'JOSE TORRES',
                    staying_in_cash: 400000,
                    timestamp: '2026-10-14T12:00:00Z'
                }],
                movements: [{
                    id: 'mov-before',
                    operator: 'JOSE TORRES',
                    amount: 50000,
                    paymentMethod: 'Efectivo',
                    type: 'CobroEstadia',
                    timestamp: '2026-10-14T11:30:00Z'
                }],
                partialCloses: [{
                    id: 'pc-before',
                    operator: 'JOSE TORRES',
                    amount: 20000,
                    movement_type: 'withdrawal',
                    timestamp: '2026-10-14T11:45:00Z'
                }]
            });

            expect(result.fondoInicial).toBe(400000);
            expect(result.cashSum).toBe(0);
            expect(result.partialsSum).toBe(0);
            expect(result.totalCashInDrawer).toBe(400000);
            expect(result.unifiedRows.length).toBe(0);
        });

        it('Escenario 4: Asdrúbal cierra y José vuelve a entrar -> Se hereda el nuevo fondo', () => {
            const shiftCloses = [
                {
                    id: 'sc-jose-old',
                    operator: 'JOSE TORRES',
                    staying_in_cash: 500000,
                    timestamp: '2026-10-14T08:00:00Z'
                },
                {
                    id: 'sc-asdrubal-new',
                    operator: 'ASDRUBAL G.',
                    staying_in_cash: 200000,
                    timestamp: '2026-10-14T16:00:00Z'
                }
            ];

            const result = calculateCajaShift({
                shiftCloses,
                movements: [{
                    id: 'mov-between',
                    operator: 'ASDRUBAL G.',
                    amount: 100000,
                    paymentMethod: 'Efectivo',
                    type: 'CobroEstadia',
                    timestamp: '2026-10-14T12:00:00Z'
                }],
                partialCloses: []
            });

            // Hereda el nuevo fondo dejado por Asdrúbal
            expect(result.lastGlobalClose?.id).toBe('sc-asdrubal-new');
            expect(result.fondoInicial).toBe(200000);
            // El movimiento de las 12:00 fue previo a ese cierre, por tanto queda excluido
            expect(result.cashSum).toBe(0);
            expect(result.totalCashInDrawer).toBe(200000);
        });

        it('Escenario 5: Dos operadores operan después del último cierre -> Se incluyen las operaciones del período', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-1',
                    operator: 'JOSE TORRES',
                    staying_in_cash: 100000,
                    timestamp: '2026-10-14T08:00:00Z'
                }],
                movements: [
                    {
                        id: 'mov-op1',
                        operator: 'OPERADOR_A',
                        amount: 50000,
                        paymentMethod: 'Efectivo',
                        type: 'CobroEstadia',
                        timestamp: '2026-10-14T09:00:00Z'
                    },
                    {
                        id: 'mov-op2',
                        operator: 'OPERADOR_B',
                        amount: 30000,
                        paymentMethod: 'Efectivo',
                        type: 'CobroAbono',
                        timestamp: '2026-10-14T10:00:00Z'
                    }
                ],
                partialCloses: [{
                    id: 'pc-op1',
                    operator: 'OPERADOR_A',
                    amount: 20000,
                    movement_type: 'withdrawal',
                    timestamp: '2026-10-14T09:30:00Z'
                }]
            });

            expect(result.fondoInicial).toBe(100000);
            expect(result.cashSum).toBe(80000);
            expect(result.partialsSum).toBe(20000);
            expect(result.totalCashInDrawer).toBe(160000); // 100k + 80k - 20k
            expect(result.unifiedRows.length).toBe(3);
        });

        it('Escenario 6: Operador con un cierre antiguo -> No se arrastran operaciones históricas', () => {
            const result = calculateCajaShift({
                shiftCloses: [
                    { id: 'sc-ancient', operator: 'ASDRUBAL G.', staying_in_cash: 10000, timestamp: '2026-10-01T10:00:00Z' },
                    { id: 'sc-recent', operator: 'JOSE TORRES', staying_in_cash: 50000, timestamp: '2026-10-14T10:00:00Z' }
                ],
                movements: [
                    { id: 'm-old', operator: 'ASDRUBAL G.', amount: 999999, paymentMethod: 'Efectivo', type: 'CobroEstadia', timestamp: '2026-10-02T10:00:00Z' }
                ],
                partialCloses: [
                    { id: 'pc-old', operator: 'ASDRUBAL G.', amount: 888888, movement_type: 'withdrawal', timestamp: '2026-10-02T11:00:00Z' }
                ]
            });

            expect(result.fondoInicial).toBe(50000);
            expect(result.cashSum).toBe(0);
            expect(result.partialsSum).toBe(0);
            expect(result.totalCashInDrawer).toBe(50000);
            expect(result.unifiedRows.length).toBe(0);
        });

        it('Escenario 7: Cierres duplicados o casi simultáneos -> No altera indebidamente el saldo', () => {
            const shiftCloses = [
                {
                    id: 'sc-dup-1',
                    operator: 'JOSE TORRES',
                    staying_in_cash: 300000,
                    timestamp: '2026-10-14T18:27:00.000Z'
                },
                {
                    id: 'sc-dup-2',
                    operator: 'JOSE TORRES',
                    staying_in_cash: 300000,
                    timestamp: '2026-10-14T18:27:02.000Z' // 2 segundos después
                }
            ];

            const result = calculateCajaShift({
                shiftCloses,
                movements: [],
                partialCloses: []
            });

            // Selecciona determinísticamente el más reciente
            expect(result.lastGlobalClose?.id).toBe('sc-dup-2');
            expect(result.fondoInicial).toBe(300000);
            expect(result.totalCashInDrawer).toBe(300000);
        });

        it('Escenario 8: Pago por transferencia -> Visible, pero sin sumarse al efectivo', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-1',
                    staying_in_cash: 100000,
                    timestamp: '2026-10-14T10:00:00Z'
                }],
                movements: [
                    {
                        id: 'm-transfer',
                        operator: 'JOSE TORRES',
                        amount: 75000,
                        paymentMethod: 'Transferencia',
                        type: 'CobroAbono',
                        timestamp: '2026-10-14T11:00:00Z'
                    },
                    {
                        id: 'm-qr',
                        operator: 'JOSE TORRES',
                        amount: 25000,
                        paymentMethod: 'QR',
                        type: 'CobroEstadia',
                        timestamp: '2026-10-14T11:15:00Z'
                    },
                    {
                        id: 'm-cash',
                        operator: 'JOSE TORRES',
                        amount: 10000,
                        paymentMethod: 'Efectivo',
                        type: 'CobroEstadia',
                        timestamp: '2026-10-14T11:30:00Z'
                    }
                ],
                partialCloses: []
            });

            expect(result.fondoInicial).toBe(100000);
            expect(result.cashSum).toBe(10000); // Solo el de efectivo
            expect(result.nonCashSum).toBe(100000); // 75k + 25k no en efectivo
            expect(result.totalCashInDrawer).toBe(110000); // 100k fondo + 10k efectivo
            // Los 3 movimientos deben estar visibles en la lista
            expect(result.unifiedRows.length).toBe(3);
        });

        it('Escenario 9: Egreso registrado -> Se descuenta exactamente una vez', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-1',
                    staying_in_cash: 200000,
                    timestamp: '2026-10-14T10:00:00Z'
                }],
                movements: [],
                partialCloses: [{
                    id: 'pc-expense-1',
                    operator: 'JOSE TORRES',
                    amount: 15000,
                    movement_type: 'expense',
                    recipient_name: 'Limpieza',
                    notes: 'Artículos de limpieza',
                    timestamp: '2026-10-14T11:00:00Z'
                }]
            });

            expect(result.fondoInicial).toBe(200000);
            expect(result.partialsSum).toBe(15000);
            expect(result.totalCashInDrawer).toBe(185000); // 200k - 15k
            expect(result.unifiedRows.length).toBe(1);
            expect((result.unifiedRows[0] as PartialCloseRecord).movement_type).toBe('expense');
        });

        it('Escenario 10: Todos los shift_id son null -> El sistema funciona correctamente', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-1',
                    staying_in_cash: 100000,
                    timestamp: '2026-10-14T10:00:00Z'
                }],
                movements: [
                    {
                        id: 'm-1',
                        amount: 40000,
                        paymentMethod: 'Efectivo',
                        type: 'CobroEstadia',
                        timestamp: '2026-10-14T11:00:00Z'
                    }
                ],
                partialCloses: [
                    {
                        id: 'pc-1',
                        amount: 10000,
                        movement_type: 'withdrawal',
                        timestamp: '2026-10-14T12:00:00Z'
                    }
                ]
            });

            expect(result.totalCashInDrawer).toBe(130000); // 100k + 40k - 10k
            expect(result.unifiedRows.length).toBe(2);
        });

        it('Escenario 11: Garajes distintos -> Datos completamente aislados', () => {
            const garageA = 'garage-uuid-A';
            const garageB = 'garage-uuid-B';

            const shiftCloses: ShiftCloseRecord[] = [
                { id: 'sc-a', garageId: garageA, staying_in_cash: 100000, timestamp: '2026-10-14T10:00:00Z' },
                { id: 'sc-b', garageId: garageB, staying_in_cash: 999999, timestamp: '2026-10-14T10:30:00Z' }
            ];

            const movements: MovementRecord[] = [
                { id: 'm-a', garageId: garageA, amount: 20000, paymentMethod: 'Efectivo', type: 'CobroEstadia', timestamp: '2026-10-14T11:00:00Z' },
                { id: 'm-b', garage_id: garageB, amount: 888888, paymentMethod: 'Efectivo', type: 'CobroEstadia', timestamp: '2026-10-14T11:00:00Z' }
            ];

            const partialCloses: PartialCloseRecord[] = [
                { id: 'pc-a', garageId: garageA, amount: 5000, movement_type: 'withdrawal', timestamp: '2026-10-14T11:30:00Z' },
                { id: 'pc-b', garage_id: garageB, amount: 777777, movement_type: 'withdrawal', timestamp: '2026-10-14T11:30:00Z' }
            ];

            const resultA = calculateCajaShift({
                shiftCloses,
                movements,
                partialCloses,
                activeGarageId: garageA
            });

            // Para Garaje A: Solo datos de A
            expect(resultA.lastGlobalClose?.id).toBe('sc-a');
            expect(resultA.fondoInicial).toBe(100000);
            expect(resultA.cashSum).toBe(20000);
            expect(resultA.partialsSum).toBe(5000);
            expect(resultA.totalCashInDrawer).toBe(115000);
            expect(resultA.unifiedRows.length).toBe(2);
            expect(resultA.unifiedRows.map(r => r.id)).toEqual(['pc-a', 'm-a']);
        });

        it('Escenario 12: Garaje sin cierres finales -> Fallback a movimientos del día actual con fondo 0', () => {
            const todayRef = new Date(2026, 9, 15, 14, 0, 0); // 15 de Octubre 2026, 14:00

            const movements: MovementRecord[] = [
                // Movimiento de hoy
                {
                    id: 'm-today',
                    amount: 30000,
                    paymentMethod: 'Efectivo',
                    type: 'CobroEstadia',
                    timestamp: new Date(2026, 9, 15, 10, 30, 0).toISOString()
                },
                // Movimiento de ayer
                {
                    id: 'm-yesterday',
                    amount: 50000,
                    paymentMethod: 'Efectivo',
                    type: 'CobroEstadia',
                    timestamp: new Date(2026, 9, 14, 20, 0, 0).toISOString()
                }
            ];

            const partialCloses: PartialCloseRecord[] = [
                // Retiro de hoy
                {
                    id: 'pc-today',
                    amount: 10000,
                    movement_type: 'withdrawal',
                    timestamp: new Date(2026, 9, 15, 12, 0, 0).toISOString()
                },
                // Retiro de hace 3 días
                {
                    id: 'pc-ancient',
                    amount: 90000,
                    movement_type: 'withdrawal',
                    timestamp: new Date(2026, 9, 12, 12, 0, 0).toISOString()
                }
            ];

            const result = calculateCajaShift({
                shiftCloses: [],
                movements,
                partialCloses,
                referenceDate: todayRef
            });

            expect(result.lastGlobalClose).toBeNull();
            expect(result.fondoInicial).toBe(0);
            expect(result.cashSum).toBe(30000);
            expect(result.partialsSum).toBe(10000);
            expect(result.totalCashInDrawer).toBe(20000); // 0 + 30k - 10k
            expect(result.unifiedRows.length).toBe(2);
            expect(result.unifiedRows.map(r => r.id)).toEqual(['pc-today', 'm-today']);
        });

        it('Escenario 13: Saldo negativo real se conserva y no se trunca a 0', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-1',
                    staying_in_cash: 50000,
                    timestamp: '2026-10-14T10:00:00Z'
                }],
                movements: [],
                partialCloses: [{
                    id: 'pc-heavy',
                    amount: 150000, // Retiro mayor al fondo
                    movement_type: 'withdrawal',
                    timestamp: '2026-10-14T11:00:00Z'
                }]
            });

            expect(result.fondoInicial).toBe(50000);
            expect(result.partialsSum).toBe(150000);
            expect(result.totalCashInDrawer).toBe(-100000); // -100k visible, no 0!
        });

        it('Escenario 14: Cierre con staying_in_cash = 0', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-zero',
                    staying_in_cash: 0,
                    timestamp: '2026-10-14T10:00:00Z'
                }],
                movements: [{
                    id: 'm-1',
                    amount: 25000,
                    paymentMethod: 'Efectivo',
                    type: 'CobroEstadia',
                    timestamp: '2026-10-14T11:00:00Z'
                }],
                partialCloses: []
            });

            expect(result.fondoInicial).toBe(0);
            expect(result.totalCashInDrawer).toBe(25000);
        });

        it('Escenario 15: Compatibilidad con camelCase (stayingInCash) y strings decimales', () => {
            const result = calculateCajaShift({
                shiftCloses: [{
                    id: 'sc-camel',
                    stayingInCash: '1583986.50',
                    timestamp: '2026-10-14T10:00:00Z'
                }],
                movements: [{
                    id: 'm-dec',
                    amount: '13.50',
                    paymentMethod: 'efectivo',
                    type: 'CobroEstadia',
                    timestamp: '2026-10-14T11:00:00Z'
                }],
                partialCloses: []
            });

            expect(result.fondoInicial).toBe(1583986.50);
            expect(result.cashSum).toBe(13.50);
            expect(result.totalCashInDrawer).toBe(1584000);
        });
    });
});
