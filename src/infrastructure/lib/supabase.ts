
import { createClient } from '@supabase/supabase-js';

// Helper to get env vars with fallback
const getEnv = (key: string, fallback: string): string => {
    // Check various sources: process.env (Node), import.meta.env (Vite), or fallback
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
        return process.env[key] as string;
    }
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
        // @ts-ignore
        return import.meta.env[key] as string;
    }
    return fallback;
};

// Configuration
export const SUPABASE_URL = getEnv('VITE_SUPABASE_URL', 'https://phugzitegoskgfisxouf.supabase.co');
const SUPABASE_ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_ka-USKd1XuxVHbfXpQh3Gw_MoDb6mP8');

// Initialize Client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
    // Customize fetch to be robust for offline usage if needed, 
    // but supabase-js handles basic retries.
});

console.log('🔗 Supabase Client Initialized:', SUPABASE_URL);
