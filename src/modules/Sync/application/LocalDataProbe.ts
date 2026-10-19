/**
 * LocalDataProbe
 *
 * Backs `GET /api/sync/has-local-data/:garageId`, consumed by
 * `AuthContext.triggerInitialSync()` to decide between:
 *   - hasLocalData=true  -> open the UI immediately, sync in background
 *   - hasLocalData=false -> block on the initial bootstrap screen
 *
 * Contract:
 *   - 100% LOCAL: reads SQLite only. Never touches Supabase / network, so it
 *     answers identically with or without Internet.
 *   - HTTP 200 for both true and false. A "no" is a valid answer, not an error.
 *   - HTTP 400 only for a malformed garageId (client error).
 *
 * "Usable local data" (all must hold; failing any => false => the client
 * falls back to the safe full bootstrap):
 *   1. the garage row exists locally,
 *   2. at least one sync checkpoint exists for this garage, i.e. a pull
 *      completed successfully on THIS terminal at some point,
 *   3. operational config is present for this garage: vehicle_types, tariffs
 *      and prices (without them neither entry nor pricing can work).
 *
 * The check is deliberately conservative: false merely costs a bootstrap,
 * while a false positive would open the UI on an empty/partial database.
 */

export const GARAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface LocalDataChecks {
    garageRow: boolean;
    vehicleTypes: boolean;
    tariffs: boolean;
    prices: boolean;
    bootstrapCompleted?: boolean;
}

export interface LocalDataResult {
    hasLocalData: boolean;
    isBootstrapComplete?: boolean;
    engine?: 'SQLITE' | 'NEDB';
    checks: LocalDataChecks;
    missing?: string[];
}

export const CORE_TRANSACTIONAL_TABLES = [
    'customers',
    'subscriptions',
    'vehicles',
    'stays',
    'cocheras',
    'debts',
    'movements',
    'shift_closes',
    'partial_closes',
] as const;

export function isValidGarageId(garageId: unknown): garageId is string {
    return typeof garageId === 'string' && GARAGE_ID_PATTERN.test(garageId);
}

function configRowExists(db: any, table: 'vehicle_types' | 'tariffs' | 'prices', garageId: string): boolean {
    // Table name comes from a closed union above, never from user input.
    const row = db.prepare(
        `SELECT 1 AS present FROM ${table}
          WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?
          LIMIT 1`
    ).get(garageId, garageId);
    return !!row;
}

function evaluateSqliteBootstrapCompletion(
    db: any,
    garageId: string,
    baseConfigPresent: boolean
): boolean {
    try {
        const incompleteRow = db.prepare(
            `SELECT 1 AS present FROM sync_checkpoints WHERE collection_name = ? LIMIT 1`
        ).get(`${garageId}__bootstrap_incomplete`);
        if (incompleteRow) {
            return false;
        }

        const completeRow = db.prepare(
            `SELECT 1 AS present FROM sync_checkpoints WHERE collection_name = ? LIMIT 1`
        ).get(`${garageId}__bootstrap_complete`);
        if (completeRow) {
            return true;
        }

        const checkpointRows = db.prepare(
            `SELECT collection_name FROM sync_checkpoints WHERE collection_name LIKE ?`
        ).all(`${garageId}_%`) as Array<{ collection_name: string }>;

        if (checkpointRows.length > 0) {
            const existingSet = new Set(checkpointRows.map((r) => r.collection_name));
            return CORE_TRANSACTIONAL_TABLES.every((t) => existingSet.has(`${garageId}_${t}`));
        }
    } catch {
        // sync_checkpoints table may not exist in minimal unit-test schemas
    }

    return baseConfigPresent;
}

export function buildMissingDatasetsList(checks: LocalDataChecks, bootstrapCompleted: boolean): string[] {
    const missing: string[] = [];
    if (!checks.garageRow) missing.push('Configuración del garaje');
    if (!checks.vehicleTypes) missing.push('Tipos de vehículo');
    if (!checks.tariffs) missing.push('Tarifas');
    if (!checks.prices) missing.push('Precios');
    if (!bootstrapCompleted) missing.push('Sincronización inicial completa');
    return missing;
}

export function probeLocalData(db: any, garageId: string): LocalDataResult {
    const garageRow = !!db.prepare(`SELECT 1 AS present FROM garages WHERE id = ? LIMIT 1`).get(garageId);

    const baseChecks = {
        garageRow,
        vehicleTypes: garageRow && configRowExists(db, 'vehicle_types', garageId),
        tariffs: garageRow && configRowExists(db, 'tariffs', garageId),
        prices: garageRow && configRowExists(db, 'prices', garageId),
    };

    const baseConfigPresent = Object.values(baseChecks).every(Boolean);
    const bootstrapCompleted = evaluateSqliteBootstrapCompletion(db, garageId, baseConfigPresent);
    const hasLocalData = baseConfigPresent && bootstrapCompleted;

    return {
        hasLocalData,
        isBootstrapComplete: bootstrapCompleted,
        engine: 'SQLITE',
        checks: baseChecks,
        missing: buildMissingDatasetsList(baseChecks, bootstrapCompleted),
    };
}

