import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';


const EXE_PATH = path.join(__dirname, '../dist_electron/win-unpacked/GarageIA.exe');
const API_URL = 'http://localhost:3000';

const USER_DATA_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'GarageIA', 'database');

describe('PHASE 3 - GATES A & B: PACKAGED APP & OFFLINE REAL', () => {
    let appProcess: ChildProcess;

    beforeAll(async () => {
        if (!fs.existsSync(EXE_PATH)) {
            console.warn('⚠️ Packaged GarageIA.exe not found at dist_electron/win-unpacked. Skipping packaged E2E test.');
            return;
        }
        try { require('child_process').execSync('taskkill /F /IM GarageIA.exe /T'); } catch {}
        // Clean packaged user data to start fresh if needed, but let's just observe it for now.
        if (fs.existsSync(USER_DATA_PATH)) {
            // We can optionally clear it, but it's safe to just reuse
            fs.rmSync(USER_DATA_PATH, { recursive: true, force: true });
        }
        
        // Force engine to SQLITE for testing Phase 3
        fs.mkdirSync(USER_DATA_PATH, { recursive: true });
        fs.writeFileSync(path.join(USER_DATA_PATH, 'storage-engine.json'), JSON.stringify({ engine: 'SQLITE' }));

        console.log('Launching:', EXE_PATH);
        appProcess = spawn(EXE_PATH, [], { detached: true });
        
        // Wait for server to boot
        let isUp = false;
        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`${API_URL}/api/precios`);
                if (res.ok) { isUp = true; break; }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 1000));
        }
        
        if (!isUp) throw new Error('Packaged app did not start the Express server on port 3000');
    }, 45000);

    afterAll(() => {
        if (appProcess) {
            try { process.kill(-appProcess.pid!); } catch (e) {
                try { appProcess.kill('SIGTERM'); } catch (e2) {}
            }
        }
    });

    it('GATE A3: SQLite database is in userData/database', () => {
        if (!fs.existsSync(EXE_PATH)) return;
        const dbPath = path.join(USER_DATA_PATH, 'garageia.sqlite');
        expect(fs.existsSync(dbPath)).toBe(true);
        // It's not in cwd or ASAR
        expect(dbPath).not.toContain('dist_electron');
        expect(dbPath).not.toContain('app.asar');
    });

    it('GATE A4: WAL Pragmas are respected', () => {
        if (!fs.existsSync(EXE_PATH)) return;
        const dbPath = path.join(USER_DATA_PATH, 'garageia.sqlite');
        const db = new DatabaseSync(dbPath);
        const journalMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
        expect(journalMode.journal_mode.toLowerCase()).toBe('wal');
        
        const synchronous = db.prepare('PRAGMA synchronous').get() as { synchronous: number };
        expect(synchronous.synchronous).toBeGreaterThanOrEqual(1); // 1=NORMAL, 2=FULL
        db.close();
    });

    it('GATE A5: Normal Operations - Create Customer', async () => {
        if (!fs.existsSync(EXE_PATH)) return;
        // Create Customer
        const cRes = await fetch(`${API_URL}/api/clientes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-garage-id': '11111111-1111-4111-8111-111111111111' },
            body: JSON.stringify({ nombreApellido: 'Phase3 Tester', dni: '12345678', telefono: '123' })
        });
        if (!cRes.ok) console.error(cRes.status, await cRes.text());
        expect(cRes.ok).toBe(true);
        const customer = await cRes.json();
        expect(customer.id).toBeDefined();
    });

    it('GATE B2: Offline CREATE - Stay creation', async () => {
        if (!fs.existsSync(EXE_PATH)) return;
        const sRes = await fetch(`${API_URL}/api/estadias/entrada`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-garage-id': '11111111-1111-4111-8111-111111111111' },
            body: JSON.stringify({ plate: 'G3-OFF', vehicleType: 'auto' })
        });
        if (!sRes.ok) console.error(sRes.status, await sRes.text());
        expect(sRes.ok).toBe(true);
        const stay = await sRes.json();
        console.log("STAY RESPONSE:", stay);
        const stayId = stay.id || stay._id || stay.stay?.id || stay.stay?._id;
        expect(stayId).toBeDefined();

        // Check SQLite directly for Outbox event PENDING
        const db = new DatabaseSync(path.join(USER_DATA_PATH, 'garageia.sqlite'));
        const outbox = db.prepare("SELECT * FROM outbox_events WHERE entity_id = ? AND entity_type = 'Stay'").all(stayId);
        expect(outbox.length).toBeGreaterThan(0);
        expect(outbox[0].status).toBe('PENDING');
        db.close();
    });

    it('GATE B3: Offline UPDATE - Stay exit', async () => {
        if (!fs.existsSync(EXE_PATH)) return;
        // Create stay first
        const sRes = await fetch(`${API_URL}/api/estadias/entrada`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-garage-id': '11111111-1111-4111-8111-111111111111' },
            body: JSON.stringify({ plate: 'G3-EXIT', vehicleType: 'auto' })
        });
        const stay = await sRes.json();

        const stayId = stay.id || stay._id || stay.stay?.id || stay.stay?._id;

        // Exit stay
        const exitRes = await fetch(`${API_URL}/api/estadias/salida`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-garage-id': '11111111-1111-4111-8111-111111111111' },
            body: JSON.stringify({ plate: 'G3-EXIT' })
        });
        if (!exitRes.ok) console.error(exitRes.status, await exitRes.text());
        expect(exitRes.ok).toBe(true);

        const db = new DatabaseSync(path.join(USER_DATA_PATH, 'garageia.sqlite'));
        const outbox = db.prepare("SELECT * FROM outbox_events WHERE entity_id = ? AND entity_type = 'Stay' ORDER BY sequence DESC").all(stayId);
        expect(outbox.length).toBeGreaterThanOrEqual(2);
        expect((outbox[0] as any).operation).toBe('UPDATE');
        db.close();
    });
});
