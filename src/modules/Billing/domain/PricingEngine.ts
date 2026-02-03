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

    // --- Dynamic Parking Logic (DP Optimization) ---
    async calculateParkingFee(
        stay: { entryTime: Date | string; exitTime?: Date | string | null; plate: string; vehicleType?: string },
        exitTime: Date | string,
        paymentMethod: string = 'Efectivo'
    ): Promise<number> {
        // 1. Validation & Setup
        const start = new Date(stay.entryTime);
        const end = new Date(exitTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
        if (end <= start) return 0;

        const durationMs = end.getTime() - start.getTime();
        const minutesTotal = Math.ceil(durationMs / 60000);

        // 2. Load Configuration (Async)
        // Map UI Payment Methods to Repository Keys ('efectivo' | 'otros')
        const repoMethod = paymentMethod === 'Efectivo' ? 'efectivo' : 'otros';

        const [tariffs, params, matrix] = await Promise.all([
            this.tariffRepo.getAll(),
            this.paramRepo.getParams(),
            this.priceRepo.getPrices(repoMethod)
        ]);

        // 3. Tolerance Logic:
        // User requested to IGNORE tolerance if we are here (calculating payment).
        // If minutesTotal > 0, we must charge at least the minimum unit.
        // if (params.toleranciaInicial > 0 && minutesTotal <= params.toleranciaInicial) {
        //     console.log(`[PricingEngine] Within tolerance (${params.toleranciaInicial}m), but enforcing minimum payment as requested.`);
        // }

        // 4. Resolve Prices for Vehicle
        const type = stay.vehicleType || 'Auto';

        // Normalize helper: exact match for keys like 'Media Estadía' vs 'Media Estadia'
        const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        // Find vehicle prices object with fuzzy matching
        let vehiclePrices: any = null;
        // Try exact match first
        if (matrix[type]) {
            vehiclePrices = matrix[type];
        } else {
            // Try normalized match
            const normalizedType = normalize(type);
            const foundKey = Object.keys(matrix).find(k => normalize(k) === normalizedType);
            if (foundKey) vehiclePrices = matrix[foundKey];
        }

        // Fallback to 'Auto' if still not found
        if (!vehiclePrices && matrix['Auto']) {
            console.log(`[PricingEngine] Vehicle type '${type}' not found. Falling back to 'Auto'.`);
            vehiclePrices = matrix['Auto'];
        }

        if (!vehiclePrices) {
            console.warn(`[PricingEngine] No prices found for '${type}' and no fallback.`);
            return 0;
        }

        // 5. Build Combinations (Chunks)
        const chunks: Chunk[] = [];

        for (const t of tariffs) {
            // Filter: Only process 'hora' type tariffs for parking stays.
            // Ignore 'turno', 'abono', or other types as requested.
            if (t.tipo !== 'hora') continue;

            // Calculate total minutes for this block
            const blockMinutes = (t.dias * 1440) + (t.horas * 60) + t.minutos;
            if (blockMinutes <= 0) continue;

            // Find price for this tariff name with fuzzy matching
            let price = vehiclePrices[t.nombre];
            if (price === undefined) {
                const normalizedTariffName = normalize(t.nombre);
                const foundPriceKey = Object.keys(vehiclePrices).find(k => normalize(k) === normalizedTariffName);
                if (foundPriceKey) price = vehiclePrices[foundPriceKey];
            }

            if (price !== undefined && price !== null) {
                // Ensure price is number
                const numPrice = Number(price);
                if (!isNaN(numPrice)) {
                    chunks.push({ minutes: blockMinutes, price: numPrice, name: t.nombre });
                }
            }
        }

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
}
