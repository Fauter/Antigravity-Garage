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
        if (!garageId) return res.json({ standard: {}, electronic: {} });

        const [pricesStandard, pricesElectronic, vehicleTypes, tariffs] = await Promise.all([
            configRepo.getPrices(garageId, 'standard'),
            configRepo.getPrices(garageId, 'electronic'),
            configRepo.getVehicleTypes(garageId),
            configRepo.getTariffs(garageId)
        ]);

        const standardMatrix: Record<string, Record<string, number>> = {};
        const electronicMatrix: Record<string, Record<string, number>> = {};

        const vTypeMap = new Map(vehicleTypes.map((v: any) => [v.id.trim(), v.name]));
        const tariffMap = new Map(tariffs.map((t: any) => [t.id.trim(), t.name]));

        pricesStandard.forEach((p: any) => {
            const vIdRaw = (p.vehicleTypeId || p.vehicle_type_id || '').trim();
            const tIdRaw = (p.tariffId || p.tariff_id || '').trim();
            if (!vIdRaw || !tIdRaw) return;

            const vName = vTypeMap.get(vIdRaw);
            const tName = tariffMap.get(tIdRaw);
            if (vName && tName) {
                const vKey = String(vName);
                const tKey = String(tName);
                if (!standardMatrix[vKey]) standardMatrix[vKey] = {};
                standardMatrix[vKey][tKey] = Number(p.amount ?? p.price ?? 0);
            }
        });

        pricesElectronic.forEach((p: any) => {
            const vIdRaw = (p.vehicleTypeId || p.vehicle_type_id || '').trim();
            const tIdRaw = (p.tariffId || p.tariff_id || '').trim();
            if (!vIdRaw || !tIdRaw) return;

            const vName = vTypeMap.get(vIdRaw);
            const tName = tariffMap.get(tIdRaw);
            if (vName && tName) {
                const vKey = String(vName);
                const tKey = String(tName);
                if (!electronicMatrix[vKey]) electronicMatrix[vKey] = {};
                electronicMatrix[vKey][tKey] = Number(p.amount ?? p.price ?? 0);
            }
        });

        res.json({
            standard: standardMatrix,
            electronic: electronicMatrix
        });
    } catch (e) {
        res.status(500).json({ error: e });
    }
});

// 4. BUILDING LEVELS (Pisos)
router.get('/building-levels', async (req, res) => {
    try {
        const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);
        if (!garageId) return res.json([]);

        let levels: any[] = [];
        const StorageEngine = require('../../../infrastructure/database/StorageEngine').StorageEngine;
        if (StorageEngine.getEngine() === 'SQLITE') {
            const SQLiteManager = require('../../../infrastructure/database/sqlite/SQLiteManager').SQLiteManager;
            const sqliteDb = SQLiteManager.getInstance().getDatabase();
            const rows = sqliteDb.prepare(`SELECT json_data FROM building_levels WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?`).all(garageId, garageId) as any[];
            levels = rows.map(r => JSON.parse(r.json_data));
        } else {
            levels = await db.buildingLevels.find({ garageId });
        }
        
        // Ensure properties for frontend
        levels = levels.map(l => ({
            ...l,
            sortOrder: l.sortOrder ?? l.sort_order ?? 0,
            displayName: l.displayName ?? l.display_name ?? 'Sin nombre'
        }));

        // Sort by sortOrder ascending (Subsuelo -> PB -> Piso 1 -> ...)
        levels.sort((a, b) => a.sortOrder - b.sortOrder);
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

            for (const tariff of contextTariffs as any[]) {
                const tId = (tariff.id || tariff._id || '').trim();
                const tName = tariff.name || tariff.id || tariff._id;

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
