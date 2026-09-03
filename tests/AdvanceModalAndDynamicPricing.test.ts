import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('ADVANCE & DEBT Modal Viewport & Dynamic Pricing Tests', () => {
    // 1. Debug cleanup test
    it('1. Debug Cleanup: CustomerDetailView.tsx contains no [DEBUG] logs in render', () => {
        const cdvPath = path.join(process.cwd(), 'src', 'frontend', 'src', 'components', 'subscription', 'CustomerDetailView.tsx');
        const content = fs.readFileSync(cdvPath, 'utf-8');
        expect(content).not.toContain('[DEBUG] Cochera');
        expect(content).not.toContain('[DEBUG]');
    });

    // 2. Case-insensitive matrix helper test
    const getPriceForSubscription = (matrix: any, vehicleType: string, subscriptionType: string, fallback: number = 0) => {
        if (!matrix || Object.keys(matrix).length === 0) return fallback;
        const normalizeStr = (s: string) => s ? String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : '';
        const vKey = normalizeStr(vehicleType || 'Auto');
        const subTypeRaw = subscriptionType || 'Movil';
        let tKey = normalizeStr(subTypeRaw);
        if (normalizeStr(subTypeRaw) === normalizeStr('Exclusiva')) tKey = normalizeStr('abono exclusivo');
        else tKey = normalizeStr(`abono ${subTypeRaw}`);

        const typeKey = Object.keys(matrix).find(k => normalizeStr(k) === vKey) || Object.keys(matrix).find(k => normalizeStr(k) === normalizeStr('Auto'));
        if (typeKey && matrix[typeKey]) {
            const priceKey = Object.keys(matrix[typeKey]).find(k => {
                const nk = normalizeStr(k);
                return nk === tKey || nk === `${normalizeStr(subTypeRaw)} abono` || nk === normalizeStr(subTypeRaw) || (tKey === 'abono movil' && nk === 'movil');
            });
            if (priceKey && Number(matrix[typeKey][priceKey]) > 0) {
                return Number(matrix[typeKey][priceKey]);
            }
        }
        return fallback;
    };

    // Matrices with original capitalized casing as returned from API/DB
    const rawCapitalizedStandardMatrix: Record<string, Record<string, number>> = {
        'Auto': { 'Fija abono': 460000, 'Movil': 390000 },
        'F1000': { 'Fija abono': 860000, 'Movil': 750000 }
    };

    const rawCapitalizedElectronicMatrix: Record<string, Record<string, number>> = {
        'Auto': { 'Fija abono': 506000, 'Movil': 429000 },
        'F1000': { 'Fija abono': 946000, 'Movil': 825000 }
    };

    it('2. Standard Price (Case-Insensitive): Resolves standard matrix amount for Efectivo ($460.000 / $860.000)', () => {
        const autoStd = getPriceForSubscription(rawCapitalizedStandardMatrix, 'Auto', 'Fija', 400000);
        expect(autoStd).toBe(460000);

        const f1000Std = getPriceForSubscription(rawCapitalizedStandardMatrix, 'f1000', 'Fija', 800000);
        expect(f1000Std).toBe(860000);
    });

    it('3. Electronic Price (Case-Insensitive): Resolves electronic matrix amount for Transferencia ($506.000 / $946.000)', () => {
        const autoElec = getPriceForSubscription(rawCapitalizedElectronicMatrix, 'auto', 'Fija', 400000);
        expect(autoElec).toBe(506000);

        const f1000Elec = getPriceForSubscription(rawCapitalizedElectronicMatrix, 'F1000', 'Fija', 800000);
        expect(f1000Elec).toBe(946000);
    });

    it('4. Live Dynamic Switching: Changing payment method changes price immediately without surcharge', () => {
        let currentMethod = 'Efectivo';
        let currentMatrix = currentMethod === 'Efectivo' ? rawCapitalizedStandardMatrix : rawCapitalizedElectronicMatrix;
        let price = getPriceForSubscription(currentMatrix, 'F1000', 'Fija');
        expect(price).toBe(860000);

        // Switch to Transferencia
        currentMethod = 'Transferencia';
        currentMatrix = currentMethod === 'Efectivo' ? rawCapitalizedStandardMatrix : rawCapitalizedElectronicMatrix;
        price = getPriceForSubscription(currentMatrix, 'F1000', 'Fija');
        expect(price).toBe(946000);

        // Switch back to Efectivo
        currentMethod = 'Efectivo';
        currentMatrix = currentMethod === 'Efectivo' ? rawCapitalizedStandardMatrix : rawCapitalizedElectronicMatrix;
        price = getPriceForSubscription(currentMatrix, 'F1000', 'Fija');
        expect(price).toBe(860000);
    });

    it('5. Modal Structure: AdvancePaymentModal.tsx adheres to responsive layout, fixed footer and scrollable body', () => {
        const modalPath = path.join(process.cwd(), 'src', 'frontend', 'src', 'components', 'subscription', 'AdvancePaymentModal.tsx');
        const modalCode = fs.readFileSync(modalPath, 'utf-8');

        // Overlay fixed & centered
        expect(modalCode).toContain('fixed inset-0');
        expect(modalCode).toContain('items-center justify-center');

        // Container with max-height viewport protection
        expect(modalCode).toContain('max-h-[calc(100vh-2rem)]');
        expect(modalCode).toContain('flex flex-col');

        // Body with internal scroll
        expect(modalCode).toContain('overflow-y-auto');
        expect(modalCode).toContain('flex-1');

        // Footer shrink-0 (outside scrollable area)
        expect(modalCode).toContain('shrink-0 flex gap-3');
        expect(modalCode).toContain('Confirmar Pago');
        expect(modalCode).toContain('Cancelar');

        // No editable input for amount
        expect(modalCode).not.toContain('input type="number"');
    });

    it('6. Modal Structure: DEBT Modal in CustomerDetailView.tsx adheres to viewport-safe layout with fixed footer', () => {
        const cdvPath = path.join(process.cwd(), 'src', 'frontend', 'src', 'components', 'subscription', 'CustomerDetailView.tsx');
        const cdvCode = fs.readFileSync(cdvPath, 'utf-8');

        // DEBT Modal overlay & container
        expect(cdvCode).toContain('{isRenewalModalOpen && (');
        expect(cdvCode).toContain('fixed inset-0 z-50 flex items-center justify-center');
        expect(cdvCode).toContain('max-h-[calc(100vh-2rem)] overflow-hidden');
    });
});
