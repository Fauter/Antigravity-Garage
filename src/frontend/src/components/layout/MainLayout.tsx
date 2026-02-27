import React, { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, Ticket, Wallet, LogOut, User as UserIcon, Eye, Settings, Database, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';


interface MainLayoutProps {
    children: React.ReactNode;
}

const SyncOverlay: React.FC<{ isVisible: boolean }> = ({ isVisible }) => {
    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center overflow-hidden">
            <div className="relative flex flex-col items-center p-12 border border-emerald-500/30 rounded-2xl bg-gray-950/90 shadow-[0_0_80px_-15px_rgba(4,120,87,0.4)]">

                {/* Rotating Elements */}
                <div className="absolute w-40 h-40 border-t-2 border-l-2 border-emerald-500/40 rounded-full animate-spin" style={{ animationDuration: '3s' }}></div>
                <div className="absolute w-32 h-32 border-b-2 border-r-2 border-emerald-400/40 rounded-full animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }}></div>

                <div className="relative bg-black rounded-full p-5 mb-8 border border-emerald-500/20 shadow-inner">
                    <Database className="w-12 h-12 text-emerald-400 animate-pulse" />
                </div>

                <h2 className="text-2xl font-mono font-bold text-emerald-400 tracking-[0.2em] mb-2 animate-pulse text-center">
                    SINCRONIZANDO
                </h2>
                <h3 className="text-xs font-mono text-emerald-500/60 tracking-widest text-center">
                    Pulleando datos...
                </h3>

                <div className="mt-10 flex items-center justify-center gap-3 bg-black/50 px-4 py-2 rounded-full border border-emerald-900/50">
                    <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                    <span className="text-emerald-500/80 font-mono text-[10px] uppercase tracking-wider font-bold">Por favor espere</span>
                </div>
            </div>
        </div>
    );
};

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    // Added 'config' back to activeTab
    const [activeTab, setActiveTab] = useState<'operador' | 'audit' | 'anticipados' | 'abonos' | 'caja' | 'incidentes' | 'config'>('operador');
    const [garageConfig, setGarageConfig] = useState<{ name: string; address: string } | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const location = useLocation();
    const { user, logout, isGlobalSyncing } = useAuth();
    const navigate = useNavigate();

    // Auto-refresh logic when sync completes
    const prevSyncingRef = useRef(isGlobalSyncing);

    useEffect(() => {
        if (prevSyncingRef.current && !isGlobalSyncing) {
            setRefreshKey(prev => prev + 1);
        }
        prevSyncingRef.current = isGlobalSyncing;
    }, [isGlobalSyncing]);

    // Load Terminal Config for Branding
    useEffect(() => {
        const stored = localStorage.getItem('ag_terminal_config');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.name) {
                    setGarageConfig(parsed);
                }
            } catch (e) {
                console.error('Failed to parse terminal config for branding', e);
            }
        }
    }, []);

    // Sync active tab with URL 
    useEffect(() => {
        const path = location.pathname;
        if (path === '/' || path.startsWith('/estadias')) setActiveTab('operador');
        else if (path.startsWith('/audit')) setActiveTab('audit');
        else if (path.startsWith('/anticipados')) setActiveTab('anticipados');
        else if (path.startsWith('/abonos')) setActiveTab('abonos');
        else if (path.startsWith('/caja')) setActiveTab('caja');
        else if (path.startsWith('/incidentes')) setActiveTab('incidentes');
        else if (path.startsWith('/config')) setActiveTab('config');
    }, [location]);

    const handleTabChange = (tab: 'operador' | 'audit' | 'anticipados' | 'abonos' | 'caja' | 'incidentes' | 'config') => {
        setActiveTab(tab);
        if (tab === 'operador') navigate('/');
        if (tab === 'audit') navigate('/audit');
        if (tab === 'anticipados') navigate('/anticipados');
        if (tab === 'abonos') navigate('/abonos');
        if (tab === 'caja') navigate('/caja');
        if (tab === 'incidentes') navigate('/incidentes');
        if (tab === 'config') navigate('/config');
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    // Helper to calculate display name
    const getUserDisplayName = () => {
        if (!user) return 'GUEST';
        if (user.full_name) return user.full_name;
        if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`;
        return user.username;
    };

    return (
        <div className="h-screen overflow-hidden bg-black text-gray-200 font-sans selection:bg-emerald-500/30 flex flex-col">
            <SyncOverlay isVisible={isGlobalSyncing} />

            {/* --- HEADER --- */}
            <header className="h-14 border-b border-gray-800 bg-gray-950 flex items-center justify-between px-4 shrink-0 z-50 relative">

                {/* Brand - Dynamic per Terminal Config and Sync Status */}
                <div className="flex items-center gap-3 flex-1">
                    <div className="flex flex-col justify-center h-full max-w-[250px]">
                        <h1 className="text-white font-bold text-base leading-tight tracking-tight truncate pb-0.5">
                            {garageConfig?.name || 'ANTIGRAVITY'}
                        </h1>
                        <span className="text-[10px] text-gray-500 uppercase tracking-tighter truncate">
                            {garageConfig?.address || 'TERMINAL PROTOTYPE'}
                        </span>
                    </div>

                    {isGlobalSyncing && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-900/20 border border-emerald-500/30 rounded text-emerald-500 font-mono shadow-sm shadow-emerald-900/20 animate-pulse">
                            <span className="animate-spin text-[10px]">🔄</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest pt-0.5">Sincronizando datos...</span>
                        </div>
                    )}
                </div>

                {/* Navigation Tabs Container - Centered */}
                <div className="absolute left-1/2 -translate-x-1/2">
                    <nav className="flex items-center gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-800/50">
                        <NavButton
                            active={activeTab === 'operador'}
                            onClick={() => handleTabChange('operador')}
                            icon={<LayoutDashboard className="w-4 h-4" />}
                            label="Operador"
                        />
                        <NavButton
                            active={activeTab === 'audit'}
                            onClick={() => handleTabChange('audit')}
                            icon={<Eye className="w-4 h-4" />}
                            label="Auditoría"
                        />
                        <NavButton
                            active={activeTab === 'abonos'}
                            onClick={() => handleTabChange('abonos')}
                            icon={<Ticket className="w-4 h-4" />}
                            label="Abonos"
                        />
                        {/* <NavButton
                            active={activeTab === 'anticipados'}
                            onClick={() => handleTabChange('anticipados')}
                            icon={<Clock className="w-4 h-4" />}
                            label="Anticipados"
                        /> */}
                        <NavButton
                            active={activeTab === 'caja'}
                            onClick={() => handleTabChange('caja')}
                            icon={<Wallet className="w-4 h-4" />}
                            label="Caja"
                        />
                        {/* <NavButton
                            active={activeTab === 'incidentes'}
                            onClick={() => handleTabChange('incidentes')}
                            icon={<AlertTriangle className="w-4 h-4" />}
                            label="Incidente"
                        /> */}
                        {/* <NavButton
                            active={activeTab === 'config'}
                            onClick={() => handleTabChange('config')}
                            icon={<Settings className="w-4 h-4" />}
                            label="Config"
                        /> */}
                    </nav>
                </div>

                {/* User & Actions */}
                <div className="flex items-center gap-4 flex-1 justify-end">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 rounded-full border border-gray-800">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${user ? 'bg-emerald-500' : 'bg-gray-500'}`}></div>
                        <UserIcon className="w-3 h-3 text-gray-400" />
                        <span className="text-xs font-mono font-bold text-gray-400 uppercase truncate max-w-[150px]">
                            {getUserDisplayName()}
                        </span>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2 hover:bg-red-900/20 text-gray-500 hover:text-red-400 rounded-lg transition-colors"
                        title="Salir"
                    >
                        <LogOut className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* --- CONTENT AREA --- */}
            <main key={refreshKey} className="flex-1 overflow-auto relative">
                {children}
            </main>
        </div>
    );
};

// Helper component
const NavButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
    <button
        onClick={onClick}
        className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2 ${active
            ? 'bg-gray-800 text-white shadow-sm border border-gray-700'
            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
    >
        {icon}
        <span className="hidden sm:inline">{label}</span>
    </button>
);

export default MainLayout;
