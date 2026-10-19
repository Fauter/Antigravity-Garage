const fs = require('fs');
let content = fs.readFileSync('src/frontend/src/components/layout/MainLayout.tsx', 'utf8');

const targetStr = \                        {localHealth?.state === 'DOWN' ? (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/40 border border-amber-600/50 rounded text-amber-500 font-mono shadow-sm cursor-pointer" title="El servidor local dejó de responder">
                                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">ERROR LOCAL · BACKEND NO DISPONIBLE</span>
                            </div>
                        ) : localHealth?.state === 'SQLITE_ERROR' ? (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-900/30 border border-red-700/50 rounded text-red-500 font-mono shadow-sm cursor-pointer" title="Error crítico en base de datos local">
                                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">ERROR BASE LOCAL</span>
                            </div>
                        ) : (syncStatus?.state === 'BACKEND_UNREACHABLE' || syncStatus?.state === 'CLOUD_UNREACHABLE' || syncStatus?.state === 'OFFLINE') ? (
                            // @ts-ignore
                            syncStatus?.pending > 0 ? (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/30 border border-amber-700/50 rounded text-amber-500 font-mono shadow-sm cursor-pointer" title={\\ pendientes - Terminal offline\}>
                                    <WifiOff className="w-3.5 h-3.5" />
                                    {/* @ts-ignore */}
                                    <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">OFFLINE · {syncStatus?.pending} PEND.</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-lime-900/30 border border-lime-700/50 rounded text-lime-500 font-mono shadow-sm cursor-pointer" title="Terminal offline - Modo Local Operativo">
                                    <WifiOff className="w-3.5 h-3.5" />
                                    <span className="text-[10px] uppercase tracking-widest pt-0.5 font-bold">SIN INTERNET · LOCAL OK</span>
                                </div>
                            )\;

// Replace from {localHealth?.state === 'DOWN' ? ( up to the ) after LOCAL OK
content = content.replace(/\{localHealth\?\.state === 'DOWN' \? \([\s\S]*?SIN INTERNET · LOCAL OK<\/span>\s*<\/div>\s*\)/, targetStr);
// And in case the previous replacement left duplicates:
content = content.replace(/\{localHealth\?\.state === 'DOWN' \? \([\s\S]*?\{localHealth\?\.state === 'DOWN' \? \(/, "{localHealth?.state === 'DOWN' ? (");

fs.writeFileSync('src/frontend/src/components/layout/MainLayout.tsx', content, 'utf8');
