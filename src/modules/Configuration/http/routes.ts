import { Router } from 'express';
import { ConfigRepository } from '../infra/ConfigRepository.js';
import { db } from '../../../infrastructure/database/datastore.js';

const router = Router();
const configRepo = new ConfigRepository();

// --- READ-ONLY CONFIGURATION ROUTES (Resilient) ---

// 0. PARAMETERS (First to avoid shadowing)
router.get('/parametros', async (req, res) => {
    try {
        const params = await configRepo.getParams();
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

// --- LEGACY/UNUSED (Blocked) ---
router.post('/tarifas', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));
router.put('/tarifas/:id', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));
router.delete('/tarifas/:id', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));
router.post('/parametros', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));
router.put('/precios/:vehiculo', (req, res) => res.status(405).json({ message: 'Configuration is Read-Only' }));

export default router;
