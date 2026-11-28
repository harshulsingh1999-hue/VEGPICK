import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { archiveLedgerAsync, archiveOrderAsync } from '../lib/apiClient';
import {
  DispatchFeedItem,
  Order,
  DeliveryPersonnel,
  WalletLedgerEntry
} from '../lib/data';
import { useAuth } from './AuthContext';

export interface RegisterPartnerInput {
  name: string;
  phone: string;
  area: string;
  vehicle: string;
  dlNumber?: string;
  bankLast4?: string;
  ifsc?: string;
}

export interface GpsCoordinateInput {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number;
  heading: number;
}

export interface DeliveryContextType {
  deliveryUser: DeliveryPersonnel | null;
  partnerLoading: boolean;
  deliveryMen: DeliveryPersonnel[];
  registerPartner: (input: RegisterPartnerInput) => Promise<DeliveryPersonnel>;
  logoutPartner: () => Promise<void>;
  toggleOnline: () => Promise<void>;

  assignedOrders: Order[];
  availableOrders: DispatchFeedItem[];
  walletLedger: WalletLedgerEntry[];
  acceptOrder: (orderId: string) => Promise<void>;
  upsertActiveGpsLocation: (order: Order, coords: GpsCoordinateInput) => Promise<void>;
  updateDeliveryOrderStatus: (
    orderId: string,
    status: Order['status'],
    failureReason?: string,
    proofImageUrl?: string
  ) => Promise<void>;
  collectDeliveryPayment: (orderId: string) => Promise<void>;
  settledCash: number;
  settleCashInHand: () => Promise<number>;

  // Admin Fleet Management
  addDeliveryBoy: (data: {
    uid: string;
    email: string;
    name: string;
    phone: string;
    area: string;
    vehicle: string;
    isOnline: boolean;
    isApproved: boolean;
  }) => Promise<DeliveryPersonnel>;
  removeDeliveryBoy: (id: string) => Promise<void>;
  updateDeliveryBoy: (id: string, updates: Partial<DeliveryPersonnel>) => Promise<void>;

  stats: {
    completed: number;
    pending: number;
    cashCollected: number;
  };
}

const DeliveryContext = createContext<DeliveryContextType | undefined>(undefined);

const generatePartnerCode = (rosterCount: number): string => {
  const num = rosterCount + 101;
  return `DEL${num}`;
};

