-- =====================================================
-- P0.3C: Idempotent Correlative Allocation with High-Water Mark
-- Run this migration on Supabase (PostgreSQL)
-- =====================================================

-- 1. Create the allocation audit/idempotency table (if not exists)
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

-- 2. Create the new idempotent RPC with extreme concurrency hardening
CREATE OR REPLACE FUNCTION allocate_ticket_block_v3(
    p_garage_id UUID, 
    p_terminal_id TEXT, 
    p_size INT, 
    p_type TEXT, 
    p_request_id TEXT,
    p_min_value INT DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    existing RECORD;
    v_last_val INT;
    v_start_val INT;
    v_end_val INT;
BEGIN
    -- 1. Create the global counter row safely if it does not exist.
    -- Using DO NOTHING prevents UNIQUE violations when multiple requests 
    -- try to initialize the counter at the exact same time.
    INSERT INTO garage_correlatives (garage_id, correlative_type, last_value)
    VALUES (p_garage_id, p_type, 0)
    ON CONFLICT (garage_id, correlative_type) DO NOTHING;

    -- 2. Serialize all concurrent requests for this garage and type.
    -- By locking the row FIRST, we ensure the idempotency check and 
    -- block allocation happen atomically in a single critical section.
    SELECT last_value INTO v_last_val
    FROM garage_correlatives
    WHERE garage_id = p_garage_id AND correlative_type = p_type
    FOR UPDATE;

    -- 3. Idempotency check: executed SAFELY inside the lock.
    -- If request A and B arrive simultaneously with the same request_id, 
    -- B will wait at the FOR UPDATE lock. When A finishes and commits, 
    -- B acquires the lock, executes this query, finds A's result, 
    -- and returns it safely without attempting to allocate or insert.
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

    -- 4. Enforce Monotonicity (High-Water Mark)
    -- The counter is mathematically guaranteed to never go backwards.
    IF p_min_value > v_last_val THEN
        v_last_val := p_min_value;
    END IF;

    -- 5. Allocate block
    v_start_val := v_last_val + 1;
    v_end_val := v_last_val + p_size;

    -- 6. Update global counter
    UPDATE garage_correlatives
    SET last_value = v_end_val
    WHERE garage_id = p_garage_id AND correlative_type = p_type;

    -- 7. Record the allocation for idempotency and audit
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

-- 3. Grant access
-- GRANT EXECUTE ON FUNCTION allocate_ticket_block_v3 TO authenticated;
-- GRANT EXECUTE ON FUNCTION allocate_ticket_block_v3 TO anon;

-- 4. Index for fast idempotency lookups
CREATE INDEX IF NOT EXISTS idx_correlative_alloc_lookup 
    ON correlative_allocations(garage_id, correlative_type, terminal_id, request_id);
