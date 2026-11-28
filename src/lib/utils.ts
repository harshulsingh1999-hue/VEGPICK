import type { AppSettings, Order } from "./data";

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
};

export interface OrderBillingBreakdown {
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  deliveryFee: number;
  discountAmount: number;
  couponCode: string;
  grandTotal: number;
  isEstimated: boolean;
}

export function getOrderBillingBreakdown(
  order: Order,
  storeSettings?: AppSettings
): OrderBillingBreakdown {
  const rawItemsTotal = (order.items || []).reduce((sum, item) => {
    const pricePerKg = Math.max(0, Number(item.pricePerKg) || 0);
    const weight = Math.max(0, Number(item.selectedWeight) || 0);
    const qty = Math.max(0, Number(item.quantity) || 0);
    return sum + (pricePerKg / 1000) * weight * qty;
  }, 0);
  const roundedItemsSubtotal = Math.max(0, Math.round(rawItemsTotal));
  const grandTotal = Math.max(0, Math.round(Number(order.total) || 0));

  const hasStoredBreakdown =
    typeof order.subtotal === "number" ||
    typeof order.taxAmount === "number" ||
    typeof order.deliveryFee === "number" ||
    typeof order.discountAmount === "number" ||
    Boolean(order.couponCode);

  if (hasStoredBreakdown) {
    const subtotal =
      typeof order.subtotal === "number" ? Math.max(0, Math.round(order.subtotal)) : roundedItemsSubtotal;
    const taxRate =
      typeof order.taxRate === "number"
        ? Math.max(0, order.taxRate)
        : storeSettings?.taxRate ?? 0;
    const taxAmount =
      typeof order.taxAmount === "number" ? Math.max(0, Math.round(order.taxAmount)) : 0;
    const deliveryFee =
      typeof order.deliveryFee === "number" ? Math.max(0, Math.round(order.deliveryFee)) : 0;
    const discountAmount =
      typeof order.discountAmount === "number" ? Math.max(0, Math.round(order.discountAmount)) : 0;
    const couponCode = (order.couponCode || "").trim().toUpperCase();

    return {
      subtotal,
      taxRate,
      taxAmount,
      deliveryFee,
      discountAmount,
      couponCode,
      grandTotal,
      isEstimated: false,
    };
  }

  // Legacy order fallback (orders placed before breakdown fields were persisted)
  const fallbackTaxRate = storeSettings?.taxRate ?? 0;
  const estTax = Math.round((roundedItemsSubtotal * fallbackTaxRate) / 100);
  const freeThreshold = storeSettings?.freeDeliveryThreshold ?? 100;
  const baseFee = storeSettings?.baseDeliveryFee ?? 20;
  const estDelivery = roundedItemsSubtotal >= freeThreshold ? 0 : baseFee;

  if (grandTotal === roundedItemsSubtotal) {
    return {
      subtotal: roundedItemsSubtotal,
      taxRate: 0,
      taxAmount: 0,
      deliveryFee: 0,
      discountAmount: 0,
      couponCode: "",
      grandTotal,
      isEstimated: true,
    };
  }

  const expectedBeforeDiscount = roundedItemsSubtotal + estTax + estDelivery;
  if (expectedBeforeDiscount >= grandTotal) {
    return {
      subtotal: roundedItemsSubtotal,
      taxRate: fallbackTaxRate,
      taxAmount: estTax,
      deliveryFee: estDelivery,
      discountAmount: Math.max(0, expectedBeforeDiscount - grandTotal),
      couponCode: "",
      grandTotal,
      isEstimated: true,
    };
  }

  return {
    subtotal: roundedItemsSubtotal,
    taxRate: fallbackTaxRate,
    taxAmount: estTax,
    deliveryFee: Math.max(0, grandTotal - roundedItemsSubtotal - estTax),
    discountAmount: 0,
    couponCode: "",
    grandTotal,
    isEstimated: true,
  };
}

export const formatPaymentMethodLabel = (method?: string): string => {
  switch ((method || "").toLowerCase()) {
    case "upi":
      return "UPI Direct";
    case "debit_card":
      return "Debit Card";
    case "credit_card":
      return "Credit Card";
    case "bank_transfer":
      return "Bank Transfer (IMPS/NEFT)";
    case "cod":
    default:
      return "Cash on Delivery";
  }
};

export const isOnlinePaymentMethod = (method?: string): boolean => {
  const m = (method || "").toLowerCase();
  return m === "upi" || m === "debit_card" || m === "credit_card" || m === "bank_transfer";
};

export const getAdminSettlementSummary = (settings?: AppSettings): string => {
  if (!settings) return "";
  const parts: string[] = [];
  if (settings.upiId?.trim()) {
    parts.push(`UPI: ${settings.upiId.trim()}`);
  }
  if (settings.bankAccountNumber?.trim()) {
    const cleanAcc = settings.bankAccountNumber.replace(/\s+/g, "");
    const maskedAcc = cleanAcc.length > 4 ? `••••${cleanAcc.slice(-4)}` : cleanAcc;
    const ifsc = settings.bankIfscCode?.trim() ? ` (IFSC ${settings.bankIfscCode.trim().toUpperCase()})` : "";
    const bankPrefix = settings.bankName?.trim() ? `${settings.bankName.trim()} ` : "Bank ";
    parts.push(`${bankPrefix}A/C ${maskedAcc}${ifsc}`);
  }
  return parts.join(" | ").slice(0, 180);
};

export const detectCardNetwork = (digitsOnly: string): string => {
  if (/^4/.test(digitsOnly)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digitsOnly)) return "Mastercard";
  if (/^(60|65|81|82|508)/.test(digitsOnly)) return "RuPay";
  if (/^3[47]/.test(digitsOnly)) return "Amex";
  return "Card";
};

export const luhnCheckCard = (digitsOnly: string): boolean => {
  if (!/^[0-9]{13,19}$/.test(digitsOnly)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let digit = Number(digitsOnly[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
};

export const sanitizeProductImages = (
  rawImages?: unknown,
  fallbackImage?: string
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  const pushUrl = (candidate: unknown) => {
    if (typeof candidate !== "string") return;
    const trimmed = candidate.trim().slice(0, 500);
    if (!trimmed || seen.has(trimmed) || result.length >= 8) return;
    seen.add(trimmed);
    result.push(trimmed);
  };

  if (Array.isArray(rawImages)) {
    rawImages.forEach(pushUrl);
  }
  if (result.length === 0 && fallbackImage) {
    pushUrl(fallbackImage);
  }
  return result;
};

export const getProductImages = (
  product?: { image?: string; images?: unknown } | null
): string[] => {
  if (!product) return [];
  return sanitizeProductImages(product.images, product.image);
};

export const getProductFrontImage = (
  product?: { image?: string; images?: unknown } | null
): string => {
  const list = getProductImages(product);
  return list[0] || (typeof product?.image === "string" ? product.image.trim() : "");
};
