import { db } from './src/infrastructure/database/datastore.js';

async function purgeDuplicateDebts() {
    console.log("Iniciando purga de emergencia...");

    // Purge local debts that are duplicates or have the static 34500 amount
    const allDebts = await db.debts.find({});
    console.log(`Deudas locales totales: ${allDebts.length}`);

    let removedCounts = 0;
    const keepIds = new Set();
    const subMonthMap = new Map(); // subId_year_month -> true

    for (const debt of allDebts) {
        if (!debt.dueDate) continue;
        const dueDate = new Date(debt.dueDate);
        const key = `${debt.subscriptionId}_${dueDate.getFullYear()}_${dueDate.getMonth() + 1}`;

        // Remove uuidv4 formatted bad debts entirely (uuid length 36)
        if (debt.id.length === 36) {
            await db.debts.remove({ id: debt.id }, { multi: false });
            removedCounts++;
            continue;
        }

        // If it's a deterministic ID but duplicated (should not happen natively with map, but safety first):
        if (subMonthMap.has(key)) {
            await db.debts.remove({ id: debt.id }, { multi: false });
            removedCounts++;
        } else {
            subMonthMap.set(key, true);
        }
    }

    console.log(`Se eliminaron ${removedCounts} deudas locales duplicadas o con ID uuidv4 erróneas.`);

    // Clean up mutation queue from these bad debts
    const pendingMutations = await db.mutations.find({ entityType: 'Debt' });
    let removedMutations = 0;
    for (const mut of pendingMutations) {
        if (mut.payload && mut.payload.id && mut.payload.id.length === 36) {
            await db.mutations.remove({ id: mut.id }, { multi: false });
            removedMutations++;
        }
    }

    console.log(`Se eliminaron ${removedMutations} mutaciones de deudas basuras.`);
    console.log("Limpieza completada.");
}

purgeDuplicateDebts().catch(console.error);
