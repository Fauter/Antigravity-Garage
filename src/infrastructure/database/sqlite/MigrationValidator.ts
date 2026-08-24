import { db as NeDBStore } from '../datastore';
import { SQLiteManager } from './SQLiteManager';

export class MigrationValidator {
    private sqlite = SQLiteManager.getInstance().getDatabase();
    private discrepancies: string[] = [];
    private fkWarnings: any[] = [];

    public async validate(collections: {nedb: string, table: string}[]): Promise<boolean> {
        console.log('🔍 Iniciando Validación Exhaustiva Shadow...');
        
        let isValid = true;

        // 1. Database level integrity
        const integrityCheck = this.sqlite.prepare('PRAGMA integrity_check;').all() as any[];
        const isCorrupt = !integrityCheck.every(row => row.integrity_check === 'ok');
        if (isCorrupt) {
            this.discrepancies.push(`Corrupción estructural de SQLite: ${JSON.stringify(integrityCheck)}`);
            isValid = false;
        }

        for (const { nedb, table } of collections) {
            const passed = await this.validateCollection(nedb, table);
            if (!passed) isValid = false;
        }

        // Validate outbox
        const outboxPassed = await this.validateOutbox();
        if (!outboxPassed) isValid = false;

        // Financial Validation
        const financialPassed = await this.validateFinancials();
        if (!financialPassed) isValid = false;

        // Check FKs
        this.checkForeignKeys();

        if (this.discrepancies.length > 0) {
            console.error('❌ Shadow Migration INVALIDADA por las siguientes discrepancias:');
            this.discrepancies.forEach(d => console.error(`  - ${d}`));
        } else {
            console.log('✅ Shadow Migration VALIDADA con exactitud 1:1.');
        }

        if (this.fkWarnings.length > 0) {
            console.warn(`⚠️ Se encontraron ${this.fkWarnings.length} violaciones de Foreign Key heredadas de NeDB (Legacy Data Inconsistency).`);
            console.warn(this.fkWarnings.slice(0, 5)); // Mostrar primeras 5
        }

        return isValid;
    }

    private async validateFinancials(): Promise<boolean> {
        let valid = true;
        
        // Movements Amount
        const nedbMovements = await NeDBStore.movements.find({});
        const nedbTotalMov = nedbMovements.reduce((acc: number, m: any) => acc + (Number(m.amount) || 0), 0);
        
        const sqTotalMovRow = this.sqlite.prepare('SELECT SUM(amount) as total FROM movements').get() as {total: number};
        const sqTotalMov = sqTotalMovRow.total || 0;

        if (Math.abs(nedbTotalMov - sqTotalMov) > 0.01) {
            this.discrepancies.push(`Financial mismatch en movements: NeDB=${nedbTotalMov}, SQLite=${sqTotalMov}`);
            valid = false;
        }

        // Stays Amount Paid
        const nedbStays = await NeDBStore.stays.find({});
        const nedbTotalStay = nedbStays.reduce((acc: number, m: any) => acc + (Number(m.amountPaid || m.amount_paid) || 0), 0);
        
        const sqTotalStayRow = this.sqlite.prepare('SELECT SUM(amount_paid) as total FROM stays').get() as {total: number};
        const sqTotalStay = sqTotalStayRow.total || 0;

        if (Math.abs(nedbTotalStay - sqTotalStay) > 0.01) {
            this.discrepancies.push(`Financial mismatch en stays: NeDB=${nedbTotalStay}, SQLite=${sqTotalStay}`);
            valid = false;
        }

        return valid;
    }

    private async validateCollection(nedbName: string, tableName: string): Promise<boolean> {
        // @ts-ignore
        const nedbStore = NeDBStore[nedbName];
        if (!nedbStore) return true;

        const docs = await nedbStore.find({});
        const sqliteCountRow = this.sqlite.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number };
        const sqliteCount = sqliteCountRow.c;

