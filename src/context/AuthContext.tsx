import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  ConfirmationResult,
  RecaptchaVerifier,
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType
} from '../lib/firebase';
import { archiveOrderAsync } from '../lib/apiClient';
import { Address, DispatchFeedItem, Order, User } from '../lib/data';

export interface PlaceOrderInput {
  items: Order['items'];
  subtotal?: number;
  taxRate?: number;
  taxAmount?: number;
  deliveryFee?: number;
  discountAmount?: number;
  couponCode?: string;
  total: number;
  deliverySlot: string;
  address: Address;
  paymentMethod: Order['paymentMethod'];
  paymentStatus?: Order['paymentStatus'];
  paymentReference?: string;
  paymentChannelLabel?: string;
  settlementTargetSummary?: string;
  cardLast4?: string;
  cardNetwork?: string;
  customerName: string;
  customerPhone: string;
}

export interface UpdateOrderDetailsInput {
  date?: string;
  deliverySlot?: string;
  customerName?: string;
  customerPhone?: string;
  address?: Partial<Address>;
}

export interface AdminAllowlistEntry {
  uid: string;
  email: string;
  role: 'admin';
}

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
  isAdmin: boolean;
  isBootstrappedAdmin: boolean;
  user: User | null;
  signInWithGoogle: () => Promise<{ success: boolean; message?: string }>;
  sendPhoneOtp: (
    phoneE164: string,
    verifier: RecaptchaVerifier
  ) => Promise<{
    success: boolean;
    confirmationResult?: ConfirmationResult;
    message?: string;
    code?: string;
  }>;
  verifyPhoneOtp: (
    confirmationResult: ConfirmationResult,
    otpCode: string,
    options?: { name?: string; createCustomerProfile?: boolean }
  ) => Promise<{ success: boolean; message?: string }>;
  ensureCustomerProfile: (nameOverride?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<Pick<User, 'name' | 'phone' | 'addresses'>>) => Promise<void>;
  addAddress: (address: Omit<Address, 'id'>) => Promise<Address | undefined>;

  // Orders
  orders: Order[];
  allOrders: Order[];
  hasMoreOrders: boolean;
  loadingMoreOrders: boolean;
  loadMoreOrders: () => Promise<void>;
  placeOrder: (input: PlaceOrderInput) => Promise<Order>;
  updateOrderStatus: (
    orderId: string,
    status: Order['status'],
    paymentStatus?: Order['paymentStatus']
  ) => Promise<void>;
  updateOrderDetails: (orderId: string, updates: UpdateOrderDetailsInput) => Promise<void>;
  assignOrderToDelivery: (
    orderId: string,
    deliveryUid: string,
    deliveryName: string,
    deliveryCode: string
  ) => Promise<void>;

  // Customers & Admin Allowlist Management (Admin)
  allUsers: User[];
  hasMoreUsers: boolean;
  loadingMoreUsers: boolean;
  loadMoreUsers: () => Promise<void>;
  toggleBlockUser: (userId: string) => Promise<void>;
  adminList: AdminAllowlistEntry[];
  grantAdminAccess: (uid: string, contactLabel: string) => Promise<void>;
  revokeAdminAccess: (uid: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const extractAuthErrorCode = (err: unknown): string => {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: unknown }).code || '');
  }
  const msg = err instanceof Error ? err.message : String(err || '');
  const match = msg.match(/auth\/[a-z0-9-]+/i);
  return match ? match[0].toLowerCase() : '';
};

