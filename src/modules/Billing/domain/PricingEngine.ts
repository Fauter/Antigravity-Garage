// Interfaces for Dependency Injection
interface TariffRepo { getAll(): Promise<any[]> }
interface ParamRepo { getParams(): Promise<any> }
interface PriceRepo { getPrices(method: string): Promise<any> }

interface Chunk { minutes: number; price: number; name: string }

export class PricingEngine {
    private tariffRepo: TariffRepo;
    private paramRepo: ParamRepo;
    private priceRepo: PriceRepo;

    constructor(tariffRepo: TariffRepo, paramRepo: ParamRepo, priceRepo: PriceRepo) {
        this.tariffRepo = tariffRepo;
        this.paramRepo = paramRepo;
        this.priceRepo = priceRepo;
    }

    // --- Helper: Canonical Identity Comparator (Robust String Matching) ---
    private toCanonical(text: string): string {
        return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    }

    // --- Dynamic Parking Logic (DP Optimization) ---
    async calculateParkingFee(
        stay: { entryTime: Date | string; exitTime?: Date | string | null; plate: string; vehicleType?: string },
        exitTime: Date | string,
        paymentMethod: string = 'Efectivo'
    ): Promise<number> {
        // 1. Validation & Setup
        console.log("--- INICIO CÁLCULO ---");
        const rawType = stay.vehicleType || 'Auto';
        console.log("Vehículo buscado:", rawType, "-> Canonical:", this.toCanonical(rawType));

        const start = new Date(stay.entryTime);
        const end = new Date(exitTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
        if (end <= start) return 0;

        const durationMs = end.getTime() - start.getTime();
        const minutesTotal = Math.ceil(durationMs / 60000);

        // 2. Load Configuration (Async)
        // Map UI Payment Methods to Repository Keys
        // Logic: 'Efectivo' -> 'standard', Others -> 'electronic' (handled by ConfigRepo via method arg)
        const repoMethod = paymentMethod === 'Efectivo' ? 'EFECTIVO' : 'ELECTRONIC';

        let tariffs: any[] = [];
        let params: any = { toleranciaInicial: 15, fraccionarDesde: 0 };
        let matrix: any = {};

        // Robust Loading: Fail individually, not collectively
        const [tariffsResult, paramsResult, matrixResult] = await Promise.allSettled([
            this.tariffRepo.getAll(),
            this.paramRepo.getParams(),
            this.priceRepo.getPrices(repoMethod)
        ]);

        if (tariffsResult.status === 'fulfilled') {
            tariffs = tariffsResult.value;
            console.log("Total Tarifas cargadas:", tariffs.length);
        } else {
            console.warn('⚠️ PricingEngine: Failed to load Tariffs', tariffsResult.reason);
        }

        if (paramsResult.status === 'fulfilled') {
            params = paramsResult.value;
        } else {
            console.warn('⚠️ PricingEngine: Failed to load Params. Using defaults (Tol: 15m).', paramsResult.reason);
        }

        if (matrixResult.status === 'fulfilled') {
            matrix = matrixResult.value;
            console.log(`[PricingEngine] Matrix Received (Keys):`, Object.keys(matrix));
        } else {
            console.warn('⚠️ PricingEngine: Failed to load PriceMatrix', matrixResult.reason);
        }

        // 3. Tolerance Logic:
        // User requested to IGNORE tolerance if we are here (calculating payment).
        // If minutesTotal > 0, we must charge at least the minimum unit.
        // if (params.toleranciaInicial > 0 && minutesTotal <= params.toleranciaInicial) {
        //     console.log(`[PricingEngine] Within tolerance (${params.toleranciaInicial}m), but enforcing minimum payment as requested.`);
        // }

        // 4. Resolve Prices for Vehicle

        // Normalize helper: exact match for keys like 'Media Estadía' vs 'Media Estadia'
        // Find vehicle prices object with fuzzy matching
        let vehiclePrices: any = null;

        // 1. Try Exact Match
        if (matrix[rawType]) {
            vehiclePrices = matrix[rawType];
        } else {
            // 2. Try Canonical Match
            const canonicalType = this.toCanonical(rawType);
            const foundKey = Object.keys(matrix).find(k => this.toCanonical(k) === canonicalType);
            if (foundKey) {
                console.log(`[PricingEngine] Fuzzy Match: '${rawType}' -> '${foundKey}'`);
                vehiclePrices = matrix[foundKey];
            } else {
                // 3. Try "Auto" Fallback if original type not found
                if (matrix['Auto']) {
                    console.log(`[PricingEngine] Type '${rawType}' not found. Fallback to 'Auto'.`);
                    vehiclePrices = matrix['Auto'];
                }
            }
        }

        if (!vehiclePrices) {
            console.error(`[PricingEngine] Error: El vehículo '${rawType}' no existe en la matriz recibida. Llaves disponibles: ${Object.keys(matrix)}`);
            return 0;
        }

        console.log("Contenido de vehiclePrices para este vehículo:", JSON.stringify(vehiclePrices, null, 2));

        // 5. Build Combinations (Chunks)
        // 5. Build Combinations (Chunks)
        const chunks: Chunk[] = [];

        for (const t of tariffs) {
            // Debug: Validate what Frontend/Engine is actually processing
            console.log("Tarifa recibida en front:", JSON.stringify(t));

            // Filter: Only process 'hora' type tariffs for parking stays.
            // Data Fix: Property is 'type', not 'tipo'
            if (t.type !== 'hora') continue;

            // Calculate total minutes for this block
            // Data Fix: Properties are days, hours, minutes (Ensure Numbers to prevent NaN)
            const d = Number(t.days || 0);
            const h = Number(t.hours || 0);
            const m = Number(t.minutes || 0);
            const blockMinutes = (d * 1440) + (h * 60) + m;

            console.log(`Analizando Tarifa DB: ${t.name} | Tipo: ${t.type} | D:${d} H:${h} M:${m} -> Total: ${blockMinutes}m`);

            if (isNaN(blockMinutes) || blockMinutes <= 0) {
                console.warn(`[PricingEngine] Invalid duration for tariff ${t.name}: ${blockMinutes}m`);
                continue;
            }

            // Find price for this tariff name with robust matching
            // Data Fix: Property is 'name', not 'nombre'
            let price = vehiclePrices[t.name];
            const canonicalName = this.toCanonical(t.name);

            const priceAttempt = vehiclePrices[t.name];
            const canonicalAttempt = this.toCanonical(t.name);

            console.log("  > Búsqueda directa:", priceAttempt !== undefined ? "OK: " + priceAttempt : "FALLÓ");
            console.log("  > Búsqueda canónica ('" + canonicalAttempt + "'):", Object.keys(vehiclePrices).find(k => this.toCanonical(k) === canonicalAttempt) ? "ENCONTRADA" : "FALLÓ");

            if (price === undefined) {
                // Fuzzy match against keys in vehiclePrices (Verified Robust Match)
                const matchedKey = Object.keys(vehiclePrices).find(k => this.toCanonical(k) === canonicalName);

                if (matchedKey) {
                    price = vehiclePrices[matchedKey];
                    console.log(`[PricingEngine] Tariff Match (Fuzzy): '${t.name}' -> '${matchedKey}'`);
                }
            }

            if (price !== undefined && price !== null) {
                // Ensure price is number
                const numPrice = Number(price);
                if (!isNaN(numPrice)) {
                    chunks.push({ minutes: blockMinutes, price: numPrice, name: t.name });
                    console.log(`[PricingEngine] Linked: ${t.name} -> $${numPrice}`);
                } else {
                    console.warn(`[PricingEngine] Invalid price for ${t.name}: ${price}`);
                }
            } else {
                console.warn(`[PricingEngine] Price not found for tariff '${t.name}' (Canonical: ${canonicalName})`);
            }
        }

        console.log("Chunks finales enviados a optimización:", JSON.stringify(chunks, null, 2));
        if (chunks.length === 0) console.error("ALERTA: No se generaron chunks. El motor no tiene precios válidos para procesar.");

        if (chunks.length === 0) return 0;

        // 6. Run Optimization (DP)
        return this.optimizeCost(minutesTotal, chunks);
    }

    /**
     * Finds the minimum cost to cover at least targetMinutes using available chunks.
     * Uses Unbounded Knapsack-like DP logic (Min Cost).
     */
    private optimizeCost(targetMinutes: number, chunks: Chunk[]): number {
        console.log(`[PricingEngine] Optimizing for ${targetMinutes} minutes. Chunks available:`, chunks.map(c => `${c.name} (${c.minutes}m)=$${c.price}`));

        // Max range: We might overshoot. 
        // Example: Stay 50min. Chunks: 60min ($100).
        // Best is to pay $100 for 60min.
        // We find min cost for i >= targetMinutes.
        // To be safe, buffer by the largest chunk size.
        const maxChunkSize = Math.max(...chunks.map(c => c.minutes));
        const limit = targetMinutes + maxChunkSize;

        // Safety Check: Prevent RangeError if limit is NaN or ridiculous
        if (isNaN(limit) || limit <= 0 || !Number.isFinite(limit)) {
            console.error("[PricingEngine] Invalid limit for optimizeCost:", limit);
            return 0;
        }

        // dp[i] = Min cost to get EXACTLY i minutes capacity (or reachable capacity)
        // Initialize with Infinity
        const dp = new Array(limit + 1).fill(Infinity);
        dp[0] = 0;

        for (let i = 0; i <= limit; i++) {
            if (dp[i] === Infinity) continue;

            for (const chunk of chunks) {
                const next = i + chunk.minutes;
                if (next <= limit) {
                    if (dp[i] + chunk.price < dp[next]) {
                        dp[next] = dp[i] + chunk.price;
                    }
                }
            }
        }

        // Find min cost in range [targetMinutes, limit]
        // This answers "What is the cheapest way to cover AT LEAST startMinutes?"
        let minCost = Infinity;
        for (let i = targetMinutes; i <= limit; i++) {
            if (dp[i] < minCost) {
                minCost = dp[i];
            }
        }

        console.log(`[PricingEngine] Target: ${targetMinutes}m. MinCost found: $${minCost}`);
        return minCost === Infinity ? 0 : minCost;
    }

    // --- Legacy / Subscription Logic (Preserved but adaptable) ---
    static calculateSubscriptionFee(monthlyPrice: number, startDate: Date = new Date()): number {
        return 0; // Placeholder or use legacy logic if needed external to this class
    }

    static calculateSubscriptionProrata(monthlyPrice: number, startDate: Date = new Date()): number {
        const now = new Date(startDate);
        const year = now.getFullYear();
        const month = now.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const dayOfMonth = now.getDate();
        const remainingDays = daysInMonth - dayOfMonth + 1;

        if (remainingDays <= 0) return 0;
        const prorated = (monthlyPrice / daysInMonth) * remainingDays;
        return Math.floor(prorated);
    }

    // --- Surcharge / Debt Logic (Mora Flexible) ---
    static calculateSurcharge(baseAmount: number, config: any = {}): number {
        try {
            const today = new Date().getDate();
            let surchargePercentage = 0;

            // Check if flexible step config exists in surchargeConfig JSON structure
            if (config?.surchargeConfig?.global_default?.steps && Array.isArray(config.surchargeConfig.global_default.steps)) {
                const steps = config.surchargeConfig.global_default.steps;
                if (steps.length > 0) {
                    // Sort descending by day to find the highest applicable threshold
                    const sortedSteps = [...steps].sort((a, b) => b.day - a.day);

                    for (const step of sortedSteps) {
                        if (today >= step.day) {
                            surchargePercentage = Number(step.percentage) || 0;
                            break;
                        }
                    }
                }
            } else {
                // Legacy Fallback
                const rate11 = config?.apartirdia11 != null ? Number(config.apartirdia11) : 0;
                const rate22 = config?.apartirdia22 != null ? Number(config.apartirdia22) : 0;

                if (today >= 22) {
                    surchargePercentage = rate22;
                } else if (today >= 11) {
                    surchargePercentage = rate11;
                }
            }

            if (surchargePercentage === 0) return 0;
            return Math.floor(baseAmount * (surchargePercentage / 100));
        } catch (error) {
            console.error("[PricingEngine] Fallo calculando recargo, devolviendo 0 (Fallback robusto):", error);
            return 0;
        }
    }
}