export const DeliveryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { firebaseUser, authReady, isAdmin, isBootstrappedAdmin, logout } = useAuth();

  const [deliveryUser, setDeliveryUser] = useState<DeliveryPersonnel | null>(null);
  const [partnerLoading, setPartnerLoading] = useState(true);
  const [deliveryMen, setDeliveryMen] = useState<DeliveryPersonnel[]>([]);
  const [assignedOrders, setAssignedOrders] = useState<Order[]>([]);
  const [availableOrders, setAvailableOrders] = useState<DispatchFeedItem[]>([]);
  const [walletLedger, setWalletLedger] = useState<WalletLedgerEntry[]>([]);

  // 1. Subscribe to current authenticated user's deliveryPartner profile (if registered)
  useEffect(() => {
    if (!authReady) return undefined;
    if (!firebaseUser) {
      setDeliveryUser(null);
      setPartnerLoading(false);
      return undefined;
    }

    setPartnerLoading(true);
    const partnerRef = doc(db, 'deliveryPartners', firebaseUser.uid);
    const unsub = onSnapshot(
      partnerRef,
      (snap) => {
        if (snap.exists()) {
          setDeliveryUser({ ...(snap.data() as DeliveryPersonnel), id: snap.id });
        } else {
          setDeliveryUser(null);
        }
        setPartnerLoading(false);
      },
      (error) => {
        setPartnerLoading(false);
        if (!auth.currentUser) return;
        handleFirestoreError(error, OperationType.GET, `deliveryPartners/${firebaseUser.uid}`);
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser]);

  // 2. Subscribe to assigned orders + available dispatch feed for approved partner
  useEffect(() => {
    if (!authReady || !firebaseUser || !deliveryUser?.isApproved) {
      setAssignedOrders([]);
      setAvailableOrders([]);
      return undefined;
    }

    const assignedQ = query(
      collection(db, 'orders'),
      where('assignedToUid', '==', firebaseUser.uid),
      limit(500)
    );
    const unsubAssigned = onSnapshot(
      assignedQ,
      (snapshot) => {
        const list: Order[] = snapshot.docs.map((d) => ({
          ...(d.data() as Order),
          id: d.id
        }));
        list.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        setAssignedOrders(list);
      },
      (error) => {
        if (!auth.currentUser) return;
        handleFirestoreError(error, OperationType.LIST, 'orders');
      }
    );

    const feedQ = query(
      collection(db, 'dispatchFeed'),
      where('assignedToUid', '==', ''),
      limit(100)
    );
    const unsubFeed = onSnapshot(
      feedQ,
      (snapshot) => {
        const list: DispatchFeedItem[] = snapshot.docs
          .map((d) => ({
            ...(d.data() as DispatchFeedItem),
            orderId: d.id
          }))
          .filter((item) => item.status !== 'delivered' && item.status !== 'cancelled');
        setAvailableOrders(list);
      },
      (error) => {
        if (!auth.currentUser) return;
        handleFirestoreError(error, OperationType.LIST, 'dispatchFeed');
      }
    );

    return () => {
      unsubAssigned();
      unsubFeed();
    };
  }, [authReady, firebaseUser, deliveryUser?.isApproved]);

  // 3. Subscribe to full delivery fleet list for Bootstrapped Admin
  useEffect(() => {
    if (!authReady || !firebaseUser || !isBootstrappedAdmin) {
      setDeliveryMen([]);
      return undefined;
    }

    const unsub = onSnapshot(
      query(collection(db, 'deliveryPartners'), limit(200)),
      (snapshot) => {
        const list: DeliveryPersonnel[] = snapshot.docs.map((d) => ({
          ...(d.data() as DeliveryPersonnel),
          id: d.id
        }));
        setDeliveryMen(list);
      },
      (error) => {
        if (!auth.currentUser) return;
        handleFirestoreError(error, OperationType.LIST, 'deliveryPartners');
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser, isBootstrappedAdmin]);

  // 4. Subscribe to immutable walletLedger (Bootstrapped Admin sees all; approved partner sees own entries)
  useEffect(() => {
    if (!authReady || !firebaseUser || (!isBootstrappedAdmin && !deliveryUser?.isApproved)) {
      setWalletLedger([]);
      return undefined;
    }

    const ledgerQ = isBootstrappedAdmin
      ? query(collection(db, 'walletLedger'), limit(250))
      : query(collection(db, 'walletLedger'), where('partnerUid', '==', firebaseUser.uid), limit(500));

    const unsub = onSnapshot(
      ledgerQ,
      (snapshot) => {
        const entries: WalletLedgerEntry[] = snapshot.docs.map((d) => ({
          ...(d.data() as WalletLedgerEntry),
          id: d.id
        }));
        entries.sort((a, b) => {
          const getMs = (ts: unknown) => {
            if (ts && typeof ts === 'object' && 'toMillis' in ts) {
              return (ts as { toMillis: () => number }).toMillis();
            }
            return 0;
          };
          return getMs(b.createdAt) - getMs(a.createdAt);
        });
        setWalletLedger(entries);
      },
      (error) => {
        if (!auth.currentUser) return;
        handleFirestoreError(error, OperationType.LIST, 'walletLedger');
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser, isBootstrappedAdmin, deliveryUser?.isApproved]);

  // Partner self-registration via Firebase Phone OTP or Google Auth
  const registerPartner = async (input: RegisterPartnerInput): Promise<DeliveryPersonnel> => {
    if (!firebaseUser) {
      throw new Error('Please sign in via Mobile OTP or Google before submitting partner registration.');
    }

    const uid = firebaseUser.uid;
    const rawPhone = input.phone || firebaseUser.phoneNumber || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(0, 15);
    if (cleanPhone.length < 10) {
      throw new Error('Please enter a valid 10-digit mobile number.');
    }
    const partnerCode = 'DEL-' + uid.slice(0, 5).toUpperCase();

    const newPartner: DeliveryPersonnel = {
      id: uid,
      uid,
      partnerCode,
      name: ((input.name || firebaseUser.displayName || '').trim() || 'Delivery Partner').slice(0, 120),
      email: (firebaseUser.email || '').slice(0, 200),
      phone: cleanPhone,
      area: input.area.trim().slice(0, 80) || 'Central Zone',
      vehicle: input.vehicle.trim().slice(0, 60) || 'Motorcycle',
      dlNumber: (input.dlNumber || '').trim().toUpperCase().slice(0, 40),
      bankLast4: (input.bankLast4 || '').trim().slice(0, 10),
      ifsc: (input.ifsc || '').trim().toUpperCase().slice(0, 20),
      isOnline: false,
      isApproved: isAdmin,
      completedDeliveries: 0,
      rating: 5.0,
      settledCash: 0
    };

    try {
      await setDoc(doc(db, 'deliveryPartners', uid), {
        ...newPartner,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return newPartner;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `deliveryPartners/${uid}`);
    }
  };

  const logoutPartner = async (): Promise<void> => {
    if (firebaseUser && deliveryUser?.isApproved && deliveryUser.isOnline) {
      try {
        await updateDoc(doc(db, 'deliveryPartners', firebaseUser.uid), {
          isOnline: false,
          updatedAt: serverTimestamp()
        });
      } catch {
        // ignore if permissions already changed
      }
    }
    await logout();
  };

  const toggleOnline = async (): Promise<void> => {
    if (!firebaseUser || !deliveryUser) return;
    try {
      await updateDoc(doc(db, 'deliveryPartners', firebaseUser.uid), {
        isOnline: !deliveryUser.isOnline,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `deliveryPartners/${firebaseUser.uid}`);
    }
  };

  const acceptOrder = async (orderId: string): Promise<void> => {
    if (!firebaseUser || !deliveryUser || !deliveryUser.isApproved) {
      throw new Error('Approved delivery partner session required to accept orders.');
    }

    const feedSnap = await getDoc(doc(db, 'dispatchFeed', orderId)).catch(() => null);
    const feedItem =
      (feedSnap?.exists() ? (feedSnap.data() as DispatchFeedItem) : null) ||
      availableOrders.find((f) => f.orderId === orderId);

    if (feedItem?.assignedToUid && feedItem.assignedToUid !== firebaseUser.uid) {
      throw new Error('This order was already claimed by another delivery partner.');
    }
    if (feedItem?.status === 'delivered' || feedItem?.status === 'cancelled') {
      throw new Error(`Order #${orderId} is already ${feedItem.status}.`);
    }

    const nextStatus: Order['status'] =
      feedItem?.status === 'out_for_delivery' ? 'out_for_delivery' : 'packed';

    try {
      const batch = writeBatch(db);
      const safePartnerName = (deliveryUser.name || '').trim().slice(0, 120) || 'Delivery Partner';
      const safePartnerCode = (deliveryUser.partnerCode || '').trim().slice(0, 32) || 'DEL';
      batch.update(doc(db, 'orders', orderId), {
        assignedToUid: firebaseUser.uid,
        assignedToName: safePartnerName,
        assignedToCode: safePartnerCode,
        status: nextStatus,
        updatedAt: serverTimestamp()
      });
      if (feedSnap?.exists()) {
        batch.update(doc(db, 'dispatchFeed', orderId), {
          assignedToUid: firebaseUser.uid,
          status: nextStatus,
          updatedAt: serverTimestamp()
        });
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  // Streams throttled GPS location into ephemeral /active_deliveries/{orderId}
  const upsertActiveGpsLocation = useCallback(
    async (order: Order, coords: GpsCoordinateInput): Promise<void> => {
      if (!firebaseUser || !deliveryUser || !deliveryUser.isApproved) return;
      if (order.assignedToUid !== firebaseUser.uid) return;
      if (order.status === 'delivered' || order.status === 'cancelled') return;

      const activeStatus =
        order.status === 'out_for_delivery'
          ? 'out_for_delivery'
          : order.status === 'packed'
          ? 'picked_up'
          : 'assigned';

      const lat = Math.max(-90, Math.min(90, Number(coords.lat) || 0));
      const lng = Math.max(-180, Math.min(180, Number(coords.lng) || 0));
      const accuracy = Math.max(0, Math.min(10000, Math.round(Number(coords.accuracy) || 0)));
      const speed = Math.max(0, Math.min(300, Number(coords.speed) || 0));
      const heading = Math.max(0, Math.min(360, Number(coords.heading) || 0));

      const activeRef = doc(db, 'active_deliveries', order.id);
      try {
        const snap = await getDoc(activeRef);
        if (!snap.exists()) {
          await setDoc(activeRef, {
            orderId: order.id,
            customerUid: order.userId,
            partnerUid: firebaseUser.uid,
            partnerName: (deliveryUser.name || '').trim().slice(0, 120) || 'Delivery Partner',
            status: activeStatus,
            lat,
            lng,
            accuracy,
            speed,
            heading,
            updatedAt: serverTimestamp()
          });
        } else {
          const existingPartnerUid = (snap.data() as Partial<{ partnerUid: string }>)?.partnerUid;
          if (existingPartnerUid && existingPartnerUid !== firebaseUser.uid) {
            return;
          }
          await updateDoc(activeRef, {
            status: activeStatus,
            lat,
            lng,
            accuracy,
            speed,
            heading,
            updatedAt: serverTimestamp()
          });
        }
      } catch (error) {
        if (!auth.currentUser) return;
        handleFirestoreError(error, OperationType.WRITE, `active_deliveries/${order.id}`);
      }
    },
    [firebaseUser, deliveryUser]
  );

  const updateDeliveryOrderStatus = async (
    orderId: string,
    status: Order['status'],
    failureReason?: string,
    proofImageUrl?: string
  ): Promise<void> => {
    if (!firebaseUser || !deliveryUser || !deliveryUser.isApproved) {
      throw new Error('Approved delivery partner session required.');
    }

    let targetOrder = assignedOrders.find((o) => o.id === orderId);
    if (!targetOrder) {
      const orderSnap = await getDoc(doc(db, 'orders', orderId)).catch(() => null);
      if (orderSnap?.exists()) {
        targetOrder = { ...(orderSnap.data() as Order), id: orderSnap.id };
      }
    }
    if (!targetOrder) {
      throw new Error(`Order #${orderId} could not be found.`);
    }
    if (targetOrder.assignedToUid !== firebaseUser.uid) {
      throw new Error(`Order #${orderId} is no longer assigned to your account.`);
    }
    if (targetOrder.status === 'delivered' || targetOrder.status === 'cancelled') {
      throw new Error(`Order #${orderId} is already ${targetOrder.status}.`);
    }

    const shouldMarkCodCollected =
      status === 'delivered' &&
      targetOrder.paymentMethod === 'cod' &&
      targetOrder.paymentStatus !== 'collected';
    const [feedSnap, activeSnap] = await Promise.all([
      getDoc(doc(db, 'dispatchFeed', orderId)).catch(() => null),
      status === 'delivered' || status === 'cancelled'
        ? getDoc(doc(db, 'active_deliveries', orderId)).catch(() => null)
        : Promise.resolve(null)
    ]);
    const feedData = feedSnap?.exists() ? (feedSnap.data() as Partial<DispatchFeedItem>) : null;
    const canUpdateFeed =
      Boolean(feedSnap?.exists()) &&
      feedData?.status !== 'delivered' &&
      feedData?.status !== 'cancelled';
    const safePartnerName = (deliveryUser.name || '').trim().slice(0, 120) || 'Delivery Partner';

    try {
      const batch = writeBatch(db);
      const orderUpdate: Record<string, unknown> = {
        status,
        updatedAt: serverTimestamp()
      };
      if (shouldMarkCodCollected) {
        orderUpdate.paymentStatus = 'collected';
      }
      if (failureReason) {
        orderUpdate.failureReason = failureReason.slice(0, 200);
      }
      if (proofImageUrl) {
        orderUpdate.proofImageUrl = proofImageUrl.slice(0, 500);
      }

      batch.update(doc(db, 'orders', orderId), orderUpdate);
      if (canUpdateFeed) {
        batch.update(doc(db, 'dispatchFeed', orderId), {
          assignedToUid: firebaseUser.uid,
          status,
          updatedAt: serverTimestamp()
        });
      }

      const deterministicLedgerId = `trip_${orderId}`;
      const alreadyCredited = walletLedger.some(
        (entry) => entry.id === deterministicLedgerId || (entry.orderId === orderId && entry.type === 'trip_credit')
      );

      if (status === 'delivered') {
        batch.update(doc(db, 'deliveryPartners', firebaseUser.uid), {
          completedDeliveries: increment(1),
          updatedAt: serverTimestamp()
        });
        if (!alreadyCredited) {
          batch.set(doc(db, 'walletLedger', deterministicLedgerId), {
            id: deterministicLedgerId,
            partnerUid: firebaseUser.uid,
            partnerName: safePartnerName,
            orderId,
            type: 'trip_credit',
            amount: 45,
            note: `Completed delivery payout for #${orderId}`,
            createdAt: serverTimestamp()
          });
        }
      }

      // Cost-saving cleanup: remove ephemeral GPS tracking doc once terminal state reached
      if ((status === 'delivered' || status === 'cancelled') && activeSnap?.exists()) {
        batch.delete(doc(db, 'active_deliveries', orderId));
      }

      await batch.commit();

      if ((status === 'delivered' || status === 'cancelled') && activeSnap === null) {
        void deleteDoc(doc(db, 'active_deliveries', orderId)).catch(() => undefined);
      }

      archiveOrderAsync({
        ...targetOrder,
        status,
        paymentStatus: shouldMarkCodCollected ? 'collected' : targetOrder.paymentStatus
      });
      if (status === 'delivered') {
        archiveLedgerAsync({
          id: deterministicLedgerId,
          partnerUid: firebaseUser.uid,
          orderId,
          type: 'trip_credit',
          amount: 45
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const collectDeliveryPayment = async (orderId: string): Promise<void> => {
    if (!firebaseUser || !deliveryUser || !deliveryUser.isApproved) {
      throw new Error('Approved delivery partner session required.');
    }

    let targetOrder = assignedOrders.find((o) => o.id === orderId);
    if (!targetOrder) {
      const orderSnap = await getDoc(doc(db, 'orders', orderId)).catch(() => null);
      if (orderSnap?.exists()) {
        targetOrder = { ...(orderSnap.data() as Order), id: orderSnap.id };
      }
    }
    if (targetOrder) {
      if (targetOrder.assignedToUid !== firebaseUser.uid) {
        throw new Error(`Order #${orderId} is no longer assigned to your account.`);
      }
      if (targetOrder.status === 'delivered' || targetOrder.status === 'cancelled') {
        throw new Error(`Cannot mark COD collected after order is ${targetOrder.status}.`);
      }
      if (targetOrder.paymentStatus === 'collected') {
        return;
      }
    }

    try {
      await updateDoc(doc(db, 'orders', orderId), {
        paymentStatus: 'collected',
        updatedAt: serverTimestamp()
      });
      if (targetOrder) {
        archiveOrderAsync({ ...targetOrder, paymentStatus: 'collected' });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  // Admin Fleet CRUD
  const addDeliveryBoy = async (data: {
    uid: string;
    email: string;
    name: string;
    phone: string;
    area: string;
    vehicle: string;
    isOnline: boolean;
    isApproved: boolean;
  }): Promise<DeliveryPersonnel> => {
    const cleanUid = data.uid.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const docId = cleanUid || 'partner_' + Math.random().toString(36).slice(2, 9);
    const partnerCode = generatePartnerCode(deliveryMen.length);
    const cleanName = data.name.trim().slice(0, 120);
    if (!cleanName) {
      throw new Error('Partner full name is required.');
    }
    const cleanPhone = data.phone.replace(/\D/g, '').slice(0, 15);
    if (cleanPhone.length < 10) {
      throw new Error('Please enter a valid 10-digit mobile number.');
    }

    const existingSnap = await getDoc(doc(db, 'deliveryPartners', docId)).catch(() => null);
    if (existingSnap?.exists()) {
      throw new Error(`Delivery partner account with UID ${docId} already exists.`);
    }

    const newBoy: DeliveryPersonnel = {
      id: docId,
      uid: docId,
      partnerCode,
      name: cleanName,
      email: data.email.trim().slice(0, 200),
      phone: cleanPhone,
      area: data.area.trim().slice(0, 80) || 'Central Zone',
      vehicle: data.vehicle.trim().slice(0, 60) || 'Motorcycle',
      isOnline: data.isOnline,
      isApproved: data.isApproved,
      completedDeliveries: 0,
      rating: 5.0,
      settledCash: 0
    };

    try {
      await setDoc(doc(db, 'deliveryPartners', docId), {
        ...newBoy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return newBoy;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `deliveryPartners/${docId}`);
    }
  };

  const removeDeliveryBoy = async (id: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, 'deliveryPartners', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `deliveryPartners/${id}`);
    }
  };

  const updateDeliveryBoy = async (
    id: string,
    updates: Partial<DeliveryPersonnel>
  ): Promise<void> => {
    const sanitized: Record<string, unknown> = {
      updatedAt: serverTimestamp()
    };
    if (typeof updates.name === 'string') {
      const clean = updates.name.trim().slice(0, 120);
      if (clean) sanitized.name = clean;
    }
    if (typeof updates.area === 'string') {
      sanitized.area = updates.area.trim().slice(0, 80) || 'Central Zone';
    }
    if (typeof updates.vehicle === 'string') {
      sanitized.vehicle = updates.vehicle.trim().slice(0, 60) || 'Motorcycle';
    }
    if (typeof updates.phone === 'string') {
      const cleanPhone = updates.phone.replace(/\D/g, '').slice(0, 15);
      if (cleanPhone.length >= 10) sanitized.phone = cleanPhone;
    }
    if (typeof updates.email === 'string') {
      sanitized.email = updates.email.trim().slice(0, 200);
    }
    if (typeof updates.isOnline === 'boolean') {
      sanitized.isOnline = updates.isOnline;
    }
    if (typeof updates.isApproved === 'boolean') {
      sanitized.isApproved = updates.isApproved;
    }

    try {
      await updateDoc(doc(db, 'deliveryPartners', id), sanitized);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `deliveryPartners/${id}`);
    }
  };

  const grossCashCollected = assignedOrders
    .filter((o) => o.paymentMethod === 'cod' && o.paymentStatus === 'collected')
    .reduce((acc, curr) => acc + curr.total, 0);

  const driverSettled = deliveryUser?.settledCash || 0;
  const cashInHand = Math.max(0, grossCashCollected - driverSettled);

  const settleCashInHand = async (): Promise<number> => {
    if (!firebaseUser || !deliveryUser || cashInHand <= 0) return 0;
    const settledAmount = cashInHand;
    const ledgerId = `cod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'deliveryPartners', firebaseUser.uid), {
        settledCash: driverSettled + settledAmount,
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, 'walletLedger', ledgerId), {
        id: ledgerId,
        partnerUid: firebaseUser.uid,
        partnerName: (deliveryUser.name || '').trim().slice(0, 120) || 'Delivery Partner',
        orderId: '',
        type: 'cod_settlement',
        amount: settledAmount,
        note: 'COD Cash Deposited at Hub',
        createdAt: serverTimestamp()
      });
      await batch.commit();
      archiveLedgerAsync({
        id: ledgerId,
        partnerUid: firebaseUser.uid,
        orderId: '',
        type: 'cod_settlement',
        amount: settledAmount
      });
      return settledAmount;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `deliveryPartners/${firebaseUser.uid}`);
    }
  };

  const stats = {
    completed: assignedOrders.filter((o) => o.status === 'delivered').length,
    pending: assignedOrders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled').length,
    cashCollected: cashInHand
  };

  return (
    <DeliveryContext.Provider
      value={{
        deliveryUser,
        partnerLoading,
        deliveryMen,
        registerPartner,
        logoutPartner,
        toggleOnline,
        assignedOrders,
        availableOrders,
        walletLedger,
        acceptOrder,
        upsertActiveGpsLocation,
        updateDeliveryOrderStatus,
        collectDeliveryPayment,
        settledCash: driverSettled,
        settleCashInHand,
        addDeliveryBoy,
        removeDeliveryBoy,
        updateDeliveryBoy,
        stats
      }}
    >
      {children}
    </DeliveryContext.Provider>
  );
};

export const useDelivery = () => {
  const context = useContext(DeliveryContext);
  if (!context) throw new Error('useDelivery must be used within DeliveryProvider');
  return context;
};
