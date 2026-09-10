import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { StorageEngine } from '../src/infrastructure/database/StorageEngine';
import { CorrelativeGenerator } from '../src/shared/CorrelativeGenerator';
import { v4 as uuidv4 } from 'uuid';

describe('Stay Correlative Generator (SQLite Atomic)', () => {
    let db: any;
    const garageA = 'garage-A';
    const garageB = 'garage-B';

    beforeAll(async () => {
        StorageEngine.setEngine('SQLITE');
        db = SQLiteManager.getInstance().getDatabase();
    });

    beforeEach(() => {
        // Clear tables for a clean slate, but we will seed specific data for tests
        db.exec(`CREATE TABLE IF NOT EXISTS correlatives (garage_id TEXT, type TEXT, last_value INTEGER, PRIMARY KEY (garage_id, type))`);
        db.exec(`DELETE FROM correlatives;`);
        db.exec(`DELETE FROM stays;`);
        db.exec(`DELETE FROM movements;`);
    });

    it('T1: existing max E0000094 -> next E0000095', async () => {
        // Seed legacy stay with ticketCode (camelCase)
        db.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run(
            'stay1', JSON.stringify({ garageId: garageA, ticketCode: 'E0000094' })
        );

        const next = await CorrelativeGenerator.nextStayTicket(garageA);
        expect(next).toBe('E0000095');
        
        // Assert correlative was created correctly
        const row = db.prepare(`SELECT last_value FROM correlatives WHERE garage_id = ? AND type = 'stay'`).get(garageA) as any;
        expect(row.last_value).toBe(95);
    });

    it('T2: next again -> E0000096', async () => {
        // Seed legacy stay with ticket_code (snake_case)
        db.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run(
            'stay1', JSON.stringify({ garageId: garageA, ticket_code: 'E0000095' })
        );

        const next = await CorrelativeGenerator.nextStayTicket(garageA);
        expect(next).toBe('E0000096');
    });

    it('T3: restart -> continues from last_value in correlatives', async () => {
        db.prepare(`INSERT INTO correlatives (garage_id, type, last_value) VALUES (?, ?, ?)`).run(garageA, 'stay', 96);
        const next = await CorrelativeGenerator.nextStayTicket(garageA);
        expect(next).toBe('E0000097');
    });

    it('T4: garage isolation', async () => {
        db.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run('stayA', JSON.stringify({ garageId: garageA, ticket_code: 'E0000094' }));
        db.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run('stayB', JSON.stringify({ garageId: garageB, ticket_code: 'E0004564' }));

        const nextA = await CorrelativeGenerator.nextStayTicket(garageA);
        const nextB = await CorrelativeGenerator.nextStayTicket(garageB);

        expect(nextA).toBe('E0000095');
        expect(nextB).toBe('E0004565');
    });

    it('T5: 10 concurrent allocations unique', async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(CorrelativeGenerator.nextStayTicket(garageA));
        }

        const results = await Promise.all(promises);
        const unique = new Set(results);
        
        // They should all be unique and exactly 10
        expect(unique.size).toBe(10);
        
        // They should be E0000001 to E0000010
        const sorted = [...results].sort();
        expect(sorted[0]).toBe('E0000001');
        expect(sorted[9]).toBe('E0000010');
    });

    it('T6: offline allocation works via SQLite', async () => {
        // Just calling it directly tests offline since this entire stack is SQLite only
        const t1 = await CorrelativeGenerator.nextStayTicket(garageA);
        const t2 = await CorrelativeGenerator.nextStayTicket(garageA);
        expect(t1).toBe('E0000001');
        expect(t2).toBe('E0000002');
    });

    it('T10: prepaid: Stay code != Movement code, both valid and independent', async () => {
        // Seed some history
        db.prepare(`INSERT INTO stays (id, json_data) VALUES (?, ?)`).run('s1', JSON.stringify({ garageId: garageA, ticket_code: 'E0000096' }));
        db.prepare(`INSERT INTO movements (id, json_data) VALUES (?, ?)`).run('m1', JSON.stringify({ garageId: garageA, ticket_code: '00000120' }));

        const stayTicket = await CorrelativeGenerator.nextStayTicket(garageA);
        const movTicket = CorrelativeGenerator.allocateMovementTicketCode(garageA);

        expect(stayTicket).toBe('E0000097');
        expect(movTicket).toBe('00000121');
    });
});
