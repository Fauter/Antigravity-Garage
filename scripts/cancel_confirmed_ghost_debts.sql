-- PHASE 19: Cancel Confirmed Ghost Debts
-- Cancels ghost debts identified in the audit.
-- WRAPPED IN A TRANSACTION FOR SAFETY.

BEGIN;

-- Preview of what will be cancelled
SELECT 
    ghost.id as ghost_debt_id,
    ghost.subscription_id,
    ghost.created_at
FROM 
    debts ghost
JOIN 
    debts real ON ghost.subscription_id = real.subscription_id
WHERE 
    ghost.type = 'CANON' 
    AND ghost.status = 'PENDING'
    AND ghost.garage_id IS NULL
    AND real.type = 'CANON'
    AND real.garage_id IS NOT NULL
    AND EXTRACT(YEAR FROM ghost.due_date) = EXTRACT(YEAR FROM real.due_date)
    AND EXTRACT(MONTH FROM ghost.due_date) = EXTRACT(MONTH FROM real.due_date)
    AND ABS(EXTRACT(EPOCH FROM ghost.due_date) - EXTRACT(EPOCH FROM real.due_date)) < 10;

-- Execute the update
UPDATE debts
SET 
    status = 'CANCELLED',
    updated_at = NOW()
WHERE id IN (
    SELECT ghost.id
    FROM debts ghost
    JOIN debts real ON ghost.subscription_id = real.subscription_id
    WHERE 
        ghost.type = 'CANON' 
        AND ghost.status = 'PENDING'
        AND ghost.garage_id IS NULL
        AND real.type = 'CANON'
        AND real.garage_id IS NOT NULL
        AND EXTRACT(YEAR FROM ghost.due_date) = EXTRACT(YEAR FROM real.due_date)
        AND EXTRACT(MONTH FROM ghost.due_date) = EXTRACT(MONTH FROM real.due_date)
        AND ABS(EXTRACT(EPOCH FROM ghost.due_date) - EXTRACT(EPOCH FROM real.due_date)) < 10
);

-- TO COMMIT THE CHANGES, RUN:
-- COMMIT;

-- TO ABORT, RUN:
-- ROLLBACK;
