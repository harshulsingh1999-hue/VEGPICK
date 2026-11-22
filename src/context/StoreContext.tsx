import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  deleteDoc,
  deleteField,
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
import { apiFetch, invalidateCatalogCache, refreshRuntimeServerNodes } from '../lib/apiClient';
import {
  Product,
  CartItem,
  Coupon,
  Complaint,
  ServiceArea,
  AppSettings,
  DEFAULT_APP_SETTINGS
} from '../lib/data';
import { STARTER_COUPONS, STARTER_PRODUCTS } from '../lib/catalogDefaults';
import { getProductFrontImage, sanitizeProductImages } from '../lib/utils';
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
  addToCart: (product: Product, weight: number, quantity?: number) => void;
  addItemsToCart: (entries: Array<{ product: Product; weight: number; quantity?: number }>) => void;
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

  serviceAreas: ServiceArea[];
  addServiceArea: (area: Omit<ServiceArea, 'id'>) => Promise<ServiceArea>;
  updateServiceArea: (id: string, updates: Partial<ServiceArea>) => Promise<void>;
  deleteServiceArea: (id: string) => Promise<void>;
  toggleServiceArea: (id: string) => Promise<void>;
  selectedPincode: string;
  setSelectedPincode: (pincode: string) => void;
  checkPincodeServiceability: (pincode: string) => {
    serviceable: boolean;
    restricted: boolean;
    matchedArea: ServiceArea | null;
    reason?: string;
  };

  appSettings: AppSettings;
  updateAppSettings: (settings: Partial<AppSettings>) => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const GUEST_CART_KEY = 'freshveggie_guest_cart';
const CATALOG_SWR_KEY = 'freshveggie_catalog_swr_v2';
const SELECTED_PINCODE_KEY = 'freshveggie_selected_pincode';

