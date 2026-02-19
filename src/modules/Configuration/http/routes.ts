import { Router } from 'express';
import { ConfigRepository } from '../infra/ConfigRepository.js';

const router = Router();
const configRepo = new ConfigRepository();

// --- READ-ONLY CONFIGURATION ROUTES (Resilient) ---

// 1. TARIFAS
router.get('/tarifas', async (req, res) => {
    try {
        const garageId = (req.query.garageId as string) || (req.headers['x-garage-id'] as string);
        if (!garageId) {
            return res.json([]);
        }
        const tariffs = await configRepo.getTariffs(garageId);
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

        const types = await configRepo.getVehicleTypes(garageId);
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
        const methodFilter = metodoParam ? metodoParam.toUpperCase() : 'EFECTIVO';

        // Fetch Data from Repo (Parallel)
        const [prices, vehicleTypes, tariffs] = await Promise.all([
            configRepo.getPrices(garageId, methodFilter),
            configRepo.getVehicleTypes(garageId),
            configRepo.getTariffs(garageId)
        ]);

        // Transform to Nested Structure: { "Auto": { "Hora": 1000, "Estadia": 5000 } }
        const matrix: Record<string, Record<string, number>> = {};

        // Helper maps for ID -> Name
        const vTypeMap = new Map(vehicleTypes.map(v => [v.id.trim(), v.name]));
        const tariffMap = new Map(tariffs.map(t => [t.id.trim(), t.name]));

        prices.forEach(p => {
            // Ensure IDs exist and are trimmed
            const vId = p.vehicleTypeId ? p.vehicleTypeId.trim() : 'MISSING_VID';
            const tId = p.tariffId ? p.tariffId.trim() : 'MISSING_TID';

            const vName = vTypeMap.get(vId);
            const tName = tariffMap.get(tId);

            if (vName && tName) {
                if (!matrix[vName]) matrix[vName] = {};
                // Use p.amount (repo guarantees this is set)
                matrix[vName][tName] = p.amount;
            } else {
                console.warn(`⚠️ ConfigMatrix Mapping Fail: Price ${p.id} -> VType: ${vId} [${vName || 'NOT_FOUND'}], Tariff: ${tId} [${tName || 'NOT_FOUND'}]`);
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
