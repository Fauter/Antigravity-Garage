-- MIGRATION 001: Initial Schema (Parity with NeDB)
-- Core Rule: Maintain NeDB parity. Non-normalized arrays/objects stored as JSON TEXT.
-- Note: NeDB uses _id as primary key. We use _id as PRIMARY KEY in SQLite to tolerate legacy duplicated 'id's.

-- 1. Garages (Metadata)
CREATE TABLE garages (
    _id TEXT PRIMARY KEY,
    id TEXT,
    name TEXT,
    address TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

-- 2. Configuration & Financial Configs
CREATE TABLE financial_configs (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    initial_tolerance INTEGER,
    fractionate_after INTEGER,
    surcharge_config TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE vehicle_types (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    name TEXT,
    description TEXT,
    is_active INTEGER,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE tariffs (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    name TEXT,
    days INTEGER,
    hours INTEGER,
    minutes INTEGER,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE prices (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    vehicle_type_id TEXT,
    tariff_id TEXT,
    amount REAL,
    price_list TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

-- 3. Core Entities
CREATE TABLE customers (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    name TEXT,
    phone TEXT,
    email TEXT,
    document TEXT,
    address TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE vehicles (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    plate TEXT,
    brand TEXT,
    model TEXT,
    color TEXT,
    customer_id TEXT,
    vehicle_type_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE subscriptions (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    customer_id TEXT,
    vehicle_id TEXT,
    start_date TEXT,
    end_date TEXT,
    status TEXT,
    amount REAL,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE cocheras (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    nombre TEXT,
    estado TEXT,
    cliente_id TEXT,
    precio_base REAL,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

-- 4. Operational
CREATE TABLE stays (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    plate TEXT,
    entry_time TEXT,
    exit_time TEXT,
    status TEXT,
    vehicle_type TEXT,
    vehicle_id TEXT,
    notes TEXT,
    barcode TEXT,
    ticket_code TEXT,
    exit_authorized INTEGER,
    amount_paid REAL,
    stay_time_minutes INTEGER,
    entry_photo_path TEXT,
    exit_photo_path TEXT,
    scanned_document TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE movements (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    type TEXT,
    amount REAL,
    category TEXT,
    description TEXT,
    date TEXT,
    payment_method TEXT,
    shift_id TEXT,
    related_entity_id TEXT,
    invoice_type TEXT,
    ticket_number TEXT,
    receipt_number TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE debts (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    customer_id TEXT,
    subscription_id TEXT,
    amount REAL,
    month INTEGER,
    year INTEGER,
    status TEXT,
    due_date TEXT,
    surcharge_applied REAL,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

-- 5. Shifts and Audits
CREATE TABLE employees (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    name TEXT,
    role TEXT,
    pin TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE shifts (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    employee_id TEXT,
    start_time TEXT,
    end_time TEXT,
    status TEXT,
    initial_cash REAL,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE partial_closes (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    shift_id TEXT,
    amount REAL,
    declared_amount REAL,
    difference REAL,
    observations TEXT,
    created_by TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE shift_closes (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    shift_id TEXT,
    total_system REAL,
    total_declared REAL,
    difference REAL,
    cash_amount REAL,
    card_amount REAL,
    transfer_amount REAL,
    observations TEXT,
    closed_by TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE incidents (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    description TEXT,
    operator_name TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE hardware_events (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    event_type TEXT,
    device TEXT,
    status TEXT,
    timestamp TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE promos (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    name TEXT,
    discount_percentage REAL,
    is_active INTEGER,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE building_levels (
    _id TEXT PRIMARY KEY,
    id TEXT,
    garage_id TEXT,
    level_name TEXT,
    capacity INTEGER,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

-- 6. Offline-First Sync Infrastructure (Outbox Phase 1)
-- Replaces NeDB mutations
CREATE TABLE outbox_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL, -- INSERT, UPDATE, DELETE
    payload TEXT, -- JSON
    status TEXT NOT NULL, -- PENDING, RETRY, BLOCKED, ACKED
    attempts INTEGER DEFAULT 0,
    last_error_code TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    acked_at TEXT,
    created_at TEXT,
    updated_at TEXT
);

-- Indexación crítica para el Worker futuro
CREATE INDEX idx_outbox_status_next ON outbox_events(status, next_attempt_at);
CREATE INDEX idx_outbox_entity ON outbox_events(entity_type, entity_id);

-- Checkpoints para el Pull
CREATE TABLE sync_checkpoints (
    entity_type TEXT PRIMARY KEY,
    last_synced_at TEXT NOT NULL
);

-- Conservamos temporalmente syncState y syncConflicts para evitar perder metadata legacy en el shadow mode
CREATE TABLE sync_state (
    id TEXT PRIMARY KEY,
    last_pull TEXT,
    last_push TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);

CREATE TABLE sync_conflicts (
    id TEXT PRIMARY KEY,
    entity_type TEXT,
    entity_id TEXT,
    local_data TEXT,
    remote_data TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT,
    json_data TEXT
);
