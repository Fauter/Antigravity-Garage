import re

with open('src/modules/Billing/domain/PricingEngine.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace resolveSurchargeRule
new_resolve = '''public static resolveSurchargeRule(
        config: any,
        vehicleTypeId: string | null | undefined
    ): { steps: any[] } | null {
        const surchargeConfig = config?.surchargeConfig ?? config?.surcharge_config;
        if (!surchargeConfig) return null;
        
        const vtOverrides = surchargeConfig.vehicle_type_overrides ?? {};
        const globalDefault = surchargeConfig.globalDefault ?? surchargeConfig.global_default;
        
        if (vehicleTypeId) {
            const vtScope = vtOverrides[vehicleTypeId];
            if (vtScope && vtScope.default_rule && Array.isArray(vtScope.default_rule.steps)) {
                return vtScope.default_rule;
            }
        }
        
        if (globalDefault && Array.isArray(globalDefault.steps)) {
            return globalDefault;
        }
        
        return null;
    }'''

content = re.sub(
    r'public static resolveSurchargeRule\(.*?return null;\s*\}',
    new_resolve,
    content,
    flags=re.DOTALL
)

# Replace the calculateDebtSurcharge signature and monthIdx calculation
content = re.sub(
    r'const monthStr = billingPeriod.split\(\'-\'\)\[1\];\s*const monthIdx = String\(parseInt\(monthStr, 10\) - 1\); // 0-11\s*let rawSteps: any\[\] = \[\];\s*const resolvedRule = this.resolveSurchargeRule\(config, vehicleTypeId, monthIdx\);',
    r'''let rawSteps: any[] = [];
            const resolvedRule = this.resolveSurchargeRule(config, vehicleTypeId);''',
    content,
    flags=re.DOTALL
)

# Fix the applicable steps selection: from maximum percentage to LAST chronological step
step_logic_old = r'''if \(applicableSteps\.length > 0\) \{
                    // Se toma el step con mayor porcentaje
                    const maxStep = applicableSteps\.reduce\(\(max: any, step: any\) => 
                        Number\(step\.percentage\) > Number\(max\.percentage\) \? step : max
                    , applicableSteps\[0\]\);
                    
                    appliedStep = maxStep;
                    percentage = Number\(maxStep\.percentage\);
                \}'''

step_logic_new = '''if (applicableSteps.length > 0) {
                    // Se toma el ÚLTIMO escalón alcanzado cronológicamente
                    const lastStep = applicableSteps[applicableSteps.length - 1];
                    
                    appliedStep = lastStep;
                    percentage = Number(lastStep.percentage);
                }'''

content = re.sub(step_logic_old, step_logic_new, content, flags=re.DOTALL)

with open('src/modules/Billing/domain/PricingEngine.ts', 'w', encoding='utf-8') as f:
    f.write(content)
