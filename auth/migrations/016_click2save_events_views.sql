-- 016_click2save_events_views.sql
-- Convenience views over click2save_events that flatten the event_data JSONB
-- so cancel reasons, freeze details, offer choices, and financials are all
-- queryable as plain columns. Already applied to the live DB; this file
-- captures it in version control.

-- One row per event, with cancel/freeze/financial fields flattened.
CREATE OR REPLACE VIEW click2save_events_expanded AS
SELECT
  e.request_id,
  e.request_type,
  e.occurred_at,
  e.received_at,
  e.club_code,
  e.member_id,
  e.member_email,
  e.member_barcode,
  e.agreement_id,
  e.result_status,

  -- CANCEL fields
  e.event_data #>> '{data,result,cancelCode}'             AS cancel_code,
  e.event_data #>> '{data,result,cancelReason}'           AS cancel_reason,
  NULLIF(e.event_data #>> '{data,result,effectiveDate}', '')::date AS cancel_effective_date,
  CASE
    WHEN e.event_data #>> '{data,result,buyerRemorseApplied}' IN ('true','false')
    THEN (e.event_data #>> '{data,result,buyerRemorseApplied}')::boolean
  END AS buyer_remorse_applied,

  -- FREEZE fields (top-level result, when requestType=FREEZE)
  e.event_data #>> '{data,result,freezeCode}'             AS freeze_code,
  e.event_data #>> '{data,result,freezeReason}'           AS freeze_reason,
  e.event_data #>> '{data,result,freezeType}'             AS freeze_type,
  NULLIF(e.event_data #>> '{data,result,freezePeriod}', '')::int  AS freeze_period_days,
  NULLIF(e.event_data #>> '{data,result,startDate}', '')::date    AS freeze_start_date,
  NULLIF(e.event_data #>> '{data,result,endDate}', '')::date      AS freeze_end_date,
  NULLIF(e.event_data #>> '{data,result,fee}', '')::numeric       AS freeze_fee,

  -- OFFER summary (for OFFER events): list of subtypes accepted.
  CASE
    WHEN jsonb_typeof(e.event_data #> '{data,result,offers}') = 'array'
    THEN (
      SELECT array_agg(o->>'offer' ORDER BY ord)
      FROM jsonb_array_elements(e.event_data #> '{data,result,offers}') WITH ORDINALITY AS arr(o, ord)
    )
  END AS offer_types,
  e.event_data #> '{data,result,offers}' AS offers_raw,

  -- Financials (every event type)
  NULLIF(e.event_data #>> '{data,financials,pastDueBalance}', '')::numeric  AS past_due_balance,
  NULLIF(e.event_data #>> '{data,financials,pastDueCollected}', '')::numeric AS past_due_collected,
  NULLIF(e.event_data #>> '{data,financials,nextDueAmount}', '')::numeric    AS next_due_amount,
  NULLIF(e.event_data #>> '{data,financials,nextDueCollected}', '')::numeric AS next_due_collected,
  NULLIF(e.event_data #>> '{data,financials,buyoutAmount}', '')::numeric     AS buyout_amount,
  NULLIF(e.event_data #>> '{data,financials,buyoutCollected}', '')::numeric  AS buyout_collected,

  e.event_data
FROM click2save_events e;

-- One row per offer subtype within each OFFER event. Use this to answer
-- "what option(s) did the member choose to save?" — each offer subtype
-- (MONETARY discount, POS items, FREEZE, transfer, plan upgrade, credit)
-- becomes its own row with its specific fields flattened.
CREATE OR REPLACE VIEW click2save_offers AS
SELECT
  e.request_id,
  e.received_at,
  e.club_code,
  e.member_id,
  e.member_email,
  o->>'offer'                                                     AS offer_subtype,
  o->>'status'                                                    AS offer_status,

  -- MONETARY (dues discount)
  o #>> '{dict,discountDues,value}'                               AS monetary_value,
  o #>> '{dict,discountDues,type}'                                AS monetary_type,
  NULLIF(o #>> '{dict,discountDues,durationPeriod}', '')::int     AS monetary_duration_periods,

  -- FREEZE (offer-level, distinct from a FREEZE-event)
  o #>> '{dict,reasonCode}'                                       AS offer_freeze_reason_code,
  o #>> '{dict,reasonName}'                                       AS offer_freeze_reason_name,
  o #>> '{dict,freezeType}'                                       AS offer_freeze_type,
  NULLIF(o #>> '{dict,freezePeriod}', '')::int                    AS offer_freeze_period,
  NULLIF(o #>> '{dict,startDate}', '')::date                      AS offer_freeze_start,
  NULLIF(o #>> '{dict,endDate}', '')::date                        AS offer_freeze_end,
  NULLIF(o #>> '{dict,value}', '')::numeric                       AS offer_freeze_fee,

  -- LOCATION transfer
  o #>> '{dict,fromClubCode}'                                     AS transfer_from_club,
  o #>> '{dict,toClubCode}'                                       AS transfer_to_club,

  -- MEMBERSHIP plan upgrade
  o #>> '{dict,planName}'                                         AS membership_plan_name,

  -- CREDIT
  NULLIF(o #>> '{dict,amount}', '')::numeric                      AS credit_amount,
  o #>> '{dict,comments}'                                         AS credit_comments,

  -- POS items (array of SKUs)
  CASE WHEN o->>'offer' = 'POS' THEN
    (SELECT array_agg(item->>'sku')
       FROM jsonb_array_elements(COALESCE(o->'array', '[]'::jsonb)) AS item)
  END                                                             AS pos_skus,

  o AS raw_offer
FROM click2save_events e
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(e.event_data #> '{data,result,offers}', '[]'::jsonb)
) AS o
WHERE e.request_type = 'OFFER';
