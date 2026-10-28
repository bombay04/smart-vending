\set ON_ERROR_STOP on

-- ISOLATED REHEARSAL ONLY. Make one expired pending payment unexpired so the
-- reset script's payment guard can be proven to fail closed.
UPDATE "Transaction"
SET
  "expiresAt" = transaction_timestamp() + interval '1 hour',
  "customerCancelledAt" = NULL
WHERE id = (
  SELECT id
  FROM "Transaction"
  WHERE "paymentStatus" = 'PENDING'
  ORDER BY id
  LIMIT 1
);
