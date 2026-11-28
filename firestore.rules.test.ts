/**
 * Firestore Security Rules Test Specification — FreshVeggie Delivery
 * Verifies all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 * Intended to be executed against the Firestore Local Emulator Suite.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  actor: 'unauthenticated' | 'customerA' | 'phoneCustomerA' | 'customerB' | 'unverifiedAdmin' | 'unapprovedPartner' | 'approvedPartner' | 'verifiedAdmin';
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED' | 'ALLOW';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Shadow admin field on user registration',
    collection: 'users/customerA',
    operation: 'create',
    actor: 'customerA',
    payload: { id: 'customerA', uid: 'customerA', name: 'Mallory', phone: '9876543210', email: 'm@example.com', addresses: [], isBlocked: false, isAdmin: true, joinedDate: '2026-11-12' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 2,
    name: 'Customer self-unblocking attempt',
    collection: 'users/customerA',
    operation: 'update',
    actor: 'customerA',
    payload: { isBlocked: false },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 3,
    name: 'Unverified admin email spoof attack',
    collection: 'products/prod_tomato',
    operation: 'create',
    actor: 'unverifiedAdmin',
    payload: { id: 'prod_tomato', name: 'Tomato', pricePerKg: 1 },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 4,
    name: 'Cross-user PII read on /users/{otherUid}',
    collection: 'users/customerB',
    operation: 'get',
    actor: 'customerA',
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 5,
    name: 'Order creation with victim userId',
    collection: 'orders/ORD-999999',
    operation: 'create',
    actor: 'customerA',
    payload: { id: 'ORD-999999', userId: 'customerB', total: 100, status: 'placed' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 6,
    name: 'Delivery partner self-approval escalation',
    collection: 'deliveryPartners/unapprovedPartner',
    operation: 'create',
    actor: 'unapprovedPartner',
    payload: { id: 'unapprovedPartner', uid: 'unapprovedPartner', isApproved: true },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 7,
    name: 'Non-partner stealing unassigned order',
    collection: 'orders/ORD-100001',
    operation: 'update',
    actor: 'customerA',
    payload: { assignedToUid: 'customerA', status: 'packed' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 8,
    name: 'Mutating total or reverting delivered order (terminal lock)',
    collection: 'orders/ORD-DELIVERED',
    operation: 'update',
    actor: 'approvedPartner',
    payload: { status: 'placed', total: 1 },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 9,
    name: 'Client timestamp forgery on product create',
    collection: 'products/prod_fake',
    operation: 'create',
    actor: 'verifiedAdmin',
    payload: { id: 'prod_fake', name: 'Onion', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 10,
    name: 'ID poisoning / oversized string injection',
    collection: 'products/bad id with spaces!',
    operation: 'create',
    actor: 'verifiedAdmin',
    payload: { id: 'bad id with spaces!', name: 'x'.repeat(500) },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 11,
    name: 'Customer altering produce pricePerKg',
    collection: 'products/prod_1',
    operation: 'update',
    actor: 'customerA',
    payload: { pricePerKg: 1 },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 12,
    name: 'Pre-resolved complaint with spoofed userId',
    collection: 'complaints/TKT-101',
    operation: 'create',
    actor: 'customerA',
    payload: { id: 'TKT-101', userId: 'customerB', status: 'resolved', subject: 'Fake' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 13,
    name: 'Cross-customer GPS tracking snoop on /active_deliveries',
    collection: 'active_deliveries/ORD-CUSTB',
    operation: 'get',
    actor: 'customerA',
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 14,
    name: 'Arbitrary rider wallet credit minting on /walletLedger',
    collection: 'walletLedger/LED-FAKE1',
    operation: 'create',
    actor: 'approvedPartner',
    payload: { id: 'LED-FAKE1', partnerUid: 'approvedPartner', type: 'trip_credit', amount: 9999, orderId: 'ORD-NONEXISTENT' },
    expected: 'PERMISSION_DENIED'
  },
  {
    id: 15,
    name: 'Phone OTP authenticated customer profile creation (empty email)',
    collection: 'users/phoneCustomerA',
    operation: 'create',
    actor: 'phoneCustomerA',
    payload: { id: 'phoneCustomerA', uid: 'phoneCustomerA', name: 'Phone User', phone: '919876543210', email: '', addresses: [], isBlocked: false, joinedDate: '2026-11-13' },
    expected: 'ALLOW'
  },
  {
    id: 16,
    name: 'Non-admin creating fake delivery slot schedule',
    collection: 'deliverySlots/slot_fake',
    operation: 'create',
    actor: 'customerA',
    payload: { id: 'slot_fake', scheduleType: 'daily', slotDate: '', startTime: '08:00', endTime: '10:00', label: '8 AM - 10 AM', isActive: true, maxOrders: 0, cutoffMinutes: 30, sortOrder: 1 },
    expected: 'PERMISSION_DENIED'
  }
];
