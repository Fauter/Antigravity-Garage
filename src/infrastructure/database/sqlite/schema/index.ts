export const FRESH_SCHEMA = `
-- MIGRATION 002: Production Schema (V2)

-- Domain tables
CREATE TABLE IF NOT EXISTS garages (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS financial_configs (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS vehicle_types (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS tariffs (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS prices (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS cocheras (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS stays (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS debts (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS partial_closes (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS shift_closes (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS hardware_events (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS promos (id TEXT PRIMARY KEY, json_data TEXT);
CREATE TABLE IF NOT EXISTS building_levels (id TEXT PRIMARY KEY, json_data TEXT);

-- Transactional Outbox
CREATE TABLE IF NOT EXISTS outbox_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL, -- PENDING, RETRY, ACKED, BLOCKED
    attempts INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_attempt_at TEXT,
    next_attempt_at TEXT,
    acked_at TEXT,
    last_error_code TEXT,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_next ON outbox_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON outbox_events(entity_type, entity_id);

-- Sync Metadata
CREATE TABLE IF NOT EXISTS sync_checkpoints (
    collection_name TEXT PRIMARY KEY,
    last_synced_at TEXT NOT NULL
);

-- Migration Metadata (from V1)
CREATE TABLE IF NOT EXISTS migration_manifest (
    migration_id TEXT PRIMARY KEY,
    source_engine TEXT,
    source_version TEXT,
    target_schema_version INTEGER,
    status TEXT,
    started_at TEXT,
    completed_at TEXT,
    validated_at TEXT,
    source_fingerprint TEXT,
    validation_version TEXT
);

-- Legacy Quarantine
CREATE TABLE IF NOT EXISTS legacy_quarantine (
    quarantine_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_collection TEXT NOT NULL,
    legacy_nedb_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    original_payload TEXT NOT NULL,
    reason TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    canonical_domain_id TEXT,
    source_hash TEXT
);
`;

export const DOMAIN_TABLES = [
    'garages', 'financial_configs', 'vehicle_types', 'tariffs', 'prices',
    'customers', 'vehicles', 'subscriptions', 'cocheras', 'stays',
    'movements', 'debts', 'employees', 'shifts', 'partial_closes',
    'shift_closes', 'incidents', 'hardware_events', 'promos', 'building_levels'
];
