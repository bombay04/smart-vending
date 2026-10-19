\set ON_ERROR_STOP on
\encoding UTF8
-- faceEmbedding is deliberately excluded. Biometric data must remain on the Pi.
COPY (
  SELECT
    id, name, "employeeCode", "faceRegistered", "isActive",
    "offboardedAt", "createdAt", "updatedAt"
  FROM "Employee"
  WHERE "offboardedAt" IS NULL
  ORDER BY "employeeCode"
) TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
