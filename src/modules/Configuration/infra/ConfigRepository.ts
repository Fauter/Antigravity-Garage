import { db } from '../../../infrastructure/database/datastore.js';
import { supabase } from '../../../infrastructure/lib/supabase.js';

export interface VehicleType {
    id: string;
    name: string;
    icon?: string;
    garageId?: string;
    description?: string;
    active?: boolean;
}

export interface Tariff {
    id: string;
    name: string;
    garageId?: string;
    type?: string;
    priority?: number;
}

export interface Price {
    id: string;
    vehicleTypeId: string;
    tariffId: string;
    price: number;
    amount: number;
    currency: string;
    garageId?: string;
    method?: string;
}

export class NeDBConfigRepository {

    async getVehicleTypes(garageId: string): Promise<VehicleType[]> {
        try {
            const types: any[] = await db.vehicleTypes.find({ garageId });
            if (types.length > 0) {
                return types.map(t => ({
                    id: t.id,
                    name: t.name,
                    icon: t.icon,
                    garageId: t.garageId,
                    description: t.description,
                    active: t.active
                }));
            }
        } catch (err) {
            console.error('Local VehicleTypes Error', err);
        }

        console.warn('⚠️ ConfigRepo: Local Data Empty. Fetching VehicleTypes from Cloud.');

        try {
            const { data, error } = await supabase
                .from('vehicle_types')
                .select('*')
                .eq('garage_id', garageId);

            if (error) throw error;

            return (data || []).map(row => ({
                id: row.id,
                name: row.name,
                icon: row.icon_key,
                garageId: row.garage_id,
                description: row.description,
                active: row.active ?? true
            }));
        } catch (cloudErr) {
            console.error('Cloud VehicleTypes Error', cloudErr);
            return [];
        }
    }

    async getTariffs(garageId: string): Promise<Tariff[]> {
        try {
            const items: any[] = await db.tariffs.find({ garageId }).sort({ priority: 1 });
            if (items.length > 0) {
                return items.map(t => ({
                    id: t.id,
                    name: t.name,
                    garageId: t.garageId,
                    type: t.type,
                    priority: t.priority
                }));
            }
        } catch (err) {
            console.error('Local Tariffs Error', err);
        }

        try {
            const { data, error } = await supabase
                .from('tariffs')
                .select('*')
                .eq('garage_id', garageId)
                .order('sort_order', { ascending: true });

            if (error) throw error;

            return (data || []).map(row => ({
                id: row.id,
                name: row.name,
                garageId: row.garage_id,
                type: row.type,
                priority: row.sort_order 
            }));
        } catch (cloudErr: any) {
            console.error('Cloud Tariffs Error', cloudErr.message);
            return [];
        }
    }

    async getPrices(garageId: string, method: string = 'EFECTIVO'): Promise<Price[]> {
        try {
            const items: any[] = await db.prices.find({ garageId, method: method.toUpperCase() });
            if (items.length > 0) {
                return items.map(p => ({
                    id: p.id,
                    vehicleTypeId: p.vehicleTypeId,
                    tariffId: p.tariffId,
                    price: p.amount || p.price,
                    amount: p.amount || p.price,
                    currency: p.currency,
                    garageId: p.garageId,
                    method: p.method
                }));
            }
        } catch (err) {
            console.error('Local Prices Error', err);
        }

        try {
            let priceList = 'standard';
            if (method.toUpperCase() === 'ELECTRONIC' || method.toUpperCase() === 'MERCADO_PAGO' || method.toUpperCase() === 'TRANSFERENCIA' || method.toUpperCase() === 'DEBITO' || method.toUpperCase() === 'CREDITO') {
                priceList = 'electronic';
            }
            if (method.toUpperCase() === 'EFECTIVO') priceList = 'standard';

            const { data, error } = await supabase
                .from('prices')
                .select('*')
                .eq('garage_id', garageId)
                .eq('price_list', priceList);

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
        } catch (cloudErr: any) {
            console.error('Cloud Prices Error', cloudErr.message);
            return [];
        }
    }

    async getParams(garageId?: string): Promise<any> {
        try {
            if (garageId) {
                const configs: any[] = await db.financialConfigs.find({ garageId });
                if (configs && configs.length > 0) {
                    configs.sort((a, b) => new Date(b.updatedAt || b.updated_at || 0).getTime() - new Date(a.updatedAt || a.updated_at || 0).getTime());
                    const config = configs[0];

                    const rawEnabled = config.subscriptionFullPriceEnabled ?? config.subscription_full_price_enabled;
                    const rawUntilDay = config.subscriptionFullPriceUntilDay ?? config.subscription_full_price_until_day ?? null;

                    const subscriptionFullPriceEnabled = rawEnabled === true;
                    const numericUntilDay = rawUntilDay === null || rawUntilDay === undefined ? null : Number(rawUntilDay);
                    const subscriptionFullPriceUntilDay = Number.isInteger(numericUntilDay) && numericUntilDay! >= 1 && numericUntilDay! <= 31 ? numericUntilDay : null;

                    return {
                        initial_tolerance: config.initialTolerance ?? 15,
                        fractionate_after: config.fractionateAfter ?? 0,
                        toleranciaInicial: config.initialTolerance ?? 15,
                        fraccionarDesde: config.fractionateAfter ?? 0,
                        recargoDia11: 10,
                        recargoDia22: 20,
                        permitirCobroAnticipado: false,
                        subscriptionFullPriceEnabled,
                        subscriptionFullPriceUntilDay
                    };
                }
            }
        } catch (err) {
            console.error('Local Config Error', err);
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

import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SqliteConfigRepository } from './SqliteConfigRepository.js';

export class ConfigRepository {
    private impl: any;
    constructor() {
        this.impl = StorageEngine.getEngine() === 'SQLITE' ? new SqliteConfigRepository() : new NeDBConfigRepository();
    }
    async getVehicleTypes(garageId: string): Promise<VehicleType[]> { return this.impl.getVehicleTypes(garageId); }
    async getTariffs(garageId: string): Promise<Tariff[]> { return this.impl.getTariffs(garageId); }
    async getPrices(garageId: string, method: string = 'EFECTIVO'): Promise<Price[]> { return this.impl.getPrices(garageId, method); }
    async getParams(garageId?: string): Promise<any> { return this.impl.getParams(garageId); }
}
