-- 042_skip_corporate_business.sql
-- "Corporate Business" and "CORP" are corporate billing/entity membership
-- types, not real member sales, so exclude them from sales metrics (membership
-- / club-health / cancels / leaderboard all consult abc_membership_skip_list).

INSERT INTO abc_membership_skip_list (membership_type, note) VALUES
  ('Corporate Business', 'Not a real sale — corporate billing entity, not a member'),
  ('CORP',               'Not a real sale — corporate billing/entity type')
ON CONFLICT (membership_type) DO NOTHING;
