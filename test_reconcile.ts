import 'reflect-metadata';
import { SQLiteManager } from './src/infrastructure/database/sqlite/SQLiteManager.js';
import { DebtRepository } from './src/modules/Garage/infra/DebtRepository.js';
import { MovementRepository } from './src/modules/Garage/infra/MovementRepository.js';
import { SubscriptionRepository } from './src/modules/Garage/infra/SubscriptionRepository.js';
import { SubscriptionCoverageReconciler } from './src/modules/Billing/application/SubscriptionCoverageReconciler.js';

async function run() {
    await SQLiteManager.getInstance().initialize();
    
    const subRepo = new SubscriptionRepository();
    const debtRepo = new DebtRepository();
    const movRepo = new MovementRepository();
    const reconciler = new SubscriptionCoverageReconciler();
    
    const garageId = 'ebf7eaa0-339e-455f-bcde-dd51636e1f21';
    const allDebts = await debtRepo.findAll();
    const allMovements = await movRepo.findAll();
    
    const subs = await subRepo.findAll();
    const mySub = subs.find(s => s.id === 'bfa14165-1b8a-4d43-9b73-b0a01d4741b0');
    
    if (mySub) {
        console.log("OLD END DATE:", mySub.endDate);
        const effectiveEnd = reconciler.reconcileCoverage(mySub as any, garageId, allDebts, allMovements);
        const storedEnd = new Date(mySub.endDate);
        console.log("CALCULATED END DATE:", effectiveEnd.toISOString());
        
        if (effectiveEnd > storedEnd) {
            mySub.endDate = effectiveEnd.toISOString();
            mySub.updatedAt = new Date();
            await subRepo.save(mySub as any);
            console.log("SAVED!");
        } else {
            console.log("NOT SAVED (NO CHANGE)");
        }
    } else {
        console.log("SUB NOT FOUND");
    }
}
run().catch(console.error);
