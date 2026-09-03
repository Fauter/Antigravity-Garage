import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager';
import { supabase } from '../../../infrastructure/lib/supabase.js';
import { VehicleType, Tariff, Price } from './ConfigRepository';

export class SqliteConfigRepository {

    async getVehicleTypes(garageId: string): Promise<VehicleType[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM vehicle_types WHERE json_extract(json_data, '$.garageId') = ?`).all(garageId) as any[];
        
        if (rows.length > 0) {
            return rows.map(r => {
                const t = JSON.parse(r.json_data);
                return {
                    id: t.id,
                    name: t.name,
                    icon: t.icon,
                    garageId: t.garageId,
                    description: t.description,
                    active: t.active
                };
            });
        }
        
        console.warn('⚠️ ConfigRepo: Local Data Empty. Fetching VehicleTypes from Cloud.');
        
        try {
            const { data, error } = await supabase.from('vehicle_types').select('*').eq('garage_id', garageId);
            if (error) throw error;
            return (data || []).map(row => ({
                id: row.id,
                name: row.name,
                icon: row.icon_key,
                garageId: row.garage_id,
                description: row.description,
                active: row.active ?? true
            }));
        } catch (err) {
            console.error('Cloud VehicleTypes Error', err);
            return [];
        }
    }

    async getTariffs(garageId: string): Promise<Tariff[]> {
        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`SELECT json_data FROM tariffs WHERE json_extract(json_data, '$.garageId') = ?`).all(garageId) as any[];
        
        if (rows.length > 0) {
            const parsed = rows.map(r => JSON.parse(r.json_data));
            parsed.sort((a, b) => (a.priority || 0) - (b.priority || 0));
            return parsed.map(t => ({
                id: t.id,
                name: t.name,
                garageId: t.garageId,
                type: t.type,
                priority: t.priority
            }));
        }

        try {
            const { data, error } = await supabase.from('tariffs').select('*').eq('garage_id', garageId).order('sort_order', { ascending: true });
            if (error) throw error;
            return (data || []).map(row => ({
                id: row.id,
                name: row.name,
                garageId: row.garage_id,
                type: row.type,
                priority: row.sort_order 
            }));
        } catch (err) {
            console.error('Cloud Tariffs Error', err);
            return [];
        }
    }

    async getPrices(garageId: string, method: string = 'EFECTIVO'): Promise<Price[]> {
        if (!garageId || typeof garageId !== 'string') return [];
        let priceList = 'standard';
        const m = (method || '').toUpperCase();
        if (m === 'ELECTRONIC' || m === 'MERCADO_PAGO' || m === 'MERCADOPAGO' || m === 'TRANSFERENCIA' || m === 'DEBITO' || m === 'CREDITO' || m === 'QR') {
            priceList = 'electronic';
        }
        if (m === 'EFECTIVO' || method.toLowerCase() === 'standard') {
            priceList = 'standard';
        }

        const db = SQLiteManager.getInstance().getDatabase();
        const rows = db.prepare(`
            SELECT json_data FROM prices 
            WHERE json_extract(json_data, '$.garageId') = ? 
              AND (
                json_extract(json_data, '$.priceList') = ? 
                OR json_extract(json_data, '$.price_list') = ? 
                OR UPPER(json_extract(json_data, '$.method')) = ?
              )
        `).all(garageId, priceList, priceList, (method || '').toUpperCase()) as any[];
        
        if (rows.length > 0) {
            return rows.map(r => {
                const p = JSON.parse(r.json_data);
                return {
                    id: p.id,
                    vehicleTypeId: p.vehicleTypeId || p.vehicle_type_id,
                    tariffId: p.tariffId || p.tariff_id,
                    price: p.amount || p.price,
                    amount: p.amount || p.price,
                    currency: p.currency,
                    garageId: p.garageId || p.garage_id,
                    method: p.method || (p.priceList === 'electronic' ? 'ELECTRONIC' : 'EFECTIVO')
                };
            });
        }

        try {
            const { data, error } = await supabase.from('prices').select('*').eq('garage_id', garageId).eq('price_list', priceList);
            if (error) throw error;
            return (data || []).map(row => ({
                id: row.id,
                vehicleTypeId: row.vehicle_type_id,
                tariffId: row.tariff_id,
                price: row.amount || 0,
                amount: row.amount || 0,
                currency: row.currency,
                garageId: row.garage_id,
                method: method
            }));
        } catch (err) {
            console.error('Cloud Prices Error', err);
            return [];
        }
    }

    async getParams(garageId?: string): Promise<any> {
        if (garageId && typeof garageId === 'string') {
            const db = SQLiteManager.getInstance().getDatabase();
            const rows = db.prepare(`SELECT json_data FROM financial_configs WHERE json_extract(json_data, '$.garageId') = ?`).all(garageId) as any[];
            
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

                return {
                    initial_tolerance: config.initialTolerance ?? 15,
                    fractionate_after: config.fractionateAfter ?? 0,
                    toleranciaInicial: config.initialTolerance ?? 15,
                    fraccionarDesde: config.fractionateAfter ?? 0,
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
