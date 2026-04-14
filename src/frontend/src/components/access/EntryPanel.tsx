import React, { useEffect } from 'react';
import { useEntryLogic } from '../../hooks/useEntryLogic';
import { useAuth } from '../../context/AuthContext';
import { useHardware, type PendingEntry } from '../../context/HardwareContext';
import EntryTabQueue from './EntryTabQueue';
import { Car, CheckCircle, AlertTriangle, Camera } from 'lucide-react';

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
        plateInputRef
    } = useEntryLogic();

    const { isGlobalSyncing } = useAuth();
    const { state, activeEntry, removeEntry, updateEntry, pendingCount } = useHardware();

    // ── Sync form fields with active tab ──
    useEffect(() => {
        if (activeEntry) {
            setPlate(activeEntry.confirmedPlate || activeEntry.suggestedPlate || '');
            if (activeEntry.vehicleTypeId) {
                setVehicleType(activeEntry.vehicleTypeId);
            }
        }
    }, [activeEntry?.id]); // Only when active tab changes

    // ── When entry is confirmed, remove from queue ──
    useEffect(() => {
        if (isSuccess && activeEntry) {
            // Small delay so user sees the success feedback
            const timer = setTimeout(() => {
                removeEntry(activeEntry.id);
            }, 800);
            return () => clearTimeout(timer);
        }
    }, [isSuccess, activeEntry?.id]);

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
        } else {
            // Manual mode — clear form
            setPlate('');
            setVehicleType('');
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800 font-sans overflow-hidden">

            {/* COMPACT HEADER */}
            <div className="px-3 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
                <div className="flex items-center gap-2 text-emerald-500">
                    <Car className="w-4 h-4" />
                    <h2 className="text-sm font-bold tracking-wide uppercase">Ingreso</h2>
                    {pendingCount > 0 && (
                        <span className="bg-amber-500/20 text-amber-400 text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center animate-pulse">
                            {pendingCount}
                        </span>
                    )}
                </div>
            </div>

            {/* TAB QUEUE (only visible when there are pending entries) */}
            <EntryTabQueue onTabSelect={handleTabSelect} />

            {/* Content Container */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* Camera / Photo Area */}
                <div className="h-40 bg-black flex items-center justify-center border-b border-gray-800 shrink-0 relative">
                    {activeEntry ? (
                        // Hardware entry: show photo placeholder with ANPR data
                        <div className="flex flex-col items-center gap-1">
                            <Camera className="w-8 h-8 text-emerald-500/50" />
                            <span className="text-emerald-400/80 font-mono text-xs font-bold">
                                CAPTURA ANPR
                            </span>
                            {activeEntry.suggestedPlate && (
                                <span className="text-white/60 font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded">
                                    OCR: {activeEntry.suggestedPlate}
                                </span>
                            )}
                        </div>
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
                <div className="flex-1 p-6 flex flex-col justify-center gap-4">
                    <form onSubmit={handleSubmit} className="space-y-4">

                        {/* Plate Input */}
                        <div>
                            <label className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-1 block">
                                Patente
                                {activeEntry && (
                                    <span className="text-emerald-500/60 ml-2 normal-case tracking-normal">
                                        (verificar OCR)
                                    </span>
                                )}
                            </label>
                            <input
                                ref={plateInputRef}
                                type="text"
                                value={plate}
                                onChange={(e) => handlePlateChange(e.target.value.toUpperCase())}
                                placeholder="AAA-000"
                                className={`w-full h-14 bg-gray-800 border-2 rounded-xl text-center text-3xl font-mono text-white font-bold outline-none uppercase transition-colors ${errorInfo?.isConflict
                                    ? 'border-red-500 focus:border-red-400'
                                    : activeEntry
                                        ? 'border-emerald-700 focus:border-emerald-500'
                                        : 'border-gray-700 focus:border-emerald-500'
                                    }`}
                                maxLength={7}
                                autoFocus
                            />
                        </div>

                        {/* Vehicle Type Dropdown */}
                        <div>
                            <label className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-1 block">Tipo Vehículo</label>
                            <div className="relative">
                                <select
                                    value={vehicleType}
                                    onChange={(e) => handleVehicleTypeChange(e.target.value)}
                                    className="w-full h-12 bg-gray-800 border border-gray-700 rounded-xl px-4 text-white text-lg appearance-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
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

                        {/* Action Button */}
                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={!plate || plate.trim().length < 3 || !vehicleType || isLoading || isGlobalSyncing}
                                className={`w-full h-14 rounded-xl font-bold text-xl uppercase tracking-wide flex items-center justify-center gap-3 transition-all ${(!plate || plate.trim().length < 3 || !vehicleType || isGlobalSyncing)
                                    ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'
                                    }`}
                            >
                                {isLoading ? '...' : isGlobalSyncing ? 'Sincronizando...' : 'Dar Entrada'}
                                {!isLoading && !isGlobalSyncing && <CheckCircle className="w-5 h-5" />}
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
