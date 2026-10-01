import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CorrelativeGenerator } from '../src/shared/CorrelativeGenerator';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

describe('CorrelativeGenerator - Deep Audit', () => {
    let db: any;
    let testDbPath: string;

    beforeEach(() => {
        // Init a fresh local db for testing
        const dbManager = SQLiteManager.initForTest();
        db = dbManager.getDatabase();
        testDbPath = dbManager.getDbPath();

        db.exec(`
            CREATE TABLE IF NOT EXISTS stays (id TEXT PRIMARY KEY, json_data TEXT);
            CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, json_data TEXT);
        `);
    });

    afterEach(() => {
        SQLiteManager.resetInstance();
        if (fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch (e) {}
        }
    });

    it('TEST 1: Ultimo receipt 1566, debe asignar 1567', async () => {
        const garageId = 'g1';
        db.prepare('INSERT INTO movements (id, json_data) VALUES (?, ?)').run(
            uuidv4(), JSON.stringify({ garageId, ticket_code: '00001566' })
        );
        const code = CorrelativeGenerator.allocateMovementTicketCode(garageId, db);
        expect(code).toBe('00001567');
    });

    it('TEST 2: Reiniciar, debe continuar usando la DB persistida (1568)', async () => {
        const garageId = 'g1';
        // Simulate previous state
        db.exec(`CREATE TABLE IF NOT EXISTS correlatives (garage_id TEXT, type TEXT, last_value INTEGER, PRIMARY KEY (garage_id, type))`);
        db.prepare('INSERT INTO correlatives (garage_id, type, last_value) VALUES (?, ?, ?)').run(garageId, 'movement', 1567);
        
        const code = CorrelativeGenerator.allocateMovementTicketCode(garageId, db);
        expect(code).toBe('00001568');
    });

    it('TEST 3 & 5: Eliminar manualmente el ultimo, debe respetar el counter', async () => {
        const garageId = 'g1';
        // We have 1566 in DB and 1567 in correlatives
        db.prepare('INSERT INTO movements (id, json_data) VALUES (?, ?)').run(
            uuidv4(), JSON.stringify({ garageId, ticket_code: '00001566' })
        );
        db.exec(`CREATE TABLE IF NOT EXISTS correlatives (garage_id TEXT, type TEXT, last_value INTEGER, PRIMARY KEY (garage_id, type))`);
        db.prepare('INSERT INTO correlatives (garage_id, type, last_value) VALUES (?, ?, ?)').run(garageId, 'movement', 1567);
        
        // Next should be 1568, NOT 1567
        const code = CorrelativeGenerator.allocateMovementTicketCode(garageId, db);
        expect(code).toBe('00001568');
    });

    it('TEST 4: Persisted counter menor que historial, debe recuperarse de forma segura', async () => {
        const garageId = 'g1';
        // Database has 1570, but correlatives lost it or has 10
        db.prepare('INSERT INTO movements (id, json_data) VALUES (?, ?)').run(
            uuidv4(), JSON.stringify({ garageId, ticket_code: '00001570' })
        );
        db.exec(`CREATE TABLE IF NOT EXISTS correlatives (garage_id TEXT, type TEXT, last_value INTEGER, PRIMARY KEY (garage_id, type))`);
        db.prepare('INSERT INTO correlatives (garage_id, type, last_value) VALUES (?, ?, ?)').run(garageId, 'movement', 10);
        
        const code = CorrelativeGenerator.allocateMovementTicketCode(garageId, db);
        expect(code).toBe('00001571'); // Uses max
    });

    it('TEST 6 & 7: Dos terminales concurrentes sin sync', async () => {
        const garageId = 'g1';
        // En lugar de inicializar dos DBs (que cierra la anterior), 
        // simulamos que ambas terminales leen el mismo max = 1564
        // A y B tienen su propia copia local offline
        
        // Simulación Terminal A
        db.prepare('INSERT INTO movements (id, json_data) VALUES (?, ?)').run(uuidv4(), JSON.stringify({ garageId, ticket_code: '00001564' }));
        const codeA = CorrelativeGenerator.allocateMovementTicketCode(garageId, db);
        expect(codeA).toBe('00001565');

        // Simulación Terminal B (en otra PC, que aun no recibio el 1565 de A)
        // Para simularlo, vaciamos la tabla de movements local y ponemos el 1564
        db.exec('DELETE FROM movements');
        db.exec('DELETE FROM correlatives');
        db.prepare('INSERT INTO movements (id, json_data) VALUES (?, ?)').run(uuidv4(), JSON.stringify({ garageId, ticket_code: '00001564' }));
        
        const codeB = CorrelativeGenerator.allocateMovementTicketCode(garageId, db);
        
        // Ambos generaron 1565 porque estaban offline sin sync!
        expect(codeB).toBe('00001565');
        expect(codeA).toBe(codeB);
    });
});
