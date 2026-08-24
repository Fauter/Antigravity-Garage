import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });
        console.error('[RENDERER:REACT-ERROR]', error.message, '\nComponent Stack:', errorInfo.componentStack);
    }

    public render() {
        if (this.state.hasError) {
            const isDev = import.meta.env.DEV;

            if (isDev) {
                return (
                    <div style={{ padding: '20px', backgroundColor: '#330000', color: '#ffaaaa', fontFamily: 'monospace', height: '100vh', overflow: 'auto' }}>
                        <h2>React Rendering Crash</h2>
                        <p style={{ fontWeight: 'bold' }}>{this.state.error?.message}</p>
                        <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px' }} open>
                            <summary>Stack Trace</summary>
                            {this.state.error?.stack}
                        </details>
                        <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px' }} open>
                            <summary>Component Stack</summary>
                            {this.state.errorInfo?.componentStack}
                        </details>
                    </div>
                );
            }

            return (
                <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif', color: '#fff', backgroundColor: '#111', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div>
                        <h2>Ha ocurrido un error en la interfaz.</h2>
                        <p>Por favor, reinicie la aplicación.</p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
