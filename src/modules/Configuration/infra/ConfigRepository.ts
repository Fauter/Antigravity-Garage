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

export class ConfigRepository {

    async getVehicleTypes(garageId: string): Promise<VehicleType[]> {
        // 1. Try Local DB (NeDB)
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

        // 2. Fallback to Cloud
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
        // 1. Local DB (NeDB)
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

        // 2. Fallback to Cloud
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
                priority: row.sort_order // Map back to 'priority' for App
            }));
        } catch (cloudErr: any) {
            console.error('Cloud Tariffs Error', cloudErr.message);
            return [];
        }
    }

    async getPrices(garageId: string, method: string = 'EFECTIVO'): Promise<Price[]> {
        // 1. Local DB (NeDB)
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

        // 2. Fallback to Cloud
        try {
            let priceList = 'standard';
            // Fallback: If method implies electronic but we want standard, we can tweak here. 
            // Current rule: Anything non-cash is electronic list.
            if (method.toUpperCase() === 'ELECTRONIC' || method.toUpperCase() === 'MERCADO_PAGO' || method.toUpperCase() === 'TRANSFERENCIA' || method.toUpperCase() === 'DEBITO' || method.toUpperCase() === 'CREDITO') {
                priceList = 'electronic';
            }

            // SECURITY: If frontend says 'EFECTIVO', force standard list.
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
    async getParams(): Promise<any> {
        // 1. Local DB (Future: params.db)
        // For now, return default hardcoded params or read from a specific doc if we had one.
        // We will assume defaults for this "Rescue Phase" to guarantee stability.
        return {
            fraccionarDesde: 0,
            toleranciaInicial: 15,
            recargoDia11: 10,
            recargoDia22: 20,
            permitirCobroAnticipado: false
        };
    }
}