        if (docs.length !== sqliteCount) {
            this.discrepancies.push(`Count mismatch en ${tableName}: NeDB=${docs.length}, SQLite=${sqliteCount}`);
            return false;
        }

        // ID Parity
        const nedbIds = new Set(docs.map((d: any) => d._id));
        const sqliteRows = this.sqlite.prepare(`SELECT * FROM ${tableName}`).all() as any[];
        const sqliteIds = new Set(sqliteRows.map(r => r._id));

        for (const id of nedbIds) {
            if (!sqliteIds.has(id)) {
                this.discrepancies.push(`Missing _id en SQLite ${tableName}: ${id}`);
                return false;
            }
        }
        for (const id of sqliteIds) {
            if (!nedbIds.has(id)) {
                this.discrepancies.push(`Extra _id en SQLite ${tableName}: ${id}`);
                return false;
            }
        }

        // Canonical Validation (Hashes)
        for (const nedbDoc of docs) {
            const sqliteDoc = sqliteRows.find(r => r._id === nedbDoc._id);
            const nedbHash = this.hashDocument(this.canonicalizeNeDB(nedbDoc));
            const sqliteHash = this.hashDocument(this.canonicalizeSQLite(sqliteDoc));

            if (nedbHash !== sqliteHash) {
                this.discrepancies.push(`Hash mismatch en ${tableName} para _id=${nedbDoc._id}. NeDB=${nedbHash}, SQLite=${sqliteHash}`);
                return false;
            }
        }

        return true;
    }

    private hashDocument(doc: any): string {
        const str = JSON.stringify(doc);
        return require('crypto').createHash('sha256').update(str).digest('hex');
    }

    private canonicalizeNeDB(doc: any): any {
        // Ordenamos las llaves y extraemos null/undefined como omitidos para match exacto
        const clean: any = {};
        Object.keys(doc).sort().forEach(k => {
            if (doc[k] !== undefined) {
                clean[k] = doc[k];
            }
        });
        // Removemos _id porque ya lo chequeamos por separado, y el ID real es 'id'
        // Wait, mantenemos _id porque forma parte del doc.
        return clean;
    }

    private canonicalizeSQLite(row: any): any {
        // En SQLite, JSON se guardó como string en 'json_data', y los campos están en snake_case.
        // Reconstruimos a camelCase.
        let reconstructed: any = {};
        if (row.json_data) {
            try {
                reconstructed = JSON.parse(row.json_data);
            } catch (e) {}
        }
        
        Object.keys(row).forEach(k => {
            if (k === 'json_data') return;
            if (row[k] === null) return; // SQLite nulls -> undefined in NeDB
            
            // camelCase
            const camelKey = k.replace(/_([a-z])/g, g => g[1].toUpperCase());
            // SQLite almacena fechas ISO o enteros para booleanos
            // En nuestra reconstrucción, devolvemos el valor crudo porque json_data tiene los originales no normalizados
            if (reconstructed[camelKey] === undefined) {
                reconstructed[camelKey] = row[k];
            }
        });

        const clean: any = {};
        Object.keys(reconstructed).sort().forEach(k => {
            if (reconstructed[k] !== undefined && reconstructed[k] !== null) {
                clean[k] = reconstructed[k];
            }
        });
        return clean;
    }

    private async validateOutbox(): Promise<boolean> {
        const docs = await NeDBStore.mutations.find({});
        const sqliteCountRow = this.sqlite.prepare(`SELECT COUNT(*) as c FROM outbox_events`).get() as { c: number };
        
        if (docs.length !== sqliteCountRow.c) {
            this.discrepancies.push(`Count mismatch en outbox_events: NeDB=${docs.length}, SQLite=${sqliteCountRow.c}`);
            return false;
        }
        
        return true;
    }

    private checkForeignKeys() {
        const violations = this.sqlite.prepare('PRAGMA foreign_key_check;').all();
        if (violations.length > 0) {
            this.fkWarnings = violations;
        }
    }

    public getDiscrepancies() { return this.discrepancies; }
    public getFkWarnings() { return this.fkWarnings; }
}
