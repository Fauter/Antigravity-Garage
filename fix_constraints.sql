SELECT 
    conname AS constraint_name, 
    pg_get_constraintdef(c.oid)
FROM pg_constraint c 
JOIN pg_namespace n ON n.oid = c.connamespace 
WHERE n.nspname = 'public' 
AND conrelid = 'public.vehicles'::regclass;
