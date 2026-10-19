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
    days?: number;
    hours?: number;
    minutes?: number;
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
        if (!garageId || typeof garageId !== 'string') return [];
        try {
            const types: any[] = await db.vehicleTypes.find({
                $or: [{ garageId }, { garage_id: garageId }]
            });
            if (types.length > 0) {
                return types.map(t => ({
                    id: t.id,
                    name: t.name,
                    icon: t.icon ?? t.iconKey ?? t.icon_key,
                    garageId: t.garageId ?? t.garage_id,
                    description: t.description,
                    active: t.active ?? true
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

            const mapped = (data || []).map(row => ({
                id: row.id,
                name: row.name,
                icon: row.icon_key,
                garageId: row.garage_id,
                description: row.description,
                active: row.active ?? true
            }));

            for (const item of mapped) {
                try {
                    await db.vehicleTypes.update({ id: item.id }, { ...item, updatedAt: new Date() }, { upsert: true });
                } catch {}
            }

            return mapped;
        } catch (cloudErr) {
            console.error('Cloud VehicleTypes Error', cloudErr);
            return [];
        }
    }

    async getTariffs(garageId: string): Promise<Tariff[]> {
        if (!garageId || typeof garageId !== 'string') return [];
        try {
            const items: any[] = await db.tariffs.find({
                $or: [{ garageId }, { garage_id: garageId }]
            });
            if (items.length > 0) {
                items.sort((a, b) => (a.priority ?? a.sortOrder ?? a.sort_order ?? 0) - (b.priority ?? b.sortOrder ?? b.sort_order ?? 0));
                return items.map(t => ({
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

            for (const item of mapped) {
                try {
                    await db.tariffs.update({ id: item.id }, { ...item, sortOrder: item.priority, updatedAt: new Date() }, { upsert: true });
                } catch {}
            }

            return mapped;
        } catch (cloudErr: any) {
            console.error('Cloud Tariffs Error', cloudErr?.message || cloudErr);
            return [];
        }
    }

    async getPrices(garageId: string, method: string = 'EFECTIVO'): Promise<Price[]> {
        if (!garageId || typeof garageId !== 'string') return [];

        const m = (method || 'EFECTIVO').toUpperCase();
        let priceList = 'standard';
        if (
            m === 'ELECTRONIC' ||
            m === 'MERCADO_PAGO' ||
            m === 'MERCADOPAGO' ||
            m === 'TRANSFERENCIA' ||
            m === 'DEBITO' ||
            m === 'CREDITO' ||
            m === 'QR'
        ) {
            priceList = 'electronic';
        } else if (m === 'EFECTIVO' || m === 'STANDARD') {
            priceList = 'standard';
        }

        try {
            const allGaragePrices: any[] = await db.prices.find({
                $or: [{ garageId }, { garage_id: garageId }]
            });

            const items = allGaragePrices.filter(p => {
                const pList = String(p.priceList ?? p.price_list ?? '').toLowerCase();
                const pMethod = String(p.method ?? '').toUpperCase();

                if (pList === priceList) return true;
                if (pMethod === m) return true;
                if (priceList === 'standard' && (pMethod === 'EFECTIVO' || pMethod === 'STANDARD')) return true;
                if (priceList === 'electronic' && pMethod === 'ELECTRONIC') return true;
                if (priceList === 'standard' && !pList && !pMethod) return true;
                return false;
            });

            if (items.length > 0) {
                return items.map(p => ({
                    id: p.id,
                    vehicleTypeId: p.vehicleTypeId || p.vehicle_type_id,
                    tariffId: p.tariffId || p.tariff_id,
                    price: Number(p.amount ?? p.price ?? 0),
                    amount: Number(p.amount ?? p.price ?? 0),
                    currency: p.currency || 'ARS',
                    garageId: p.garageId || p.garage_id,
                    method: p.method || (priceList === 'electronic' ? 'ELECTRONIC' : 'EFECTIVO')
                }));
            }
        } catch (err) {
            console.error('Local Prices Error', err);
        }

        try {
            const { data, error } = await supabase
                .from('prices')
                .select('*')
                .eq('garage_id', garageId)
                .eq('price_list', priceList);

            if (error) throw error;

            const mapped = (data || []).map(row => ({
                id: row.id,
                vehicleTypeId: row.vehicle_type_id,
                tariffId: row.tariff_id,
                price: Number(row.amount || 0),
                amount: Number(row.amount || 0),
                currency: row.currency || 'ARS',
                garageId: row.garage_id,
                method: method
            }));

            for (const row of (data || [])) {
                try {
                    await db.prices.update(
                        { id: row.id },
                        {
                            id: row.id,
                            vehicleTypeId: row.vehicle_type_id,
                            tariffId: row.tariff_id,
                            amount: Number(row.amount || 0),
                            price: Number(row.amount || 0),
                            currency: row.currency || 'ARS',
                            garageId: row.garage_id,
                            priceList: row.price_list || priceList,
                            method: (row.price_list || priceList) === 'electronic' ? 'ELECTRONIC' : 'EFECTIVO',
                            updatedAt: new Date()
                        },
                        { upsert: true }
                    );
                } catch {}
            }

            return mapped;
        } catch (cloudErr: any) {
            console.error('Cloud Prices Error', cloudErr?.message || cloudErr);
            return [];
        }
    }

    async getParams(garageId?: string): Promise<any> {
        try {
            if (garageId) {
                const configs: any[] = await db.financialConfigs.find({
                    $or: [{ garageId }, { garage_id: garageId }]
                });
                if (configs && configs.length > 0) {
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
