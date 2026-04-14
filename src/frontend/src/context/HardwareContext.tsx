import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export interface PendingEntry {
    id: string;                 // Event UUID from hardware
    timestamp: string;          // ISO string
    photoPath: string;          // Local file path to captured photo
    suggestedPlate: string;     // ANPR OCR suggestion
    confirmedPlate: string;     // What the operator types (starts as suggestedPlate)
    vehicleTypeId: string;      // Selected by operator
    status: 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'DISMISSED';
    staleMinutes: number;       // Minutes since creation (updated by timer)
}

interface HardwareState {
    pendingEntries: PendingEntry[];
    activeTabIndex: number;     // -1 = manual entry mode, 0+ = tab index
    hardwareConnected: boolean;
    lastEventAt: string | null;
}

type HardwareAction =
    | { type: 'ADD_PENDING_ENTRY'; payload: PendingEntry }
    | { type: 'UPDATE_ENTRY'; payload: { id: string; changes: Partial<PendingEntry> } }
    | { type: 'REMOVE_ENTRY'; payload: string }
    | { type: 'SET_ACTIVE_TAB'; payload: number }
    | { type: 'SET_HW_CONNECTED'; payload: boolean }
    | { type: 'UPDATE_STALE_TIMES' }
    | { type: 'AUTO_DISMISS_STALE'; payload: number }; // max minutes

interface HardwareContextType {
    state: HardwareState;
    dispatch: React.Dispatch<HardwareAction>;
    // Convenience methods
    addEntry: (event: any) => void;
    updateEntry: (id: string, changes: Partial<PendingEntry>) => void;
    removeEntry: (id: string) => void;
    setActiveTab: (index: number) => void;
    activeEntry: PendingEntry | null;
    pendingCount: number;
}

// ── Reducer ────────────────────────────────────────────────────────

const initialState: HardwareState = {
    pendingEntries: [],
    activeTabIndex: -1,
    hardwareConnected: false,
    lastEventAt: null,
};

function hardwareReducer(state: HardwareState, action: HardwareAction): HardwareState {
    switch (action.type) {
        case 'ADD_PENDING_ENTRY': {
            const newEntries = [...state.pendingEntries, action.payload];
            return {
                ...state,
                pendingEntries: newEntries,
                // Auto-select the new tab if we're in manual mode
                activeTabIndex: state.activeTabIndex === -1 ? 0 : state.activeTabIndex,
                lastEventAt: action.payload.timestamp,
            };
        }

        case 'UPDATE_ENTRY': {
            return {
                ...state,
                pendingEntries: state.pendingEntries.map(e =>
                    e.id === action.payload.id
                        ? { ...e, ...action.payload.changes }
                        : e
                ),
            };
        }

        case 'REMOVE_ENTRY': {
            const filtered = state.pendingEntries.filter(e => e.id !== action.payload);
            let newIndex = state.activeTabIndex;

            // Adjust active tab index
            if (filtered.length === 0) {
                newIndex = -1; // Back to manual mode
            } else if (newIndex >= filtered.length) {
                newIndex = filtered.length - 1;
            }

            return {
                ...state,
                pendingEntries: filtered,
                activeTabIndex: newIndex,
            };
        }

        case 'SET_ACTIVE_TAB':
            return { ...state, activeTabIndex: action.payload };

        case 'SET_HW_CONNECTED':
            return { ...state, hardwareConnected: action.payload };

        case 'UPDATE_STALE_TIMES': {
            const now = Date.now();
            return {
                ...state,
                pendingEntries: state.pendingEntries.map(e => ({
                    ...e,
                    staleMinutes: Math.floor((now - new Date(e.timestamp).getTime()) / 60000),
                })),
            };
        }

        case 'AUTO_DISMISS_STALE': {
            const maxMinutes = action.payload;
            const filtered = state.pendingEntries.filter(e => e.staleMinutes < maxMinutes);

            if (filtered.length === state.pendingEntries.length) return state;

            let newIndex = state.activeTabIndex;
            if (filtered.length === 0) {
                newIndex = -1;
            } else if (newIndex >= filtered.length) {
                newIndex = filtered.length - 1;
            }

            return {
                ...state,
                pendingEntries: filtered,
                activeTabIndex: newIndex,
            };
        }

        default:
            return state;
    }
}

