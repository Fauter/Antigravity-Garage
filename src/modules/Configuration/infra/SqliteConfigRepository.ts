import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';
import { supabase } from '../../../infrastructure/lib/supabase.js';
import { VehicleType, Tariff, Price } from './ConfigRepository';

export class SqliteConfigRepository {

    async getVehicleTypes(garageId: string): Promise<VehicleType[]> {
        if (!garageId || typeof garageId !== 'string') return [];
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`
            SELECT json_data FROM vehicle_types 
            WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?
        `).all(garageId, garageId) as any[];
        
        if (rows.length > 0) {
            return rows.map(r => {
                const t = JSON.parse(r.json_data);
                return {
                    id: t.id,
                    name: t.name,
                    icon: t.icon ?? t.iconKey ?? t.icon_key,
                    garageId: t.garageId ?? t.garage_id,
                    description: t.description,
                    active: t.active ?? true
                };
            });
        }
        
        console.warn('⚠️ ConfigRepo: Local Data Empty. Fetching VehicleTypes from Cloud.');
        
        try {
            const { data, error } = await supabase.from('vehicle_types').select('*').eq('garage_id', garageId);
            if (error) throw error;
            const mapped = (data || []).map(row => ({
                id: row.id,
                name: row.name,
                icon: row.icon_key,
                garageId: row.garage_id,
                description: row.description,
                active: row.active ?? true
            }));
            if (mapped.length > 0) {
                try {
                    const stmt = db.prepare(`INSERT INTO vehicle_types (id, json_data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data`);
                    for (const item of mapped) {
                        stmt.run(item.id, JSON.stringify(item));
                    }
                } catch {}
            }
            return mapped;
        } catch (err) {
            console.error('Cloud VehicleTypes Error', err);
            return [];
        }
    }

    async getTariffs(garageId: string): Promise<Tariff[]> {
        if (!garageId || typeof garageId !== 'string') return [];
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`
            SELECT json_data FROM tariffs 
            WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?
        `).all(garageId, garageId) as any[];
        
        if (rows.length > 0) {
            const parsed = rows.map(r => JSON.parse(r.json_data));
            parsed.sort((a, b) => (a.priority ?? a.sortOrder ?? a.sort_order ?? 0) - (b.priority ?? b.sortOrder ?? b.sort_order ?? 0));
            return parsed.map(t => ({
                id: t.id,
                name: t.name,
                garageId: t.garageId ?? t.garage_id,
                type: t.type,
                priority: t.priority ?? t.sortOrder ?? t.sort_order ?? 0,
                days: t.days,
                hours: t.hours,
                minutes: t.minutes
            }));
        }

        try {
            const { data, error } = await supabase.from('tariffs').select('*').eq('garage_id', garageId).order('sort_order', { ascending: true });
            if (error) throw error;
            const mapped = (data || []).map(row => ({
                id: row.id,
                name: row.name,
                garageId: row.garage_id,
                type: row.type,
                priority: row.sort_order,
                days: row.days,
                hours: row.hours,
                minutes: row.minutes
            }));
            if (mapped.length > 0) {
                try {
                    const stmt = db.prepare(`INSERT INTO tariffs (id, json_data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data`);
                    for (const item of mapped) {
                        stmt.run(item.id, JSON.stringify(item));
                    }
                } catch {}
            }
            return mapped;
        } catch (err) {
            console.error('Cloud Tariffs Error', err);
            return [];
        }
    }

    async getPrices(garageId: string, method: string = 'EFECTIVO'): Promise<Price[]> {
        if (!garageId || typeof garageId !== 'string') return [];
        let priceList = 'standard';
        const m = (method || 'EFECTIVO').toUpperCase();
        if (m === 'ELECTRONIC' || m === 'MERCADO_PAGO' || m === 'MERCADOPAGO' || m === 'TRANSFERENCIA' || m === 'DEBITO' || m === 'CREDITO' || m === 'QR') {
            priceList = 'electronic';
        }
        if (m === 'EFECTIVO' || method.toLowerCase() === 'standard') {
            priceList = 'standard';
        }

        const expectedMethodUpper = priceList === 'electronic' ? 'ELECTRONIC' : 'EFECTIVO';

        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`
            SELECT json_data FROM prices 
            WHERE (json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?)
              AND (
                LOWER(json_extract(json_data, '$.priceList')) = ? 
                OR LOWER(json_extract(json_data, '$.price_list')) = ? 
                OR UPPER(json_extract(json_data, '$.method')) = ?
                OR UPPER(json_extract(json_data, '$.method')) = ?
                OR (? = 'standard' AND json_extract(json_data, '$.priceList') IS NULL AND json_extract(json_data, '$.price_list') IS NULL AND json_extract(json_data, '$.method') IS NULL)
              )
        `).all(garageId, garageId, priceList, priceList, m, expectedMethodUpper, priceList) as any[];
        
        if (rows.length > 0) {
            return rows.map(r => {
                const p = JSON.parse(r.json_data);
                return {
                    id: p.id,
                    vehicleTypeId: p.vehicleTypeId || p.vehicle_type_id,
                    tariffId: p.tariffId || p.tariff_id,
                    price: Number(p.amount ?? p.price ?? 0),
                    amount: Number(p.amount ?? p.price ?? 0),
                    currency: p.currency || 'ARS',
                    garageId: p.garageId || p.garage_id,
                    method: p.method || (priceList === 'electronic' ? 'ELECTRONIC' : 'EFECTIVO')
                };
            });
        }

        try {
            const { data, error } = await supabase.from('prices').select('*').eq('garage_id', garageId).eq('price_list', priceList);
            if (error) throw error;
            const mapped = (data || []).map(row => ({
                id: row.id,
                vehicleTypeId: row.vehicle_type_id,
                tariffId: row.tariff_id,
                price: Number(row.amount || 0),
                amount: Number(row.amount || 0),
                currency: row.currency || 'ARS',
                garageId: row.garage_id,
                priceList,
                method: expectedMethodUpper
            }));
            if (mapped.length > 0) {
                try {
                    const stmt = db.prepare(`INSERT INTO prices (id, json_data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data`);
                    for (const item of mapped) {
                        stmt.run(item.id, JSON.stringify(item));
                    }
                } catch {}
            }
            return mapped;
        } catch (err) {
            console.error('Cloud Prices Error', err);
            return [];
        }
    }

    async getParams(garageId?: string): Promise<any> {
        if (garageId && typeof garageId === 'string') {
            const db = SQLiteManager.getInstance().getDatabase();
            const rows = db.prepare(`
                SELECT json_data FROM financial_configs 
                WHERE json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?
            `).all(garageId, garageId) as any[];
            
            if (rows.length > 0) {
                const configs = rows.map(r => JSON.parse(r.json_data));
                configs.sort((a, b) => new Date(b.updatedAt || b.updated_at || 0).getTime() - new Date(a.updatedAt || a.updated_at || 0).getTime());
                const config = configs[0];
                
                const rawEnabled = config.subscriptionFullPriceEnabled ?? config.subscription_full_price_enabled;
                const rawUntilDay = config.subscriptionFullPriceUntilDay ?? config.subscription_full_price_until_day ?? null;

                const subscriptionFullPriceEnabled = rawEnabled === true;
                const numericUntilDay = rawUntilDay === null || rawUntilDay === undefined ? null : Number(rawUntilDay);
                const subscriptionFullPriceUntilDay = Number.isInteger(numericUntilDay) && numericUntilDay! >= 1 && numericUntilDay! <= 31 ? numericUntilDay : null;

                let parsedSurchargeConfig = config.surchargeConfig ?? config.surcharge_config;
                if (typeof parsedSurchargeConfig === 'string') {
                    try {
                        parsedSurchargeConfig = JSON.parse(parsedSurchargeConfig);
                    } catch (e) {
                        console.error('Invalid surcharge_config JSON string in DB:', e);
                        parsedSurchargeConfig = {};
                    }
                }

                const initialTolerance = config.initialTolerance ?? config.initial_tolerance ?? 15;
                const fractionateAfter = config.fractionateAfter ?? config.fractionate_after ?? 0;

                return {
                    initial_tolerance: initialTolerance,
                    fractionate_after: fractionateAfter,
                    toleranciaInicial: initialTolerance,
                    fraccionarDesde: fractionateAfter,
                    recargoDia11: 10,
                    recargoDia22: 20,
                    permitirCobroAnticipado: false,
                    subscriptionFullPriceEnabled,
                    subscriptionFullPriceUntilDay,
                    surchargeConfig: parsedSurchargeConfig
                };
            }
        }
        
        return {
            initial_tolerance: 15,
            fractionate_after: 0,
            toleranciaInicial: 15,
            fraccionarDesde: 0,
            recargoDia11: 10,
            recargoDia22: 20,
            permitirCobroAnticipado: false,
            subscriptionFullPriceEnabled: false,
            subscriptionFullPriceUntilDay: null
        };
    }
}

export { SqliteConfigRepository as ConfigRepository };