/**
 * Express-compatible handler. `getDb` is injected so tests can supply an
 * isolated database and so this module never imports network code.
 */
export function createHasLocalDataHandler(getDb: () => any) {
    return (req: any, res: any) => {
        const { garageId } = req.params;
        if (!isValidGarageId(garageId)) {
            return res.status(400).json({ error: 'invalid garageId' });
        }
        try {
            return res.status(200).json(probeLocalData(getDb(), garageId));
        } catch (err: any) {
            // Local DB unreadable: report it honestly instead of claiming false.
            return res.status(500).json({ error: 'local database unavailable', details: err?.message });
        }
    };
}

/**
 * Active-engine local data readiness probe.
 * Inspects ONLY the currently active storage engine (SQLITE or NEDB) so that
 * readiness reflects the exact persistence layer consumed by the application's repositories.
 */
export async function probeLocalDataUnified(
    getSqliteDb: () => any,
    garageId: string
): Promise<LocalDataResult> {
    let activeEngine: 'SQLITE' | 'NEDB' = 'SQLITE';
    try {
        const { StorageEngine } = await import('../../../infrastructure/database/StorageEngine.js');
        activeEngine = StorageEngine.getEngine() === 'NEDB' ? 'NEDB' : 'SQLITE';
    } catch {}

    if (activeEngine === 'SQLITE') {
        try {
            const sqDb = getSqliteDb();
            if (sqDb) {
                return probeLocalData(sqDb, garageId);
            }
        } catch (err: any) {
            throw new Error(`SQLite readiness probe failed: ${err?.message || err}`);
        }
    }

    // Active engine is NEDB: inspect NeDB collections exclusively
    let garageRow = false;
    let vehicleTypes = false;
    let tariffs = false;
    let prices = false;
    let bootstrapCompleted = false;

    try {
        const { db } = await import('../../../infrastructure/database/datastore.js');
        const g = await db.garages.findOne({ $or: [{ id: garageId }, { _id: garageId }] });
        if (g) {
            garageRow = true;
        } else {
            try {
                const { TerminalConfigManager } = await import('../../../infrastructure/config/TerminalConfigManager.js');
                const termCfg = TerminalConfigManager.getConfig();
                if (termCfg && termCfg.garage_id === garageId) {
                    garageRow = true;
                }
            } catch {}
        }

        const vt = await db.vehicleTypes.findOne({ $or: [{ garageId }, { garage_id: garageId }] });
        if (vt) vehicleTypes = true;

        const tf = await db.tariffs.findOne({ $or: [{ garageId }, { garage_id: garageId }] });
        if (tf) tariffs = true;

        const pr = await db.prices.findOne({ $or: [{ garageId }, { garage_id: garageId }] });
        if (pr) prices = true;

        const baseConfigPresent = garageRow && vehicleTypes && tariffs && prices;

        const incompleteDoc = await db.syncState.findOne({ collection_name: `${garageId}__bootstrap_incomplete` });
        if (incompleteDoc) {
            bootstrapCompleted = false;
        } else {
            const completeDoc = await db.syncState.findOne({ collection_name: `${garageId}__bootstrap_complete` });
            if (completeDoc) {
                bootstrapCompleted = true;
            } else {
                const allStates: any[] = await db.syncState.find({});
                const garageStates = allStates.filter(
                    (s) => typeof s?.collection_name === 'string' && s.collection_name.startsWith(`${garageId}_`)
                );
                if (garageStates.length > 0) {
                    const existingSet = new Set(garageStates.map((s) => s.collection_name));
                    bootstrapCompleted = CORE_TRANSACTIONAL_TABLES.every((t) => existingSet.has(`${garageId}_${t}`));
                } else {
                    bootstrapCompleted = baseConfigPresent;
                }
            }
        }
    } catch (err: any) {
        throw new Error(`NeDB readiness probe failed: ${err?.message || err}`);
    }

    const checks: LocalDataChecks = {
        garageRow,
        vehicleTypes: garageRow && vehicleTypes,
        tariffs: garageRow && tariffs,
        prices: garageRow && prices,
    };

    const baseConfigPresent = Object.values(checks).every(Boolean);
    const hasLocalData = baseConfigPresent && bootstrapCompleted;

    return {
        hasLocalData,
        isBootstrapComplete: bootstrapCompleted,
        engine: 'NEDB',
        checks,
        missing: buildMissingDatasetsList(checks, bootstrapCompleted),
    };
}

export function createUnifiedHasLocalDataHandler(getSqliteDb: () => any) {
    return async (req: any, res: any) => {
        const { garageId } = req.params;
        if (!isValidGarageId(garageId)) {
            return res.status(400).json({ error: 'invalid garageId' });
        }
        try {
            const result = await probeLocalDataUnified(getSqliteDb, garageId);
            return res.status(200).json(result);
        } catch (err: any) {
            return res.status(500).json({ error: 'local database unavailable', details: err?.message });
        }
    };
}


