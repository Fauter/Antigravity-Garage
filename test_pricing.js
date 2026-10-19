const { PricingEngine } = require('./dist/modules/Billing/domain/PricingEngine.js');

const globalDefaultSteps = [{ day: 11, percentage: 10 }, { day: 22, percentage: 20 }];
const sprinterSteps = [{ day: 1, percentage: 18 }, { day: 22, percentage: 20 }];
const sprinterId = '65f6d051-ab51-4043-98d7-cd9d82ad5ec8';

const snakeConfig = {
  surcharge_config: {
    global_default: { steps: globalDefaultSteps },
    vehicle_type_overrides: {
      [sprinterId]: { default_rule: { steps: sprinterSteps } }
    }
  }
};

const camelConfig = {
  surchargeConfig: {
    globalDefault: { steps: globalDefaultSteps },
    vehicleTypeOverrides: {
      [sprinterId]: { defaultRule: { steps: sprinterSteps } }
    }
  }
};

const now = new Date();
const tests = [
  { name: 'A. Snake case (Sprinter)', config: snakeConfig, vt: sprinterId, expected: 18 },
  { name: 'B. Camel case (Sprinter)', config: camelConfig, vt: sprinterId, expected: 18 },
  { name: 'D. Auto sin override', config: camelConfig, vt: 'auto-id', expected: 0 }, // It returns 0 because day 1 < 11
  { name: 'E. vehicleTypeId null', config: camelConfig, vt: null, expected: 0 }
];

tests.forEach(t => {
  const res = PricingEngine.calculateDebtSurcharge({
    baseAmount: 300000,
    billingPeriod: '2026-10', // today is oct 1, so period 2026-10 starts on oct 1, delay is 1 day
    now: new Date('2026-10-01T08:00:00Z'),
    config: t.config,
    vehicleTypeId: t.vt
  });
  console.log(`Test ${t.name}: percentage=${res.percentage}`);
});
