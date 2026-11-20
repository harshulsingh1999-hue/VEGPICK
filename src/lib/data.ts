export interface Product {
  id: string;
  name: string;
  category: 'Leafy Greens' | 'Root Vegetables' | 'Fruits' | 'Herbs' | 'Exotic' | string;
  pricePerKg: number;
  image: string;
  available: boolean;
  description: string;
  rating: number;
  reviews: number;
}

export interface CartItem extends Product {
  quantity: number;
  selectedWeight: number; // 250, 500, 1000
}

export interface Address {
  id: string;
  label: string;
  street: string;
  city: string;
  zip: string;
}

export interface User {
  id: string;
  uid: string;
  name: string;
  phone: string;
  email: string;
  addresses: Address[];
  isBlocked: boolean;
  joinedDate: string;
}

export interface Order {
  id: string;
  userId: string;
  customerName: string;
  customerPhone: string;
  items: CartItem[];
  total: number;
  status: 'placed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';
  date: string;
  deliverySlot: string;
  address: Address;
  paymentMethod: 'cod' | 'upi';
  paymentStatus: 'pending' | 'collected' | 'paid';
  deliveryPin: string;
  assignedToUid: string;
  assignedToName: string;
  assignedToCode: string;
  failureReason?: string;
  proofImageUrl?: string;
}

export interface DispatchFeedItem {
  orderId: string;
  city: string;
  zip: string;
  deliverySlot: string;
  itemCount: number;
  total: number;
  paymentMethod: 'cod' | 'upi';
  status: 'placed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';
  assignedToUid: string;
}

export interface ActiveDelivery {
  orderId: string;
  customerUid: string;
  partnerUid: string;
  partnerName: string;
  status: 'assigned' | 'picked_up' | 'out_for_delivery';
  lat: number;
  lng: number;
  accuracy: number;
  speed: number;
  heading: number;
  updatedAt?: unknown;
}

export interface WalletLedgerEntry {
  id: string;
  partnerUid: string;
  partnerName: string;
  orderId: string;
  type: 'trip_credit' | 'cod_settlement';
  amount: number;
  note: string;
  createdAt?: unknown;
}

export interface DeliveryPersonnel {
  id: string;
  uid: string;
  partnerCode: string;
  name: string;
  email: string;
  phone: string;
  area: string;
  vehicle: string;
  dlNumber?: string;
  bankLast4?: string;
  ifsc?: string;
  isOnline: boolean;
  isApproved: boolean;
  completedDeliveries: number;
  rating: number;
  settledCash: number;
}

export interface Coupon {
  code: string;
  description: string;
  discountType: 'percent' | 'flat';
  discountValue: number;
  minOrder: number;
  isActive: boolean;
  expiry: string;
}

export interface Complaint {
  id: string;
  userId: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  category: 'Quality' | 'Delay' | 'Missing Item' | 'Refund' | 'Other';
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved';
  date: string;
  resolutionNotes?: string;
}

export interface AppSettings {
  taxRate: number;
  baseDeliveryFee: number;
  freeDeliveryThreshold: number;
  storeOpen: boolean;
  notificationsEnabled: boolean;
  catalogInitialized?: boolean;
}

export const CATEGORIES = [
  'All',
  'Leafy Greens',
  'Root Vegetables',
  'Fruits',
  'Herbs',
  'Exotic'
] as const;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  taxRate: 5,
  baseDeliveryFee: 20,
  freeDeliveryThreshold: 100,
  storeOpen: true,
  notificationsEnabled: true,
  catalogInitialized: false
};
