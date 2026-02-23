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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGlobalSyncing, setIsGlobalSyncing] = useState(false);

    useEffect(() => {
        // Check local storage for persisted session
        const storedUser = localStorage.getItem('ag_user');
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                if (parsed.id) {
                    setUser(parsed);
                }
            } catch (e) {
                console.error('Failed to parse stored user', e);
                localStorage.removeItem('ag_user');
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
            localStorage.setItem('ag_user', JSON.stringify(userData));
            setIsGlobalSyncing(true); // Assuming sync started on backend
            return true;
        } catch (error) {
            console.error('Login failed', error);
            return false;
        }
    };

    const logout = () => {
        setUser(null);
        setIsGlobalSyncing(false);
        localStorage.removeItem('ag_user');
    };

    // Global Sync Indicator Polling
    useEffect(() => {
        let interval: number;

        const checkSync = async () => {
            if (!user) return;
            try {
                const res = await api.get('/sync/check');
                if (res.data.syncing === false) {
                    setIsGlobalSyncing(false);
                }
            } catch (err) {
                console.error('Failed to check sync', err);
            }
        };

        if (user && isGlobalSyncing) {
            interval = window.setInterval(checkSync, 2000); // Check every 2 seconds
        }

        return () => {
            if (interval) window.clearInterval(interval);
        };
    }, [user, isGlobalSyncing]);

    return (
        <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, isLoading, isGlobalSyncing }}>
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
