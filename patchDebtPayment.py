import re

with open('src/modules/Billing/application/DebtPaymentService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'basePrice?: number;',
    'basePrice?: number;\n    vehicleTypeId?: string;'
)

content = content.replace(
    'const { targetDebtIds, now, config, basePrice } = request;',
    'const { targetDebtIds, now, config, basePrice, vehicleTypeId } = request;'
)

content = content.replace(
    '''const surchargeRes = PricingEngine.calculateDebtSurcharge({
                    baseAmount: principal,
                    billingPeriod: period,
                    now,
                    config
                });''',
    '''const surchargeRes = PricingEngine.calculateDebtSurcharge({
                    baseAmount: principal,
                    billingPeriod: period,
                    now,
                    config,
                    vehicleTypeId
                });'''
)

with open('src/modules/Billing/application/DebtPaymentService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
