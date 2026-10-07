const THAI_PRODUCT_NAMES: Readonly<Record<string, string>> = {
  Tissue: "กระดาษทิชชู",
  "Sanitary Pad": "ผ้าอนามัย",
  "Wet Wipes": "ทิชชูเปียก",
};

export function getProductDisplayName(productName: string): string {
  return THAI_PRODUCT_NAMES[productName] ?? productName;
}
