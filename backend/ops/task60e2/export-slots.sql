\set ON_ERROR_STOP on
\encoding UTF8
COPY (
  SELECT id, "slotNumber", status, "productId", "createdAt", "updatedAt"
  FROM "Slot"
  WHERE "slotNumber" IN (1, 2, 3)
  ORDER BY "slotNumber"
) TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