interface CatalogCachePayload {
  products: Product[];
  coupons: Coupon[];
  serviceAreas: ServiceArea[];
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
      serviceAreas: Array.isArray(parsed.serviceAreas) ? parsed.serviceAreas : [],
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
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>(initialSwr?.serviceAreas || []);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(
    initialSwr?.settings || DEFAULT_APP_SETTINGS
  );
  const [selectedPincode, setSelectedPincodeState] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_PINCODE_KEY) || '';
    } catch {
      return '';
    }
  });

  const setSelectedPincode = useCallback((pincode: string) => {
    const cleaned = pincode.replace(/\D/g, '').slice(0, 10);
    setSelectedPincodeState(cleaned);
    try {
      if (cleaned) localStorage.setItem(SELECTED_PINCODE_KEY, cleaned);
      else localStorage.removeItem(SELECTED_PINCODE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(GUEST_CART_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const cartRef = useRef<CartItem[]>(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const fetchEdgeCatalogAndFallback = useCallback(async () => {
    try {
      void refreshRuntimeServerNodes();
      const res = await apiFetch('/api/catalog/bootstrap', {}, 4500);
      if (res.ok) {
        const data = (await res.json()) as {
          products?: Product[];
          coupons?: Coupon[];
          serviceAreas?: ServiceArea[];
          settings?: Partial<AppSettings> | null;
        };
        if (Array.isArray(data.products) && (data.products.length > 0 || Array.isArray(data.serviceAreas))) {
          const nextSettings = data.settings
            ? { ...DEFAULT_APP_SETTINGS, ...data.settings }
            : DEFAULT_APP_SETTINGS;
          const nextCoupons = Array.isArray(data.coupons) ? data.coupons : [];
          const nextAreas = Array.isArray(data.serviceAreas) ? data.serviceAreas : [];
          setProducts(data.products);
          setCoupons(nextCoupons);
          setServiceAreas(nextAreas);
          setAppSettings(nextSettings);
          setProductsLoading(false);
          writeCatalogSwr({
            products: data.products,
            coupons: nextCoupons,
            serviceAreas: nextAreas,
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
      const [prodSnap, couponSnap, areaSnap, settingsSnap] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('pricePerKg', '>=', 0), limit(200))),
        getDocs(query(collection(db, 'coupons'), where('isActive', '==', true), limit(50))),
        getDocs(query(collection(db, 'serviceAreas'), where('isActive', '==', true), limit(200))),
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
      const nextAreas: ServiceArea[] = areaSnap.docs.map((d) => ({
        ...(d.data() as ServiceArea),
        id: d.id
      }));
      const nextSettings: AppSettings = settingsSnap.exists()
        ? { ...DEFAULT_APP_SETTINGS, ...(settingsSnap.data() as Partial<AppSettings>) }
        : DEFAULT_APP_SETTINGS;

      setProducts(nextProducts);
      setCoupons(nextCoupons);
      setServiceAreas(nextAreas);
      setAppSettings(nextSettings);
      setProductsLoading(false);
      writeCatalogSwr({
        products: nextProducts,
        coupons: nextCoupons,
        serviceAreas: nextAreas,
        settings: nextSettings
      });
    } catch (error) {
      setProductsLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'products');
    }
  }, []);

  // 1. Storefront Catalog, Settings & Service Areas:
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

    const unsubAreas = onSnapshot(
      query(collection(db, 'serviceAreas'), limit(200)),
      (snapshot) => {
        const list: ServiceArea[] = snapshot.docs.map((d) => ({
          ...(d.data() as ServiceArea),
          id: d.id
        }));
        list.sort((a, b) => a.pincode.localeCompare(b.pincode));
        setServiceAreas(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'serviceAreas');
      }
    );

    return () => {
      unsubProducts();
      unsubSettings();
      unsubCoupons();
      unsubAreas();
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
        let guestItems: CartItem[] = [];
        try {
          const guestRaw = localStorage.getItem(GUEST_CART_KEY);
          const parsed = guestRaw ? JSON.parse(guestRaw) : [];
          if (Array.isArray(parsed)) {
            guestItems = parsed;
          }
        } catch {
          guestItems = [];
        }

        if (snap.exists()) {
          const data = snap.data() as { items?: CartItem[] };
          const remoteItems = Array.isArray(data.items) ? data.items : [];
          if (guestItems.length > 0) {
            const merged = [...remoteItems];
            for (const gItem of guestItems) {
              const idx = merged.findIndex(
                (r) => r.id === gItem.id && r.selectedWeight === gItem.selectedWeight
              );
              if (idx >= 0) {
                merged[idx] = {
                  ...merged[idx],
                  quantity: merged[idx].quantity + (gItem.quantity || 1)
                };
              } else {
                merged.push(gItem);
              }
            }
            const bounded = merged.slice(0, 50);
            setCart(bounded);
            setDoc(cartRef, {
              uid: firebaseUser.uid,
              items: bounded,
              updatedAt: serverTimestamp()
            }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `carts/${firebaseUser.uid}`));
            localStorage.removeItem(GUEST_CART_KEY);
          } else {
            setCart(remoteItems);
          }
        } else if (guestItems.length > 0) {
          const bounded = guestItems.slice(0, 50);
          setCart(bounded);
          setDoc(cartRef, {
            uid: firebaseUser.uid,
            items: bounded,
            updatedAt: serverTimestamp()
          }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `carts/${firebaseUser.uid}`));
          localStorage.removeItem(GUEST_CART_KEY);
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
      cartRef.current = bounded;
      setCart(bounded);
      if (!firebaseUser) {
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(bounded));
        return;
      }
      const cartRefDoc = doc(db, 'carts', firebaseUser.uid);
      setDoc(cartRefDoc, {
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
    const normalizedImages = sanitizeProductImages(productData.images, productData.image);
    const frontImage = normalizedImages[0] || productData.image.trim().slice(0, 500);
    const newProduct: Product = {
      id,
      name: productData.name.trim().slice(0, 120),
      category: productData.category,
      pricePerKg: Math.max(0, Number(productData.pricePerKg) || 0),
      image: frontImage,
      images: normalizedImages.length > 0 ? normalizedImages : [frontImage],
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
      if (!isBootstrappedAdmin) {
        setProducts((prev) => [...prev, newProduct]);
      }
      invalidateCatalogCache();
      return newProduct;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `products/${id}`);
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>): Promise<void> => {
    const existing = products.find((p) => p.id === id);
    if (!existing) return;
    const rawGallery =
      updates.images !== undefined
        ? sanitizeProductImages(updates.images, updates.image ?? existing.image)
        : updates.image !== undefined
        ? sanitizeProductImages([updates.image, ...(existing.images || []).filter((u) => u !== updates.image)], updates.image)
        : sanitizeProductImages(existing.images, existing.image);
    const frontImage = rawGallery[0] || (updates.image ?? existing.image).trim().slice(0, 500);
    const normalizedImages = rawGallery.length > 0 ? rawGallery : [frontImage];

    const updatedProduct: Product = {
      ...existing,
      name: (updates.name ?? existing.name).trim().slice(0, 120),
      category: updates.category ?? existing.category,
      pricePerKg: Math.max(0, Number(updates.pricePerKg ?? existing.pricePerKg)),
      image: frontImage,
      images: normalizedImages,
      available: updates.available ?? existing.available,
      description: (updates.description ?? existing.description).trim().slice(0, 1000),
      rating: updates.rating ?? existing.rating,
      reviews: updates.reviews ?? existing.reviews
    };
    try {
      await updateDoc(doc(db, 'products', id), {
        name: updatedProduct.name,
        category: updatedProduct.category,
        pricePerKg: updatedProduct.pricePerKg,
        image: updatedProduct.image,
        images: normalizedImages,
        available: updatedProduct.available,
        description: updatedProduct.description,
        rating: updatedProduct.rating,
        reviews: updatedProduct.reviews,
        updatedAt: serverTimestamp()
      });
      if (!isBootstrappedAdmin) {
        setProducts((prev) => prev.map((p) => (p.id === id ? updatedProduct : p)));
      }
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `products/${id}`);
    }
  };

  const deleteProduct = async (id: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, 'products', id));
      if (!isBootstrappedAdmin) {
        setProducts((prev) => prev.filter((p) => p.id !== id));
      }
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
      if (!isBootstrappedAdmin) {
        setProducts(
          STARTER_PRODUCTS.map((item, index) => ({
            ...item,
            id: `prod_${index + 1}`
          }))
        );
        setCoupons(STARTER_COUPONS);
        setAppSettings((prev) => ({ ...prev, catalogInitialized: true }));
      }
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'products/starter-catalog');
    }
  };

  // Admin Coupons CRUD
  const addCoupon = async (coupon: Coupon): Promise<void> => {
    const cleanCode = coupon.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    const savedCoupon: Coupon = {
      code: cleanCode,
      description: coupon.description.trim().slice(0, 240),
      discountType: coupon.discountType,
      discountValue: Math.max(0, Number(coupon.discountValue) || 0),
      minOrder: Math.max(0, Number(coupon.minOrder) || 0),
      isActive: Boolean(coupon.isActive),
      expiry: coupon.expiry.slice(0, 32)
    };
    try {
      await setDoc(doc(db, 'coupons', cleanCode), {
        ...savedCoupon,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      if (!isBootstrappedAdmin) {
        setCoupons((prev) => [
          ...prev.filter((c) => c.code !== cleanCode),
          savedCoupon
        ]);
      }
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `coupons/${cleanCode}`);
    }
  };

  const deleteCoupon = async (code: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, 'coupons', code));
      if (!isBootstrappedAdmin) {
        setCoupons((prev) => prev.filter((c) => c.code !== code));
      }
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
      if (!isBootstrappedAdmin) {
        setCoupons((prev) =>
          prev.map((c) => (c.code === code ? { ...c, isActive: !target.isActive } : c))
        );
      }
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

  // Service Areas & Pincode CRUD
  const addServiceArea = async (areaData: Omit<ServiceArea, 'id'>): Promise<ServiceArea> => {
    const cleanPin = areaData.pincode.replace(/\D/g, '').slice(0, 10);
    if (cleanPin.length < 4) {
      throw new Error('Pincode must be between 4 and 10 digits.');
    }
    const id = `area_${cleanPin}_${Math.random().toString(36).slice(2, 6)}`;
    const payload: Record<string, unknown> = {
      id,
      name: areaData.name.trim().slice(0, 100),
      city: areaData.city.trim().slice(0, 80),
      pincode: cleanPin,
      isActive: Boolean(areaData.isActive),
      etaMinutes: Math.max(5, Math.min(1440, Number(areaData.etaMinutes) || 30)),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (typeof areaData.deliveryFeeOverride === 'number' && Number.isFinite(areaData.deliveryFeeOverride)) {
      payload.deliveryFeeOverride = Math.max(0, Math.min(5000, areaData.deliveryFeeOverride));
    }
    if (typeof areaData.minOrderOverride === 'number' && Number.isFinite(areaData.minOrderOverride)) {
      payload.minOrderOverride = Math.max(0, Math.min(50000, areaData.minOrderOverride));
    }
    if (areaData.notes && areaData.notes.trim()) {
      payload.notes = areaData.notes.trim().slice(0, 240);
    }

    try {
      await setDoc(doc(db, 'serviceAreas', id), payload);
      const createdArea: ServiceArea = {
        id,
        name: String(payload.name),
        city: String(payload.city),
        pincode: cleanPin,
        isActive: Boolean(payload.isActive),
        etaMinutes: Number(payload.etaMinutes),
        deliveryFeeOverride:
          typeof payload.deliveryFeeOverride === 'number' ? payload.deliveryFeeOverride : null,
        minOrderOverride:
          typeof payload.minOrderOverride === 'number' ? payload.minOrderOverride : null,
        notes: typeof payload.notes === 'string' ? payload.notes : ''
      };
      if (!isBootstrappedAdmin) {
        setServiceAreas((prev) =>
          [...prev, createdArea].sort((a, b) => a.pincode.localeCompare(b.pincode))
        );
      }
      invalidateCatalogCache();
      return createdArea;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `serviceAreas/${id}`);
    }
  };

  const updateServiceArea = async (id: string, updates: Partial<ServiceArea>): Promise<void> => {
    const existing = serviceAreas.find((a) => a.id === id);
    if (!existing) return;
    const cleanPin = (updates.pincode ?? existing.pincode).replace(/\D/g, '').slice(0, 10);
    if (cleanPin.length < 4) {
      throw new Error('Pincode must be between 4 and 10 digits.');
    }

    const updatedName = (updates.name ?? existing.name).trim().slice(0, 100);
    const updatedCity = (updates.city ?? existing.city).trim().slice(0, 80);
    const updatedIsActive = updates.isActive ?? existing.isActive;
    const updatedEta = Math.max(5, Math.min(1440, Number(updates.etaMinutes ?? existing.etaMinutes) || 30));

    const payload: Record<string, unknown> = {
      name: updatedName,
      city: updatedCity,
      pincode: cleanPin,
      isActive: updatedIsActive,
      etaMinutes: updatedEta,
      updatedAt: serverTimestamp()
    };

    let resolvedFee: number | null =
      typeof existing.deliveryFeeOverride === 'number' ? existing.deliveryFeeOverride : null;
    if (updates.deliveryFeeOverride === null) {
      payload.deliveryFeeOverride = deleteField();
      resolvedFee = null;
    } else if (
      typeof updates.deliveryFeeOverride === 'number' &&
      Number.isFinite(updates.deliveryFeeOverride)
    ) {
      const clampedFee = Math.max(0, Math.min(5000, updates.deliveryFeeOverride));
      payload.deliveryFeeOverride = clampedFee;
      resolvedFee = clampedFee;
    } else if (
      typeof existing.deliveryFeeOverride === 'number' &&
      Number.isFinite(existing.deliveryFeeOverride)
    ) {
      payload.deliveryFeeOverride = Math.max(0, Math.min(5000, existing.deliveryFeeOverride));
    }

    let resolvedMin: number | null =
      typeof existing.minOrderOverride === 'number' ? existing.minOrderOverride : null;
    if (updates.minOrderOverride === null) {
      payload.minOrderOverride = deleteField();
      resolvedMin = null;
    } else if (
      typeof updates.minOrderOverride === 'number' &&
      Number.isFinite(updates.minOrderOverride)
    ) {
      const clampedMin = Math.max(0, Math.min(50000, updates.minOrderOverride));
      payload.minOrderOverride = clampedMin;
      resolvedMin = clampedMin;
    } else if (
      typeof existing.minOrderOverride === 'number' &&
      Number.isFinite(existing.minOrderOverride)
    ) {
      payload.minOrderOverride = Math.max(0, Math.min(50000, existing.minOrderOverride));
    }

    let resolvedNotes = existing.notes || '';
    if (updates.notes !== undefined) {
      const trimmedNotes = updates.notes.trim().slice(0, 240);
      if (trimmedNotes) {
        payload.notes = trimmedNotes;
        resolvedNotes = trimmedNotes;
      } else {
        payload.notes = deleteField();
        resolvedNotes = '';
      }
    } else if (existing.notes && existing.notes.trim()) {
      payload.notes = existing.notes.trim().slice(0, 240);
    }

    try {
      await updateDoc(doc(db, 'serviceAreas', id), payload);
      if (!isBootstrappedAdmin) {
        const mergedArea: ServiceArea = {
          id,
          name: updatedName,
          city: updatedCity,
          pincode: cleanPin,
          isActive: updatedIsActive,
          etaMinutes: updatedEta,
          deliveryFeeOverride: resolvedFee,
          minOrderOverride: resolvedMin,
          notes: resolvedNotes
        };
        setServiceAreas((prev) =>
          prev
            .map((a) => (a.id === id ? mergedArea : a))
            .sort((a, b) => a.pincode.localeCompare(b.pincode))
        );
      }
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `serviceAreas/${id}`);
    }
  };

  const deleteServiceArea = async (id: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, 'serviceAreas', id));
      if (!isBootstrappedAdmin) {
        setServiceAreas((prev) => prev.filter((a) => a.id !== id));
      }
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `serviceAreas/${id}`);
    }
  };

  const toggleServiceArea = async (id: string): Promise<void> => {
    const target = serviceAreas.find((a) => a.id === id);
    if (!target) return;
    await updateServiceArea(id, { isActive: !target.isActive });
  };

  const checkPincodeServiceability = useCallback(
    (pincode: string) => {
      const cleanPin = pincode.replace(/\D/g, '').trim();
      const restricted = Boolean(appSettings.restrictToServiceAreas);
      const activeAreas = serviceAreas.filter((a) => a.isActive);
      const matchedArea = cleanPin
        ? activeAreas.find((a) => a.pincode.replace(/\D/g, '') === cleanPin) || null
        : null;

      if (!restricted) {
        return {
          serviceable: true,
          restricted: false,
          matchedArea
        };
      }

      if (!cleanPin) {
        return {
          serviceable: false,
          restricted: true,
          matchedArea: null,
          reason: 'Please enter or select a valid delivery pincode.'
        };
      }

      if (!matchedArea) {
        return {
          serviceable: false,
          restricted: true,
          matchedArea: null,
          reason: `Delivery is currently unavailable for pincode ${cleanPin}.`
        };
      }

      return {
        serviceable: true,
        restricted: true,
        matchedArea
      };
    },
    [appSettings.restrictToServiceAreas, serviceAreas]
  );

  // App Settings
  const updateAppSettings = async (settings: Partial<AppSettings>): Promise<void> => {
    const cleanUpi = String(settings.upiId ?? appSettings.upiId ?? '').trim().slice(0, 100);
    const cleanPayee = String(settings.upiPayeeName ?? appSettings.upiPayeeName ?? 'FreshVeggie Delivery')
      .trim()
      .slice(0, 100);
    const cleanAccHolder = String(settings.bankAccountHolder ?? appSettings.bankAccountHolder ?? '')
      .trim()
      .slice(0, 120);
    const cleanBankName = String(settings.bankName ?? appSettings.bankName ?? '')
      .trim()
      .slice(0, 120);
    const cleanAccNumber = String(settings.bankAccountNumber ?? appSettings.bankAccountNumber ?? '')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 34);
    const cleanBranch = String(settings.bankBranch ?? appSettings.bankBranch ?? '')
      .trim()
      .slice(0, 120);
    const cleanIfsc = String(settings.bankIfscCode ?? appSettings.bankIfscCode ?? '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 20);

    const nextSettings: AppSettings = {
      taxRate: Math.max(0, Math.min(50, Number(settings.taxRate ?? appSettings.taxRate))),
      baseDeliveryFee: Math.max(0, Number(settings.baseDeliveryFee ?? appSettings.baseDeliveryFee)),
      freeDeliveryThreshold: Math.max(
        0,
        Number(settings.freeDeliveryThreshold ?? appSettings.freeDeliveryThreshold)
      ),
      storeOpen: settings.storeOpen ?? appSettings.storeOpen,
      notificationsEnabled: settings.notificationsEnabled ?? appSettings.notificationsEnabled,
      catalogInitialized: settings.catalogInitialized ?? appSettings.catalogInitialized ?? false,
      restrictToServiceAreas:
        settings.restrictToServiceAreas ?? appSettings.restrictToServiceAreas ?? false,
      upiId: cleanUpi,
      upiPayeeName: cleanPayee,
      bankAccountHolder: cleanAccHolder,
      bankName: cleanBankName,
      bankAccountNumber: cleanAccNumber,
      bankBranch: cleanBranch,
      bankIfscCode: cleanIfsc,
      acceptUpi: settings.acceptUpi ?? appSettings.acceptUpi ?? true,
      acceptDebitCard: settings.acceptDebitCard ?? appSettings.acceptDebitCard ?? true,
      acceptCreditCard: settings.acceptCreditCard ?? appSettings.acceptCreditCard ?? true,
      acceptBankTransfer: settings.acceptBankTransfer ?? appSettings.acceptBankTransfer ?? true,
      acceptCod: settings.acceptCod ?? appSettings.acceptCod ?? true
    };

    try {
      await setDoc(doc(db, 'settings', 'store'), {
        ...nextSettings,
        updatedAt: serverTimestamp()
      });
      if (!isBootstrappedAdmin) {
        setAppSettings(nextSettings);
      }
      invalidateCatalogCache();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/store');
    }
  };

  // Cart Actions
  const addItemsToCart = useCallback(
    (entries: Array<{ product: Product; weight: number; quantity?: number }>) => {
      const next = [...cartRef.current];
      for (const entry of entries) {
        const qty = Math.max(1, entry.quantity || 1);
        const idx = next.findIndex(
          (item) => item.id === entry.product.id && item.selectedWeight === entry.weight
        );
        if (idx >= 0) {
          next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        } else {
          next.push({
            ...entry.product,
            image: getProductFrontImage(entry.product),
            selectedWeight: entry.weight,
            quantity: qty
          });
        }
      }
      persistCart(next);
    },
    [persistCart]
  );

  const addToCart = (product: Product, weight: number, quantity = 1) => {
    addItemsToCart([{ product, weight, quantity }]);
  };

  const removeFromCart = (productId: string, weight: number) => {
    persistCart(cartRef.current.filter((item) => !(item.id === productId && item.selectedWeight === weight)));
  };

  const updateQuantity = (productId: string, weight: number, newCount: number) => {
    if (newCount < 1) {
      removeFromCart(productId, weight);
      return;
    }
    persistCart(
      cartRef.current.map((item) =>
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
        addItemsToCart,
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
        serviceAreas,
        addServiceArea,
        updateServiceArea,
        deleteServiceArea,
        toggleServiceArea,
        selectedPincode,
        setSelectedPincode,
        checkPincodeServiceability,
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
