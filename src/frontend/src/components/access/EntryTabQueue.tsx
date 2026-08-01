import React from 'react';
import { useHardware, type PendingEntry } from '../../context/HardwareContext';
import { X, Clock, AlertTriangle } from 'lucide-react';

interface EntryTabQueueProps {
    onTabSelect: (entry: PendingEntry | null) => void;
}

const EntryTabQueue: React.FC<EntryTabQueueProps> = ({ onTabSelect }) => {
    const { state, setActiveTab, removeEntry, pendingCount } = useHardware();
    const { pendingEntries, activeTabIndex } = state;

    if (pendingEntries.length === 0) return null;

    const handleTabClick = (index: number) => {
        setActiveTab(index);
        onTabSelect(pendingEntries[index]);
    };

    const handleDismiss = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        removeEntry(id);
    };

    const handleManualMode = () => {
        setActiveTab(-1);
        onTabSelect(null);
    };

    return (
        <div className="bg-gray-950 border-b border-gray-800 px-2 py-1.5 shrink-0 min-h-[48px] flex items-center overflow-x-auto overflow-y-hidden custom-scrollbar">

            {/* Tabs Row */}
            <div className="flex gap-1 overflow-x-auto pb-1 [&::-webkit-scrollbar]:h-[4px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-thumb]:rounded-full">
                {pendingEntries.map((entry, index) => {
                    const isActive = index === activeTabIndex;
                    const isStale = entry.staleMinutes >= 5;
                    const isCritical = entry.staleMinutes >= 10;

                    return (
                        <button
                            key={entry.id}
                            onClick={() => handleTabClick(index)}
                            className={`
                                relative group flex items-center gap-1.5 px-2 py-1 rounded-lg
                                text-xs font-bold uppercase tracking-wide
                                transition-all duration-200 shrink-0 border
                                ${isActive
                                    ? 'bg-emerald-900/40 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-900/20 scale-105'
                                    : isCritical
                                        ? 'bg-red-900/20 border-red-800/50 text-red-400 animate-pulse'
                                        : isStale
                                            ? 'bg-amber-900/20 border-amber-800/50 text-amber-400'
                                            : 'bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                                }
                            `}
                        >
                            {/* Stale indicator */}
                            {isStale && !isActive && (
                                <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                            )}

                            {/* Tab content */}
                            <span className="font-mono text-[11px]">
                                {entry.ocrStatus === 'DETECTED' ? entry.suggestedPlate 
                                 : entry.ocrStatus === 'NOT_FOUND' ? 'SIN LECTURA' 
                                 : entry.ocrStatus === 'ERROR' ? 'ERROR OCR' 
                                 : (entry.suggestedPlate || `#${index + 1}`)}
                            </span>

                            {/* Time badge */}
                            <span className="flex items-center gap-0.5 opacity-60">
                                <Clock className="w-2.5 h-2.5" />
                                <span className="text-[8px]">
                                    {entry.staleMinutes > 0 ? `${entry.staleMinutes}m` : 'ahora'}
                                </span>
                            </span>

                            {/* Dismiss X */}
                            <span
                                onClick={(e) => handleDismiss(e, entry.id)}
                                className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity
                                           hover:text-red-400 cursor-pointer p-0.5 rounded"
                            >
                                <X className="w-2.5 h-2.5" />
                            </span>
                        </button>
                    );
                })}

                {/* Manual entry tab (always available) */}
                <button
                    onClick={handleManualMode}
                    className={`
                        flex items-center gap-1 px-2 py-1 rounded-lg
                        text-xs font-bold uppercase tracking-wide
                        transition-all shrink-0 border
                        ${activeTabIndex === -1
                            ? 'bg-gray-800 border-gray-600 text-gray-300'
                            : 'bg-gray-900/50 border-gray-800/50 text-gray-600 hover:text-gray-400'
                        }
                    `}
                >
                    + Manual
                </button>
            </div>
        </div>
    );
};

export default EntryTabQueue;
