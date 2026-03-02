import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api';

/**
 * Validation result for a single vehicle type from the backend.
 */
export interface VehiclePriceValidation {
    id: string;
    name: string;
    valid: boolean;
    missing: string[];
    referencePrice: number;
}

/**
 * An enriched vehicle type entry ready for rendering in a <select>.
 */
export interface EnrichedVehicleType {
    id: string;
    name: string;
    label: string;
    disabled: boolean;
    referencePrice: number;
}

/**
 * Custom hook that validates whether each vehicle type has complete pricing
 * (standard + electronic) for all tariffs of the given context (hora/abono),
 * and returns a sorted, enriched list ready for rendering.
 *
 * @param tariffType - The tariff context to validate against: 'hora' | 'abono'
 * @returns Validation utilities and a function to produce sorted vehicle type arrays.
 */
export const useVehiclePriceValidation = (tariffType: 'hora' | 'abono' | 'turno') => {
    const [validations, setValidations] = useState<VehiclePriceValidation[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        api.get(`/validacion-precios?type=${tariffType}`)
            .then(res => {
                if (!cancelled && res.data && Array.isArray(res.data)) {
                    setValidations(res.data);
                }
            })
            .catch(err => {
                console.error(`[PriceValidation] Error fetching for type=${tariffType}:`, err);
                // On error, don't block the UI — treat all as valid (fail-open)
                setValidations([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [tariffType]);

    // Normalize helper: accent + case insensitive
    const normalize = useCallback(
        (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
        []
    );

    // Indexed maps for O(1) lookup
    const byId = useMemo(() => {
        const map = new Map<string, VehiclePriceValidation>();
        validations.forEach(v => map.set(v.id, v));
        return map;
    }, [validations]);

    const byNormalizedName = useMemo(() => {
        const map = new Map<string, VehiclePriceValidation>();
        validations.forEach(v => map.set(normalize(v.name), v));
        return map;
    }, [validations, normalize]);

    /** Resolve a validation entry by UUID or display name. */
    const resolve = useCallback((idOrName: string): VehiclePriceValidation | undefined => {
        return byId.get(idOrName) || byNormalizedName.get(normalize(idOrName));
    }, [byId, byNormalizedName, normalize]);

    /**
     * Check if a vehicle type is valid (has complete pricing).
     * Accepts either the vehicle type UUID or its display name.
     * Returns true if validation data hasn't loaded yet (fail-open).
     */
    const isVehicleValid = useCallback((idOrName: string): boolean => {
        if (loading || validations.length === 0) return true; // Fail-open
        const entry = resolve(idOrName);
        return entry ? entry.valid : true; // Unknown types default to valid
    }, [loading, validations, resolve]);

    /**
     * Returns the display label for a vehicle type.
     * Appends a warning suffix if the vehicle has incomplete pricing.
     */
    const getLabel = useCallback((name: string): string => {
        if (loading || validations.length === 0) return name;
        const entry = resolve(name);
        if (entry && !entry.valid) {
            return `${name} (Configuración de precios incompleta)`;
        }
        return name;
    }, [loading, validations, resolve]);

    /**
     * Takes a raw array of vehicle types (with at least `id` and `name` fields)
     * and returns a new array sorted by:
     *   1. valid first (invalid at end)
     *   2. referencePrice ascending (cheapest first)
     *   3. alphabetical name as tiebreaker
     * Each entry is enriched with `label`, `disabled`, and `referencePrice`.
     */
    const getSortedVehicleTypes = useCallback(<T extends { id: string; name: string }>(
        rawTypes: T[]
    ): (T & EnrichedVehicleType)[] => {
        // If validations haven't loaded yet, return as-is with default enrichment
        if (loading || validations.length === 0) {
            return rawTypes.map(v => ({
                ...v,
                label: v.name,
                disabled: false,
                referencePrice: 0
            }));
        }

        return rawTypes
            .map(v => {
                const entry = resolve(v.id) || resolve(v.name);
                const valid = entry ? entry.valid : true;
                const refPrice = entry ? entry.referencePrice : 0;
                return {
                    ...v,
                    label: valid ? v.name : `${v.name} (Configuración de precios incompleta)`,
                    disabled: !valid,
                    referencePrice: refPrice
                };
            })
            .sort((a, b) => {
                // 1. Valid first
                if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
                // 2. referencePrice ascending
                if (a.referencePrice !== b.referencePrice) return a.referencePrice - b.referencePrice;
                // 3. Alphabetical tiebreaker
                return normalize(a.name).localeCompare(normalize(b.name));
            });
    }, [loading, validations, resolve, normalize]);

    return {
        validations,
        loading,
        isVehicleValid,
        getLabel,
        getSortedVehicleTypes
    };
};
