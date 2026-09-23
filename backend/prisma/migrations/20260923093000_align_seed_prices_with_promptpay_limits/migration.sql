-- Opn PromptPay accepts charges from THB 20.00. Only migrate unchanged
-- prototype seed prices so operator-customized product prices are preserved.
UPDATE "Product"
SET "price" = CASE
  WHEN "name" = 'Tissue' AND "price" = 10.00 THEN 20.00
  WHEN "name" = 'Sanitary Pad' AND "price" = 15.00 THEN 25.00
  WHEN "name" = 'Wet Wipes' AND "price" = 20.00 THEN 30.00
  ELSE "price"
END
WHERE
  ("name" = 'Tissue' AND "price" = 10.00)
  OR ("name" = 'Sanitary Pad' AND "price" = 15.00)
  OR ("name" = 'Wet Wipes' AND "price" = 20.00);
