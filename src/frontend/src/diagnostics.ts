declare global {
    interface Window {
        __frontendDiagnosticsInstalled?: boolean;
    }
}

export function installGlobalFrontendDiagnostics() {
    if (window.__frontendDiagnosticsInstalled) return;
    window.__frontendDiagnosticsInstalled = true;

    if (import.meta.env.DEV) {
        console.log('[FRONTEND] installGlobalFrontendDiagnostics initialized');
    }

    window.addEventListener('error', (event) => {
        console.error('[RENDERER:GLOBAL-ERROR]', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error?.stack || 'No stack'
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        let safeReason = 'Unknown reason';
        try {
            if (event.reason instanceof Error) {
                safeReason = event.reason.stack || event.reason.message;
            } else {
                safeReason = JSON.stringify(event.reason);
            }
        } catch (e) {
            safeReason = String(event.reason);
        }

        console.error('[RENDERER:UNHANDLED-PROMISE-REJECTION]', {
            reason: safeReason
        });
    });
}
