import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import MainLayout from './components/layout/MainLayout';
import OperatorDashboard from './pages/OperatorDashboard';
import LoginPage from './pages/LoginPage';
import GestorAbonos from './components/subscription/GestorAbonos'; // Assuming this is the page for Abonos
import AltaSuscriptor from './pages/AltaSuscriptor';
import CajaPage from './pages/CajaPage';
import AuditoriaVehiculos from './components/audit/AuditoriaVehiculos';
import ConfigPage from './pages/ConfigPage';

// Protected Route Wrapper
const ProtectedRoute = () => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) return <div className="h-screen bg-black flex items-center justify-center text-emerald-500">Cargando...</div>;

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
        <AuthProvider>
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
                        <Route path="/config" element={<ConfigPage />} />
                    </Route>

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Router>
        </AuthProvider>
    );
}

export default App;
