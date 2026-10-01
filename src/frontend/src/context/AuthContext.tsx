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

interface AuthContextType {
    user: User | null;
    login: (username: string, password: string, garage_id?: string) => Promise<boolean>;
    logout: () => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    isGlobalSyncing: boolean;
    syncStatus: any;
    operatorName: string;
    
    // Initial Hydration Gate variables
    initialSyncState: InitialSyncState;
    retryInitialSync: () => void;
    continueWithLocalData: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGlobalSyncing, setIsGlobalSyncing] = useState(false);
    const queryClient = useQueryClient();
    
    const [initialSyncState, setInitialSyncState] = useState<InitialSyncState>('idle');
    const [syncStatus, setSyncStatus] = useState<any>({ state: 'ONLINE', isSyncing: false, pending: 0, blocked: 0 });
    
    const abortControllerRef = useRef<AbortController | null>(null);

    const triggerInitialSync = async (garageId: string) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const signal = controller.signal;

        setInitialSyncState('syncing');
        setIsGlobalSyncing(true);
        
        try {
            const hasDataRes = await api.get(`/sync/has-local-data/${garageId}`, { signal });
            if (hasDataRes.data?.hasLocalData) {
                console.log('Local data is usable. Starting UI immediately, syncing in background.');
                setInitialSyncState('ready');
                setIsGlobalSyncing(false);
                api.post('/sync/bootstrap', { garageId, background: true }, { signal }).catch(e => {
                    if (e.name !== 'CanceledError') console.error('Background sync failed:', e);
                });
                return;
            }
        } catch (err: any) {
            if (err.name === 'CanceledError') return;
            console.warn('has-local-data check failed, proceeding to full bootstrap');
        }
        
        let isResolved = false;
        
        // 30 second timeout fallback
        const timeoutTimer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                setInitialSyncState('timeout');
                setIsGlobalSyncing(false);
            }
        }, 30000);

        try {
            await api.post('/sync/bootstrap', { garageId }, { signal });
            if (signal.aborted) return;
            
            if (!isResolved) {
                // Trigger LOCAL CRITICAL WARMUP
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

                isResolved = true;
                clearTimeout(timeoutTimer);
                setInitialSyncState('ready');
                setIsGlobalSyncing(false);
            }
        } catch (error: any) {
            if (signal.aborted) return;
            if (!isResolved) {
                // If it's a network error or 5xx, we might be offline
                if (!error.response || error.response.status >= 500 || error.message.includes('Network')) {
                    // Try to warmup from local SQLite anyway
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
                    } catch (warmupErr) {}

                    isResolved = true;
                    clearTimeout(timeoutTimer);
                    setInitialSyncState('offline');
                    setIsGlobalSyncing(false);
                    setTimeout(() => {
                        setInitialSyncState('ready');
                    }, 2000); // 2s brief notification
                } else {
                    isResolved = true;
                    clearTimeout(timeoutTimer);
                    setInitialSyncState('error');
                    setIsGlobalSyncing(false);
                }
            }
        }
    };

    const retryInitialSync = () => {
        const resolvedGarageId = user?.garage_id || (user as any)?.garageId;
        if (resolvedGarageId) {
            triggerInitialSync(resolvedGarageId);
        }
    };

    const continueWithLocalData = () => {
        setInitialSyncState('ready');
    };

    // Removed Auth state changed dev log

    // Restore persisted session
    useEffect(() => {
        const storedUser = sessionStorage.getItem('ag_user');
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                if (parsed.id) {
                    setUser(parsed);
                    // Persisted session startup! Trigger initial sync
                    const resolvedGarageId = parsed.garage_id || parsed.garageId;
                    if (resolvedGarageId) {
                        triggerInitialSync(resolvedGarageId);
                    } else {
                        setInitialSyncState('ready');
                    }
                }
            } catch (e) {
                console.error('Failed to parse stored user', e);
                sessionStorage.removeItem('ag_user');
                setInitialSyncState('ready');
            }
        } else {
            setInitialSyncState('ready');
        }
        setIsLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const login = async (username: string, password: string, garage_id?: string): Promise<boolean> => {
        try {
            const res = await api.post('/auth/login', { username, password, garage_id });
            const userData: User = res.data;

            setUser(userData);
            sessionStorage.setItem('ag_user', JSON.stringify(userData));
            
            const resolvedGarageId = garage_id || userData.garage_id || (userData as any).garageId;
            if (resolvedGarageId) {
                // DON'T block the login return so UI can show the sync screen
                triggerInitialSync(resolvedGarageId);
            } else {
                setInitialSyncState('ready');
            }
            
            return true;
        } catch (error) {
            console.error('Login failed', error);
            return false;
        }
    };

    const logout = () => {
        setUser(null);
        setIsGlobalSyncing(false);
        setInitialSyncState('idle');
        sessionStorage.removeItem('ag_user');
        localStorage.removeItem('ag_user');
    };

    // Global Sync Indicator Polling
    useEffect(() => {
        let interval: number;

        const checkSync = async () => {
            if (!user) return;
            try {
                const res = await api.get('/sync/check');
                if (res.data.state) {
                    setSyncStatus(res.data);
                    if (initialSyncState === 'ready') {
                        if (res.data.isSyncing !== isGlobalSyncing) {
                            setIsGlobalSyncing(res.data.isSyncing);
                            if (!res.data.isSyncing && isGlobalSyncing) {
                                window.dispatchEvent(new Event('ag:sync-completed'));
                            }
                        }
                    }
                } else {
                    if (res.data.syncing === false && initialSyncState === 'ready') {
                        if (isGlobalSyncing) {
                            setIsGlobalSyncing(false);
                            window.dispatchEvent(new Event('ag:sync-completed'));
                        }
                    }
                }
            } catch (err) {
                setSyncStatus((prev: any) => ({ ...prev, state: 'BACKEND_UNREACHABLE' }));
            }
        };

        if (user && initialSyncState === 'ready') {
            interval = window.setInterval(checkSync, isGlobalSyncing ? 2000 : 5000);
        }

        return () => {
            if (interval) window.clearInterval(interval);
        };
    }, [user, isGlobalSyncing, initialSyncState]);

    const operatorName = React.useMemo(() => {
        if (!user) return 'Sistema';
        if (user.role === 'OWNER') return user.full_name || 'Owner';
        if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`;
        return user.username || 'Operador';
    }, [user]);

    return (
        <AuthContext.Provider value={{ 
            user, login, logout, isAuthenticated: !!user, isLoading, isGlobalSyncing, syncStatus, operatorName,
            initialSyncState, retryInitialSync, continueWithLocalData
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
