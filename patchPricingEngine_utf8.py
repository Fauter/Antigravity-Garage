import re

with open('src/modules/Billing/domain/PricingEngine.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add resolveSurchargeRule method
resolve_method = '''
    public static resolveSurchargeRule(
        config: any,
        vehicleTypeId: string | null | undefined,
        monthIndex: string
    ): { steps: any[] } | null {
        const surchargeConfig = config?.surchargeConfig ?? config?.surcharge_config;
        if (!surchargeConfig) return null;
        
        const isVtEnabled = surchargeConfig.vehicle_type_enabled === true;
        const vtOverrides = surchargeConfig.vehicle_type_overrides ?? {};
        const monthlyOverrides = surchargeConfig.monthlyOverrides ?? surchargeConfig.monthly_overrides ?? {};
        const globalDefault = surchargeConfig.globalDefault ?? surchargeConfig.global_default;
        
        // Switch ON logic
        if (isVtEnabled && vehicleTypeId) {
            const vtScope = vtOverrides[vehicleTypeId];
            if (vtScope) {
                // 1. Excepción mensual específica del vehicle_type
                const vtMonthly = (vtScope.monthly_overrides ?? vtScope.monthlyOverrides)?.[monthIndex];
                if (vtMonthly && vtMonthly.steps && Array.isArray(vtMonthly.steps)) {
                    return vtMonthly;
                }
                // 2. Regla default específica del vehicle_type
                if (vtScope.default_rule && vtScope.default_rule.steps && Array.isArray(vtScope.default_rule.steps)) {
                    return vtScope.default_rule;
                }
            }
        }
        
        // Switch OFF or Fallback (3. Excepción general, 4. Global default)
        const generalMonthly = monthlyOverrides[monthIndex];
        if (generalMonthly && generalMonthly.steps && Array.isArray(generalMonthly.steps)) {
            return generalMonthly;
        }
        
        if (globalDefault && globalDefault.steps && Array.isArray(globalDefault.steps)) {
            return globalDefault;
        }
        
        return null;
    }

    public static calculateDebtSurcharge({
        baseAmount,
        billingPeriod,
        now,
        config,
        vehicleTypeId
    }: {
        baseAmount: number;
        billingPeriod: string;
        now: Date;
        config: any;
        vehicleTypeId?: string | null;
    }): {'''

content = re.sub(
    r'public static calculateDebtSurcharge\(\{\s*baseAmount,\s*billingPeriod,\s*now,\s*config\s*\}\:\s*\{\s*baseAmount:\s*number;\s*billingPeriod:\s*string;\s*now:\s*Date;\s*config:\s*any;\s*\}\):\s*\{',
    resolve_method,
    content
)

logic_replacement = '''
            const monthStr = billingPeriod.split('-')[1];
            const monthIdx = String(parseInt(monthStr, 10) - 1); // 0-11
            
            let rawSteps: any[] = [];
            const resolvedRule = this.resolveSurchargeRule(config, vehicleTypeId, monthIdx);
            
            if (resolvedRule && Array.isArray(resolvedRule.steps) && resolvedRule.steps.length > 0) {
                rawSteps = resolvedRule.steps;
            } else {
                // Try legacy fallback (apartirdia11)
                const rate11 = config?.apartirdia11 != null ? Number(config.apartirdia11) : 0;
                const rate22 = config?.apartirdia22 != null ? Number(config.apartirdia22) : 0;
                
                if (rate11 > 0 || rate22 > 0) {
                    rawSteps = [
                        { day: 11, percentage: rate11 },
                        { day: 22, percentage: rate22 }
                    ];
                } else {
                    return { percentage: 0, amount: 0, reason: 'NO_CONFIG' };
                }
            }
'''

content = re.sub(
    r'const monthStr = billingPeriod\.split\(\'-\'\)\[1\];\s*const monthIdx = String\(parseInt\(monthStr, 10\) - 1\); // 0-11\s*const surchargeConfig = config\?\.surchargeConfig \?\? config\?\.surcharge_config;.*?if \(!rawSteps \|\| !Array\.isArray\(rawSteps\) \|\| rawSteps\.length === 0\) \{\s*// Try legacy fallback.*?return \{ percentage: 0, amount: 0, reason: \'NO_CONFIG\' \};\s*\}\s*\}',
    logic_replacement.strip(),
    content,
    flags=re.DOTALL
)

with open('src/modules/Billing/domain/PricingEngine.ts', 'w', encoding='utf-8') as f:
    f.write(content)
