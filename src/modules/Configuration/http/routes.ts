import { Router } from 'express';
import { ConfigRepository } from '../infra/ConfigRepository.js';
import { db } from '../../../infrastructure/database/datastore.js';

const router = Router();
const configRepo = new ConfigRepository();

// --- READ-ONLY CONFIGURATION ROUTES (Resilient) ---

// 0. PARAMETERS (First to avoid shadowing)
router.get('/parametros', async (req, res) => {
    try {
        const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);
        const params = await configRepo.getParams(garageId);
        res.json(params);
    } catch (e) {
        res.status(500).json({ error: e });
    }
});

// 1. TARIFAS
router.get('/tarifas', async (req, res) => {
    try {
        const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);
        if (!garageId) {
            return res.json([]);
        }
        // Direct DB Access (Source of Truth: Local Sync)
        const tariffs = await db.tariffs.find({ garageId });
        res.json(tariffs);
    } catch (e) {
        res.status(500).json({ error: e });
    }
});

// 2. VEHICLE TYPES
router.get('/tipos-vehiculo', async (req, res) => {
    try {
        const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);
        if (!garageId) return res.json([]);

        // Direct DB Access (Source of Truth: Local Sync)
        const types: any[] = await db.vehicleTypes.find({ garageId });
        // Filter active only (safe default for frontend)
        const activeTypes = types.filter(t => t.active !== false);
        res.json(activeTypes);
    } catch (e) {
        res.status(500).json({ error: e });
    }
});

// 3. PRECIOS (Matrix)
router.get('/precios', async (req, res) => {
    try {
        const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);
        if (!garageId) return res.json({});

        const metodoParam = req.query.metodo as string;
        // Map UI Method -> Repo Method
        // 'EFECTIVO' -> 'standard', anything else -> 'electronic'
        const listFilter = (metodoParam && metodoParam.toUpperCase() === 'EFECTIVO') ? 'standard' : 'electronic';

        // Fetch Data from Local DB (Sync Source of Truth)
        // We use the local DB because SyncService ensures it's up to date.
        // This avoids round-trips and ensures property consistency (camelCase).
        const [prices, vehicleTypes, tariffs] = await Promise.all([
            db.prices.find({ garageId, priceList: listFilter }),
            db.vehicleTypes.find({ garageId }),
            db.tariffs.find({ garageId })
        ]);

        // Transform to Nested Structure: { "Auto": { "Hora": 1000, "Estadia": 5000 } }
        const matrix: Record<string, Record<string, number>> = {};

        // Helper maps for ID -> Name (Source of Truth: DB Name)
        const vTypeMap = new Map(vehicleTypes.map((v: any) => [v.id.trim(), v.name]));
        const tariffMap = new Map(tariffs.map((t: any) => [t.id.trim(), t.name]));

        if (prices.length === 0) {
            console.warn("⚠️ No local prices found for garage:", garageId);
        }

        prices.forEach((p: any) => {
            // Dual Property Check (Bulletproof: camelCase OR snake_case)
            const vIdRaw = (p.vehicleTypeId || p.vehicle_type_id || '').trim();
            const tIdRaw = (p.tariffId || p.tariff_id || '').trim();

            if (!vIdRaw || !tIdRaw) return;

            // Resolve Name by ID
            const vName = vTypeMap.get(vIdRaw);
            const tName = tariffMap.get(tIdRaw);

            if (vName && tName) {
                const vKey = String(vName);
                const tKey = String(tName);
                if (!matrix[vKey]) matrix[vKey] = {};
                // Use p.amount 
                matrix[vKey][tKey] = Number(p.amount || 0);
            } else {
                // Only warn if IDs are present but not found in maps (avoid noise for phantom records)
                // console.warn(`⚠️ ConfigMatrix Mapping Fail: Price ${p.id} -> VType: ${vIdRaw} [${vName || 'NOT_FOUND'}], Tariff: ${tIdRaw} [${tName || 'NOT_FOUND'}]`);
            }
        });

        res.json(matrix);
    } catch (e) {
        res.status(500).json({ error: e });
    }
});

