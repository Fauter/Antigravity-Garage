export class CanonicalEntityHelper {
    /**
     * Deduplicates a list of entities that might have been loaded from duplicate physical rows 
     * (e.g. NeDB PK vs UUID PK). Resolves the canonical entity using logical identity and completeness.
     */
    static resolveCanonical<T extends { id?: string }>(entities: T[], entityType: string): T[] {
        const grouped = new Map<string, T[]>();

        for (const entity of entities) {
            const logicalId = entity.id; // We assume parsed JSON has $.id
            if (!logicalId) continue;
            if (!grouped.has(logicalId)) {
                grouped.set(logicalId, []);
            }
            grouped.get(logicalId)!.push(entity);
        }

        const resolved: T[] = [];

        for (const [logicalId, copies] of grouped.entries()) {
            if (copies.length === 1) {
                resolved.push(copies[0]);
                continue;
            }

            // We have duplicates. Merge them based on entityType.
            let canonical = { ...copies[0] };

            if (entityType === 'Debt') {
                canonical = this.mergeDebts(copies as any) as unknown as T;
            } else if (entityType === 'Subscription') {
                canonical = this.mergeSubscriptions(copies as any) as unknown as T;
            } else {
                canonical = this.mergeGeneric(copies) as unknown as T;
            }

            resolved.push(canonical);
        }

        return resolved;
    }

    private static mergeDebts(copies: any[]): any {
        // Find the copy that looks like it has been updated by Sync (often PAID but lacking remaining_amount)
        // and the copy that has legacy financial fields.
        let merged = { ...copies[0] };
        let hasPaid = false;
        
        for (const copy of copies) {
            // 1. Status: If any copy is PAID, the canonical is PAID
            if (copy.status === 'PAID') {
                merged.status = 'PAID';
                hasPaid = true;
            } else if (copy.status === 'CANCELLED' && merged.status !== 'PAID') {
                merged.status = 'CANCELLED';
            }
            
            // 2. Financial Completeness
            if (copy.remaining_amount !== undefined && copy.remaining_amount !== null) {
                merged.remaining_amount = copy.remaining_amount;
            }
            if (copy.amount_paid !== undefined && copy.amount_paid !== null) {
                merged.amount_paid = copy.amount_paid;
            }
            
            // 3. Keep newest timestamp if any
            if (copy.updatedAt && (!merged.updatedAt || new Date(copy.updatedAt) > new Date(merged.updatedAt))) {
                merged.updatedAt = copy.updatedAt;
            }
        }

        // Logical normalizations based on merged status
        if (merged.status === 'PAID') {
            merged.remaining_amount = 0;
            if (merged.amount !== undefined && (merged.amount_paid === undefined || merged.amount_paid === 0)) {
                merged.amount_paid = merged.amount;
            }
        }

        return merged;
    }

    private static mergeSubscriptions(copies: any[]): any {
        let merged = { ...copies[0] };
        
        for (const copy of copies) {
            // Keep the furthest endDate (represents the most recent advancement)
            if (copy.endDate) {
                if (!merged.endDate || new Date(copy.endDate) > new Date(merged.endDate)) {
                    merged.endDate = copy.endDate;
                }
            }
            
            if (copy.updatedAt && (!merged.updatedAt || new Date(copy.updatedAt) > new Date(merged.updatedAt))) {
                merged.updatedAt = copy.updatedAt;
            }
        }
        return merged;
    }

    private static mergeGeneric(copies: any[]): any {
        let merged = { ...copies[0] };
        for (const copy of copies) {
            if (copy.updatedAt && (!merged.updatedAt || new Date(copy.updatedAt) > new Date(merged.updatedAt))) {
                merged = { ...merged, ...copy };
            }
        }
        return merged;
    }
}
