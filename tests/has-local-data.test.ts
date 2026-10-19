/**
 * GET /api/sync/has-local-data/:garageId
 *
 * Contract under test (see LocalDataProbe.ts):
 *  - 100% local, never touches Supabase
 *  - 200 for both true and false
 *  - 400 only for a malformed garageId
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

process.env.NODE_ENV = 'test';

// Supabase must never be reached by this endpoint. Any use is a test failure.
const supabaseTouched = vi.fn(() => { throw new Error('SUPABASE_MUST_NOT_BE_USED (simulated offline)'); });
vi.mock('../src/infrastructure/lib/supabase', () => ({
    SUPABASE_URL: 'http://offline.invalid',
    supabase: new Proxy({}, { get: () => supabaseTouched }),
}));
vi.mock('../src/infrastructure/lib/supabase.js', () => ({
    SUPABASE_URL: 'http://offline.invalid',
    supabase: new Proxy({}, { get: () => supabaseTouched }),
}));

import { SQLiteManager } from '../src/infrastructure/database/sqlite/SQLiteManager';
import { createHasLocalDataHandler, probeLocalData, isValidGarageId } from '../src/modules/Sync/application/LocalDataProbe';

const GARAGE = 'ebf7eaa0-339e-455f-bcde-dd51636e1f21';
const OTHER = '11111111-2222-3333-4444-555555555555';

let server: Server;
let base: string;

const db = () => SQLiteManager.getInstance().getDatabase();

function seedFull(garageId: string) {
    db().prepare(`INSERT OR REPLACE INTO garages (id, json_data) VALUES (?, ?)`).run(garageId, JSON.stringify({ id: garageId, name: 'G' }));
    db().prepare(`INSERT OR REPLACE INTO vehicle_types (id, json_data) VALUES (?, ?)`).run(`vt-${garageId}`, JSON.stringify({ id: `vt-${garageId}`, garageId }));
    db().prepare(`INSERT OR REPLACE INTO tariffs (id, json_data) VALUES (?, ?)`).run(`t-${garageId}`, JSON.stringify({ id: `t-${garageId}`, garageId }));
    db().prepare(`INSERT OR REPLACE INTO prices (id, json_data) VALUES (?, ?)`).run(`p-${garageId}`, JSON.stringify({ id: `p-${garageId}`, garageId }));
}

async function get(id: string) {
    const res = await fetch(`${base}/api/sync/has-local-data/${encodeURIComponent(id)}`);
    return { status: res.status, body: await res.json() as any };
}

beforeAll(async () => {
    const app = express();
    app.get('/api/sync/has-local-data/:garageId', createHasLocalDataHandler(() => db()));
    app.get('/api/sync/has-local-data-broken/:garageId', createHasLocalDataHandler(() => { throw new Error('disk I/O error'); }));
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
    for (const t of ['garages', 'vehicle_types', 'tariffs', 'prices']) db().exec(`DELETE FROM ${t}`);
    supabaseTouched.mockClear();
});

describe('has-local-data endpoint', () => {
    it('local data exists -> 200 { hasLocalData: true }', async () => {
        seedFull(GARAGE);
        const { status, body } = await get(GARAGE);
        expect(status).toBe(200);
        expect(body.hasLocalData).toBe(true);
    });

    it('no local data -> 200 { hasLocalData: false } (not 404)', async () => {
        const { status, body } = await get(GARAGE);
        expect(status).toBe(200);
        expect(body.hasLocalData).toBe(false);
    });

    it.each([
        ['garage row missing', `DELETE FROM garages`],
        ['no vehicle_types', `DELETE FROM vehicle_types`],
        ['no tariffs', `DELETE FROM tariffs`],
        ['no prices', `DELETE FROM prices`],
    ])('partial data (%s) -> 200 false so the client does a full bootstrap', async (_label, sql) => {
        seedFull(GARAGE);
        db().exec(sql);
        const { status, body } = await get(GARAGE);
        expect(status).toBe(200);
        expect(body.hasLocalData).toBe(false);
    });

    it('data of another garage does not count', async () => {
        seedFull(OTHER);
        const { status, body } = await get(GARAGE);
        expect(status).toBe(200);
        expect(body.hasLocalData).toBe(false);
    });

    it('Supabase offline/unavailable -> still answers locally and never calls Supabase', async () => {
        seedFull(GARAGE);
        const { status, body } = await get(GARAGE);
        expect(status).toBe(200);
        expect(body.hasLocalData).toBe(true);
        expect(supabaseTouched).not.toHaveBeenCalled();
    });

    it('malformed garageId -> 400 (defined behaviour), never 200/500', async () => {
        for (const bad of ['bad id!', 'a'.repeat(129), "x'; DROP TABLE garages;--", '%']) {
            const { status, body } = await get(bad);
            expect(status, bad).toBe(400);
            expect(body.error).toBeDefined();
        }
        expect(db().prepare(`SELECT count(*) c FROM garages`).get()).toBeDefined(); // table still there
    });

    it('well-formed but unknown garageId -> 200 false', async () => {
        const { status, body } = await get('does-not-exist-123');
        expect(status).toBe(200);
        expect(body.hasLocalData).toBe(false);
    });

    it('unreadable local DB -> 500 with explicit error (not a silent false)', async () => {
        const res = await fetch(`${base}/api/sync/has-local-data-broken/${GARAGE}`);
        expect(res.status).toBe(500);
    });

    it('isValidGarageId accepts uuid and rejects junk', () => {
        expect(isValidGarageId(GARAGE)).toBe(true);
        expect(isValidGarageId('')).toBe(false);
        expect(isValidGarageId(undefined)).toBe(false);
        expect(isValidGarageId('a/b')).toBe(false);
    });
});
