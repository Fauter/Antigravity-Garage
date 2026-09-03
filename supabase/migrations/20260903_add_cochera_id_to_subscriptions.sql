-- Fase I: Supabase Migration
-- Add cochera_id to subscriptions table to fix the Identity Model Gap

ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS cochera_id uuid NULL;

-- Optional: Add Foreign Key if cocheras table uses UUID and we want referential integrity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'subscriptions_cochera_id_fkey'
        AND table_name = 'subscriptions'
    ) THEN
        ALTER TABLE public.subscriptions
        ADD CONSTRAINT subscriptions_cochera_id_fkey
        FOREIGN KEY (cochera_id)
        REFERENCES public.cocheras (id)
        ON DELETE SET NULL;
    END IF;
END $$;
