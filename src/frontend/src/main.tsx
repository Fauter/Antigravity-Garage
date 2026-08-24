import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installGlobalFrontendDiagnostics } from './diagnostics'
import { ErrorBoundary } from './components/ErrorBoundary'

installGlobalFrontendDiagnostics();

const queryClient = new QueryClient()

if (import.meta.env.DEV) {
    console.log('[FRONTEND] main.tsx loaded');
    console.log('[FRONTEND] creating React root');
}

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (import.meta.env.DEV) {
    console.log('[FRONTEND] React root mounted');
}

root.render(
    <React.StrictMode>
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        </ErrorBoundary>
    </React.StrictMode>,
)
