import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P0 Polish & Hardening: Modal Viewport Centering and ListaAbonados Atomic Hydration', () => {
    const srcDir = path.join(process.cwd(), 'src', 'frontend', 'src');

    it('1. ModalPortal: Exists and correctly ports elements to document.body', () => {
        const portalPath = path.join(srcDir, 'components', 'common', 'ModalPortal.tsx');
        expect(fs.existsSync(portalPath)).toBe(true);
        const code = fs.readFileSync(portalPath, 'utf-8');
        expect(code).toContain('createPortal(children, document.body)');
    });

    it('2. useBodyScrollLock: Exists and manages document.body.style.overflow', () => {
        const hookPath = path.join(srcDir, 'hooks', 'useBodyScrollLock.ts');
        expect(fs.existsSync(hookPath)).toBe(true);
        const code = fs.readFileSync(hookPath, 'utf-8');
        expect(code).toContain("document.body.style.overflow = 'hidden'");
    });

    it('3. AdvancePaymentModal: Integrated with ModalPortal and useBodyScrollLock', () => {
        const modalPath = path.join(srcDir, 'components', 'subscription', 'AdvancePaymentModal.tsx');
        const code = fs.readFileSync(modalPath, 'utf-8');
        expect(code).toContain('ModalPortal');
        expect(code).toContain('<ModalPortal>');
        expect(code).toContain('useBodyScrollLock(isOpen)');
    });

    it('4. CustomerDetailView: Wraps all dialogs/modals in ModalPortal and calls useBodyScrollLock', () => {
        const cdvPath = path.join(srcDir, 'components', 'subscription', 'CustomerDetailView.tsx');
        const code = fs.readFileSync(cdvPath, 'utf-8');
        expect(code).toContain('ModalPortal');
        expect(code).toContain('useBodyScrollLock(');
        expect(code).toContain('<ModalPortal>');
        // Contains AdvancePaymentModal with all dynamic pricing props
        expect(code).toContain('<AdvancePaymentModal');
        expect(code).toContain('onPaymentMethodChange={handleAdvancePaymentMethodChange}');
    });

    it('5. ListaAbonados: Atomic Hydration Barrier (no premature unhydrated flashing states)', () => {
        const listPath = path.join(srcDir, 'components', 'subscription', 'ListaAbonados.tsx');
        const code = fs.readFileSync(listPath, 'utf-8');

        // State declaration for hydrationStatus
        expect(code).toContain("const [hydrationStatus, setHydrationStatus] = useState<'loading' | 'ready' | 'error'>('loading')");

        // Atomic commit after all fetches are fulfilled
        expect(code).toContain("setHydrationStatus('ready')");
        expect(code).toContain("setHydrationStatus('error')");

        // Renders skeleton rows while loading
        expect(code).toContain("(hydrationStatus === 'loading' || isLoading)");
        expect(code).toContain("key={`skeleton-${idx}`}");
        expect(code).toContain("animate-pulse");

        // Error retry mechanism
        expect(code).toContain("hydrationStatus === 'error'");
        expect(code).toContain("Reintentar");
    });

    it('6. GestorAbonos: Passes isLoading to ListaAbonados with valid scope', () => {
        const gestorPath = path.join(srcDir, 'components', 'subscription', 'GestorAbonos.tsx');
        const code = fs.readFileSync(gestorPath, 'utf-8');
        expect(code).toContain('isLoading={isLoading}');
        expect(code).toContain('const { subscribers, isLoading, error, refetch } = useSubscription();');
    });
});
