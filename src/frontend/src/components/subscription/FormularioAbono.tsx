import React, { useState } from 'react';
import { Save, ArrowLeft, CreditCard, Car, User } from 'lucide-react';

interface FormularioAbonoProps {
    onCancel: () => void;
    onSubmit: (data: any) => Promise<void> | void;
}

const FormularioAbono: React.FC<FormularioAbonoProps> = ({ onCancel, onSubmit }) => {
    // State mirroring the legacy logic
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        cochera: 'Móvil',
        piso: '',
        exclusiva: false,
        nombreApellido: '',
        dni: '',
        email: '',
        telefono: '',
        patente: '',
        marca: '',
        modelo: '',
        color: '',
        tipoVehiculo: '',
        metodoPago: 'Efectivo',
        factura: 'Final'
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        // Checkbox handling logic
        if (e.target.type === 'checkbox') {
            setFormData(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
        } else {
            setFormData(prev => ({ ...prev, [name]: name === 'patente' ? value.toUpperCase() : value }));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Transform data structure to match backend/hook expectation if needed
            // The hook expects: customer: {}, vehicle: {}, billing: {}
            // But here we have flat structure. Let's map it.
            const payload = {
                customer: {
                    nombreApellido: formData.nombreApellido,
                    dni: formData.dni,
                    email: formData.email,
                    telefono: formData.telefono
                },
                vehicle: {
                    plate: formData.patente,
                    brand: formData.marca,
                    model: formData.modelo,
                    type: formData.tipoVehiculo || 'Auto', // Default
                    color: formData.color
                },
                billing: {
                    method: formData.metodoPago,
                    invoiceType: formData.factura,
                    parkingType: formData.cochera
                }
            };

            await onSubmit(payload);
        } catch (error) {
            console.error("Error submitting form", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-800 bg-gray-800/50 flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">Alta de Nuevo Suscriptor</h3>
                <button onClick={onCancel} className="text-gray-400 hover:text-white transition-colors flex items-center gap-2 text-sm">
                    <ArrowLeft className="w-4 h-4" /> Cancelar
                </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-8">

                {/* Section 1: Personal Data */}
                <section>
                    <h4 className="flex items-center gap-2 text-indigo-400 font-semibold mb-4 text-sm uppercase tracking-wider">
                        <User className="w-4 h-4" /> Datos Personales
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <InputGroup label="Nombre y Apellido" name="nombreApellido" value={formData.nombreApellido} onChange={handleChange} required />
                        <InputGroup label="DNI / CUIT" name="dni" value={formData.dni} onChange={handleChange} required />
                        <InputGroup label="Email" name="email" type="email" value={formData.email} onChange={handleChange} required />
                        <InputGroup label="Teléfono" name="telefono" value={formData.telefono} onChange={handleChange} />
                    </div>
                </section>

                <div className="border-t border-gray-800"></div>

                {/* Section 2: Vehicle Data */}
                <section>
                    <h4 className="flex items-center gap-2 text-emerald-400 font-semibold mb-4 text-sm uppercase tracking-wider">
                        <Car className="w-4 h-4" /> Vehículo & Cochera
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Patente highlighted */}
                        <div className="lg:col-span-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Patente</label>
                            <input
                                type="text"
                                name="patente"
                                value={formData.patente}
                                onChange={handleChange}
                                className="w-full bg-gray-950 border-2 border-emerald-900/50 rounded-lg px-4 py-2.5 text-emerald-400 font-mono font-bold text-center tracking-widest focus:border-emerald-500 outline-none uppercase"
                                placeholder="AAA-000"
                                maxLength={10}
                                required
                            />
                        </div>
                        <InputGroup label="Marca" name="marca" value={formData.marca} onChange={handleChange} />
                        <InputGroup label="Modelo" name="modelo" value={formData.modelo} onChange={handleChange} />

                        <div className="space-y-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Tipo</label>
                            <select name="tipoVehiculo" value={formData.tipoVehiculo} onChange={handleChange} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none">
                                <option value="">Seleccione...</option>
                                <option value="Auto">Auto</option>
                                <option value="Moto">Moto</option>
                                <option value="Camioneta">Camioneta</option>
                            </select>
                        </div>

                        <div className="space-y-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Cochera</label>
                            <select name="cochera" value={formData.cochera} onChange={handleChange} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none">
                                <option value="Móvil">Móvil</option>
                                <option value="Fija">Fija</option>
                            </select>
                        </div>
                        <InputGroup label="Piso / N°" name="piso" value={formData.piso} onChange={handleChange} disabled={formData.cochera !== 'Fija'} />
                    </div>
                </section>

                <div className="border-t border-gray-800"></div>

                {/* Section 3: Billing */}
                <section>
                    <h4 className="flex items-center gap-2 text-orange-400 font-semibold mb-4 text-sm uppercase tracking-wider">
                        <CreditCard className="w-4 h-4" /> Facturación
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-lg">
                        <div className="space-y-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Método Pago</label>
                            <select name="metodoPago" value={formData.metodoPago} onChange={handleChange} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none">
                                <option value="Efectivo">Efectivo</option>
                                <option value="Transferencia">Transferencia</option>
                                <option value="Débito">Débito</option>
                                <option value="Crédito">Crédito</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Tipo Factura</label>
                            <select name="factura" value={formData.factura} onChange={handleChange} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none">
                                <option value="CC">CC</option>
                                <option value="A">A</option>
                                <option value="Final">Final</option>
                            </select>
                        </div>
                    </div>
                </section>

                {/* Actions */}
                <div className="pt-6 flex justify-end gap-4">
                    <button type="button" onClick={onCancel} className="px-6 py-3 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className={`px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg shadow-indigo-900/50 flex items-center gap-2 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <Save className="w-5 h-5" />
                        {loading ? 'Guardando...' : 'Guardar Suscriptor'}
                    </button>
                </div>

            </form>
        </div>
    );
};

// Helper Input Component
const InputGroup = ({ label, name, value, onChange, type = "text", required = false, disabled = false }: any) => (
    <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">{label} {required && '*'}</label>
        <input
            type={type}
            name={name}
            value={value}
            onChange={onChange}
            disabled={disabled}
            className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
    </div>
);

export default FormularioAbono;
