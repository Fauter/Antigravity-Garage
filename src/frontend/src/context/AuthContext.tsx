import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';

// Updated interface to match Supabase/Backend response
export interface User {
    id: string;
    username: string;
    full_name: string;
    first_name?: string; // Added for display logic
    last_name?: string;  // Added for display logic
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR';
    owner_id: string;
    garage_id?: string | null;
    permissions?: any;
}

interface AuthContextType {
    user: User | null;
    login: (username: string, password: string, garage_id?: string) => Promise<boolean>;
    logout: () => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    isGlobalSyncing: boolean;
    syncStatus: any;
    operatorName: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGlobalSyncing, setIsGlobalSyncing] = useState(false);

    useEffect(() => {
        if (import.meta.env.DEV) {
            console.log('[FRONTEND] Auth state changed:', !!user);
        }
    }, [user]);

    useEffect(() => {
        // Check session storage for persisted session
        const storedUser = sessionStorage.getItem('ag_user');
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                if (parsed.id) {
                    setUser(parsed);
                }
            } catch (e) {
                console.error('Failed to parse stored user', e);
                sessionStorage.removeItem('ag_user');
            }
        }
        setIsLoading(false);
    }, []);

    const login = async (username: string, password: string, garage_id?: string): Promise<boolean> => {
        try {
            // Forward garage_id to backend for Isolation Check
            const res = await api.post('/auth/login', { username, password, garage_id });

            const userData: User = res.data;

            setUser(userData);
            sessionStorage.setItem('ag_user', JSON.stringify(userData));
            setIsGlobalSyncing(true); // Assuming sync started on backend
            
            const resolvedGarageId = garage_id || userData.garage_id || (userData as any).garageId;
            if (resolvedGarageId) {
                api.post('/sync/bootstrap', { garageId: resolvedGarageId }).catch(e => console.error('Bootstrap failed', e));
            } else {
                console.warn('⚠️ No garageId available for bootstrap sync.');
                setIsGlobalSyncing(false);
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
        sessionStorage.removeItem('ag_user');
        localStorage.removeItem('ag_user'); // Fallback cleanup in case of legacy data
    };

    // Global Sync Indicator Polling
    const [syncStatus, setSyncStatus] = useState<any>({ state: 'ONLINE', isSyncing: false, pending: 0, blocked: 0 });

    useEffect(() => {
        let interval: number;

        const checkSync = async () => {
            if (!user) return;
            try {
                const res = await api.get('/sync/check');
                // Phase 0: new status API support
                if (res.data.state) {
                    setSyncStatus(res.data);
                    setIsGlobalSyncing(res.data.isSyncing);
                } else {
                    // Legacy fallback
                    if (res.data.syncing === false) {
                        setIsGlobalSyncing(false);
                    }
                }
            } catch (err) {
                setSyncStatus((prev: any) => ({ ...prev, state: 'BACKEND_UNREACHABLE' }));
                console.error('Failed to check sync', err);
            }
        };

        if (user) {
            // Poll more frequently during initial sync, then back off to every 5 seconds
            interval = window.setInterval(checkSync, isGlobalSyncing ? 2000 : 5000);
        }

        return () => {
            if (interval) window.clearInterval(interval);
        };
    }, [user, isGlobalSyncing]);

    // Compute Operator Name
    const operatorName = React.useMemo(() => {
        if (!user) return 'Sistema';
        if (user.role === 'OWNER') return user.full_name || 'Owner';
        if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`;
        return user.username || 'Operador';
    }, [user]);

    return (
        <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, isLoading, isGlobalSyncing, syncStatus, operatorName }}>
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