// ── Context ────────────────────────────────────────────────────────

const HardwareContext = createContext<HardwareContextType | undefined>(undefined);

export const HardwareProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [state, dispatch] = useReducer(hardwareReducer, initialState);

    // ── Stale timer: update ages every 30s ──
    useEffect(() => {
        const interval = window.setInterval(() => {
            dispatch({ type: 'UPDATE_STALE_TIMES' });
            dispatch({ type: 'AUTO_DISMISS_STALE', payload: 30 }); // Auto-dismiss after 30 min
        }, 30_000);

        return () => window.clearInterval(interval);
    }, []);

    // ── IPC: Listen for hardware entry events ──
    useEffect(() => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) return;

        // Listen for entry events
        const cleanupEntry = electronAPI.onHardwareEntry?.((event: any) => {
            const pending: PendingEntry = {
                id: event.id,
                timestamp: event.timestamp,
                photoPath: event.photoPath,
                suggestedPlate: event.suggestedPlate || '',
                confirmedPlate: event.suggestedPlate || '', // Pre-fill with suggestion
                vehicleTypeId: '',
                status: 'PENDING',
                staleMinutes: 0,
            };

            dispatch({ type: 'ADD_PENDING_ENTRY', payload: pending });

            // Audio alert
            try {
                const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU' +
                    'oGAACAgICAgICAgICAgIB/f39/f39/f39/gICBgoOEhYaHiImKi4yNjo+QkZKTlJWWl5iZmpucnZ6f');
                audio.volume = 0.3;
                audio.play().catch(() => { });
            } catch { }
        });

        // Listen for status changes
        const cleanupStatus = electronAPI.onHardwareStatusChanged?.((status: any) => {
            // Unify status: if barrier or camera goes down, we might want to show disconnected
            // For now, we consider it connected if the main driver is up
            const isConnected = status.entryBarrierOnline || status.exitBarrierOnline || status.cameraOnline;
            dispatch({ type: 'SET_HW_CONNECTED', payload: isConnected });
        });

        // Fetch initial status
        electronAPI.getHardwareStatus?.().then((status: any) => {
            if (status) {
                const isConnected = status.entryBarrierOnline || status.exitBarrierOnline || status.cameraOnline;
                dispatch({ type: 'SET_HW_CONNECTED', payload: isConnected });
            }
        });

        return () => {
            if (cleanupEntry) cleanupEntry();
            if (cleanupStatus) cleanupStatus();
        };
    }, []);

    // ── Convenience Methods ──
    const addEntry = useCallback((event: any) => {
        const pending: PendingEntry = {
            id: event.id,
            timestamp: event.timestamp,
            photoPath: event.photoPath,
            suggestedPlate: event.suggestedPlate || '',
            confirmedPlate: event.suggestedPlate || '',
            vehicleTypeId: '',
            status: 'PENDING',
            staleMinutes: 0,
        };
        dispatch({ type: 'ADD_PENDING_ENTRY', payload: pending });
    }, []);

    const updateEntry = useCallback((id: string, changes: Partial<PendingEntry>) => {
        dispatch({ type: 'UPDATE_ENTRY', payload: { id, changes } });
    }, []);

    const removeEntry = useCallback((id: string) => {
        dispatch({ type: 'REMOVE_ENTRY', payload: id });
    }, []);

    const setActiveTab = useCallback((index: number) => {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: index });
    }, []);

    // Active entry based on tab selection
    const activeEntry = state.activeTabIndex >= 0 && state.activeTabIndex < state.pendingEntries.length
        ? state.pendingEntries[state.activeTabIndex]
        : null;

    const pendingCount = state.pendingEntries.filter(e => e.status === 'PENDING').length;

    return (
        <HardwareContext.Provider value={{
            state,
            dispatch,
            addEntry,
            updateEntry,
            removeEntry,
            setActiveTab,
            activeEntry,
            pendingCount,
        }}>
            {children}
        </HardwareContext.Provider>
    );
};

export const useHardware = () => {
    const context = useContext(HardwareContext);
    if (context === undefined) {
        throw new Error('useHardware must be used within a HardwareProvider');
    }
    return context;
};
