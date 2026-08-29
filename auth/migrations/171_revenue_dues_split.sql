-- 171_revenue_dues_split.sql
--
-- Dues means DUES, and nothing else.
--
-- Migration 170 folded ten dues-ish codes into one Dues category. That was
-- wrong in kind: First Month Dues, Paid In Full Dues, Summer Membership Dues
-- and A2 Exec Dues are DIFFERENT PRODUCTS that happen to share a word, and
-- rolling them together hid $12,879 of exec dues inside a $528,224 number where
-- nobody could see it move.
--
-- THE DISTINCTION THAT SURVIVES IS SPELLING, NOT MEANING. Folding two spellings
-- of one thing is repair; folding two things is data loss. So:
--
--   folded   A2EXECDUES + A2 EXEC DUES     -> A2 Exec Dues
--            ANNUALFEE + ANNUAL            -> Annual Fee
--            TRAINING + PERSONAL TRAINING  -> Training       (a real rename)
--            LOCKER + LOCKERS              -> Locker
--            CANCEL FEE + CANCELLATION FEE + CANCEL -> Cancel Fee
--            the four swim codes           -> Swim
--
--   split    every dues PRODUCT keeps its own row
--
-- Dues is now $515,345 for August rather than $528,224, and A2 Exec Dues is a
-- $12,879 line of its own that can be watched.
--
-- The swim, training and annual-fee consolidations stay: those were asked for
-- and each folds either a rename or a set of variants of one thing.

create or replace function public.analytics_revenue_category(p_center text)
returns text
language sql
immutable
as $$
  select case upper(btrim(coalesce(p_center, '')))
    -- Dues is DUES alone. The rest keep their identity.
    when 'DUES' then 'Dues'
    when 'A2EXECDUES' then 'A2 Exec Dues'
    when 'A2 EXEC DUES' then 'A2 Exec Dues'
    when 'FIRST MONTH DUES' then 'First Month Dues'
    when 'LAST MONTH DUES' then 'Last Month Dues'
    when 'PAID IN FULL DUES' then 'Paid In Full Dues'
    when 'SUMMER MEMBERSHIP DUES' then 'Summer Membership Dues'
    when 'CORPORATE DUES' then 'Corporate Dues'
    when 'MBODUES' then 'MBO Dues'
    when 'GYMSTRDUES' then 'Gymstr Dues'

    when 'ANNUALFEE' then 'Annual Fee'
    when 'ANNUAL' then 'Annual Fee'

    -- The rename that would otherwise break year-over-year at Eugene.
    when 'TRAINING' then 'Training'
    when 'PERSONAL TRAINING' then 'Training'

    when 'PRIVATE SWIM LESSONS' then 'Swim'
    when 'GROUP SWIM LESSONS' then 'Swim'
    when 'SWIM CLUB' then 'Swim'
    when 'WCS SWIM ITEMS' then 'Swim'

    when 'WCS DRINKS' then 'Drinks'
    when 'WCS SNACKS' then 'Snacks'
    when 'WCS SUPPLEMENTS' then 'Supplements'
    when 'WCS MERCHANDISE' then 'Merchandise'

    -- Spelling variants elsewhere, folded on the same principle.
    when 'LOCKER' then 'Locker'
    when 'LOCKERS' then 'Locker'
    when 'CANCEL FEE' then 'Cancel Fee'
    when 'CANCELLATION FEE' then 'Cancel Fee'
    when 'CANCEL' then 'Cancel Fee'

    else initcap(lower(btrim(coalesce(nullif(p_center, ''), 'Unknown'))))
  end
$$;
