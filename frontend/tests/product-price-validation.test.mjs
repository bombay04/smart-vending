import assert from "node:assert/strict";
import test from "node:test";
import {
  PRICE_MINIMUM_ERROR,
  validateProductPrice,
} from "../src/product-price-validation.mjs";

test("admin product price accepts 20 THB inclusively", () => {
  assert.equal(validateProductPrice("19.99"), PRICE_MINIMUM_ERROR);
  assert.equal(validateProductPrice("20.00"), null);
  assert.equal(validateProductPrice("20.01"), null);
  assert.equal(validateProductPrice("21.00"), null);
  assert.equal(PRICE_MINIMUM_ERROR, "ราคาสินค้าต้องไม่น้อยกว่า 20 บาท");
});
