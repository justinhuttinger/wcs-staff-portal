-- Add minimum role visibility to help center categories and articles
-- NULL means visible to all roles
ALTER TABLE help_categories ADD COLUMN IF NOT EXISTS min_role TEXT DEFAULT NULL;
ALTER TABLE help_articles ADD COLUMN IF NOT EXISTS min_role TEXT DEFAULT NULL;
