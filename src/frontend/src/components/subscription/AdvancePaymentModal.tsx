import React from 'react';
import { Calendar, X, ChevronDown, Check, AlertTriangle } from 'lucide-react';
import { ModalPortal } from '../common/ModalPortal';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

export interface AdvancePaymentModalProps {
    isOpen: boolean;
    isSubmitting: boolean;
    nextMonthLabel: string;
    nextPeriodLabel: string;
    currentEndDateStr: string;
    nextEndDateStr: string;
    spotNumber?: string | number | null;
    cocheraType?: string | null;
    vehiclePlate?: string | null;
    vehicleType?: string | null;
    amount: number;
    paymentMethod: string;
    billingType: string;
    priceNotFound?: boolean;
    onPaymentMethodChange: (method: string) => void;
    onBillingTypeChange: (type: string) => void;
    onConfirm: () => void;
    onClose: () => void;
}

export const AdvancePaymentModal: React.FC<AdvancePaymentModalProps> = ({
    isOpen,
    isSubmitting,
    nextMonthLabel,
    nextPeriodLabel,
    currentEndDateStr,
    nextEndDateStr,
    spotNumber,
    cocheraType,
    vehiclePlate,
    vehicleType,
    amount,
    paymentMethod,
    billingType,
    priceNotFound = false,
    onPaymentMethodChange,
    onBillingTypeChange,
    onConfirm,
    onClose
}) => {
    // Body scroll lock via reusable hook
    useBodyScrollLock(isOpen);

    if (!isOpen) return null;

    return (
        <ModalPortal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-gray-900 border border-emerald-500/30 rounded-2xl w-full max-w-md shadow-2xl shadow-emerald-900/20 flex flex-col max-h-[calc(100vh-2rem)] overflow-hidden">
                    {/* Header (Fixed) */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-800 shrink-0 bg-gray-950/40">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-emerald-500" />
                            Pagar {nextMonthLabel}
                        </h3>
                        <button
                            disabled={isSubmitting}
                            onClick={onClose}
                            className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                            title="Cerrar modal"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Body (Scrollable only as emergency fallback, compact by default) */}
                    <div className="p-4 overflow-y-auto space-y-3 flex-1">
                        {/* Cochera & Vehicle Info Card */}
                        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 flex flex-col gap-1.5">
                            <div className="flex justify-between items-center">
                                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Cochera</span>
                                <span className="text-sm font-bold text-white">
                                    {cocheraType === 'Movil' ? 'Cochera Móvil' : `Cochera #${spotNumber || '-'}`}
                                </span>
                            </div>
                            {vehiclePlate && (
                                <div className="flex justify-between items-center text-xs text-gray-300">
                                    <span className="text-gray-500">Vehículo</span>
                                    <span className="font-mono font-semibold">
                                        {vehiclePlate} {vehicleType ? `· ${vehicleType}` : ''}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Coverage Progression Info */}
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex flex-col gap-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-gray-400">Próximo período:</span>
                                <span className="text-emerald-400 font-bold uppercase">{nextPeriodLabel}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-gray-400 pt-1.5 border-t border-emerald-500/10">
                                <span>Cobertura actual:</span>
                                <span className="font-mono text-gray-300">hasta {currentEndDateStr}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-emerald-400 font-medium">
                                <span>Luego del pago:</span>
                                <span className="font-mono font-bold">hasta {nextEndDateStr}</span>
                            </div>
                        </div>

                        {/* Amount Display (Strictly non-editable, no mora) */}
                        <div className="bg-gray-800/80 border border-gray-700 rounded-xl p-3.5 flex justify-between items-center">
                            <div>
                                <span className="block text-[10px] text-gray-400 font-bold uppercase tracking-widest">Importe Total</span>
                                <span className="text-xs text-emerald-400 font-medium">
                                    {priceNotFound ? 'Tarifa no disponible' : 'Tarifa mensual completa'}
                                </span>
                            </div>
                            <div className="text-2xl font-black text-white font-mono tracking-tight">
                                {priceNotFound ? '—' : `$${amount.toLocaleString('es-AR')}`}
                            </div>
                        </div>

                        {/* Selectors Grid (2 Columns) */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* Payment Method Selector */}
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Método de Pago</label>
                                <div className="relative">
                                    <select
                                        disabled={isSubmitting}
                                        value={paymentMethod}
                                        onChange={(e) => onPaymentMethodChange(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white appearance-none focus:outline-none focus:border-emerald-500 text-xs font-medium transition-colors cursor-pointer"
                                    >
                                        <option value="Efectivo">Efectivo</option>
                                        <option value="Transferencia">Transferencia</option>
                                        <option value="QR">QR</option>
                                        <option value="Debito">Débito</option>
                                        <option value="Credito">Crédito</option>
                                    </select>
                                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                            </div>

                            {/* Invoice Type Selector */}
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Facturación</label>
                                <div className="relative">
                                    <select
                                        disabled={isSubmitting}
                                        value={billingType}
                                        onChange={(e) => onBillingTypeChange(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white appearance-none focus:outline-none focus:border-emerald-500 text-xs font-medium transition-colors cursor-pointer"
                                    >
                                        <option value="Final">Consumidor Final</option>
                                        <option value="A">Factura A</option>
                                        <option value="B">Factura B</option>
                                        <option value="X">Comprobante X</option>
                                    </select>
                                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        {priceNotFound && (
                            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <span>No hay una tarifa configurada para este medio de pago.</span>
                            </div>
                        )}
                    </div>

                    {/* Footer (Fixed & Always Visible) */}
                    <div className="p-4 border-t border-gray-800 bg-gray-950/60 shrink-0 flex gap-3">
                        <button
                            disabled={isSubmitting}
                            onClick={onClose}
                            className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-bold uppercase transition-colors disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            disabled={isSubmitting || priceNotFound || amount <= 0}
                            onClick={onConfirm}
                            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20 text-white rounded-xl text-xs font-bold uppercase transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Procesando...
                                </>
                            ) : (
                                <>
                                    <Check className="w-4 h-4" />
                                    Confirmar Pago
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};
