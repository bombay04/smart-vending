\set ON_ERROR_STOP on

-- ISOLATED REHEARSAL ONLY. Make one terminal session appear active so the
-- reset script's active-session guard can be proven to fail closed.
UPDATE "KioskSession"
SET status = 'ACTIVE', "expiresAt" = transaction_timestamp() + interval '1 hour'
WHERE id = (
  SELECT id
  FROM "KioskSession"
  WHERE status <> 'ACTIVE'
  ORDER BY id
  LIMIT 1
);
