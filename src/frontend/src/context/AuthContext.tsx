import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';

export interface User {
    id: string;
    username: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
    role: string;
    garage_id?: string;
    permissions?: any;
    owner_id?: string;
}

export type InitialSyncState = 'idle' | 'syncing' | 'warmup' | 'ready' | 'offline' | 'timeout' | 'error';

export interface LoginResult {
    ok: boolean;
    code?: string;
    message?: string;
    status?: number;
}

export interface ReadinessDiagnostics {
    hasLocalData: boolean;
    missing: string[];
    failedTables: string[];
    message?: string;
}

interface AuthContextType {
    user: User | null;
    login: (username: string, password: string, garage_id?: string) => Promise<boolean>;
    loginDetailed: (username: string, password: string, garage_id?: string) => Promise<LoginResult>;
    logout: () => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    isGlobalSyncing: boolean;
    syncStatus: any;
    operatorName: string;
    
    // Initial Hydration Gate variables
    initialSyncState: InitialSyncState;
    readinessDiagnostics: ReadinessDiagnostics;
    retryInitialSync: () => void;
    continueWithLocalData: () => void;
    localHealth: { state: 'UP' | 'DOWN' };
}

export interface InitialSyncFlowDeps {
    garageId: string;
    authMode?: string;
    forceRemote?: boolean;
    signal: AbortSignal;
    timeoutMs?: number;
    apiGet: (url: string, config?: any) => Promise<any>;
    apiPost: (url: string, body?: any, config?: any) => Promise<any>;
    runWarmupAndNotify: (garageId: string) => Promise<void>;
    setInitialSyncState: (state: InitialSyncState) => void;
    setIsGlobalSyncing: (syncing: boolean) => void;
    setReadinessDiagnostics: React.Dispatch<React.SetStateAction<ReadinessDiagnostics>>;
}

