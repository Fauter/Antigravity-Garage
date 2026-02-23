import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Ticket, Wallet, LogOut, User as UserIcon, Eye, Settings } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';


interface MainLayoutProps {
    children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    // Added 'config' back to activeTab
    const [activeTab, setActiveTab] = useState<'operador' | 'abonos' | 'caja' | 'audit' | 'config'>('operador');
    const [garageConfig, setGarageConfig] = useState<{ name: string; address: string } | null>(null);

    const location = useLocation();
    const { user, logout, isGlobalSyncing } = useAuth();
    const navigate = useNavigate();

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
        else if (path.startsWith('/abonos')) setActiveTab('abonos');
        else if (path.startsWith('/caja')) setActiveTab('caja');
        else if (path.startsWith('/audit')) setActiveTab('audit');
        else if (path.startsWith('/config')) setActiveTab('config');
    }, [location]);

    const handleTabChange = (tab: 'operador' | 'abonos' | 'caja' | 'audit' | 'config') => {
        setActiveTab(tab);
        if (tab === 'operador') navigate('/');
        if (tab === 'abonos') navigate('/abonos');
        if (tab === 'caja') navigate('/caja');
        if (tab === 'audit') navigate('/audit');
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

            {/* --- HEADER --- */}
            <header className="h-14 border-b border-gray-800 bg-gray-950 flex items-center justify-between px-4 shrink-0 z-50">

                {/* Brand - Dynamic per Terminal Config and Sync Status */}
                <div className="flex items-center gap-3 w-1/3">
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

                {/* Navigation Tabs */}
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
                    <NavButton
                        active={activeTab === 'caja'}
                        onClick={() => handleTabChange('caja')}
                        icon={<Wallet className="w-4 h-4" />}
                        label="Caja"
                    />
                    {/* RESTORED Config Button */}
                    <NavButton
                        active={activeTab === 'config'}
                        onClick={() => handleTabChange('config')}
                        icon={<Settings className="w-4 h-4" />}
                        label="Config"
                    />
                </nav>

                {/* User & Actions */}
                <div className="flex items-center gap-4">
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
            <main className="flex-1 overflow-auto relative">
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
