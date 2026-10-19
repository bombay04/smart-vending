export const PRICE_MINIMUM_ERROR = "ราคาสินค้าต้องไม่น้อยกว่า 20 บาท";

export function validateProductPrice(value) {
  const normalized = value.trim();
  const price = Number(normalized);
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(normalized) ||
    !Number.isFinite(price) ||
    price > 99_999_999.99
  ) {
    return "ราคาต้องเป็นจำนวนบวกและมีทศนิยมไม่เกิน 2 ตำแหน่ง";
  }
  if (price < 20) return PRICE_MINIMUM_ERROR;
  return null;
}
