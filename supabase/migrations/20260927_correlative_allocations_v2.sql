-- =====================================================
-- P0.3A: Idempotent Correlative Allocation System
-- Run this migration on Supabase (PostgreSQL)
-- =====================================================

-- 1. Create the allocation audit/idempotency table
CREATE TABLE IF NOT EXISTS correlative_allocations (
    id SERIAL PRIMARY KEY,
    garage_id UUID NOT NULL,
    correlative_type TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    start_val INTEGER NOT NULL,
    end_val INTEGER NOT NULL,
    allocated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(garage_id, correlative_type, terminal_id, request_id)
);

-- 2. Create the new idempotent RPC
CREATE OR REPLACE FUNCTION allocate_ticket_block_v2(
    p_garage_id UUID, 
    p_terminal_id TEXT, 
    p_size INT, 
    p_type TEXT, 
    p_request_id TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    existing RECORD;
    current_val INT;
    v_start_val INT;
    v_end_val INT;
BEGIN
    -- 1. Idempotency check: if this exact request was already served, return same result
    SELECT ca.start_val, ca.end_val INTO existing
    FROM correlative_allocations ca
    WHERE ca.garage_id = p_garage_id 
      AND ca.correlative_type = p_type
      AND ca.terminal_id = p_terminal_id
      AND ca.request_id = p_request_id;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'start_val', existing.start_val,
            'end_val', existing.end_val,
            'idempotent', true
        );
    END IF;

    -- 2. Atomically advance the global counter (row-level lock)
    INSERT INTO garage_correlatives (garage_id, correlative_type, last_value)
    VALUES (p_garage_id, p_type, p_size)
    ON CONFLICT (garage_id, correlative_type) DO UPDATE
    SET last_value = garage_correlatives.last_value + p_size
    RETURNING last_value INTO current_val;

    v_end_val := current_val;
    v_start_val := current_val - p_size + 1;

    -- 3. Record the allocation for idempotency and audit
    INSERT INTO correlative_allocations 
        (garage_id, correlative_type, terminal_id, request_id, start_val, end_val)
    VALUES 
        (p_garage_id, p_type, p_terminal_id, p_request_id, v_start_val, v_end_val);

    RETURN jsonb_build_object(
        'start_val', v_start_val,
        'end_val', v_end_val,
        'idempotent', false
    );
END;
$$;

-- 3. Grant access (adjust role as needed)
-- GRANT EXECUTE ON FUNCTION allocate_ticket_block_v2 TO authenticated;
-- GRANT EXECUTE ON FUNCTION allocate_ticket_block_v2 TO anon;

-- 4. Index for fast idempotency lookups
CREATE INDEX IF NOT EXISTS idx_correlative_alloc_lookup 
    ON correlative_allocations(garage_id, correlative_type, terminal_id, request_id);
