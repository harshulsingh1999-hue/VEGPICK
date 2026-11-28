export interface Product {
  id: string;
  name: string;
  category: 'Leafy Greens' | 'Root Vegetables' | 'Fruits' | 'Herbs' | 'Exotic' | string;
  pricePerKg: number;
  image: string;
  images?: string[];
  available: boolean;
  description: string;
  rating: number;
  reviews: number;
  createdAt?: unknown;
  updatedAt?: unknown;
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
  subtotal?: number;
  taxRate?: number;
  taxAmount?: number;
  deliveryFee?: number;
  discountAmount?: number;
  couponCode?: string;
  total: number;
  status: 'placed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';
  date: string;
  deliverySlot: string;
  address: Address;
  paymentMethod: 'cod' | 'upi' | 'debit_card' | 'credit_card' | 'bank_transfer';
  paymentStatus: 'pending' | 'collected' | 'paid';
  paymentReference?: string;
  paymentChannelLabel?: string;
  settlementTargetSummary?: string;
  cardLast4?: string;
  cardNetwork?: string;
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
  paymentMethod: 'cod' | 'upi' | 'debit_card' | 'credit_card' | 'bank_transfer';
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

export interface ServiceArea {
  id: string;
  name: string;
  city: string;
  pincode: string;
  isActive: boolean;
  deliveryFeeOverride?: number | null;
  minOrderOverride?: number | null;
  etaMinutes: number;
  notes?: string;
}

export interface DeliverySlot {
  id: string;
  scheduleType: 'date' | 'daily';
  slotDate: string; // '' for daily template, 'YYYY-MM-DD' for date override
  startTime: string; // 'HH:mm' (24h)
  endTime: string; // 'HH:mm' (24h)
  label: string;
  isActive: boolean;
  maxOrders: number; // 0 = unlimited
  cutoffMinutes: number; // minutes before startTime when booking closes
  sortOrder: number;
  notes?: string;
}

export const DEFAULT_DAILY_SLOT_TEMPLATES: Array<Omit<DeliverySlot, 'id'>> = [
  { scheduleType: 'daily', slotDate: '', startTime: '06:00', endTime: '08:00', label: '6:00 AM - 8:00 AM', isActive: true, maxOrders: 0, cutoffMinutes: 0, sortOrder: 1, notes: 'Early Morning Farm Harvest' },
  { scheduleType: 'daily', slotDate: '', startTime: '08:00', endTime: '10:00', label: '8:00 AM - 10:00 AM', isActive: true, maxOrders: 0, cutoffMinutes: 0, sortOrder: 2, notes: 'Morning Slot' },
  { scheduleType: 'daily', slotDate: '', startTime: '10:00', endTime: '12:00', label: '10:00 AM - 12:00 PM', isActive: true, maxOrders: 0, cutoffMinutes: 0, sortOrder: 3, notes: 'Late Morning Slot' },
  { scheduleType: 'daily', slotDate: '', startTime: '16:00', endTime: '17:00', label: '4:00 PM - 5:00 PM', isActive: true, maxOrders: 0, cutoffMinutes: 0, sortOrder: 4, notes: 'Evening Slot 1' },
  { scheduleType: 'daily', slotDate: '', startTime: '17:00', endTime: '18:00', label: '5:00 PM - 6:00 PM', isActive: true, maxOrders: 0, cutoffMinutes: 0, sortOrder: 5, notes: 'Evening Slot 2' },
  { scheduleType: 'daily', slotDate: '', startTime: '18:00', endTime: '19:00', label: '6:00 PM - 7:00 PM', isActive: true, maxOrders: 0, cutoffMinutes: 0, sortOrder: 6, notes: 'Evening Peak Slot' },
  { scheduleType: 'daily', slotDate: '', startTime: '19:00', endTime: '20:00', label: '7:00 PM - 8:00 PM', isActive: true, maxOrders: 0, cutoffMinutes: 0, sortOrder: 7, notes: 'Dinner Prep Slot' },
  { scheduleType: 'daily', slotDate: '', startTime: '20:00', endTime: '21:00', label: '8:00 PM - 9:00 PM', isActive: true, maxOrders: 0, cutoffMinutes: 0, sortOrder: 8, notes: 'Night Last Dispatch' }
];

export interface AppSettings {
  taxRate: number;
  baseDeliveryFee: number;
  freeDeliveryThreshold: number;
  storeOpen: boolean;
  notificationsEnabled: boolean;
  catalogInitialized?: boolean;
  restrictToServiceAreas?: boolean;
  upiId?: string;
  upiPayeeName?: string;
  bankAccountHolder?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankBranch?: string;
  bankIfscCode?: string;
  acceptUpi?: boolean;
  acceptDebitCard?: boolean;
  acceptCreditCard?: boolean;
  acceptBankTransfer?: boolean;
  acceptCod?: boolean;
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
  catalogInitialized: false,
  restrictToServiceAreas: false,
  upiId: '',
  upiPayeeName: 'FreshVeggie Delivery',
  bankAccountHolder: '',
  bankName: '',
  bankAccountNumber: '',
  bankBranch: '',
  bankIfscCode: '',
  acceptUpi: true,
  acceptDebitCard: true,
  acceptCreditCard: true,
  acceptBankTransfer: true,
  acceptCod: true
};

