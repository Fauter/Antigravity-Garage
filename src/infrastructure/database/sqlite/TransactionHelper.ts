import { SQLiteManager } from './SQLiteManager';

export class TransactionHelper {
    /**
     * Executes a callback within an IMMEDIATE SQLite transaction.
     * Ensures all operations commit together, or rollback entirely on failure.
     */
    public static run<T>(callback: (db: any) => T): T {
        const db = SQLiteManager.getInstance().getDatabase();
        
        // BEGIN IMMEDIATE prevents SQLITE_BUSY by immediately acquiring a write lock
        db.exec('BEGIN IMMEDIATE;');
        try {
            const result = callback(db);
            db.exec('COMMIT;');
            return result;
        } catch (error) {
            db.exec('ROLLBACK;');
            throw error;
        }
    }

    /**
     * Async variant if we needed to await things (though node:sqlite is synchronous)
     */
    public static async runAsync<T>(callback: (db: any) => Promise<T>): Promise<T> {
        const db = SQLiteManager.getInstance().getDatabase();
        
        db.exec('BEGIN IMMEDIATE;');
        try {
            const result = await callback(db);
            db.exec('COMMIT;');
            return result;
        } catch (error) {
            db.exec('ROLLBACK;');
            throw error;
        }
    }
}
