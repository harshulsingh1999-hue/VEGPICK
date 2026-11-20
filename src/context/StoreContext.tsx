import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { apiFetch, invalidateCatalogCache } from '../lib/apiClient';
import {
  Product,
  CartItem,
  Coupon,
  Complaint,
  AppSettings,
  DEFAULT_APP_SETTINGS
} from '../lib/data';
import { STARTER_COUPONS, STARTER_PRODUCTS } from '../lib/catalogDefaults';
import { useAuth } from './AuthContext';

interface StoreContextType {
  products: Product[];
  productsLoading: boolean;
  refreshCatalog: () => Promise<void>;
  addProduct: (product: Omit<Product, 'id'>) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  toggleStock: (id: string) => Promise<void>;
  seedStarterCatalog: () => Promise<void>;

  cart: CartItem[];
  addToCart: (product: Product, weight: number) => void;
  removeFromCart: (productId: string, weight: number) => void;
  updateQuantity: (productId: string, weight: number, count: number) => void;
  clearCart: () => void;
  cartTotal: number;

  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  filteredProducts: Product[];

  coupons: Coupon[];
  addCoupon: (coupon: Coupon) => Promise<void>;
  deleteCoupon: (code: string) => Promise<void>;
  toggleCoupon: (code: string) => Promise<void>;

  complaints: Complaint[];
  addComplaint: (complaint: Omit<Complaint, 'id' | 'date' | 'userId'>) => Promise<void>;
  updateComplaintStatus: (
    id: string,
    status: Complaint['status'],
    resolutionNotes?: string
  ) => Promise<void>;

