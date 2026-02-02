import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Ticket, Wallet, LogOut, User as UserIcon, Eye, Settings } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';


interface MainLayoutProps {
    children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    // Determine active tab from location if needed, or simple local state if we want single-page feel
    // For now we mix: router for persistent state, but simplified here.
    const [activeTab, setActiveTab] = useState<'operador' | 'abonos' | 'caja' | 'audit' | 'config'>('operador');

    // Sync logic: In a real app we'd adhere strictly to routes
    const location = useLocation();
    useEffect(() => {
        if (location.pathname === '/') setActiveTab('operador');
        else if (location.pathname === '/abonos') setActiveTab('abonos');
        else if (location.pathname === '/caja') setActiveTab('caja');
        else if (location.pathname === '/audit') setActiveTab('audit');
        else if (location.pathname === '/config') setActiveTab('config');
    }, [location]);

    const { user, logout } = useAuth();
    const navigate = useNavigate();

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

    return (
        <div className="h-screen overflow-hidden bg-black text-gray-200 font-sans selection:bg-emerald-500/30 flex flex-col">

            {/* --- HEADER --- */}
            <header className="h-14 border-b border-gray-800 bg-gray-950 flex items-center justify-between px-4 shrink-0 z-50">

                {/* Brand */}
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-900/20">
                        <span className="font-bold text-white text-lg">AG</span>
                    </div>
                    <h1 className="font-bold text-lg tracking-tight text-white hidden md:block">
                        Garage<span className="text-emerald-500">IA</span>
                    </h1>
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
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                        <UserIcon className="w-3 h-3 text-gray-400" />
                        <span className="text-xs font-mono font-bold text-gray-400">
                            {user ? `${user.nombre} ${user.apellido}` : 'GUEST'}
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

// Helper component for clearer code
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
