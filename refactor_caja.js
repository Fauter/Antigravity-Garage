const fs = require('fs');
let code = fs.readFileSync('src/frontend/src/pages/CajaPage.tsx', 'utf-8');

// We will do precise replacements to avoid breaking the 1200 lines file.

// 1. State changes
code = code.replace(
    /const \[reprintItems, setReprintItems\] = useState<ReprintItem\[\]>\(\[\]\);\s*const \[reprintLoading, setReprintLoading\] = useState\(false\);\s*const \[reprintSearch, setReprintSearch\] = useState\(''\);\s*const \[reprintingId, setReprintingId\] = useState<string \| null>\(null\);/,
    \const [reprintItems, setReprintItems] = useState<ReprintItem[]>([]);
    const [reprintLoading, setReprintLoading] = useState(false);
    const [reprintSearch, setReprintSearch] = useState('');
    const [reprintingId, setReprintingId] = useState<string | null>(null);
    const [reprintOffset, setReprintOffset] = useState(0);
    const [hasMoreReprint, setHasMoreReprint] = useState(true);
    const REPRINT_LIMIT = 50;\
);

// 2. Remove recentStays and the old build effect
code = code.replace(
    /const \[recentStays, setRecentStays\] = useState<RecentStay\[\]>\(\[\]\);\s*useEffect\(\(\) => \{\s*if \(isReprintModalOpen\) \{\s*loadReprintData\(\);\s*\}\s*\}, \[isReprintModalOpen\]\);[\s\S]*?setReprintItems\(items\);\s*\}, \[recentStays, rawMovements\]\);/,
    \// Load reprint data when modal opens or offset changes
    useEffect(() => {
        if (isReprintModalOpen) {
            loadReprintData(reprintOffset === 0);
        }
    }, [isReprintModalOpen, reprintOffset]);

    // Handle Search debounce
    useEffect(() => {
        if (!isReprintModalOpen) return;
        const delayDebounceFn = setTimeout(() => {
            setReprintOffset(0);
            loadReprintData(true);
        }, 500);
        return () => clearTimeout(delayDebounceFn);
    }, [reprintSearch]);

    const loadReprintData = async (reset = false) => {
        setReprintLoading(true);
        try {
            const currentOffset = reset ? 0 : reprintOffset;
            const res = await api.get(\\\/reimpresion/buscar?limit=\&offset=\&search=\\\\);
            const data = res.data || [];
            if (reset) {
                setReprintItems(data);
            } else {
                setReprintItems(prev => [...prev, ...data]);
            }
            setHasMoreReprint(data.length === REPRINT_LIMIT);
        } catch (error) {
            console.error('Error loading reprint items:', error);
            toast.error('Error al cargar tickets');
        } finally {
            setReprintLoading(false);
        }
    };\
);

// 3. Update handleReprintExit to use item._stay
code = code.replace(
    /const handleReprintExit = \(item: ReprintItem\) => \{[\s\S]*?PrinterService\.printExitTicket\(stayForPrint, movementForPrint\);\s*toast\.success\(\Reimprimiendo Ticket Salida: \$\{mov\.plate\}\\);\s*\};/,
    \const handleReprintExit = (item: ReprintItem) => {
        const mov = item._movement;
        if (!mov) {
            toast.error('Datos de movimiento no disponibles para reimpresión');
            return;
        }

        const matchingStay = item._stay;
        if (!matchingStay) {
            toast.error('No se encontraron los datos originales necesarios para reimprimir este ticket.');
            return;
        }

        // Parse duration from notes if contains "Por Xhs" pattern
        let durationNote = mov.notes || 'N/A';
        const durationMatch = mov.notes?.match(/Por\\s+(\\d+[\\w\\s]*)/i);
        if (durationMatch) {
            durationNote = durationMatch[0];
        }

        const movementForPrint: any = {
            ...mov,
            notes: durationNote,
            amount: mov.amount,
            paymentMethod: mov.paymentMethod || mov.payment_method || 'N/A',
            operator: mov.operator || 'Sys',
            receipt_number: mov.receipt_number || mov.ticket_code,
        };

        PrinterService.printExitTicket(matchingStay, movementForPrint);
        toast.success(\\\Reimprimiendo Ticket Salida: \\\\);
    };\
);