  appSettings: AppSettings;
  updateAppSettings: (settings: Partial<AppSettings>) => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const GUEST_CART_KEY = 'freshveggie_guest_cart';
const CATALOG_SWR_KEY = 'freshveggie_catalog_swr_v1';

interface CatalogCachePayload {
  products: Product[];
  coupons: Coupon[];
  settings: AppSettings;
}

const readCatalogSwr = (): CatalogCachePayload | null => {
  try {
    const raw = localStorage.getItem(CATALOG_SWR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CatalogCachePayload>;
    if (!Array.isArray(parsed.products)) return null;
    return {
      products: parsed.products,
      coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
      settings: parsed.settings
        ? { ...DEFAULT_APP_SETTINGS, ...parsed.settings }
        : DEFAULT_APP_SETTINGS
    };
  } catch {
    return null;
  }
};

const writeCatalogSwr = (payload: CatalogCachePayload) => {
  try {
    localStorage.setItem(CATALOG_SWR_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
};

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { firebaseUser, authReady, isBootstrappedAdmin } = useAuth();
  const initialSwr = readCatalogSwr();

  const [products, setProducts] = useState<Product[]>(initialSwr?.products || []);
  const [productsLoading, setProductsLoading] = useState(!initialSwr);
  const [coupons, setCoupons] = useState<Coupon[]>(initialSwr?.coupons || []);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(
    initialSwr?.settings || DEFAULT_APP_SETTINGS
  );

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(GUEST_CART_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const fetchEdgeCatalogAndFallback = useCallback(async () => {
    try {
      const res = await apiFetch('/api/catalog/bootstrap', {}, 4500);
      if (res.ok) {
        const data = (await res.json()) as {
          products?: Product[];
          coupons?: Coupon[];
          settings?: Partial<AppSettings> | null;
        };
        if (Array.isArray(data.products) && data.products.length > 0) {
          const nextSettings = data.settings
            ? { ...DEFAULT_APP_SETTINGS, ...data.settings }
            : DEFAULT_APP_SETTINGS;
          const nextCoupons = Array.isArray(data.coupons) ? data.coupons : [];
          setProducts(data.products);
          setCoupons(nextCoupons);
          setAppSettings(nextSettings);
          setProductsLoading(false);
          writeCatalogSwr({
            products: data.products,
            coupons: nextCoupons,
            settings: nextSettings
          });
          return;
        }
      }
    } catch {
      // Fall back cleanly to one-shot Firestore query below
    }

    // One-shot Firestore fallback (no persistent WebSocket listener for public shoppers)
    try {
      const [prodSnap, couponSnap, settingsSnap] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('pricePerKg', '>=', 0), limit(200))),
        getDocs(query(collection(db, 'coupons'), where('isActive', '==', true), limit(50))),
        getDoc(doc(db, 'settings', 'store'))
      ]);

      const nextProducts: Product[] = prodSnap.docs.map((d) => ({
        ...(d.data() as Product),
        id: d.id
      }));
      const nextCoupons: Coupon[] = couponSnap.docs.map((d) => ({
        ...(d.data() as Coupon),
        code: d.id
      }));
      const nextSettings: AppSettings = settingsSnap.exists()
        ? { ...DEFAULT_APP_SETTINGS, ...(settingsSnap.data() as Partial<AppSettings>) }
        : DEFAULT_APP_SETTINGS;

      setProducts(nextProducts);
      setCoupons(nextCoupons);
      setAppSettings(nextSettings);
      setProductsLoading(false);
      writeCatalogSwr({
        products: nextProducts,
        coupons: nextCoupons,
        settings: nextSettings
      });
    } catch (error) {
      setProductsLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'products');
    }
  }, []);

  // 1. Storefront Catalog, Settings & Coupons:
  //    - Bootstrapped Admin receives live Firestore onSnapshot sync
  //    - 1M daily customers/guests hydrate from Edge-Cached /api/catalog/bootstrap + SWR (near-zero Firestore reads)
  useEffect(() => {
    if (!authReady) return;

    if (!isBootstrappedAdmin) {
      void fetchEdgeCatalogAndFallback();
      return;
    }

    const q = query(collection(db, 'products'), where('pricePerKg', '>=', 0), limit(200));
    const unsubProducts = onSnapshot(
      q,
      (snapshot) => {
        const list: Product[] = snapshot.docs.map((d) => ({
          ...(d.data() as Product),
          id: d.id
        }));
        setProducts(list);
        setProductsLoading(false);
      },
      (error) => {
        setProductsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'products');
      }
    );

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'store'),
      (snap) => {
        if (snap.exists()) {
          setAppSettings({
            ...DEFAULT_APP_SETTINGS,
            ...(snap.data() as Partial<AppSettings>)
          });
        } else {
          setAppSettings(DEFAULT_APP_SETTINGS);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'settings/store');
      }
    );

    const unsubCoupons = onSnapshot(
      query(collection(db, 'coupons'), limit(100)),
      (snapshot) => {
        const list: Coupon[] = snapshot.docs.map((d) => ({
          ...(d.data() as Coupon),
          code: d.id
        }));
        setCoupons(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'coupons');
      }
    );

    return () => {
      unsubProducts();
      unsubSettings();
      unsubCoupons();
    };
  }, [authReady, isBootstrappedAdmin, fetchEdgeCatalogAndFallback]);

  // 2. Live Complaints from Firestore (Authenticated only)
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setComplaints([]);
      return;
    }

    const complaintsQuery = isBootstrappedAdmin
      ? query(collection(db, 'complaints'), limit(150))
      : query(collection(db, 'complaints'), where('userId', '==', firebaseUser.uid), limit(30));

    const unsub = onSnapshot(
      complaintsQuery,
      (snapshot) => {
        const list: Complaint[] = snapshot.docs.map((d) => ({
          ...(d.data() as Complaint),
          id: d.id
        }));
        list.sort((a, b) => b.date.localeCompare(a.date));
        setComplaints(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'complaints');
      }
    );
    return () => unsub();
  }, [authReady, firebaseUser, isBootstrappedAdmin]);

  // 5. Cross-device persistent Cart (synced to carts/{uid} when logged in)
  useEffect(() => {
    if (!authReady) return;

    if (!firebaseUser) {
      localStorage.setItem(GUEST_CART_KEY, JSON.stringify(cart));
      return;
    }

    const cartRef = doc(db, 'carts', firebaseUser.uid);
    const unsub = onSnapshot(
      cartRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as { items?: CartItem[] };
          setCart(Array.isArray(data.items) ? data.items : []);
        } else {
          // Migrate any guest cart items into Firestore once on login
          try {
            const guestRaw = localStorage.getItem(GUEST_CART_KEY);
            const guestItems: CartItem[] = guestRaw ? JSON.parse(guestRaw) : [];
            if (guestItems.length > 0) {
              setDoc(cartRef, {
                uid: firebaseUser.uid,
                items: guestItems.slice(0, 50),
                updatedAt: serverTimestamp()
              }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `carts/${firebaseUser.uid}`));
              localStorage.removeItem(GUEST_CART_KEY);
            }
          } catch {
            // ignore
          }
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `carts/${firebaseUser.uid}`);
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser]);

  const persistCart = useCallback(
    (nextCart: CartItem[]) => {
      const bounded = nextCart.slice(0, 50);
      setCart(bounded);
      if (!firebaseUser) {
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(bounded));
        return;
      }
      const cartRef = doc(db, 'carts', firebaseUser.uid);
      setDoc(cartRef, {
        uid: firebaseUser.uid,
        items: bounded,
        updatedAt: serverTimestamp()
      }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `carts/${firebaseUser.uid}`));
    },
    [firebaseUser]
  );

  // Admin Product CRUD
  const addProduct = async (productData: Omit<Product, 'id'>): Promise<Product> => {
    const id = 'prod_' + Math.random().toString(36).slice(2, 9);
    const newProduct: Product = {
      id,
      name: productData.name.trim().slice(0, 120),
      category: productData.category,
      pricePerKg: Math.max(0, Number(productData.pricePerKg) || 0),
      image: productData.image.trim().slice(0, 500),
      available: Boolean(productData.available),
      description: productData.description.trim().slice(0, 1000),
      rating: Number(productData.rating) || 4.5,
      reviews: Number(productData.reviews) || 0
    };
    try {
      await setDoc(doc(db, 'products', id), {
        ...newProduct,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      invalidateCatalogCache();
      return newProduct;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `products/${id}`);
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>): Promise<void> => {
    const existing = products.find((p) => p.id === id);
    if (!existing) return;
    try {
      await updateDoc(doc(db, 'products', id), {
        name: (updates.name ?? existing.name).trim().slice(0, 120),
        category: updates.category ?? existing.category,
        pricePerKg: Math.max(0, Number(updates.pricePerKg ?? existing.pricePerKg)),
        image: (updates.image ?? existing.image).trim().slice(0, 500),
        available: updates.available ?? existing.available,
        description: (updates.description ?? existing.description).trim().slice(0, 1000),
        rating: updates.rating ?? existing.rating,
        reviews: updates.reviews ?? existing.reviews,
        updatedAt: serverTimestamp()
      });
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `products/${id}`);
    }
  };

  const deleteProduct = async (id: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, 'products', id));
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `products/${id}`);
    }
  };

  const toggleStock = async (id: string): Promise<void> => {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    await updateProduct(id, { available: !target.available });
  };

  // Admin Starter Catalog Initialization
  const seedStarterCatalog = async (): Promise<void> => {
    try {
      const batch = writeBatch(db);
      STARTER_PRODUCTS.forEach((item, index) => {
        const id = `prod_${index + 1}`;
        batch.set(doc(db, 'products', id), {
          ...item,
          id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      STARTER_COUPONS.forEach((coupon) => {
        batch.set(doc(db, 'coupons', coupon.code), {
          ...coupon,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      batch.set(doc(db, 'settings', 'store'), {
        ...appSettings,
        catalogInitialized: true,
        updatedAt: serverTimestamp()
      });

      await batch.commit();
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'products/starter-catalog');
    }
  };

  // Admin Coupons CRUD
  const addCoupon = async (coupon: Coupon): Promise<void> => {
    const cleanCode = coupon.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    try {
      await setDoc(doc(db, 'coupons', cleanCode), {
        code: cleanCode,
        description: coupon.description.trim().slice(0, 240),
        discountType: coupon.discountType,
        discountValue: Math.max(0, Number(coupon.discountValue) || 0),
        minOrder: Math.max(0, Number(coupon.minOrder) || 0),
        isActive: Boolean(coupon.isActive),
        expiry: coupon.expiry.slice(0, 32),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `coupons/${cleanCode}`);
    }
  };

  const deleteCoupon = async (code: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, 'coupons', code));
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `coupons/${code}`);
    }
  };

  const toggleCoupon = async (code: string): Promise<void> => {
    const target = coupons.find((c) => c.code === code);
    if (!target) return;
    try {
      await updateDoc(doc(db, 'coupons', code), {
        isActive: !target.isActive,
        updatedAt: serverTimestamp()
      });
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `coupons/${code}`);
    }
  };

  // Complaints CRUD
  const addComplaint = async (
    data: Omit<Complaint, 'id' | 'date' | 'userId'>
  ): Promise<void> => {
    if (!firebaseUser) {
      throw new Error('Please sign in to submit a support ticket.');
    }
    const id = 'TKT-' + Math.floor(1000 + Math.random() * 9000);
    const cleanPhone = data.customerPhone.replace(/\D/g, '').slice(0, 15);
    const ticket: Complaint = {
      id,
      userId: firebaseUser.uid,
      orderId: (data.orderId || 'GENERAL').trim().slice(0, 128),
      customerName: data.customerName.trim().slice(0, 120),
      customerPhone: cleanPhone,
      category: data.category,
      subject: data.subject.trim().slice(0, 160),
      description: data.description.trim().slice(0, 2000),
      status: 'open',
      date: new Date().toISOString().split('T')[0]
    };

    try {
      await setDoc(doc(db, 'complaints', id), {
        ...ticket,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `complaints/${id}`);
    }
  };

  const updateComplaintStatus = async (
    id: string,
    status: Complaint['status'],
    resolutionNotes?: string
  ): Promise<void> => {
    try {
      const payload: Record<string, unknown> = {
        status,
        updatedAt: serverTimestamp()
      };
      if (typeof resolutionNotes === 'string') {
        payload.resolutionNotes = resolutionNotes.trim().slice(0, 1000);
      }
      await updateDoc(doc(db, 'complaints', id), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `complaints/${id}`);
    }
  };

  // App Settings
  const updateAppSettings = async (settings: Partial<AppSettings>): Promise<void> => {
    const nextSettings: AppSettings = {
      taxRate: Math.max(0, Math.min(50, Number(settings.taxRate ?? appSettings.taxRate))),
      baseDeliveryFee: Math.max(0, Number(settings.baseDeliveryFee ?? appSettings.baseDeliveryFee)),
      freeDeliveryThreshold: Math.max(
        0,
        Number(settings.freeDeliveryThreshold ?? appSettings.freeDeliveryThreshold)
      ),
      storeOpen: settings.storeOpen ?? appSettings.storeOpen,
      notificationsEnabled: settings.notificationsEnabled ?? appSettings.notificationsEnabled,
      catalogInitialized: settings.catalogInitialized ?? appSettings.catalogInitialized ?? false
    };

    try {
      await setDoc(doc(db, 'settings', 'store'), {
        ...nextSettings,
        updatedAt: serverTimestamp()
      });
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/store');
    }
  };

  // Cart Actions
  const addToCart = (product: Product, weight: number) => {
    const existing = cart.find((item) => item.id === product.id && item.selectedWeight === weight);
    if (existing) {
      persistCart(
        cart.map((item) =>
          item.id === product.id && item.selectedWeight === weight
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      persistCart([...cart, { ...product, selectedWeight: weight, quantity: 1 }]);
    }
  };

  const removeFromCart = (productId: string, weight: number) => {
    persistCart(cart.filter((item) => !(item.id === productId && item.selectedWeight === weight)));
  };

  const updateQuantity = (productId: string, weight: number, newCount: number) => {
    if (newCount < 1) {
      removeFromCart(productId, weight);
      return;
    }
    persistCart(
      cart.map((item) =>
        item.id === productId && item.selectedWeight === weight
          ? { ...item, quantity: newCount }
          : item
      )
    );
  };

  const clearCart = () => persistCart([]);

  const cartTotal = cart.reduce((total, item) => {
    const pricePerGram = item.pricePerKg / 1000;
    const itemPrice = pricePerGram * item.selectedWeight;
    return total + itemPrice * item.quantity;
  }, 0);

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <StoreContext.Provider
      value={{
        products,
        productsLoading,
        refreshCatalog: fetchEdgeCatalogAndFallback,
        addProduct,
        updateProduct,
        deleteProduct,
        toggleStock,
        seedStarterCatalog,
        cart,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        cartTotal,
        searchQuery,
        setSearchQuery,
        selectedCategory,
        setSelectedCategory,
        filteredProducts,
        coupons,
        addCoupon,
        deleteCoupon,
        toggleCoupon,
        complaints,
        addComplaint,
        updateComplaintStatus,
        appSettings,
        updateAppSettings
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
};
