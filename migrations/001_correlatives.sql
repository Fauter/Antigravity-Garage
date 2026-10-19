-- 1. Create a table to track correlative allocations per garage
CREATE TABLE garage_correlatives (
    garage_id uuid,
    correlative_type text,
    last_value int NOT NULL DEFAULT 0,
    PRIMARY KEY (garage_id, correlative_type)
);

-- 2. Create the Atomic RPC to allocate a block of tickets
CREATE OR REPLACE FUNCTION allocate_ticket_block(p_garage_id uuid, p_terminal_id text, p_size int, p_type text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    current_val int;
    v_start_val int;
    v_end_val int;
BEGIN
    -- This UPDATE is atomic and row-level locks the specific garage and type
    INSERT INTO garage_correlatives (garage_id, correlative_type, last_value)
    VALUES (p_garage_id, p_type, p_size)
    ON CONFLICT (garage_id, correlative_type) DO UPDATE
    SET last_value = garage_correlatives.last_value + p_size
    RETURNING last_value INTO current_val;

    -- Calculate the block bounds
    v_end_val := current_val;
    v_start_val := current_val - p_size + 1;

    RETURN jsonb_build_object(
        'start_val', v_start_val,
        'end_val', v_end_val
    );
END;
$$;

-- 3. To apply the UNIQUE constraint safely:
-- FIRST, run an audit to find duplicates across ALL movements:
/*
  SELECT garage_id, ticket_code, COUNT(*) 
  FROM movements 
  WHERE ticket_code IS NOT NULL 
  GROUP BY garage_id, ticket_code 
  HAVING COUNT(*) > 1;
*/
-- SECOND, update the duplicates to append a letter (e.g. 1535A, 1535B) or assign new codes
-- THIRD, apply the constraint:
/*
  CREATE UNIQUE INDEX idx_unique_global_ticket_code_movement 
  ON movements (garage_id, ticket_code) 
  WHERE ticket_code IS NOT NULL;
  
  CREATE UNIQUE INDEX idx_unique_global_ticket_code_stay
  ON stays (garage_id, ticket_code)
  WHERE ticket_code IS NOT NULL;
*/

-- ==============================================================================
-- 4. BACKFILL AUTOMÁTICO PARA GARAGES EXISTENTES
-- ==============================================================================

-- Llenar la secuencia de MOVEMENTS basándose en el historial real
INSERT INTO garage_correlatives (garage_id, correlative_type, last_value)
SELECT 
    garage_id, 
    'movement' as correlative_type, 
    COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(ticket_code, '\D', '', 'g'), '') AS INTEGER)), 0) as max_val
FROM movements
WHERE ticket_code IS NOT NULL
GROUP BY garage_id
ON CONFLICT (garage_id, correlative_type) DO UPDATE
SET last_value = GREATEST(
    garage_correlatives.last_value,
    EXCLUDED.last_value
);

-- Llenar la secuencia de STAYS basándose en el historial real
INSERT INTO garage_correlatives (garage_id, correlative_type, last_value)
SELECT 
    garage_id, 
    'stay' as correlative_type, 
    COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(ticket_code, '\D', '', 'g'), '') AS INTEGER)), 0) as max_val
FROM stays
WHERE ticket_code IS NOT NULL
GROUP BY garage_id
ON CONFLICT (garage_id, correlative_type) DO UPDATE
SET last_value = GREATEST(
    garage_correlatives.last_value,
    EXCLUDED.last_value
);

-- ==============================================================================
-- 5. VERIFICACIÓN FINAL (Para el garage ebf7eaa0-339e-455f-bcde-dd51636e1f21)
-- ==============================================================================
/*
SELECT garage_id, correlative_type, last_value 
FROM garage_correlatives 
WHERE garage_id = 'ebf7eaa0-339e-455f-bcde-dd51636e1f21'
ORDER BY correlative_type;
*/