export async function executeInitialSyncFlow(deps: InitialSyncFlowDeps): Promise<void> {
    const {
        garageId,
        authMode,
        forceRemote,
        signal,
        timeoutMs = 30000,
        apiGet,
        apiPost,
        runWarmupAndNotify,
        setInitialSyncState,
        setIsGlobalSyncing,
        setReadinessDiagnostics
    } = deps;

    const probeReadinessSafe = async (sig?: AbortSignal): Promise<{ hasLocalData: boolean; missing: string[] }> => {
        try {
            const hasDataRes = await apiGet(`/sync/has-local-data/${garageId}`, sig ? { signal: sig } : undefined);
            return {
                hasLocalData: Boolean(hasDataRes.data?.hasLocalData),
                missing: Array.isArray(hasDataRes.data?.missing) ? hasDataRes.data.missing : []
            };
        } catch {
            return { hasLocalData: false, missing: ['verificación local no disponible'] };
        }
    };

    setInitialSyncState('syncing');
    setIsGlobalSyncing(true);

    const isExplicitOfflineLogin = authMode === 'OFFLINE_LOCAL' && !forceRemote;

    // Case C & D: Explicit offline login — verify local snapshot completeness without waiting for remote timeout
    if (isExplicitOfflineLogin) {
        const localProbe = await probeReadinessSafe(signal);
        if (signal.aborted) return;

        if (localProbe.hasLocalData) {
            setReadinessDiagnostics({
                hasLocalData: true,
                missing: [],
                failedTables: []
            });
            await runWarmupAndNotify(garageId);
            if (signal.aborted) return;
            setInitialSyncState('ready');
            setIsGlobalSyncing(false);
            return;
        } else {
            setReadinessDiagnostics({
                hasLocalData: false,
                missing: localProbe.missing,
                failedTables: [],
                message: 'Sin conexión a internet y los datos locales requeridos para operar este garaje están incompletos.'
            });
            setInitialSyncState('offline');
            setIsGlobalSyncing(false);
            return;
        }
    }

    let isResolved = false;

    const timeoutTimer = setTimeout(async () => {
        if (!isResolved) {
            isResolved = true;
            const localProbe = await probeReadinessSafe();
            setReadinessDiagnostics({
                hasLocalData: localProbe.hasLocalData,
                missing: localProbe.missing,
                failedTables: [],
                message: 'La sincronización inicial excedió el tiempo de espera.'
            });
            setInitialSyncState('timeout');
            setIsGlobalSyncing(false);
        }
    }, timeoutMs);

    try {
        // Case A & B: Online login or session restore ALWAYS awaits full bootstrap completion before entering ready
        const bootRes = await apiPost('/sync/bootstrap', { garageId }, { signal });
        if (signal.aborted) {
            clearTimeout(timeoutTimer);
            return;
        }

        if (!isResolved) {
            const readiness = bootRes.data?.readiness;
            const failedTables: string[] = Array.isArray(bootRes.data?.failedTables)
                ? bootRes.data.failedTables
                : (Array.isArray(bootRes.data?.warnings) ? bootRes.data.warnings : []);

            if (failedTables.length > 0 || (readiness && readiness.hasLocalData === false)) {
                isResolved = true;
                clearTimeout(timeoutTimer);
                setReadinessDiagnostics({
                    hasLocalData: Boolean(readiness?.hasLocalData),
                    missing: Array.isArray(readiness?.missing) ? readiness.missing : [],
                    failedTables,
                    message: `Sincronización incompleta (${failedTables.join(', ') || readiness?.missing?.join(', ') || 'datos faltantes'}).`
                });
                setInitialSyncState('error');
                setIsGlobalSyncing(false);
                return;
            }

            setReadinessDiagnostics({
                hasLocalData: true,
                missing: [],
                failedTables: []
            });
            await runWarmupAndNotify(garageId);
            if (signal.aborted) {
                clearTimeout(timeoutTimer);
                return;
            }

            isResolved = true;
            clearTimeout(timeoutTimer);
            setInitialSyncState('ready');
            setIsGlobalSyncing(false);
        }
    } catch (error: any) {
        if (signal.aborted) {
            clearTimeout(timeoutTimer);
            return;
        }
        if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutTimer);

            const status = error.response?.status;
            const respData = error.response?.data;
            const failedTables: string[] = Array.isArray(respData?.failedTables)
                ? respData.failedTables
                : (Array.isArray(respData?.warnings) ? respData.warnings : []);

            let readiness: { hasLocalData: boolean; missing: string[] } = {
                hasLocalData: Boolean(respData?.readiness?.hasLocalData),
                missing: Array.isArray(respData?.readiness?.missing) ? respData.readiness.missing : []
            };
            if (!respData?.readiness) {
                readiness = await probeReadinessSafe();
            }

            // Partial table failure (HTTP 502): do NOT silently enter ready
            if (status === 502 || respData?.status === 'PARTIAL_FAILURE') {
                setReadinessDiagnostics({
                    hasLocalData: readiness.hasLocalData,
                    missing: readiness.missing,
                    failedTables,
                    message: respData?.error || 'La sincronización inicial falló en una o más tablas críticas.'
                });
                setInitialSyncState('error');
                setIsGlobalSyncing(false);
                return;
            }

            // Network / Offline failure (HTTP 503 or no response)
            if (!error.response || status === 503 || status >= 500 || error.message?.includes('Network')) {
                if (readiness.hasLocalData) {
                    setReadinessDiagnostics({
                        hasLocalData: true,
                        missing: [],
                        failedTables
                    });
                    await runWarmupAndNotify(garageId);
                    setInitialSyncState('ready');
                    setIsGlobalSyncing(false);
                } else {
                    setReadinessDiagnostics({
                        hasLocalData: false,
                        missing: readiness.missing,
                        failedTables,
                        message: respData?.error || 'Sin conexión remota y los datos locales requeridos están incompletos.'
                    });
                    setInitialSyncState('offline');
                    setIsGlobalSyncing(false);
                }
            } else {
                setReadinessDiagnostics({
                    hasLocalData: readiness.hasLocalData,
                    missing: readiness.missing,
                    failedTables,
                    message: respData?.error || error.message || 'Error durante la sincronización inicial.'
                });
                setInitialSyncState('error');
                setIsGlobalSyncing(false);
            }
        }
    }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGlobalSyncing, setIsGlobalSyncing] = useState(false);
    const queryClient = useQueryClient();
    
    const [initialSyncState, setInitialSyncState] = useState<InitialSyncState>('idle');
    const [readinessDiagnostics, setReadinessDiagnostics] = useState<ReadinessDiagnostics>({
        hasLocalData: false,
        missing: [],
        failedTables: []
    });
    const [syncStatus, setSyncStatus] = useState<any>({ state: 'ONLINE', isSyncing: false, pending: 0, blocked: 0 });
    const [localHealth, setLocalHealth] = useState<{ state: 'UP' | 'DOWN' }>({ state: 'UP' });
    
    const abortControllerRef = useRef<AbortController | null>(null);
    const prevSyncStateRef = useRef<string>('ONLINE');

    const runWarmupAndNotify = async (garageId: string) => {
        setInitialSyncState('warmup');
        try {
            await queryClient.prefetchQuery({
                queryKey: ['abonos-hydration', garageId],
                queryFn: async () => {
                    const res = await api.get('/abonos/hydration');
                    return res.data;
                },
                staleTime: 60000
            });
        } catch (warmupErr) {
            console.error('Warmup error (continuing anyway):', warmupErr);
        }
        try {
            await queryClient.invalidateQueries();
        } catch {}
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('ag:sync-completed'));
        }
    };

    const probeReadinessSafe = async (garageId: string, signal?: AbortSignal): Promise<{ hasLocalData: boolean; missing: string[] }> => {
        try {
            const hasDataRes = await api.get(`/sync/has-local-data/${garageId}`, signal ? { signal } : undefined);
            return {
                hasLocalData: Boolean(hasDataRes.data?.hasLocalData),
                missing: Array.isArray(hasDataRes.data?.missing) ? hasDataRes.data.missing : []
            };
        } catch {
            return { hasLocalData: false, missing: ['verificación local no disponible'] };
        }
    };

    const triggerInitialSync = async (garageId: string, options?: { authMode?: string; forceRemote?: boolean }) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        await executeInitialSyncFlow({
            garageId,
            authMode: options?.authMode,
            forceRemote: options?.forceRemote,
            signal: controller.signal,
            apiGet: (url, cfg) => api.get(url, cfg),
            apiPost: (url, body, cfg) => api.post(url, body, cfg),
            runWarmupAndNotify,
            setInitialSyncState,
            setIsGlobalSyncing,
            setReadinessDiagnostics
        });
    };

    const retryInitialSync = () => {
        const resolvedGarageId = user?.garage_id || (user as any)?.garageId;
        if (resolvedGarageId) {
            triggerInitialSync(resolvedGarageId, { forceRemote: true });
        }
    };

    const continueWithLocalData = async () => {
        const resolvedGarageId = user?.garage_id || (user as any)?.garageId;
        if (resolvedGarageId) {
            const probe = await probeReadinessSafe(resolvedGarageId);
            if (!probe.hasLocalData) {
                setReadinessDiagnostics(prev => ({
                    ...prev,
                    hasLocalData: false,
                    missing: probe.missing,
                    message: 'No es posible operar: faltan datos locales indispensables para este garaje.'
                }));
                return;
            }
            await runWarmupAndNotify(resolvedGarageId);
        } else if (!readinessDiagnostics.hasLocalData) {
            return;
        }
        setInitialSyncState('ready');
    };

    // Restore persisted session
    useEffect(() => {
        const storedUser = sessionStorage.getItem('ag_user');
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                if (parsed.id) {
                    const resolvedGarageId = parsed.garage_id || parsed.garageId;
                    if (resolvedGarageId) {
                        setInitialSyncState('syncing');
                        setIsGlobalSyncing(true);
                        setUser(parsed);
                        triggerInitialSync(resolvedGarageId, { authMode: parsed.authMode });
                    } else {
                        setUser(parsed);
                        setInitialSyncState('ready');
                    }
                } else {
                    setInitialSyncState('idle');
                }
            } catch (e) {
                console.error('Failed to parse stored user', e);
                sessionStorage.removeItem('ag_user');
                setInitialSyncState('idle');
            }
        } else {
            setInitialSyncState('idle');
        }
        setIsLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loginDetailed = async (username: string, password: string, garage_id?: string): Promise<LoginResult> => {
        try {
            const res = await api.post('/auth/login', { username, password, garage_id });
            const userData: User = res.data;

            const resolvedGarageId = garage_id || userData.garage_id || (userData as any).garageId;
            if (resolvedGarageId) {
                // Set syncing BEFORE setUser so ProtectedRoute immediately renders InitialSyncScreen
                setInitialSyncState('syncing');
                setIsGlobalSyncing(true);
            } else {
                setInitialSyncState('ready');
            }

            setUser(userData);
            sessionStorage.setItem('ag_user', JSON.stringify(userData));
            
            if (resolvedGarageId) {
                // DON'T block the login return so UI can show the sync screen while bootstrap runs
                triggerInitialSync(resolvedGarageId, { authMode: (userData as any).authMode });
            }
            
            return { ok: true };
        } catch (error: any) {
            console.error('Login failed', error);
            if (!error?.response || error?.code === 'ECONNABORTED' || error?.message?.includes('Network')) {
                return {
                    ok: false,
                    code: 'BACKEND_UNAVAILABLE',
                    message: 'Servidor local temporalmente inaccesible. Reintente en unos instantes.'
                };
            }
            const status = error.response?.status;
            const code = error.response?.data?.code;
            const serverMsg = error.response?.data?.message || error.response?.data?.error;
            return {
                ok: false,
                code: code || (status === 403 ? 'UNAUTHORIZED_GARAGE' : 'INVALID_CREDENTIALS'),
                message: serverMsg,
                status
            };
        }
    };

    const login = async (username: string, password: string, garage_id?: string): Promise<boolean> => {
        const result = await loginDetailed(username, password, garage_id);
        return result.ok;
    };

    const logout = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setUser(null);
        setIsGlobalSyncing(false);
        setInitialSyncState('idle');
        setReadinessDiagnostics({ hasLocalData: false, missing: [], failedTables: [] });
        sessionStorage.removeItem('ag_user');
        localStorage.removeItem('ag_user');
    };

    // Global Sync Indicator Polling & Reconnection Recovery
    useEffect(() => {
        let interval: number;

        const checkSync = async () => {
            if (!user) return;
            try {
                const res = await api.get('/sync/check');
                setLocalHealth({ state: 'UP' });
                if (res.data.state) {
                    const prevState = prevSyncStateRef.current;
                    const nextState = res.data.state;
                    prevSyncStateRef.current = nextState;
                    setSyncStatus(res.data);

                    if (prevState === 'BACKEND_UNREACHABLE' && nextState !== 'BACKEND_UNREACHABLE') {
                        queryClient.invalidateQueries();
                        window.dispatchEvent(new Event('ag:sync-completed'));
                    }

                    if (initialSyncState === 'ready') {
                        if (res.data.isSyncing !== isGlobalSyncing) {
                            setIsGlobalSyncing(res.data.isSyncing);
                            if (!res.data.isSyncing && isGlobalSyncing) {
                                queryClient.invalidateQueries();
                                window.dispatchEvent(new Event('ag:sync-completed'));
                            }
                        }
                    }
                } else {
                    if (res.data.syncing === false && initialSyncState === 'ready') {
                        if (isGlobalSyncing) {
                            setIsGlobalSyncing(false);
                            queryClient.invalidateQueries();
                            window.dispatchEvent(new Event('ag:sync-completed'));
                        }
                    }
                }
            } catch (err: any) {
                if (!err?.response) {
                    setLocalHealth({ state: 'DOWN' });
                    prevSyncStateRef.current = 'BACKEND_UNREACHABLE';
                    setSyncStatus((prev: any) => ({ ...prev, state: 'BACKEND_UNREACHABLE' }));
                }
            }
        };

        const handleBrowserOnline = () => {
            if (!user) return;
            let garageId = user.garage_id || (user as any).garageId;
            if (!garageId) {
                try {
                    const rawCfg = localStorage.getItem('ag_terminal_config');
                    if (rawCfg) garageId = JSON.parse(rawCfg)?.garage_id;
                } catch {}
            }
            if (!garageId) return;

            if (initialSyncState === 'offline' || initialSyncState === 'error' || initialSyncState === 'timeout') {
                triggerInitialSync(garageId, { forceRemote: true });
                return;
            }

            // Case E: Reconnection during active session — sync in background without blocking UI
            api.post('/sync/background', { garageId }).then(() => {
                queryClient.invalidateQueries();
                window.dispatchEvent(new Event('ag:sync-completed'));
                checkSync();
            }).catch(() => {});
        };

        window.addEventListener('online', handleBrowserOnline);

        if (user && initialSyncState === 'ready') {
            interval = window.setInterval(checkSync, isGlobalSyncing ? 2000 : 5000);
        }

        return () => {
            window.removeEventListener('online', handleBrowserOnline);
            if (interval) window.clearInterval(interval);
        };
    }, [user, isGlobalSyncing, initialSyncState, queryClient]);

    const operatorName = React.useMemo(() => {
        if (!user) return 'Sistema';
        if (user.role === 'OWNER') return user.full_name || 'Owner';
        if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`;
        return user.username || 'Operador';
    }, [user]);

    return (
        <AuthContext.Provider value={{ 
            user, login, loginDetailed, logout, isAuthenticated: !!user, isLoading, isGlobalSyncing, syncStatus, operatorName,
            initialSyncState, readinessDiagnostics, retryInitialSync, continueWithLocalData, localHealth
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