const formatPhoneAuthError = (err: unknown): string => {
  const code = extractAuthErrorCode(err);
  const msg = err instanceof Error ? err.message : String(err || 'Authentication failed');
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  if (code === 'auth/operation-not-allowed') {
    return 'Phone OTP sign-in is disabled in Firebase Console. Enable Authentication → Sign-in method → Phone for this project.';
  }
  if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
    return `Domain "${host || 'this URL'}" is not yet allowlisted in Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (code === 'auth/invalid-phone-number' || code === 'auth/missing-phone-number') {
    return 'Invalid mobile number. Select your country code and enter your 10-digit number without leading 0.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many OTP attempts from this device or number. Please wait a few minutes and try again.';
  }
  if (code === 'auth/quota-exceeded' || code === 'auth/billing-not-enabled') {
    return 'SMS sending is unavailable because Firebase Phone Auth SMS billing/quota needs setup in Firebase Console.';
  }
  if (code === 'auth/invalid-verification-code') {
    return 'Incorrect OTP code. Please check the 6-digit SMS code and try again.';
  }
  if (code === 'auth/code-expired' || code === 'auth/session-expired') {
    return 'This OTP session has expired. Please request a fresh verification code.';
  }
  if (
    code === 'auth/captcha-check-failed' ||
    code === 'auth/invalid-app-credential' ||
    code === 'auth/missing-client-identifier' ||
    code === 'auth/internal-error'
  ) {
    return 'reCAPTCHA security check could not complete automatically. Please solve the verification checkbox or try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error contacting Google SMS verification. Check internet connection or disable strict content blockers.';
  }
  if (code === 'auth/web-storage-unsupported') {
    return 'Browser storage/cookies are blocked. Enable cookies/storage for this site to verify OTP.';
  }
  return msg;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isBootstrappedAdmin, setIsBootstrappedAdmin] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [liveOrdersWindow, setLiveOrdersWindow] = useState<Order[]>([]);
  const [extraOrders, setExtraOrders] = useState<Order[]>([]);
  const [ordersCursor, setOrdersCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);

  const [liveUsersWindow, setLiveUsersWindow] = useState<User[]>([]);
  const [extraUsers, setExtraUsers] = useState<User[]>([]);
  const [usersCursor, setUsersCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [loadingMoreUsers, setLoadingMoreUsers] = useState(false);

  const [adminList, setAdminList] = useState<AdminAllowlistEntry[]>([]);

  // 1. Observe Firebase Authentication state (Google & Phone OTP)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);

      if (!fbUser) {
        setIsAdmin(false);
        setIsBootstrappedAdmin(false);
        setUser(null);
        setOrders([]);
        setLiveOrdersWindow([]);
        setExtraOrders([]);
        setOrdersCursor(null);
        setHasMoreOrders(false);
        setLiveUsersWindow([]);
        setExtraUsers([]);
        setUsersCursor(null);
        setHasMoreUsers(false);
        setAdminList([]);
        setAuthReady(true);
        return;
      }

      const isBootstrapped =
        Boolean(fbUser.emailVerified) && fbUser.email === BOOTSTRAPPED_ADMIN_EMAIL;
      const isVerifiedIdentity = Boolean(fbUser.emailVerified || fbUser.phoneNumber);

      let adminFlag = isBootstrapped;
      if (!adminFlag && isVerifiedIdentity) {
        try {
          const adminDoc = await getDoc(doc(db, 'admins', fbUser.uid));
          adminFlag = adminDoc.exists();
        } catch {
          adminFlag = false;
        }
      }
      setIsBootstrappedAdmin(isBootstrapped);
      setIsAdmin(adminFlag);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  // 2. Subscribe to current user's profile doc in Firestore
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setUser(null);
      return;
    }

    const userDocRef = doc(db, 'users', firebaseUser.uid);
    const unsub = onSnapshot(
      userDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as User;
          setUser({ ...data, id: snap.id, uid: firebaseUser.uid });
        } else {
          setUser(null);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser]);

  // 3. Subscribe to customer's own orders
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setOrders([]);
      return;
    }

    const ordersQuery = query(
      collection(db, 'orders'),
      where('userId', '==', firebaseUser.uid),
      limit(35)
    );

    const unsub = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const list: Order[] = snapshot.docs.map((d) => ({
          ...(d.data() as Order),
          id: d.id
        }));
        list.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        setOrders(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser]);

  // 4. Subscribe to hot recent window of orders/users (100 docs) + cursor pagination for scale
  useEffect(() => {
    if (!authReady || !firebaseUser || !isBootstrappedAdmin) {
      setLiveOrdersWindow([]);
      setExtraOrders([]);
      setOrdersCursor(null);
      setHasMoreOrders(false);
      setLiveUsersWindow([]);
      setExtraUsers([]);
      setUsersCursor(null);
      setHasMoreUsers(false);
      setAdminList([]);
      return;
    }

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(100)),
      (snapshot) => {
        const list: Order[] = snapshot.docs.map((d) => ({
          ...(d.data() as Order),
          id: d.id
        }));
        setLiveOrdersWindow(list);
        if (snapshot.docs.length === 100 && !ordersCursor) {
          setOrdersCursor(snapshot.docs[snapshot.docs.length - 1]);
          setHasMoreOrders(true);
        } else if (snapshot.docs.length < 100 && extraOrders.length === 0) {
          setHasMoreOrders(false);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      }
    );

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(100)),
      (snapshot) => {
        const list: User[] = snapshot.docs.map((d) => ({
          ...(d.data() as User),
          id: d.id
        }));
        setLiveUsersWindow(list);
        if (snapshot.docs.length === 100 && !usersCursor) {
          setUsersCursor(snapshot.docs[snapshot.docs.length - 1]);
          setHasMoreUsers(true);
        } else if (snapshot.docs.length < 100 && extraUsers.length === 0) {
          setHasMoreUsers(false);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      }
    );

    const unsubAdmins = onSnapshot(
      query(collection(db, 'admins'), limit(100)),
      (snapshot) => {
        const list: AdminAllowlistEntry[] = snapshot.docs.map((d) => {
          const data = d.data() as Partial<AdminAllowlistEntry>;
          return {
            uid: d.id,
            email: data.email || '',
            role: 'admin'
          };
        });
        setAdminList(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'admins');
      }
    );

    return () => {
      unsubOrders();
      unsubUsers();
      unsubAdmins();
    };
  }, [authReady, firebaseUser, isBootstrappedAdmin]);

  // Merge live real-time window + paginated older pages cleanly without duplicates
  const allOrders = React.useMemo(() => {
    const map = new Map<string, Order>();
    liveOrdersWindow.forEach((o) => map.set(o.id, o));
    extraOrders.forEach((o) => {
      if (!map.has(o.id)) map.set(o.id, o);
    });
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    );
  }, [liveOrdersWindow, extraOrders]);

  const allUsers = React.useMemo(() => {
    const map = new Map<string, User>();
    liveUsersWindow.forEach((u) => map.set(u.id, u));
    extraUsers.forEach((u) => {
      if (!map.has(u.id)) map.set(u.id, u);
    });
    return Array.from(map.values());
  }, [liveUsersWindow, extraUsers]);

  const loadMoreOrders = useCallback(async () => {
    if (!isBootstrappedAdmin || !ordersCursor || loadingMoreOrders) return;
    setLoadingMoreOrders(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'orders'), orderBy('createdAt', 'desc'), startAfter(ordersCursor), limit(100))
      );
      const nextPage: Order[] = snap.docs.map((d) => ({
        ...(d.data() as Order),
        id: d.id
      }));
      setExtraOrders((prev) => [...prev, ...nextPage]);
      if (snap.docs.length === 100) {
        setOrdersCursor(snap.docs[snap.docs.length - 1]);
        setHasMoreOrders(true);
      } else {
        setHasMoreOrders(false);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    } finally {
      setLoadingMoreOrders(false);
    }
  }, [isBootstrappedAdmin, ordersCursor, loadingMoreOrders]);

  const loadMoreUsers = useCallback(async () => {
    if (!isBootstrappedAdmin || !usersCursor || loadingMoreUsers) return;
    setLoadingMoreUsers(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), orderBy('createdAt', 'desc'), startAfter(usersCursor), limit(100))
      );
      const nextPage: User[] = snap.docs.map((d) => ({
        ...(d.data() as User),
        id: d.id
      }));
      setExtraUsers((prev) => [...prev, ...nextPage]);
      if (snap.docs.length === 100) {
        setUsersCursor(snap.docs[snap.docs.length - 1]);
        setHasMoreUsers(true);
      } else {
        setHasMoreUsers(false);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'users');
    } finally {
      setLoadingMoreUsers(false);
    }
  }, [isBootstrappedAdmin, usersCursor, loadingMoreUsers]);

  // Provision or validate customer /users/{uid} document cleanly for Google or Phone OTP accounts
  const upsertCustomerProfileForUser = useCallback(
    async (
      fbUser: FirebaseUser,
      nameOverride?: string
    ): Promise<{ blocked: boolean }> => {
      const userRef = doc(db, 'users', fbUser.uid);
      const existingSnap = await getDoc(userRef);
      const verifiedDigits = (fbUser.phoneNumber || '').replace(/\D/g, '').slice(0, 15);

      if (existingSnap.exists()) {
        const existingData = existingSnap.data() as User;
        if (existingData.isBlocked) {
          return { blocked: true };
        }
        // Sync verified OTP phone number when profile has no phone yet
        if (!existingData.phone && verifiedDigits.length >= 10 && verifiedDigits.length <= 15) {
          await updateDoc(userRef, {
            phone: verifiedDigits,
            updatedAt: serverTimestamp()
          });
        }
        return { blocked: false };
      }

      const defaultName =
        nameOverride?.trim() ||
        fbUser.displayName ||
        (fbUser.email ? fbUser.email.split('@')[0] : '') ||
        (verifiedDigits ? `Customer ${verifiedDigits.slice(-4)}` : 'FreshVeggie Customer');

      const newProfile = {
        id: fbUser.uid,
        uid: fbUser.uid,
        name: defaultName.slice(0, 120),
        phone: verifiedDigits.length >= 10 ? verifiedDigits : '',
        email: (fbUser.email || '').slice(0, 200),
        addresses: [],
        isBlocked: false,
        joinedDate: new Date().toISOString().split('T')[0],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await setDoc(userRef, newProfile);
      return { blocked: false };
    },
    []
  );

  const ensureCustomerProfile = useCallback(
    async (nameOverride?: string): Promise<void> => {
      if (!auth.currentUser) return;
      await upsertCustomerProfileForUser(auth.currentUser, nameOverride);
    },
    [upsertCustomerProfileForUser]
  );

  // Google OAuth Sign-In
  const signInWithGoogle = async (): Promise<{ success: boolean; message?: string }> => {
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const fbUser = credential.user;

      if (!fbUser.emailVerified || !fbUser.email) {
        return { success: false, message: 'A verified Google email address is required.' };
      }

      const { blocked } = await upsertCustomerProfileForUser(fbUser);
      if (blocked) {
        return {
          success: false,
          message: 'Your account has been suspended by store administration. Please contact support.'
        };
      }
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Google sign-in failed';
      if (msg.includes('popup-closed-by-user')) {
        return { success: false, message: 'Sign-in popup was closed before completing.' };
      }
      return { success: false, message: msg };
    }
  };

  // Firebase Mobile Phone OTP Step 1: Send SMS Verification Code
  const sendPhoneOtp = async (
    phoneE164: string,
    verifier: RecaptchaVerifier
  ): Promise<{
    success: boolean;
    confirmationResult?: ConfirmationResult;
    message?: string;
    code?: string;
  }> => {
    const cleanedE164 = '+' + phoneE164.replace(/\D/g, '');
    if (!/^\+[1-9][0-9]{7,14}$/.test(cleanedE164)) {
      return {
        success: false,
        code: 'auth/invalid-phone-number',
        message: 'Invalid mobile number format. Select country code and enter 10 digits without leading 0.'
      };
    }
    try {
      const confirmationResult = await signInWithPhoneNumber(auth, cleanedE164, verifier);
      return { success: true, confirmationResult };
    } catch (error) {
      return {
        success: false,
        code: extractAuthErrorCode(error),
        message: formatPhoneAuthError(error)
      };
    }
  };

  // Firebase Mobile Phone OTP Step 2: Confirm 6-Digit SMS Code
  const verifyPhoneOtp = async (
    confirmationResult: ConfirmationResult,
    otpCode: string,
    options?: { name?: string; createCustomerProfile?: boolean }
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const credential = await confirmationResult.confirm(otpCode.trim());
      const fbUser = credential.user;

      if (options?.createCustomerProfile !== false) {
        const { blocked } = await upsertCustomerProfileForUser(fbUser, options?.name);
        if (blocked) {
          return {
            success: false,
            message: 'Your account has been suspended by store administration. Please contact support.'
          };
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: formatPhoneAuthError(error) };
    }
  };

  const grantAdminAccess = async (uid: string, contactLabel: string): Promise<void> => {
    const cleanUid = uid.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanUid) throw new Error('Valid Firebase Auth UID is required.');
    try {
      await setDoc(doc(db, 'admins', cleanUid), {
        uid: cleanUid,
        email: contactLabel.trim().slice(0, 200),
        role: 'admin',
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `admins/${cleanUid}`);
    }
  };

  const revokeAdminAccess = async (uid: string): Promise<void> => {
    const cleanUid = uid.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanUid) return;
    try {
      await deleteDoc(doc(db, 'admins', cleanUid));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `admins/${cleanUid}`);
    }
  };

  const logout = async (): Promise<void> => {
    await signOut(auth);
  };

  const updateProfile = async (
    data: Partial<Pick<User, 'name' | 'phone' | 'addresses'>>
  ): Promise<void> => {
    if (!firebaseUser) return;
    const path = `users/${firebaseUser.uid}`;
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp()
    };

    if (typeof data.name === 'string' && data.name.trim()) {
      payload.name = data.name.trim().slice(0, 120);
    }
    if (typeof data.phone === 'string') {
      const cleaned = data.phone.replace(/\D/g, '').slice(0, 15);
      payload.phone = cleaned;
    }
    if (Array.isArray(data.addresses)) {
      payload.addresses = data.addresses.slice(0, 20);
    }

    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const addAddress = async (addr: Omit<Address, 'id'>): Promise<Address | undefined> => {
    if (!firebaseUser || !user) return undefined;
    const newAddress: Address = {
      id: 'addr_' + Math.random().toString(36).slice(2, 9),
      label: addr.label.trim().slice(0, 40) || 'Home',
      street: addr.street.trim().slice(0, 300),
      city: addr.city.trim().slice(0, 100),
      zip: addr.zip.trim().slice(0, 20)
    };
    const nextAddresses = [...(user.addresses || []), newAddress].slice(0, 20);
    await updateProfile({ addresses: nextAddresses });
    return newAddress;
  };

  const placeOrder = async (input: PlaceOrderInput): Promise<Order> => {
    if (!firebaseUser) {
      throw new Error('Authentication required to place order.');
    }

    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const deliveryPin = String(Math.floor(1000 + Math.random() * 9000));
    const cleanPhone = input.customerPhone.replace(/\D/g, '').slice(0, 15);
    const nowIso = new Date().toISOString();

    const sanitizedAddress: Address = {
      id: (input.address.id || 'addr_1').trim().slice(0, 64) || 'addr_1',
      label: (input.address.label || 'Home').trim().slice(0, 40) || 'Home',
      street: (input.address.street || '').trim().slice(0, 300) || 'Main Street',
      city: (input.address.city || '').trim().slice(0, 100) || 'Local City',
      zip: (input.address.zip || '').trim().slice(0, 20) || '000000'
    };

    const computedItemsSubtotal = Math.round(
      input.items.reduce(
        (sum, item) =>
          sum + (Math.max(0, Number(item.pricePerKg) || 0) / 1000) * Math.max(0, Number(item.selectedWeight) || 0) * Math.max(0, Number(item.quantity) || 0),
        0
      )
    );
    const sanitizedSubtotal = Math.max(
      0,
      Math.min(
        1000000,
        Math.round(typeof input.subtotal === 'number' && Number.isFinite(input.subtotal) ? input.subtotal : computedItemsSubtotal)
      )
    );
    const sanitizedTaxRate = Math.max(
      0,
      Math.min(50, Number(input.taxRate) || 0)
    );
    const sanitizedTaxAmount = Math.max(
      0,
      Math.min(500000, Math.round(Number(input.taxAmount) || 0))
    );
    const sanitizedDeliveryFee = Math.max(
      0,
      Math.min(5000, Math.round(Number(input.deliveryFee) || 0))
    );
    const sanitizedDiscountAmount = Math.max(
      0,
      Math.min(100000, Math.round(Number(input.discountAmount) || 0))
    );
    const sanitizedCouponCode = (input.couponCode || '').trim().toUpperCase().slice(0, 32);

    const sanitizedPaymentRef = (input.paymentReference || '').trim().slice(0, 100);
    const sanitizedChannelLabel = (input.paymentChannelLabel || '').trim().slice(0, 100);
    const sanitizedSettlementSummary = (input.settlementTargetSummary || '').trim().slice(0, 180);
    const sanitizedCardLast4 = (input.cardLast4 || '').replace(/\D/g, '').slice(-4);
    const validCardLast4 = /^[0-9]{4}$/.test(sanitizedCardLast4) ? sanitizedCardLast4 : '';
    const sanitizedCardNetwork = (input.cardNetwork || '').trim().slice(0, 32);

    const resolvedPaymentStatus: Order['paymentStatus'] =
      input.paymentStatus && ['pending', 'collected', 'paid'].includes(input.paymentStatus)
        ? input.paymentStatus
        : input.paymentMethod === 'cod'
        ? 'pending'
        : 'paid';

    const orderDoc: Order = {
      id: orderId,
      userId: firebaseUser.uid,
      customerName: (input.customerName.trim() || 'FreshVeggie Customer').slice(0, 120),
      customerPhone: cleanPhone,
      items: input.items.slice(0, 50),
      subtotal: sanitizedSubtotal,
      taxRate: sanitizedTaxRate,
      taxAmount: sanitizedTaxAmount,
      deliveryFee: sanitizedDeliveryFee,
      discountAmount: sanitizedDiscountAmount,
      couponCode: sanitizedCouponCode,
      total: Math.max(0, Math.min(1000000, Math.round(input.total))),
      status: 'placed',
      date: nowIso,
      deliverySlot: input.deliverySlot.slice(0, 120),
      address: sanitizedAddress,
      paymentMethod: input.paymentMethod,
      paymentStatus: resolvedPaymentStatus,
      ...(sanitizedPaymentRef ? { paymentReference: sanitizedPaymentRef } : {}),
      ...(sanitizedChannelLabel ? { paymentChannelLabel: sanitizedChannelLabel } : {}),
      ...(sanitizedSettlementSummary ? { settlementTargetSummary: sanitizedSettlementSummary } : {}),
      ...(validCardLast4 ? { cardLast4: validCardLast4 } : {}),
      ...(sanitizedCardNetwork ? { cardNetwork: sanitizedCardNetwork } : {}),
      deliveryPin,
      assignedToUid: '',
      assignedToName: '',
      assignedToCode: ''
    };

    const dispatchDoc: DispatchFeedItem = {
      orderId,
      city: sanitizedAddress.city.slice(0, 80),
      zip: sanitizedAddress.zip.slice(0, 20),
      deliverySlot: orderDoc.deliverySlot,
      itemCount: orderDoc.items.length,
      total: orderDoc.total,
      paymentMethod: orderDoc.paymentMethod,
      status: 'placed',
      assignedToUid: ''
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'orders', orderId), {
        ...orderDoc,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, 'dispatchFeed', orderId), {
        ...dispatchDoc,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await batch.commit();
      archiveOrderAsync(orderDoc);
      return orderDoc;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  const updateOrderStatus = async (
    orderId: string,
    status: Order['status'],
    paymentStatus?: Order['paymentStatus']
  ): Promise<void> => {
    try {
      const feedSnap = isAdmin
        ? await getDoc(doc(db, 'dispatchFeed', orderId)).catch(() => null)
        : null;
      const batch = writeBatch(db);
      const orderUpdate: Record<string, unknown> = {
        status,
        updatedAt: serverTimestamp()
      };
      if (paymentStatus) {
        orderUpdate.paymentStatus = paymentStatus;
      }

      batch.update(doc(db, 'orders', orderId), orderUpdate);
      if (!isAdmin || feedSnap?.exists()) {
        batch.update(doc(db, 'dispatchFeed', orderId), {
          status,
          updatedAt: serverTimestamp()
        });
      }
      if ((status === 'delivered' || status === 'cancelled') && isAdmin) {
        batch.delete(doc(db, 'active_deliveries', orderId));
      }
      await batch.commit();
      const matched = allOrders.find((o) => o.id === orderId) || orders.find((o) => o.id === orderId);
      if (matched) {
        archiveOrderAsync({
          ...matched,
          status,
          paymentStatus: paymentStatus || matched.paymentStatus
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const updateOrderDetails = async (
    orderId: string,
    updates: UpdateOrderDetailsInput
  ): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Only store administrators can edit order details.');
    }

    let currentOrder = allOrders.find((o) => o.id === orderId) || orders.find((o) => o.id === orderId);
    if (!currentOrder) {
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (orderSnap.exists()) {
        currentOrder = { ...(orderSnap.data() as Order), id: orderSnap.id };
      }
    }
    if (!currentOrder) {
      throw new Error(`Order #${orderId} could not be found.`);
    }

    const cleanPhone =
      updates.customerPhone !== undefined
        ? updates.customerPhone.replace(/\D/g, '').slice(0, 15)
        : currentOrder.customerPhone;
    if (!/^[0-9]{10,15}$/.test(cleanPhone)) {
      throw new Error('Customer phone number must contain 10 to 15 digits.');
    }

    const cleanCustomerName = (
      updates.customerName !== undefined ? updates.customerName : currentOrder.customerName
    )
      .trim()
      .slice(0, 120);
    if (!cleanCustomerName) {
      throw new Error('Customer name cannot be empty.');
    }

    let nextDate = currentOrder.date;
    if (updates.date !== undefined) {
      const parsed = new Date(updates.date);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('Please enter a valid order date.');
      }
      nextDate = parsed.toISOString().slice(0, 64);
    }

    const nextSlot = (
      updates.deliverySlot !== undefined ? updates.deliverySlot : currentOrder.deliverySlot
    )
      .trim()
      .slice(0, 120);
    if (!nextSlot) {
      throw new Error('Delivery slot cannot be empty.');
    }

    const existingAddr = currentOrder.address || {
      id: 'addr_1',
      label: 'Home',
      street: '',
      city: '',
      zip: ''
    };
    const nextAddress: Address = {
      id: (existingAddr.id || 'addr_1').trim().slice(0, 64) || 'addr_1',
      label: (updates.address?.label ?? existingAddr.label ?? 'Home').trim().slice(0, 40) || 'Home',
      street: (updates.address?.street ?? existingAddr.street ?? '').trim().slice(0, 300),
      city: (updates.address?.city ?? existingAddr.city ?? '').trim().slice(0, 100),
      zip: (updates.address?.zip ?? existingAddr.zip ?? '').trim().slice(0, 20)
    };

    if (!nextAddress.street) {
      throw new Error('Street address is required.');
    }
    if (!nextAddress.city) {
      throw new Error('City is required.');
    }
    if (nextAddress.zip.length < 3) {
      throw new Error('Pincode must be at least 3 characters.');
    }

    try {
      const feedSnap = await getDoc(doc(db, 'dispatchFeed', orderId)).catch(() => null);
      const batch = writeBatch(db);
      batch.update(doc(db, 'orders', orderId), {
        date: nextDate,
        deliverySlot: nextSlot,
        customerName: cleanCustomerName,
        customerPhone: cleanPhone,
        address: nextAddress,
        updatedAt: serverTimestamp()
      });

      if (feedSnap?.exists()) {
        batch.update(doc(db, 'dispatchFeed', orderId), {
          city: nextAddress.city.slice(0, 80),
          zip: nextAddress.zip.slice(0, 20),
          deliverySlot: nextSlot,
          updatedAt: serverTimestamp()
        });
      }

      await batch.commit();
      archiveOrderAsync({
        ...currentOrder,
        date: nextDate,
        deliverySlot: nextSlot,
        customerName: cleanCustomerName,
        customerPhone: cleanPhone,
        address: nextAddress
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const assignOrderToDelivery = async (
    orderId: string,
    deliveryUid: string,
    deliveryName: string,
    deliveryCode: string
  ): Promise<void> => {
    try {
      let currentOrder = allOrders.find((o) => o.id === orderId) || orders.find((o) => o.id === orderId);
      if (!currentOrder) {
        const orderSnap = await getDoc(doc(db, 'orders', orderId));
        if (orderSnap.exists()) {
          currentOrder = { ...(orderSnap.data() as Order), id: orderSnap.id };
        }
      }
      const nextStatus = currentOrder?.status === 'placed' ? 'packed' : (currentOrder?.status || 'packed');
      const safePartnerName = (deliveryName.trim() || 'Delivery Partner').slice(0, 120);
      const safePartnerCode = (deliveryCode.trim() || 'DEL').slice(0, 32);

      const feedSnap = await getDoc(doc(db, 'dispatchFeed', orderId)).catch(() => null);

      const batch = writeBatch(db);
      batch.update(doc(db, 'orders', orderId), {
        assignedToUid: deliveryUid,
        assignedToName: safePartnerName,
        assignedToCode: safePartnerCode,
        status: nextStatus,
        updatedAt: serverTimestamp()
      });
      if (feedSnap?.exists()) {
        batch.update(doc(db, 'dispatchFeed', orderId), {
          assignedToUid: deliveryUid,
          status: nextStatus,
          updatedAt: serverTimestamp()
        });
      }
      if (currentOrder?.userId && nextStatus !== 'delivered' && nextStatus !== 'cancelled') {
        const activeStatus =
          nextStatus === 'out_for_delivery'
            ? 'out_for_delivery'
            : nextStatus === 'packed'
            ? 'picked_up'
            : 'assigned';
        batch.set(doc(db, 'active_deliveries', orderId), {
          orderId,
          customerUid: currentOrder.userId,
          partnerUid: deliveryUid,
          partnerName: safePartnerName,
          status: activeStatus,
          lat: 28.6139,
          lng: 77.2090,
          accuracy: 50,
          speed: 0,
          heading: 0,
          updatedAt: serverTimestamp()
        });
      }
      await batch.commit();
      if (currentOrder) {
        archiveOrderAsync({
          ...currentOrder,
          assignedToUid: deliveryUid,
          status: nextStatus
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const toggleBlockUser = async (userId: string): Promise<void> => {
    const target = allUsers.find((u) => u.id === userId);
    if (!target) return;
    try {
      await updateDoc(doc(db, 'users', userId), {
        isBlocked: !target.isBlocked,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        authReady,
        isAdmin,
        isBootstrappedAdmin,
        user,
        signInWithGoogle,
        sendPhoneOtp,
        verifyPhoneOtp,
        ensureCustomerProfile,
        logout,
        updateProfile,
        addAddress,
        orders,
        allOrders,
        hasMoreOrders,
        loadingMoreOrders,
        loadMoreOrders,
        placeOrder,
        updateOrderStatus,
        updateOrderDetails,
        assignOrderToDelivery,
        allUsers,
        hasMoreUsers,
        loadingMoreUsers,
        loadMoreUsers,
        toggleBlockUser,
        adminList,
        grantAdminAccess,
        revokeAdminAccess
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
