-- 042_skip_corporate_business.sql
-- "Corporate Business" is a billing/entity membership type, not a real member
-- sale, so exclude it from sales metrics (membership / club-health / cancels /
-- leaderboard all consult abc_membership_skip_list). NOTE: the separate "CORP"
-- type (corporate-wellness members) is intentionally NOT excluded — those are
-- real members.

INSERT INTO abc_membership_skip_list (membership_type, note)
VALUES ('Corporate Business', 'Not a real sale — corporate billing entity, not a member')
ON CONFLICT (membership_type) DO NOTHING;
