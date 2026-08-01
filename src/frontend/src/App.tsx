import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { HardwareProvider } from './context/HardwareContext';
import MainLayout from './components/layout/MainLayout';
import OperatorDashboard from './pages/OperatorDashboard';
import LoginPage from './pages/LoginPage';
import GestorAbonos from './components/subscription/GestorAbonos';
import AltaSuscriptor from './pages/AltaSuscriptor';
import CajaPage from './pages/CajaPage';
import AuditoriaVehiculos from './components/audit/AuditoriaVehiculos';
import ConfigAuditPage from './pages/ConfigAuditPage'; // New Audit Page

import { useState, useEffect } from 'react';

// Wrapper for Electron Window Controls Overlay
const ElectronWindowShell = ({ children }: { children: React.ReactNode }) => {
    const [isWCO, setIsWCO] = useState(false);

    useEffect(() => {
        const checkWCO = () => {
            if ('windowControlsOverlay' in navigator) {
                // @ts-ignore
                setIsWCO(navigator.windowControlsOverlay.visible);
            } else {
                setIsWCO(false);
            }
        };

        checkWCO();

        if ('windowControlsOverlay' in navigator) {
            // @ts-ignore
            navigator.windowControlsOverlay.addEventListener('geometrychange', checkWCO);
            return () => {
                // @ts-ignore
                navigator.windowControlsOverlay.removeEventListener('geometrychange', checkWCO);
            };
        }
    }, []);

    return (
        <div className="electron-window-shell flex flex-col h-full w-full overflow-hidden bg-black relative" style={{ isolation: 'isolate' }}>
            {isWCO && (
                <div className="electron-titlebar flex-none select-none flex items-center relative z-20" 
                     style={{ 
                         height: 'env(titlebar-area-height, 0px)', 
                         backgroundColor: '#030712', 
                         color: '#E6EDF7'
                     }}>
                    <div className="electron-titlebar-drag-region absolute top-0" style={{ 
                        left: 'env(titlebar-area-x, 0px)', 
                        width: 'env(titlebar-area-width, 100%)', 
                        height: 'env(titlebar-area-height, 0px)', 
                        WebkitAppRegion: 'drag' 
                    }} />
                    <div className="flex items-center gap-2 px-3 relative z-10 pointer-events-none">
                        <img src="/icon.png" alt="icon" className="w-4 h-4 object-contain" />
                        <span className="text-xs font-sans text-gray-200">GarageIA - Control de Estacionamientos</span>
                    </div>
                </div>
            )}
            
            <div className="electron-app-viewport flex-auto min-h-0 min-w-0 overflow-hidden relative z-10" 
                 style={{ 
                     isolation: 'isolate', 
                     transform: 'translateZ(0)' // Limita todos los `fixed inset-0` al rectángulo del viewport
                 }}>
                {children}
            </div>
        </div>
    );
};

// Protected Route Wrapper
const ProtectedRoute = () => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) return <div className="h-full bg-black flex items-center justify-center text-emerald-500">Cargando...</div>;

    return isAuthenticated ? (
        <MainLayout>
            <Outlet />
        </MainLayout>
    ) : (
        <Navigate to="/login" replace />
    );
};

function App() {
    return (
        <ElectronWindowShell>
            <AuthProvider>
                <HardwareProvider>
                    <Router>
                        <Routes>
                            <Route path="/login" element={<LoginPage />} />

                            {/* Protected Routes */}
                            <Route element={<ProtectedRoute />}>
                                <Route path="/" element={<OperatorDashboard />} />
                                <Route path="/abonos" element={<GestorAbonos />} />
                                <Route path="/abonos/alta" element={<AltaSuscriptor />} />
                                <Route path="/caja" element={<CajaPage />} />
                                <Route path="/audit" element={<AuditoriaVehiculos />} />
                                <Route path="/config" element={<ConfigAuditPage />} />
                            </Route>

                            {/* Fallback */}
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </Router>
                </HardwareProvider>
            </AuthProvider>
        </ElectronWindowShell>
    );
}

export default App;