// 4. Update handleReprintEntry to use Prepaid if necessary
code = code.replace(
    /const handleReprintEntry = \(item: ReprintItem\) => \{[\s\S]*?toast\.success\(\Reimprimiendo Ticket Entrada: \$\{stay\.plate\}\\);\s*\};/,
    \const handleReprintEntry = (item: ReprintItem) => {
        const stay = item._stay;
        if (!stay) {
            toast.error('Datos de estadía no disponibles para reimpresión');
            return;
        }
        
        if (stay.is_prepaid || stay.isPrepaid) {
            const mov = item._movement || {};
            PrinterService.printPrepaidEntryTicket(stay, mov, 'Pago Anticipado');
            toast.success(\\\Reimprimiendo Ticket Anticipado: \\\\);
        } else {
            PrinterService.printEntryTicket(stay);
            toast.success(\\\Reimprimiendo Ticket Entrada: \\\\);
        }
    };\
);

// 5. Update filteredReprintItems logic
code = code.replace(
    /\/\/ Filtered reprint items by search\s*const filteredReprintItems = reprintSearch\.trim\(\)[\s\S]*?: reprintItems;/,
    \const filteredReprintItems = reprintItems;\
);

// 6. Update JSX to include "Mostrar anteriores"
code = code.replace(
    /\{filteredReprintItems\.map\(item => \([\s\S]*?\}\)\}/,
    \{filteredReprintItems.map(item => (
                                        <div
                                            key={item.id}
                                            className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/60 transition-colors group"
                                        >
                                            <div className="w-[80px] shrink-0">
                                                {getReprintTypeBadge(item.type)}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-white text-base tracking-wide">
                                                        {item.plate}
                                                    </span>
                                                    <span className="text-slate-500 text-xs">
                                                        {new Date(item.timestamp).toLocaleString('es-AR', {
                                                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                                                        })}
                                                    </span>
                                                </div>
                                                {item.type !== 'Entrada' && (
                                                    <div className="flex items-center gap-3 mt-1">
                                                        <span className="text-emerald-400 font-medium text-sm">
                                                            $\u00A0{formatMoney(item.amount || 0)}
                                                        </span>
                                                        {item.paymentMethod && (
                                                            <span className="text-slate-400 text-xs flex items-center gap-1 bg-slate-800/50 px-2 py-0.5 rounded-md">
                                                                <Wallet className="w-3 h-3" />
                                                                {item.paymentMethod}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            <button
                                                onClick={() => handleReprint(item)}
                                                disabled={reprintingId === item.id}
                                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-bold hover:bg-sky-500/20 hover:border-sky-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed group-hover:bg-sky-500/20"
                                            >
                                                {reprintingId === item.id ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <Printer className="w-3.5 h-3.5" />
                                                )}
                                                Reimprimir
                                            </button>
                                        </div>
                                    ))}
                                    {hasMoreReprint && (
                                        <div className="pt-2 pb-4 flex justify-center">
                                            <button
                                                onClick={() => setReprintOffset(prev => prev + REPRINT_LIMIT)}
                                                disabled={reprintLoading}
                                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors border border-slate-700 hover:text-white flex items-center gap-2"
                                            >
                                                {reprintLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                                Mostrar anteriores
                                            </button>
                                        </div>
                                    )}\
);

// 7. Remove onChange trigger from Actualizar button
code = code.replace(
    /onClick=\{loadReprintData\}/,
    \onClick={() => { setReprintOffset(0); loadReprintData(true); }}\
);

// 8. Remove autoFocus and value-only from input
// The actual rendering logic of the input was mostly kept above, I just need to make sure the debounce does not clash with React controlled inputs. Actually React handles it fine.

fs.writeFileSync('src/frontend/src/pages/CajaPage.tsx', code);
