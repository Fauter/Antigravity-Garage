import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';

// Updated interface to match Supabase/Backend response
export interface User {
    id: string;
    username: string;
    full_name: string;
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

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
            return true;
        } catch (error) {
            console.error('Login failed', error);
            return false;
        }
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem('ag_user');
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, isLoading }}>
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
