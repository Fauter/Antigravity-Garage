import React, { useEffect, useState, useRef } from 'react';
import { useEntryLogic } from '../../hooks/useEntryLogic';
import { useAuth } from '../../context/AuthContext';
import { useHardware, type PendingEntry } from '../../context/HardwareContext';
import EntryTabQueue from './EntryTabQueue';
import { Car, CheckCircle, AlertTriangle, Camera, Clock, Lock } from 'lucide-react';

const EntryPanel: React.FC = () => {
    const {
        plate,
        setPlate,
        vehicleType,
        setVehicleType,
        vehicleTypes,
        handleSubmit,
        isLoading,
        isSuccess,
        errorInfo,
        photoPath,
        setPhotoPath,
        plateInputRef,
        // Prepaid / Anticipado
        isPrepaid,
        setIsPrepaid,
        prepaidTariffId,
        setPrepaidTariffId,
        prepaidPaymentMethod,
        setPrepaidPaymentMethod,
        prepaidInvoiceType,
        setPrepaidInvoiceType,
        turnoTariffs,
        pricesStd,
        pricesElec,
        promos,
        selectedPromo,
        setSelectedPromo
    } = useEntryLogic();

    const { isGlobalSyncing } = useAuth();
    const { state, activeEntry, removeEntry, updateEntry, pendingCount } = useHardware();

    // ── Anti-Crush Sensor State + Barrier LED ──
    const [sensorState, setSensorState] = useState<'OCCUPIED' | 'CLEAR' | 'UNKNOWN'>('UNKNOWN');
    const [barrierState, setBarrierState] = useState<'OPEN' | 'CLOSED' | 'UNKNOWN'>('CLOSED');
    const isSensorBlocked = sensorState === 'OCCUPIED';

    useEffect(() => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) return;

        // Listen for sensor state changes
        const cleanupSensor = electronAPI.onSensorStateChanged?.((payload: { state: string }) => {
            setSensorState(payload.state as 'OCCUPIED' | 'CLEAR' | 'UNKNOWN');
        });

        // Listen for hardware status changes (includes barrier state)
        const cleanupStatus = electronAPI.onHardwareStatusChanged?.((status: any) => {
            if (status?.entryBarrierState) setBarrierState(status.entryBarrierState);
            if (status?.sensorState) setSensorState(status.sensorState);
        });

        // Fetch initial state
        electronAPI.getHardwareStatus?.().then((status: any) => {
            if (status?.sensorState) setSensorState(status.sensorState);
            if (status?.entryBarrierState) setBarrierState(status.entryBarrierState);
        });

        return () => {
            if (cleanupSensor) cleanupSensor();
            if (cleanupStatus) cleanupStatus();
        };
    }, []);

    // ── Sync form fields with active tab ──
    useEffect(() => {
        if (activeEntry) {
            setPlate(activeEntry.confirmedPlate || activeEntry.suggestedPlate || '');
            if (activeEntry.vehicleTypeId) {
                setVehicleType(activeEntry.vehicleTypeId);
            }
            setPhotoPath(activeEntry.photoPath || '');
        }
    }, [activeEntry?.id]); // Only when active tab changes

    const submittedEntryIdRef = useRef<string | null>(null);

    const onFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        submittedEntryIdRef.current = activeEntry?.id ?? null;
        await handleSubmit(e);
    };

    // ── When entry is confirmed, remove from queue ──
    useEffect(() => {
        if (isSuccess && submittedEntryIdRef.current) {
            const targetEntryId = submittedEntryIdRef.current;
            // Small delay so user sees the success feedback
            const timer = setTimeout(() => {
                removeEntry(targetEntryId);
                if (submittedEntryIdRef.current === targetEntryId) {
                    submittedEntryIdRef.current = null;
                }
            }, 800);
            return () => clearTimeout(timer);
        }
    }, [isSuccess, removeEntry]);

    // ── Sync plate changes back to context ──
    const handlePlateChange = (value: string) => {
        setPlate(value);
        if (activeEntry) {
            updateEntry(activeEntry.id, { confirmedPlate: value });
        }
    };

    const handleVehicleTypeChange = (value: string) => {
        setVehicleType(value);
        if (activeEntry) {
            updateEntry(activeEntry.id, { vehicleTypeId: value });
        }
    };

    const handleTabSelect = (entry: PendingEntry | null) => {
        if (entry) {
            setPlate(entry.confirmedPlate || entry.suggestedPlate || '');
            if (entry.vehicleTypeId) setVehicleType(entry.vehicleTypeId);
            else setVehicleType('');
            setPhotoPath(entry.photoPath || '');
        } else {
            // Manual mode — clear form
            setPlate('');
            setVehicleType('');
            setPhotoPath('');
        }
    };

    const isBaseInvalid = !plate || plate.trim().length < 3 || !vehicleType || isLoading || isGlobalSyncing || isSensorBlocked;
    const isPrepaidInvalid = isPrepaid && (!prepaidTariffId || !prepaidPaymentMethod || !prepaidInvoiceType);
    const isFormInvalid = isBaseInvalid || isPrepaidInvalid;
    const vehicleName = vehicleTypes.find((v: any) => String(v.id) === String(vehicleType))?.name || 'Auto';

    let rawPrice: number | null = null;
    let hasStdPrice = true;
    let hasElecPrice = true;
    if (prepaidTariffId) {
        const selectedTariff = turnoTariffs.find((t: any) => String(t.id) === String(prepaidTariffId));
        if (selectedTariff) {
            hasStdPrice = (pricesStd[vehicleName]?.[selectedTariff.name] || 0) > 0;
            hasElecPrice = (pricesElec[vehicleName]?.[selectedTariff.name] || 0) > 0;
            
            if (prepaidPaymentMethod) {
                rawPrice = prepaidPaymentMethod === 'Efectivo' 
                    ? (pricesStd[vehicleName]?.[selectedTariff.name] || 0)
                    : (pricesElec[vehicleName]?.[selectedTariff.name] || 0);
            }
        }
    }
    const finalPrice = rawPrice !== null ? (selectedPromo ? rawPrice * (1 - selectedPromo.porcentaje / 100) : rawPrice) : null;

    return (
        <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800 font-sans overflow-hidden">

            {/* COMPACT HEADER */}
            <div className="px-3 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-500">
                        <Car className="w-4 h-4" />
                        <h2 className="text-sm font-bold tracking-wide uppercase">Ingreso</h2>
                        {pendingCount > 0 && (
                            <span className="bg-amber-500/20 text-amber-400 text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center animate-pulse">
                                {pendingCount}
                            </span>
                        )}
                    </div>
                    {/* Status LED */}
                    <div
                        className={`w-2.5 h-2.5 rounded-full border transition-all duration-500 ${barrierState === 'OPEN'
                                ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_8px_2px_rgba(16,185,129,0.5)]'
                                : 'bg-red-500/40 border-red-500/50'
                            }`}
                        title={`Barrera: ${barrierState}`}
                    />
                </div>
            </div>

            {/* TAB QUEUE (only visible when there are pending entries) */}
            <EntryTabQueue onTabSelect={handleTabSelect} />

            {/* Content Container */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* Camera / Photo Area */}
                <div className="relative flex-1 flex items-center justify-center bg-black border-b border-gray-800 transition-all duration-300 overflow-hidden min-h-[60px]">
                    {activeEntry ? (
                        // Renderizar imagen
                        activeEntry.photoPath && (activeEntry.photoPath.startsWith('data:image') || activeEntry.photoPath.startsWith('garagemedia://')) ? (
                            <>
                                <img
                                    src={activeEntry.photoPath}
                                    alt="Captura ANPR"
                                    className="absolute inset-0 w-full h-full object-cover opacity-80 rounded-sm"
                                />
                                <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1 shadow-2xl">
                                    <span className="text-emerald-400 font-mono text-[10px] bg-black/90 px-2 py-0.5 rounded border border-emerald-500/50 uppercase tracking-wider backdrop-blur-sm">
                                        Captura ANPR
                                    </span>
                                    {activeEntry.ocrStatus === 'DETECTED' && activeEntry.suggestedPlate && (
                                        <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded border backdrop-blur-sm ${activeEntry.ocrConfidence && activeEntry.ocrConfidence < 0.5 ? 'text-amber-300 bg-amber-900/90 border-amber-500/80' : 'text-white bg-emerald-900/90 border-emerald-500/80'}`}>
                                            OCR: {activeEntry.suggestedPlate} {activeEntry.ocrConfidence ? `· ${Math.round(activeEntry.ocrConfidence * 100)}%` : ''}
                                        </span>
                                    )}
                                    {activeEntry.ocrStatus === 'NOT_FOUND' && (
                                        <span className="text-amber-300 font-mono text-xs font-bold bg-amber-900/90 px-2 py-0.5 rounded border border-amber-500/80 backdrop-blur-sm">
                                            OCR: No se detectó patente
                                        </span>
                                    )}
                                    {activeEntry.ocrStatus === 'ERROR' && (
                                        <span className="text-red-300 font-mono text-xs font-bold bg-red-900/90 px-2 py-0.5 rounded border border-red-500/80 backdrop-blur-sm" title={activeEntry.ocrMessage}>
                                            OCR: Error
                                        </span>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center gap-1">
                                <Camera className="w-8 h-8 text-emerald-500/50" />
                                <span className="text-emerald-400/80 font-mono text-xs font-bold">
                                    CAPTURA ANPR
                                </span>
                                {activeEntry.ocrStatus === 'DETECTED' && activeEntry.suggestedPlate && (
                                    <span className={`font-mono text-[10px] px-2 py-0.5 rounded ${activeEntry.ocrConfidence && activeEntry.ocrConfidence < 0.5 ? 'text-amber-300/80 bg-white/5' : 'text-white/60 bg-white/5'}`}>
                                        OCR: {activeEntry.suggestedPlate} {activeEntry.ocrConfidence ? `· ${Math.round(activeEntry.ocrConfidence * 100)}%` : ''}
                                    </span>
                                )}
                                {activeEntry.ocrStatus === 'NOT_FOUND' && (
                                    <span className="text-amber-300/80 font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded">
                                        OCR: No se detectó patente
                                    </span>
                                )}
                                {activeEntry.ocrStatus === 'ERROR' && (
                                    <span className="text-red-300/80 font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded" title={activeEntry.ocrMessage}>
                                        OCR: Error
                                    </span>
                                )}
                            </div>
                        )
                    ) : (
                        <>
                            <span className="text-gray-700 font-mono text-xs">
                                {pendingCount > 0 ? 'SELECCIONE UNA PESTAÑA' : 'MODO MANUAL'}
                            </span>
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-500/5 to-transparent opacity-30 pointer-events-none animate-scan"></div>
                        </>
                    )}
                </div>

                {/* Form Area */}
                <div className="shrink-0 px-2 py-1.5 flex flex-col justify-end bg-gray-900 z-10">
                    <form onSubmit={onFormSubmit} className={`flex flex-col transition-all duration-300 ${isPrepaid ? 'gap-1' : 'gap-3'}`}>

                        {/* Plate Input */}
                        <div>
                            <label className={`text-gray-500 font-bold uppercase tracking-widest block transition-all ${isPrepaid ? 'text-[9px] mb-0' : 'text-xs mb-1'}`}>
                                Patente
                            </label>
                            <input
                                ref={plateInputRef}
                                type="text"
                                value={plate}
                                onChange={(e) => handlePlateChange(e.target.value.toUpperCase())}
                                placeholder="AAA-000"
                                className={`w-full bg-gray-800 border-2 rounded-xl text-center font-mono text-white font-bold outline-none uppercase transition-colors duration-300 ${errorInfo?.isConflict ? 'border-red-500' : activeEntry ? 'border-emerald-700' : 'border-gray-700'} ${isPrepaid ? 'h-9 text-lg' : 'h-12 text-2xl'}`}
                                maxLength={7}
                                autoFocus
                            />
                        </div>

                        {/* Vehicle Type Dropdown */}
                        <div>
                            <label className={`text-gray-500 font-bold uppercase tracking-widest block transition-all ${isPrepaid ? 'text-[9px] mb-0' : 'text-xs mb-1'}`}>Tipo Vehículo</label>
                            <div className="relative">
                                <select
                                    value={vehicleType}
                                    onChange={(e) => handleVehicleTypeChange(e.target.value)}
                                    className={`w-full bg-gray-800 border border-gray-700 rounded-xl px-2 text-white appearance-none outline-none transition-colors duration-300 ${isPrepaid ? 'h-8 text-xs' : 'h-10 text-sm'}`}
                                >
                                    <option value="" disabled>Seleccione el tipo...</option>
                                    {vehicleTypes.map((type: any) => (
                                        <option key={type.id} value={type.id} disabled={type.disabled}>{type.label}</option>
                                    ))}
                                </select>
                                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-gray-400">
                                    ▼
                                </div>
                            </div>
                        </div>

                        {/* ── Prepaid / Anticipado Toggle ── */}
                        <div className="pt-1">
                            <button
                                type="button"
                                onClick={() => setIsPrepaid(!isPrepaid)}
                                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg border transition-all duration-200 ${isPrepaid
                                        ? 'bg-amber-900/30 border-amber-600/50 text-amber-400'
                                        : 'bg-gray-800/50 border-gray-700/50 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Pago Anticipado</span>
                                </div>
                                {/* iOS-style toggle */}
                                <div className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${isPrepaid ? 'bg-amber-500' : 'bg-gray-700'
                                    }`}>
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-200 ${isPrepaid ? 'translate-x-5' : 'translate-x-0.5'
                                        }`} />
                                </div>
                            </button>

                            {/* Expandable Prepaid Options */}
                            <div className={`overflow-hidden transition-all duration-300 ease-in-out flex flex-col gap-1.5 ${isPrepaid ? 'max-h-60 opacity-100 mt-1' : 'max-h-0 opacity-0 mt-0'}`}>
                                <div className="bg-gray-900 border border-gray-800 rounded-lg p-1.5 space-y-1 relative">
                                    {/* OVERLAY DE BLOQUEO */}
                                    {!vehicleType && (
                                        <div className="absolute inset-0 z-10 bg-gray-950/80 backdrop-blur-[1px] rounded-lg flex flex-col items-center justify-center border border-gray-800">
                                            <Lock className="w-4 h-4 text-amber-500/50 mb-1"/>
                                            <span className="text-[9px] text-amber-500/70 font-bold uppercase tracking-widest text-center">
                                                Seleccione un vehículo<br/>para cotizar
                                            </span>
                                        </div>
                                    )}

                                    {/* Tariff Select */}
                                    <div>
                                        <label className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1 block">Tarifa Anticipada</label>
                                        <select
                                            value={prepaidTariffId}
                                            onChange={(e) => setPrepaidTariffId(e.target.value)}
                                            className={`w-full h-7 bg-gray-800 border border-gray-700 rounded-lg px-1.5 text-[10px] appearance-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none ${!prepaidTariffId ? 'text-gray-400' : 'text-white'}`}
                                        >
                                            <option value="" disabled>Seleccione bloque...</option>
                                            {turnoTariffs.map((t: any) => {
                                                const pStd = pricesStd[vehicleName]?.[t.name] || 0;
                                                const pElec = pricesElec[vehicleName]?.[t.name] || 0;

                                                let isDisabled = false;
                                                if (prepaidPaymentMethod === 'Efectivo') isDisabled = pStd <= 0;
                                                else if (prepaidPaymentMethod) isDisabled = pElec <= 0;
                                                else isDisabled = (pStd <= 0 && pElec <= 0);

                                                return <option key={t.id} value={t.id} disabled={isDisabled}>{t.name}{isDisabled ? ' (Sin precio)' : ''}</option>;
                                            })}
                                        </select>
                                    </div>

                                    {/* Payment Method + Invoice in a row */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1 block">Medio Pago</label>
                                            <select
                                                value={prepaidPaymentMethod}
                                                onChange={(e) => setPrepaidPaymentMethod(e.target.value)}
                                                className={`w-full h-7 bg-gray-800 border border-gray-700 rounded-lg px-1.5 text-[10px] appearance-none focus:border-amber-500 outline-none ${!prepaidPaymentMethod ? 'text-gray-400' : 'text-white'}`}
                                            >
                                                <option value="" disabled>Método...</option>
                                                <option value="Efectivo" disabled={!hasStdPrice}>Efectivo</option>
                                                <option value="Transferencia" disabled={!hasElecPrice}>Transf.</option>
                                                <option value="Debito" disabled={!hasElecPrice}>Débito</option>
                                                <option value="Credito" disabled={!hasElecPrice}>Crédito</option>
                                                <option value="QR" disabled={!hasElecPrice}>QR</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1 block">Factura</label>
                                            <select
                                                value={prepaidInvoiceType}
                                                onChange={(e) => setPrepaidInvoiceType(e.target.value)}
                                                className={`w-full h-7 bg-gray-800 border border-gray-700 rounded-lg px-1.5 text-[10px] appearance-none focus:border-amber-500 outline-none ${!prepaidInvoiceType ? 'text-gray-400' : 'text-white'}`}
                                            >
                                                <option value="" disabled>Factura...</option>
                                                <option value="Final">Final</option>
                                                <option value="A">A</option>
                                                <option value="CC">CC</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Financial Block (Total & Promos) */}
                                    <div className="bg-gray-950 border border-gray-800 rounded-lg p-1 px-2 flex justify-between items-center gap-2 mt-0.5 shadow-inner">
                                        <div>
                                            <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Total a Pagar</div>
                                            <div className={`text-xl font-black drop-shadow-md ${finalPrice !== null ? 'text-white' : 'text-gray-700'}`}>
                                                {finalPrice !== null ? `$${Math.round(finalPrice)}` : '$-'}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1 block text-right">Descuento / Promo</label>
                                            <select
                                                value={selectedPromo?.id || ''}
                                                onChange={(e) => {
                                                    const p = promos.find((pr: any) => String(pr.id) === e.target.value);
                                                    setSelectedPromo(p || null);
                                                }}
                                                className="w-32 h-6 bg-gray-800 border border-gray-700 rounded-lg px-1 text-[9px] appearance-none focus:border-amber-500 outline-none text-white text-right"
                                            >
                                                <option value="">Ninguno</option>
                                                {promos.map((p: any) => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.name} (-{p.porcentaje}%)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Button */}
                        <div>
                            <button
                                type="submit"
                                disabled={isFormInvalid}
                                className={`w-full rounded-xl font-bold uppercase tracking-wide flex items-center justify-center gap-2 transition-all shrink-0 ${isFormInvalid ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : (isPrepaid ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30')} ${isPrepaid ? 'h-9 text-xs mt-1' : 'h-12 text-lg mt-2'}`}
                            >
                                {isLoading ? '...' : isGlobalSyncing ? 'Sincronizando...' : isPrepaid ? 'Cobrar y Dar Entrada' : 'Dar Entrada'}
                                {!isLoading && !isGlobalSyncing && (isPrepaid ? <Clock className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />)}
                            </button>
                        </div>

                    </form>

                    {/* Feedback */}
                    {isSuccess && (
                        <div className="p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-lg text-emerald-400 text-center text-xs font-bold">
                            ENTRADA REGISTRADA
                        </div>
                    )}
                    {errorInfo && (
                        <div className={`p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-center text-xs font-bold flex items-center justify-center gap-2 ${errorInfo.isConflict ? 'animate-shake' : ''
                            }`}>
                            {errorInfo.isConflict && <AlertTriangle className="w-4 h-4 shrink-0" />}
                            {errorInfo.message}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-gray-800 flex justify-between text-[10px] text-gray-600 font-mono tracking-widest shrink-0">
                <span>FRONT-01</span>
                <span>{state.hardwareConnected ? '🟢 HW' : 'MANUAL'}</span>
            </div>

        </div>
    );
};

export default EntryPanel;
