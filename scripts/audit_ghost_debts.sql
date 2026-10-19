-- PHASE 18: Audit Ghost Debts
-- Identifies CANON debts with garage_id IS NULL that duplicate real debts.

SELECT 
    ghost.id as ghost_debt_id,
    ghost.subscription_id,
    ghost.garage_id as ghost_garage,
    ghost.due_date as ghost_due_date,
    ghost.amount as ghost_amount,
    ghost.created_at as ghost_created_at,
    real.id as real_debt_id,
    real.garage_id as real_garage,
    real.due_date as real_due_date
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
    -- Same logical period boundary logic (ignoring up to 10 seconds difference in due_date)
    AND EXTRACT(YEAR FROM ghost.due_date) = EXTRACT(YEAR FROM real.due_date)
    AND EXTRACT(MONTH FROM ghost.due_date) = EXTRACT(MONTH FROM real.due_date)
    AND ABS(EXTRACT(EPOCH FROM ghost.due_date) - EXTRACT(EPOCH FROM real.due_date)) < 10
ORDER BY 
    ghost.created_at DESC;
