export class CanonicalEntityHelper {
    /**
     * Deduplicates a list of entities that might have been loaded from duplicate physical rows 
     * (e.g. NeDB PK vs UUID PK). Resolves the canonical entity using logical identity and completeness.
     */
    static resolveCanonical<T extends { id?: string }>(entities: T[], entityType: string): T[] {
        const grouped = new Map<string, T[]>();

        for (const entity of entities) {
            let logicalId = entity.id; // We assume parsed JSON has $.id
            
            if (entityType === 'Debt') {
                const debt = entity as any;
                if (debt.type === 'CANON' && debt.subscriptionId) {
                    try {
                        let bp = debt.billingPeriod;
                        if (!bp) {
                            const d = new Date(debt.dueDate);
                            const year = d.getUTCFullYear();
                            const month = String(d.getUTCMonth() + 1).padStart(2, '0');
                            bp = `${year}-${month}`;
                        }
                        const seedString = `CANON|${debt.subscriptionId}|${bp}`;
                        logicalId = require('uuid').v5(seedString, '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
                    } catch (e) {
                        // Fallback to original id
                    }
                }
            }

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
                canonical = this.mergeDebts(logicalId, copies as any) as unknown as T;
            } else if (entityType === 'Subscription') {
                canonical = this.mergeSubscriptions(copies as any) as unknown as T;
            } else {
                canonical = this.mergeGeneric(copies) as unknown as T;
            }

            resolved.push(canonical);
        }

        return resolved;
    }

    private static mergeDebts(logicalId: string, copies: any[]): any {
        let merged = { ...copies[0], id: logicalId };
        let hasPaid = false;
        
        let referenceAmount = copies[0].amount;
        let amountConflict = false;

        for (const copy of copies) {
            // Integrity conflict detection
            if (copy.amount !== undefined && referenceAmount !== undefined && copy.amount !== referenceAmount) {
                amountConflict = true;
            }

            // 1. Status: If any copy is PAID, the canonical is PAID
            if (copy.status === 'PAID') {
                merged.status = 'PAID';
                hasPaid = true;
            } else if (copy.status === 'CANCELLED' && merged.status !== 'PAID') {
                merged.status = 'CANCELLED';
            }
            
            // 2. Financial Completeness (take max amount_paid, min remaining_amount)
            if (copy.amount_paid !== undefined && copy.amount_paid !== null) {
                if (merged.amount_paid === undefined || copy.amount_paid > merged.amount_paid) {
                    merged.amount_paid = copy.amount_paid;
                }
            }
            if (copy.remaining_amount !== undefined && copy.remaining_amount !== null) {
                if (merged.remaining_amount === undefined || copy.remaining_amount < merged.remaining_amount) {
                    merged.remaining_amount = copy.remaining_amount;
                }
            }
            
            // 3. Keep newest timestamp if any
            if (copy.updatedAt && (!merged.updatedAt || new Date(copy.updatedAt) > new Date(merged.updatedAt))) {
                merged.updatedAt = copy.updatedAt;
            }
        }

        if (amountConflict) {
            merged.status = 'INTEGRITY_CONFLICT';
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
