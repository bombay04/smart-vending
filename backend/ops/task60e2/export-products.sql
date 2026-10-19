\set ON_ERROR_STOP on
\encoding UTF8
COPY (
  SELECT DISTINCT
    p.id, p.name, p.price, p."imageUrl", p."isActive", p."createdAt", p."updatedAt"
  FROM "Product" p
  JOIN "Slot" s ON s."productId" = p.id
  WHERE s."slotNumber" IN (1, 2, 3)
  ORDER BY p.id
) TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
