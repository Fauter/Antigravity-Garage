import { describe, it, expect } from 'vitest';
import { getVisibleDebts } from '../src/frontend/src/utils/subscriptionHelper';

describe('getVisibleDebts Helper', () => {
    it('TEST — Legitimate Debt Visibility (Empty Client)', () => {
        const debts = [
            { id: '1', type: 'CANON', status: 'PENDING', subscriptionId: 'sub-old' }
        ];
        
        // Empty client (no active cocheras)
        const visible = getVisibleDebts(debts, [], [], []);
        expect(visible.length).toBe(1);
    });

    it('TEST — Superseded Subscriptions (Mendez bug)', () => {
        const debts = [
            { id: '1', type: 'CANON', status: 'PENDING', subscriptionId: 'sub-old' },
            { id: '2', type: 'CANON', status: 'PAID', subscriptionId: 'sub-new' },
            { id: '3', type: 'MANUAL_MIGRATION', status: 'PENDING', subscriptionId: 'sub-old' }
        ];
        
        const cocheras = [
            { id: 'c-1', clienteId: 'client-1', tipo: 'Fija', numero: '36', vehiculos: ['PKI943'] }
        ];
        
        const subscriptions = [
            { id: 'sub-old', vehicle_id: 'veh-1', customerId: 'client-1', active: false },
            { id: 'sub-new', vehicle_id: 'veh-1', customerId: 'client-1', active: true, cocheraId: 'c-1' } // Canonical active sub for cochera
        ];
        
        const vehicles = [
            { id: 'veh-1', plate: 'PKI943' }
        ];
        
        const visible = getVisibleDebts(debts, cocheras, subscriptions, vehicles);
        
        // Old CANON debt should be hidden (superseded by sub-new on same vehicle).
        // The PAID debt is kept visible, and MANUAL_MIGRATION is kept.
        expect(visible.length).toBe(2);
        expect(visible.map(d => d.id)).toContain('2');
        expect(visible.map(d => d.id)).toContain('3');
    });

    it('TEST — Legitimate debt from different removed vehicle', () => {
        const debts = [
            { id: '1', type: 'CANON', status: 'PENDING', subscriptionId: 'sub-car1' }, // old debt for removed car
            { id: '2', type: 'CANON', status: 'PENDING', subscriptionId: 'sub-car2' }  // current debt for active car
        ];
        
        const cocheras = [
            { id: 'c-1', clienteId: 'client-1', tipo: 'Fija', numero: '36', vehiculos: ['CAR2'] }
        ];
        
        const subscriptions = [
            { id: 'sub-car1', vehicle_id: 'veh-1', active: false },
            { id: 'sub-car2', vehicle_id: 'veh-2', active: true, cocheraId: 'c-1' } // Canonical active sub for cochera
        ];
        
        const vehicles = [
            { id: 'veh-1', plate: 'CAR1' },
            { id: 'veh-2', plate: 'CAR2' }
        ];
        
        const visible = getVisibleDebts(debts, cocheras, subscriptions, vehicles);
        
        // Both should be visible. CAR1 is not superseded by CAR2 (different vehicle_id).
        expect(visible.length).toBe(2);
        expect(visible.map(d => d.id)).toEqual(['1', '2']);
    });
    
    it('TEST — No Sub Object found keeps debt visible', () => {
        const debts = [
            { id: '1', type: 'CANON', status: 'PENDING', subscriptionId: 'sub-ghost' }
        ];
        
        const cocheras = [
            { id: 'c-1', clienteId: 'client-1', tipo: 'Fija', vehiculos: ['CAR2'] }
        ];
        
        const subscriptions = [
            { id: 'sub-car2', vehicle_id: 'veh-2', active: true, cocheraId: 'c-1' } 
        ];
        
        const vehicles = [
            { id: 'veh-2', plate: 'CAR2' }
        ];
        
        const visible = getVisibleDebts(debts, cocheras, subscriptions, vehicles);
        
        // Should keep it visible since we cannot prove it is superseded
        expect(visible.length).toBe(1);
    });
});