// 4. BUILDING LEVELS (Pisos)
router.get('/building-levels', async (req, res) => {
    try {
        const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);
        if (!garageId) return res.json([]);

        const levels: any[] = await db.buildingLevels.find({ garageId });
        // Sort by sortOrder ascending (Subsuelo -> PB -> Piso 1 -> ...)
        levels.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        res.json(levels);
    } catch (e) {
        res.status(500).json({ error: e });
    }
});

// 5. PRICE INTEGRITY VALIDATION
router.get('/validacion-precios', async (req, res) => {
    try {
        const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);
        if (!garageId) return res.json([]);

        const tariffType = (req.query.type as string || '').toLowerCase();
        if (!tariffType || !['hora', 'abono', 'turno'].includes(tariffType)) {
            return res.status(400).json({ error: 'Query param "type" is required (hora | abono | turno)' });
        }

        // Normalize helper (accent + case insensitive)
        const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

        // 1. Fetch all required data in parallel
        const [allPrices, vehicleTypes, tariffs] = await Promise.all([
            db.prices.find({ garageId }),
            db.vehicleTypes.find({ garageId }),
            db.tariffs.find({ garageId })
        ]);

        // 2. Filter tariffs by type (normalized comparison)
        const contextTariffs = tariffs.filter((t: any) => normalize(t.type || '') === normalize(tariffType));

        if (contextTariffs.length === 0) {
            // No tariffs of this type exist → all vehicles are valid by default (nothing to check against)
            return res.json(vehicleTypes.filter((v: any) => v.active !== false).map((v: any) => ({
                id: v.id, name: v.name, valid: true, missing: [], referencePrice: 0
            })));
        }

        // 3. Index prices by composite key: "vehicleTypeId|tariffId|priceList"
        const priceIndex = new Map<string, number>();
        allPrices.forEach((p: any) => {
            const vId = (p.vehicleTypeId || p.vehicle_type_id || '').trim();
            const tId = (p.tariffId || p.tariff_id || '').trim();
            const list = (p.priceList || p.price_list || p.method || '').toLowerCase().trim();

            // Normalize priceList: 'standard'/'efectivo' → 'standard', rest → 'electronic'
            let normalizedList = list;
            if (list === 'efectivo' || list === 'standard') normalizedList = 'standard';
            else if (list) normalizedList = 'electronic';

            const key = `${vId}|${tId}|${normalizedList}`;
            priceIndex.set(key, Number(p.amount || 0));
        });

        // 4. Validate each active vehicle type + compute referencePrice
        const activeTypes = vehicleTypes.filter((v: any) => v.active !== false);
        const results = activeTypes.map((vt: any) => {
            const missing: string[] = [];
            const vId = (vt.id || '').trim();
            let stdSum = 0;
            let stdCount = 0;

            for (const tariff of contextTariffs) {
                const tId = (tariff.id || '').trim();
                const tName = tariff.name || tariff.id;

                // Check standard price
                const stdKey = `${vId}|${tId}|standard`;
                const stdAmount = priceIndex.get(stdKey) || 0;
                if (stdAmount <= 0) {
                    missing.push(`${tName} → Standard`);
                } else {
                    stdSum += stdAmount;
                    stdCount++;
                }

                // Check electronic price
                const elecKey = `${vId}|${tId}|electronic`;
                const elecAmount = priceIndex.get(elecKey) || 0;
                if (elecAmount <= 0) {
                    missing.push(`${tName} → Electronic`);
                }
            }

            return {
                id: vId,
                name: String(vt.name),
                valid: missing.length === 0,
                missing,
                referencePrice: stdCount > 0 ? Math.round(stdSum / stdCount) : 0
            };
        });

        res.json(results);
    } catch (e) {
        console.error('Price validation error:', e);
        res.status(500).json({ error: e });
    }
});

// --- LEGACY/UNUSED (Blocked) ---
router.post('/tarifas', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));
router.put('/tarifas/:id', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));
router.delete('/tarifas/:id', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));
router.post('/parametros', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));
router.put('/precios/:vehiculo', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));

export default router;
