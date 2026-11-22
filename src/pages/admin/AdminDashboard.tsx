import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, Truck, ShoppingCart, Package, 
  CreditCard, Tag, BarChart3, MessageSquare, Settings, LogOut, 
  Menu, X, Shield, Plus, Search, Edit2, Trash2, Check, CheckCircle2,
  AlertTriangle, Filter, Eye, Phone, MapPin, IndianRupee, ArrowUpRight, Sprout,
  Download, Upload, Monitor, Camera, Database, Server, Calendar, Clock, Landmark, Smartphone,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import { useDelivery } from '../../context/DeliveryContext';
import {
  formatCurrency,
  formatPaymentMethodLabel,
  getAdminSettlementSummary,
  getOrderBillingBreakdown,
  getProductFrontImage,
  getProductImages,
  isOnlinePaymentMethod,
  sanitizeProductImages
} from '../../lib/utils';
import { CATEGORIES, Product, Coupon, DeliveryPersonnel, Order } from '../../lib/data';
import { uploadCompressedMedia } from '../../lib/imageUtils';
import { apiFetch } from '../../lib/apiClient';
import { useToast } from '../../context/ToastContext';
import { AreaPincodeControlCenter } from '../../components/admin/AreaPincodeControlCenter';
import { DatabaseControlCenter } from '../../components/admin/DatabaseControlCenter';
import { ServerApiControlCenter } from '../../components/admin/ServerApiControlCenter';
import { AppLogo } from '../../components/AppLogo';

const SLOT_TIME_WINDOWS = [
  '6:00 AM - 8:00 AM',
  '8:00 AM - 10:00 AM',
  '10:00 AM - 12:00 PM',
  '12:00 PM - 2:00 PM',
  '2:00 PM - 4:00 PM',
  '4:00 PM - 5:00 PM',
  '5:00 PM - 6:00 PM',
  '6:00 PM - 7:00 PM',
  '7:00 PM - 8:00 PM',
  '8:00 PM - 9:00 PM',
  'Standard Delivery'
];

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'areas', label: 'Area & Pincode Control', icon: MapPin },
  { id: 'databases', label: 'Database Control', icon: Database },
  { id: 'servers', label: 'Server & API Control', icon: Server },
  { id: 'customers', label: 'Customer Management', icon: Users },
  { id: 'delivery', label: 'Delivery Men Management', icon: Truck },
  { id: 'orders', label: 'Order Management', icon: ShoppingCart },
  { id: 'products', label: 'Product Management', icon: Package },
  { id: 'payments', label: 'Payment Management', icon: CreditCard },
  { id: 'offers', label: 'Offers & Coupons', icon: Tag },
  { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
  { id: 'support', label: 'Complaint & Support', icon: MessageSquare },
  { id: 'settings', label: 'App Settings', icon: Settings },
];

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Unified context data
  const {
    firebaseUser,
    authReady,
    isAdmin,
    isBootstrappedAdmin,
    logout,
    allUsers,
    hasMoreUsers,
    loadingMoreUsers,
    loadMoreUsers,
    toggleBlockUser,
    allOrders,
    hasMoreOrders,
    loadingMoreOrders,
    loadMoreOrders,
    updateOrderStatus,
    updateOrderDetails,
    assignOrderToDelivery,
    adminList,
    grantAdminAccess,
    revokeAdminAccess
  } = useAuth();
  const {
    products,
    productsLoading,
    addProduct,
    updateProduct,
    deleteProduct,
    toggleStock,
    seedStarterCatalog,
    coupons,
    addCoupon,
    deleteCoupon,
    toggleCoupon,
    complaints,
    updateComplaintStatus,
    serviceAreas,
    checkPincodeServiceability,
    appSettings,
    updateAppSettings
  } = useStore();
  const { deliveryMen, walletLedger, addDeliveryBoy, removeDeliveryBoy, updateDeliveryBoy } = useDelivery();
  const { showToast } = useToast();
  const [uploadingProductImg, setUploadingProductImg] = useState(false);

  const driverZoneOptions = React.useMemo(() => {
    const normalize = (val: string) => val.trim().slice(0, 80);
    const list: string[] = [];
    const seen = new Set<string>();
    const addZone = (raw: string) => {
      const zone = normalize(raw);
      if (!zone) return;
      const key = zone.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(zone);
      }
    };

    // 1. Configured Service Areas & Pincodes
    serviceAreas.forEach((a) => {
      addZone(`${a.name} (${a.pincode})`);
      if (a.city && a.city.trim().toLowerCase() !== a.name.trim().toLowerCase()) {
        addZone(`${a.city} (${a.pincode})`);
      }
    });

    // 2. Booked Customer Order Areas & Pincodes (e.g. Gwalior (474011))
    allOrders.forEach((o) => {
      const city = (o.address?.city || '').trim();
      const zip = (o.address?.zip || '').trim();
      if (city && zip) addZone(`${city} (${zip})`);
      else if (city) addZone(city);
      else if (zip) addZone(`Pincode ${zip}`);
    });

    // 3. Registered Customer Saved Addresses
    allUsers.forEach((u) => {
      (u.addresses || []).forEach((addr) => {
        const city = (addr.city || '').trim();
        const zip = (addr.zip || '').trim();
        if (city && zip) addZone(`${city} (${zip})`);
      });
    });

    // 4. Existing Delivery Partner Zones
    deliveryMen.forEach((d) => {
      if (d.area) addZone(d.area);
    });

    // 5. Fallback baseline hubs
    ['Central Zone', 'Sector 14', 'Cyber City', 'Green Park', 'Dwarka', 'Rohini'].forEach(addZone);
    return list;
  }, [serviceAreas, allOrders, allUsers, deliveryMen]);

  const driverMatchesOrderArea = (driverArea: string, order: Order): boolean => {
    const normArea = (driverArea || '').toLowerCase();
    const zip = (order.address?.zip || '').trim().toLowerCase();
    const city = (order.address?.city || '').trim().toLowerCase();
    if (zip && normArea.includes(zip)) return true;
    if (city && normArea.includes(city)) return true;
    return false;
  };

  const downloadCsv = (filename: string, headers: string[], rows: Array<Array<string | number>>) => {
    const escapeCell = (val: string | number) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const csvContent = [
      headers.map(escapeCell).join(','),
      ...rows.map((r) => r.map(escapeCell).join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Authentication & RBAC guard
  useEffect(() => {
    if (authReady && (!firebaseUser || !isAdmin)) {
      navigate('/admin/login', { replace: true });
    }
  }, [authReady, firebaseUser, isAdmin, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const [seedingCatalog, setSeedingCatalog] = useState(false);
  const handleSeedCatalog = async () => {
    setSeedingCatalog(true);
    try {
      await seedStarterCatalog();
      showToast('Published farm produce catalog & starter offers to Firestore!', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to publish starter catalog';
      showToast(msg, 'error');
    } finally {
      setSeedingCatalog(false);
    }
  };

  // -------------------------------------------------------------
  // Section 1: Dashboard metrics calculation
  // -------------------------------------------------------------
  const todayStr = new Date().toISOString().split('T')[0];
  const todayOrders = allOrders.filter(o => o.date && o.date.startsWith(todayStr));
  const todaySales = todayOrders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.total : 0), 0);
  const totalRevenue = allOrders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.total : 0), 0);
  const activeTrips = allOrders.filter(o => o.status === 'out_for_delivery' || o.status === 'packed').length;
  const onlineDrivers = deliveryMen.filter(d => d.isOnline).length;

  // -------------------------------------------------------------
  // Modals & local state for sections
  // -------------------------------------------------------------
  // Product modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    name: '',
    category: 'Root Vegetables',
    pricePerKg: 40,
    image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&q=80&w=600',
    images: ['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&q=80&w=600'] as string[],
    description: '',
    available: true
  });
  const [newProductImageUrl, setNewProductImageUrl] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('All');

  const syncProductGallery = (nextList: string[]) => {
    const cleaned = sanitizeProductImages(nextList, nextList[0]);
    setProductForm((prev) => ({
      ...prev,
      images: cleaned,
      image: cleaned[0] || ''
    }));
  };

  // Customer state & modal
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const selectedCustomer = allUsers.find((u) => u.id === selectedCustomerId) || null;

  // Delivery boys modal & inline custom zone state
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [useCustomDriverZone, setUseCustomDriverZone] = useState(false);
  const [customDriverZone, setCustomDriverZone] = useState('');
  const [editingZoneDriverId, setEditingZoneDriverId] = useState<string | null>(null);
  const [editingZoneText, setEditingZoneText] = useState('');
  const [driverForm, setDriverForm] = useState({
    uid: '',
    email: '',
    name: '',
    phone: '',
    area: 'Central Zone',
    vehicle: 'Motorcycle'
  });

  // Orders filters, bulk selection & modals
  const [orderStatusFilter, setOrderStatusFilter] = useState('All');
  const [orderSearch, setOrderSearch] = useState('');
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [bulkDriverUid, setBulkDriverUid] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const viewingOrder = allOrders.find((o) => o.id === viewingOrderId) || null;

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [savingOrderEdit, setSavingOrderEdit] = useState(false);
  const [editOrderForm, setEditOrderForm] = useState({
    orderDate: '',
    orderTime: '',
    slotDate: '',
    slotWindow: '8:00 AM - 10:00 AM',
    customSlotText: '',
    customerName: '',
    customerPhone: '',
    addressLabel: 'Home',
    street: '',
    city: '',
    zip: ''
  });

  const formatOrderDateTime = (rawDate?: string): string => {
    if (!rawDate) return '—';
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) return rawDate;
    return format(d, 'dd MMM yyyy, hh:mm a');
  };

  const openEditOrderModal = (order: Order) => {
    const parsedDate = order.date ? new Date(order.date) : new Date();
    const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
    const localDateIso = format(safeDate, 'yyyy-MM-dd');
    const localTimeIso = format(safeDate, 'HH:mm');

    const rawSlot = (order.deliverySlot || '').trim();
    const sepIndex = rawSlot.indexOf(' - ');
    let initialSlotDate = localDateIso;
    let matchedWindow = '__custom__';

    if (sepIndex !== -1) {
      const datePart = rawSlot.slice(0, sepIndex).trim();
      const windowPart = rawSlot.slice(sepIndex + 3).trim();
      const currentYear = safeDate.getFullYear();
      const parsedSlotDate = new Date(`${datePart} ${currentYear}`);
      if (!Number.isNaN(parsedSlotDate.getTime())) {
        initialSlotDate = format(parsedSlotDate, 'yyyy-MM-dd');
      }
      if (SLOT_TIME_WINDOWS.includes(windowPart)) {
        matchedWindow = windowPart;
      }
    } else if (SLOT_TIME_WINDOWS.includes(rawSlot)) {
      matchedWindow = rawSlot;
    }

    setEditOrderForm({
      orderDate: localDateIso,
      orderTime: localTimeIso,
      slotDate: initialSlotDate,
      slotWindow: matchedWindow,
      customSlotText: rawSlot || `${format(safeDate, 'EEE, MMM d')} - Standard Delivery`,
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      addressLabel: order.address?.label || 'Home',
      street: order.address?.street || '',
      city: order.address?.city || '',
      zip: order.address?.zip || ''
    });
    setEditingOrder(order);
  };

  // Coupons modal
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [couponForm, setCouponForm] = useState({
    code: '',
    description: '',
    discountType: 'percent' as 'percent' | 'flat',
    discountValue: 20,
    minOrder: 100,
    expiry: '2026-12-31'
  });

  // Complaints modal
  const [selectedComplaint, setSelectedComplaint] = useState<typeof complaints[0] | null>(null);
  const [resolutionText, setResolutionText] = useState('');

  // Settings local state
  const [settingsForm, setSettingsForm] = useState({ ...appSettings });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [savingBankSettings, setSavingBankSettings] = useState(false);
  const [bankSettingsSaved, setBankSettingsSaved] = useState(false);
  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminContact, setNewAdminContact] = useState('');
  const [savingAdmin, setSavingAdmin] = useState(false);

  useEffect(() => {
    setSettingsForm({ ...appSettings });
  }, [appSettings]);

  const [sqlSummary, setSqlSummary] = useState<{
    archivedOrders: number;
    deliveredOrders: number;
    grossRevenue: number;
    totalRiderPayouts: number;
    topCities: Array<{ city: string; orderCount: number; revenue: number }>;
    databaseEngine: string;
  } | null>(null);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    let active = true;
    apiFetch('/api/analytics/summary')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setSqlSummary(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeTab]);

  // -------------------------------------------------------------
  // RENDER CONTENT BY TAB
  // -------------------------------------------------------------
  const renderContent = () => {
    switch (activeTab) {
      // 1. Dashboard Overview
      case 'dashboard':
        return (
          <div className="space-y-6 animate-in fade-in">
            {isAdmin && !isBootstrappedAdmin && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-amber-900">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Delegated Staff Admin Session</p>
                  <p className="mt-0.5">
                    To view full customer, order, and fleet directories across the database, sign in with the Store Owner Google account in the Admin Portal per Firestore security rules.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Store Performance Overview</h2>
                <p className="text-sm text-gray-500">Real-time statistics across customers, delivery fleet, and inventory.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const defaultImg = 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&q=80&w=600';
                    setEditingProduct(null);
                    setProductForm({
                      name: '',
                      category: 'Root Vegetables',
                      pricePerKg: 40,
                      image: defaultImg,
                      images: [defaultImg],
                      description: 'Fresh farm harvested produce',
                      available: true
                    });
                    setNewProductImageUrl('');
                    setShowProductModal(true);
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
                >
                  <Plus size={16} /> Add Product
                </button>
                <button
                  onClick={() => {
                    setUseCustomDriverZone(false);
                    setCustomDriverZone('');
                    setDriverForm((prev) => ({
                      ...prev,
                      area: driverZoneOptions[0] || 'Central Zone'
                    }));
                    setShowDriverModal(true);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
                >
                  <Plus size={16} /> Add Delivery Partner
                </button>
              </div>
            </div>

            {!productsLoading && products.length === 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Sprout size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-emerald-950 text-sm">
                      Store Catalog Is Currently Empty
                    </h3>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      Publish the curated farm produce inventory and initial discount codes into Cloud Firestore in one click, or add items individually.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={seedingCatalog}
                  onClick={handleSeedCatalog}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm shrink-0 transition"
                >
                  {seedingCatalog ? 'Publishing...' : 'Publish Initial Catalog & Offers'}
                </button>
              </div>
            )}

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Customers</span>
                  <p className="text-3xl font-extrabold text-gray-900 mt-2">{allUsers.length}</p>
                </div>
                <p className="text-xs text-green-600 font-medium mt-3 flex items-center gap-1">
                  <ArrowUpRight size={14} /> Active user base
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Orders</span>
                  <p className="text-3xl font-extrabold text-gray-900 mt-2">{allOrders.length}</p>
                </div>
                <p className="text-xs text-blue-600 font-medium mt-3">
                  {allOrders.filter(o => o.status === 'delivered').length} Delivered
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Daily Sales</span>
                  <p className="text-3xl font-extrabold text-green-600 mt-2">{formatCurrency(todaySales || totalRevenue)}</p>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  {todayOrders.length || allOrders.length} orders recorded
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Active Deliveries</span>
                  <p className="text-3xl font-extrabold text-orange-500 mt-2">{activeTrips}</p>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  {onlineDrivers} drivers currently online
                </p>
              </div>
            </div>

            {/* Recent Orders table */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-base text-gray-800">Recent Customer Orders</h3>
                <button 
                  onClick={() => setActiveTab('orders')}
                  className="text-xs font-bold text-blue-600 hover:underline"
                >
                  View All Orders →
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-400 font-bold">
                    <tr>
                      <th className="p-3">Order ID</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Items</th>
                      <th className="p-3">Total</th>
                      <th className="p-3">Payment</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Assigned Driver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {allOrders.slice(0, 5).map(o => (
                      <tr key={o.id} className="hover:bg-gray-50/80 transition">
                        <td className="p-3 font-bold text-gray-900">#{o.id}</td>
                        <td className="p-3 font-medium text-gray-800">
                          <span>{o.customerName || 'Customer'}</span>
                          {o.address?.city && (
                            <span className="block text-[11px] text-gray-400 font-normal">
                              {o.address.city}{o.address.zip ? ` (${o.address.zip})` : ''}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-gray-500">
                          <button
                            type="button"
                            onClick={() => setViewingOrderId(o.id)}
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold"
                          >
                            <Eye size={13} /> {o.items?.length || 0} items
                          </button>
                        </td>
                        <td className="p-3 font-bold text-gray-900">
                          {formatCurrency(o.total)}
                          {o.couponCode && (
                            <span className="block text-[10px] font-bold text-green-700">
                              🏷️ {o.couponCode} (-{formatCurrency(o.discountAmount || 0)})
                            </span>
                          )}
                        </td>
                        <td className="p-3 uppercase text-xs font-bold">{o.paymentMethod}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            o.status === 'delivered' ? 'bg-green-100 text-green-700' :
                            o.status === 'out_for_delivery' ? 'bg-blue-100 text-blue-700' :
                            o.status === 'packed' ? 'bg-yellow-100 text-yellow-700' :
                            o.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {o.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3 text-xs font-medium text-gray-600">
                          {o.assignedToName || <span className="text-orange-500 italic">Unassigned</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );

      // 2. Customer Management
      case 'customers':
        const filteredCustomers = allUsers.filter(u => {
          const match = u.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
                        (u.phone || '').includes(customerSearch) ||
                        (u.email || '').toLowerCase().includes(customerSearch.toLowerCase());
          return match;
        });

        return (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Customer Management</h2>
                <p className="text-sm text-gray-500">View registered users, purchase history, and control access permissions.</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search customer..."
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-400 font-bold border-b border-gray-100">
                    <tr>
                      <th className="p-4">Customer</th>
                      <th className="p-4">Phone</th>
                      <th className="p-4">Email</th>
                      <th className="p-4">Addresses</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredCustomers.map(cust => (
                      <tr key={cust.id} className="hover:bg-gray-50/80 transition">
                        <td className="p-4 font-bold text-gray-800 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold text-sm">
                            {(cust.name || 'C').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p>{cust.name}</p>
                            <span className="text-[10px] text-gray-400 font-normal">ID: {cust.id}</span>
                          </div>
                        </td>
                        <td className="p-4 font-medium text-gray-700">{cust.phone}</td>
                        <td className="p-4 text-gray-500">{cust.email || 'N/A'}</td>
                        <td className="p-4 text-xs text-gray-500">{cust.addresses?.length || 0} saved</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            cust.isBlocked ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {cust.isBlocked ? 'BLOCKED' : 'ACTIVE'}
                          </span>
                        </td>
                        <td className="p-4 text-right space-x-2 whitespace-nowrap">
                          <button
                            onClick={() => setSelectedCustomerId(cust.id)}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition inline-flex items-center gap-1"
                          >
                            <Eye size={13} /> Details
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await toggleBlockUser(cust.id);
                                showToast(
                                  cust.isBlocked ? `Unblocked ${cust.name}` : `Blocked ${cust.name}`,
                                  cust.isBlocked ? 'success' : 'info'
                                );
                              } catch {
                                showToast('Unable to update customer access right now.', 'error');
                              }
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                              cust.isBlocked
                                ? 'bg-green-50 text-green-600 hover:bg-green-100'
                                : 'bg-red-50 text-red-600 hover:bg-red-100'
                            }`}
                          >
                            {cust.isBlocked ? 'Unblock User' : 'Block User'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMoreUsers && (
                <div className="p-4 border-t border-gray-100 flex justify-center bg-gray-50/50">
                  <button
                    type="button"
                    disabled={loadingMoreUsers}
                    onClick={() => void loadMoreUsers()}
                    className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
                  >
                    {loadingMoreUsers ? 'Loading More Customers...' : 'Load Older Customers'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );

      // 3. Delivery Men Management
      case 'delivery':
        return (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Delivery Fleet Management</h2>
                <p className="text-sm text-gray-500">Approve registered partners, assign delivery zones, and monitor live shifts.</p>
              </div>
              <button
                onClick={() => {
                  setUseCustomDriverZone(false);
                  setCustomDriverZone('');
                  setDriverForm((prev) => ({
                    ...prev,
                    area: driverZoneOptions[0] || 'Central Zone'
                  }));
                  setShowDriverModal(true);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition"
              >
                <Plus size={18} /> Add Delivery Partner
              </button>
            </div>

            {driverZoneOptions.length > 0 && (
              <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-blue-900 flex items-center gap-1.5">
                  <MapPin size={14} className="text-blue-600" />
                  Synced Dispatch Areas ({driverZoneOptions.length}):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {driverZoneOptions.slice(0, 10).map((z) => (
                    <span
                      key={z}
                      className="px-2 py-0.5 rounded-lg bg-white border border-blue-200 text-blue-800 font-semibold text-[11px]"
                    >
                      {z}
                    </span>
                  ))}
                  {driverZoneOptions.length > 10 && (
                    <span className="text-[11px] font-bold text-blue-700 px-1">
                      +{driverZoneOptions.length - 10} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {deliveryMen.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 text-sm">
                No delivery partners registered yet. Partners can register via Mobile OTP or Google Sign-In at the Delivery Portal or be provisioned manually above.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {deliveryMen.map(driver => (
                <div key={driver.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-gray-900 text-white flex items-center justify-center font-bold text-base shrink-0">
                        <Truck size={22} className="text-green-400" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-gray-800 truncate">{driver.name}</h4>
                        <p className="text-xs text-gray-500 truncate">{driver.partnerCode} • {driver.phone}</p>
                        <p className="text-[11px] text-gray-400 truncate">{driver.email || 'Phone OTP Partner'}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        driver.isApproved ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {driver.isApproved ? 'APPROVED' : 'PENDING'}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        driver.isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {driver.isOnline ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs bg-gray-50 p-3 rounded-xl text-gray-600">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-medium text-gray-400 shrink-0">Assigned Area:</span>
                        <select
                          value={driver.area}
                          onChange={async (e) => {
                            if (e.target.value === '__custom__') {
                              setEditingZoneDriverId(driver.id);
                              setEditingZoneText(driver.area || '');
                              return;
                            }
                            try {
                              await updateDeliveryBoy(driver.id, { area: e.target.value });
                              showToast(`Assigned ${driver.name} to ${e.target.value}`, 'success');
                            } catch {
                              showToast('Unable to update assigned area.', 'error');
                            }
                          }}
                          className="bg-white border border-gray-200 rounded px-2 py-1 font-bold text-gray-800 outline-none max-w-[185px]"
                        >
                          {Array.from(new Set([driver.area, ...driverZoneOptions])).filter(Boolean).map((zone) => (
                            <option key={zone} value={zone}>
                              {zone}
                            </option>
                          ))}
                          <option value="__custom__">+ Type Custom Area / Pincode...</option>
                        </select>
                      </div>
                      {editingZoneDriverId === driver.id && (
                        <div className="flex items-center gap-1.5 pt-1">
                          <input
                            type="text"
                            maxLength={80}
                            placeholder="e.g. Gwalior (474011)"
                            value={editingZoneText}
                            onChange={(e) => setEditingZoneText(e.target.value)}
                            className="flex-1 bg-white border border-blue-300 rounded-lg px-2 py-1 text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const cleaned = editingZoneText.trim().slice(0, 80);
                              if (!cleaned) {
                                showToast('Enter a valid city, area, or pincode.', 'error');
                                return;
                              }
                              try {
                                await updateDeliveryBoy(driver.id, { area: cleaned });
                                showToast(`Assigned ${driver.name} to ${cleaned}`, 'success');
                                setEditingZoneDriverId(null);
                              } catch {
                                showToast('Unable to save custom area.', 'error');
                              }
                            }}
                            className="px-2.5 py-1 bg-blue-600 text-white rounded-lg font-bold text-[11px]"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingZoneDriverId(null)}
                            className="px-2 py-1 bg-gray-200 text-gray-700 rounded-lg font-bold text-[11px]"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-400">Vehicle:</span>
                      <span className="font-bold text-gray-800">{driver.vehicle}</span>
                    </div>
                    {driver.dlNumber && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-400">License No:</span>
                        <span className="font-bold text-gray-800">{driver.dlNumber}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-400">Deliveries Completed:</span>
                      <span className="font-bold text-green-600">{driver.completedDeliveries}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-400">Partner Rating:</span>
                      <span className="font-bold text-yellow-600">★ {driver.rating}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-between items-center gap-2 pt-2">
                    <button
                      onClick={async () => {
                        const nextApproved = !driver.isApproved;
                        try {
                          await updateDeliveryBoy(driver.id, { isApproved: nextApproved });
                          showToast(
                            nextApproved
                              ? `Approved ${driver.name} for live deliveries`
                              : `Suspended ${driver.name}'s dispatch access`,
                            nextApproved ? 'success' : 'info'
                          );
                        } catch {
                          showToast('Failed to update partner approval status.', 'error');
                        }
                      }}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                        driver.isApproved
                          ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {driver.isApproved ? 'Revoke Approval' : 'Approve Partner'}
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          await updateDeliveryBoy(driver.id, { isOnline: !driver.isOnline });
                        } catch {
                          showToast('Unable to toggle partner availability.', 'error');
                        }
                      }}
                      className="text-xs font-bold text-blue-600 hover:underline"
                    >
                      {driver.isOnline ? 'Mark Offline' : 'Mark Online'}
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          await removeDeliveryBoy(driver.id);
                          showToast(`Removed ${driver.name} from delivery fleet`, 'info');
                        } catch {
                          showToast('Unable to remove delivery partner.', 'error');
                        }
                      }}
                      className="text-xs font-bold text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      // 4. Order Management
      case 'orders':
        const qTerm = orderSearch.trim().toLowerCase();
        const filteredOrdersList = allOrders.filter(o => {
          const matchesStatus = orderStatusFilter === 'All' || o.status === orderStatusFilter;
          const matchesSearch =
            !qTerm ||
            o.id.toLowerCase().includes(qTerm) ||
            (o.customerName && o.customerName.toLowerCase().includes(qTerm)) ||
            (o.customerPhone && o.customerPhone.toLowerCase().includes(qTerm)) ||
            (o.address?.street && o.address.street.toLowerCase().includes(qTerm)) ||
            (o.address?.city && o.address.city.toLowerCase().includes(qTerm)) ||
            (o.address?.zip && o.address.zip.toLowerCase().includes(qTerm)) ||
            (o.deliverySlot && o.deliverySlot.toLowerCase().includes(qTerm)) ||
            formatOrderDateTime(o.date).toLowerCase().includes(qTerm);
          return matchesStatus && matchesSearch;
        });

        return (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Order Management</h2>
                <p className="text-sm text-gray-500">Track all customer orders, assign to delivery boys, and advance statuses.</p>
              </div>

              <div className="flex gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="Search #, customer, phone, address, slot..."
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-72"
                />
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {['All', 'placed', 'packed', 'out_for_delivery', 'delivered', 'cancelled'].map(st => (
                <button
                  key={st}
                  onClick={() => setOrderStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize transition ${
                    orderStatusFilter === st
                      ? 'bg-gray-900 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {st.replace(/_/g, ' ')}
                </button>
              ))}
            </div>

            {/* Bulk Order Action Bar */}
            {selectedOrderIds.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-900">
                  <span className="bg-blue-600 text-white px-2.5 py-0.5 rounded-full">
                    {selectedOrderIds.length} selected
                  </span>
                  <span>Bulk Order Dispatch</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={bulkDriverUid}
                    onChange={(e) => setBulkDriverUid(e.target.value)}
                    disabled={bulkBusy}
                    className="bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-800 outline-none"
                  >
                    <option value="">-- Assign Rider --</option>
                    {deliveryMen.filter((d) => d.isApproved).length > 0 && (
                      <optgroup label="Approved Partners">
                        {deliveryMen
                          .filter((d) => d.isApproved)
                          .map((d) => (
                            <option key={d.uid} value={d.uid}>
                              {d.name} ({d.area}) {d.isOnline ? '🟢' : '⚪'}
                            </option>
                          ))}
                      </optgroup>
                    )}
                    {deliveryMen.filter((d) => !d.isApproved).length > 0 && (
                      <optgroup label="Pending Approval (Auto-Approves)">
                        {deliveryMen
                          .filter((d) => !d.isApproved)
                          .map((d) => (
                            <option key={d.uid} value={d.uid}>
                              {d.name} ({d.area}) [Pending]
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    disabled={bulkBusy || !bulkDriverUid}
                    onClick={async () => {
                      const chosenDriver = deliveryMen.find((d) => d.uid === bulkDriverUid);
                      if (!chosenDriver) return;
                      setBulkBusy(true);
                      try {
                        if (!chosenDriver.isApproved) {
                          await updateDeliveryBoy(chosenDriver.id, { isApproved: true });
                        }
                        await Promise.all(
                          selectedOrderIds.map((oid) =>
                            assignOrderToDelivery(
                              oid,
                              chosenDriver.uid,
                              chosenDriver.name,
                              chosenDriver.partnerCode
                            )
                          )
                        );
                        showToast(
                          `${!chosenDriver.isApproved ? 'Approved & assigned' : 'Assigned'} ${selectedOrderIds.length} orders to ${chosenDriver.name}`,
                          'success'
                        );
                        setSelectedOrderIds([]);
                        setBulkDriverUid('');
                      } catch {
                        showToast('Some orders could not be assigned.', 'error');
                      } finally {
                        setBulkBusy(false);
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition"
                  >
                    Bulk Assign
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={async () => {
                      setBulkBusy(true);
                      try {
                        await Promise.all(
                          selectedOrderIds.map((oid) => updateOrderStatus(oid, 'packed'))
                        );
                        showToast(`Marked ${selectedOrderIds.length} orders as PACKED`, 'success');
                        setSelectedOrderIds([]);
                      } catch {
                        showToast('Failed to bulk update status.', 'error');
                      } finally {
                        setBulkBusy(false);
                      }
                    }}
                    className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition"
                  >
                    Mark Packed
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const picked = filteredOrdersList.filter((o) =>
                        selectedOrderIds.includes(o.id)
                      );
                      downloadCsv(
                        `freshveggie_selected_orders_${new Date().toISOString().split('T')[0]}.csv`,
                        ['Order ID', 'Order Date', 'Delivery Slot', 'Customer', 'Phone', 'Address', 'City', 'Pincode', 'Total', 'Payment', 'Status'],
                        picked.map((o) => [
                          o.id,
                          formatOrderDateTime(o.date),
                          o.deliverySlot || '',
                          o.customerName,
                          o.customerPhone,
                          o.address?.street || '',
                          o.address?.city || '',
                          o.address?.zip || '',
                          o.total,
                          formatPaymentMethodLabel(o.paymentMethod),
                          o.status
                        ])
                      );
                      showToast(`Exported ${picked.length} selected orders`, 'success');
                    }}
                    className="bg-white border border-blue-200 hover:bg-blue-100 text-blue-800 px-3 py-1.5 rounded-lg text-xs font-bold transition"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedOrderIds([])}
                    className="text-xs font-bold text-gray-500 hover:text-gray-800 px-2"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Orders Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-400 font-bold border-b border-gray-100">
                    <tr>
                      <th className="p-4 w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all visible orders"
                          checked={
                            filteredOrdersList.length > 0 &&
                            filteredOrdersList.every((o) => selectedOrderIds.includes(o.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedOrderIds(filteredOrdersList.map((o) => o.id));
                            } else {
                              setSelectedOrderIds([]);
                            }
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="p-4">Order ID & Date</th>
                      <th className="p-4">Customer Info</th>
                      <th className="p-4">Items</th>
                      <th className="p-4">Amount</th>
                      <th className="p-4">Delivery Partner</th>
                      <th className="p-4">Status Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredOrdersList.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50/80 transition">
                        <td className="p-4">
                          <input
                            type="checkbox"
                            aria-label={`Select order ${order.id}`}
                            checked={selectedOrderIds.includes(order.id)}
                            onChange={(e) => {
                              setSelectedOrderIds((prev) =>
                                e.target.checked
                                  ? [...prev, order.id]
                                  : prev.filter((oid) => oid !== order.id)
                              );
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="p-4">
                          <p className="font-bold text-gray-900">#{order.id}</p>
                          <p className="text-[11px] text-gray-500 font-medium">{formatOrderDateTime(order.date)}</p>
                          <p className="text-[11px] text-blue-700 font-semibold mt-0.5">{order.deliverySlot}</p>
                        </td>

                        <td className="p-4">
                          <p className="font-bold text-gray-800">{order.customerName || 'Customer'}</p>
                          <p className="text-xs text-gray-500">
                            {order.address?.street
                              ? `${order.address.street}, ${order.address.city || ''} ${order.address.zip ? `- ${order.address.zip}` : ''}`.trim()
                              : 'Main Address'}
                          </p>
                          {order.customerPhone && (
                            <p className="text-[11px] text-gray-400 font-mono">+{order.customerPhone}</p>
                          )}
                        </td>

                        <td className="p-4 text-xs text-gray-700">
                          <div className="flex flex-col items-start gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingOrderId(order.id)}
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold"
                            >
                              <Eye size={13} /> {order.items?.length || 0} items &amp; bill
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditOrderModal(order)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-700 bg-gray-100 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 hover:border-blue-200 px-2 py-1 rounded-lg transition"
                            >
                              <Edit2 size={11} /> Edit Details
                            </button>
                          </div>
                        </td>

                        <td className="p-4">
                          {(() => {
                            const b = getOrderBillingBreakdown(order, appSettings);
                            return (
                              <div className="space-y-0.5">
                                <span className="font-bold text-gray-900">{formatCurrency(b.grandTotal)}</span>
                                <span className="block text-[10px] text-gray-500">
                                  Sub {formatCurrency(b.subtotal)} + GST {formatCurrency(b.taxAmount)} + Del {b.deliveryFee === 0 ? 'Free' : formatCurrency(b.deliveryFee)}
                                </span>
                                {(b.discountAmount > 0 || b.couponCode) && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                                    <Tag size={10} /> {b.couponCode || 'COUPON'} (-{formatCurrency(b.discountAmount)})
                                  </span>
                                )}
                                <span className="block text-[10px] font-bold text-gray-500">
                                  {formatPaymentMethodLabel(order.paymentMethod)}
                                  {order.cardLast4 ? ` (•••• ${order.cardLast4})` : ''} •{' '}
                                  <span className="uppercase">{order.paymentStatus || 'pending'}</span>
                                </span>
                                {order.paymentReference && (
                                  <span className="block text-[10px] font-mono text-blue-700 truncate max-w-[190px]">
                                    Ref: {order.paymentReference}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        <td className="p-4">
                          {deliveryMen.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab('delivery');
                                setDriverForm((prev) => ({
                                  ...prev,
                                  area:
                                    order.address?.city && order.address?.zip
                                      ? `${order.address.city} (${order.address.zip})`.slice(0, 80)
                                      : prev.area
                                }));
                                setShowDriverModal(true);
                              }}
                              className="text-xs font-bold text-blue-600 hover:underline"
                            >
                              + Add Partner for {order.address?.zip || order.address?.city || 'Area'}
                            </button>
                          ) : (
                            (() => {
                              const sorted = [...deliveryMen].sort((a, b) => {
                                const aMatch = driverMatchesOrderArea(a.area, order) ? 1 : 0;
                                const bMatch = driverMatchesOrderArea(b.area, order) ? 1 : 0;
                                return bMatch - aMatch;
                              });
                              const approvedList = sorted.filter((d) => d.isApproved);
                              const pendingList = sorted.filter((d) => !d.isApproved);

                              return (
                                <select
                                  value={order.assignedToUid || ''}
                                  onChange={async (e) => {
                                    const chosenDriver = deliveryMen.find(d => d.uid === e.target.value);
                                    if (chosenDriver) {
                                      try {
                                        if (!chosenDriver.isApproved) {
                                          await updateDeliveryBoy(chosenDriver.id, { isApproved: true });
                                        }
                                        await assignOrderToDelivery(
                                          order.id,
                                          chosenDriver.uid,
                                          chosenDriver.name,
                                          chosenDriver.partnerCode
                                        );
                                        showToast(
                                          `${!chosenDriver.isApproved ? 'Approved & assigned' : 'Assigned'} #${order.id} to ${chosenDriver.name}`,
                                          'success'
                                        );
                                      } catch {
                                        showToast('Unable to assign delivery partner.', 'error');
                                      }
                                    }
                                  }}
                                  className="bg-gray-50 border border-gray-200 rounded-lg p-1.5 text-xs font-medium text-gray-800 outline-none max-w-[210px]"
                                >
                                  <option value="">-- Assign Partner --</option>
                                  {approvedList.length > 0 && (
                                    <optgroup label="Approved Partners">
                                      {approvedList.map(d => {
                                        const isZoneMatch = driverMatchesOrderArea(d.area, order);
                                        return (
                                          <option key={d.uid} value={d.uid}>
                                            {isZoneMatch ? '★ ' : ''}{d.name} ({d.area}) {d.isOnline ? '🟢' : '⚪'}
                                          </option>
                                        );
                                      })}
                                    </optgroup>
                                  )}
                                  {pendingList.length > 0 && (
                                    <optgroup label="Pending Approval (Auto-Approves)">
                                      {pendingList.map(d => {
                                        const isZoneMatch = driverMatchesOrderArea(d.area, order);
                                        return (
                                          <option key={d.uid} value={d.uid}>
                                            {isZoneMatch ? '★ ' : ''}{d.name} ({d.area}) [Pending]
                                          </option>
                                        );
                                      })}
                                    </optgroup>
                                  )}
                                </select>
                              );
                            })()
                          )}
                        </td>

                        <td className="p-4">
                          <select
                            value={order.status}
                            onChange={async (e) => {
                              const nextStatus = e.target.value as Order['status'];
                              try {
                                await updateOrderStatus(order.id, nextStatus);
                                showToast(`Order #${order.id} updated to ${nextStatus.replace(/_/g, ' ')}`, 'info');
                              } catch {
                                showToast('Failed to update order status.', 'error');
                              }
                            }}
                            className={`p-1.5 rounded-lg text-xs font-bold outline-none border ${
                              order.status === 'delivered' ? 'bg-green-50 border-green-200 text-green-700' :
                              order.status === 'out_for_delivery' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                              order.status === 'cancelled' ? 'bg-red-50 border-red-200 text-red-700' :
                              'bg-yellow-50 border-yellow-200 text-yellow-700'
                            }`}
                          >
                            <option value="placed">PLACED</option>
                            <option value="packed">PACKED</option>
                            <option value="out_for_delivery">OUT FOR DELIVERY</option>
                            <option value="delivered">DELIVERED</option>
                            <option value="cancelled">CANCELLED</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMoreOrders && (
                <div className="p-4 border-t border-gray-100 flex justify-center bg-gray-50/50">
                  <button
                    type="button"
                    disabled={loadingMoreOrders}
                    onClick={() => void loadMoreOrders()}
                    className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
                  >
                    {loadingMoreOrders ? 'Loading Older Orders...' : 'Load Older Orders'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );

      // 5. Product Management
      case 'products':
        const filteredProductsList = products.filter(p => {
          const matchCat = productCategoryFilter === 'All' || p.category === productCategoryFilter;
          const matchSearch = p.name.toLowerCase().includes(productSearch.toLowerCase());
          return matchCat && matchSearch;
        });

        return (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Vegetables & Inventory</h2>
                <p className="text-sm text-gray-500">Add, edit, remove vegetables, update pricing per kg and live stock availability.</p>
              </div>

              <div className="flex gap-2">
                {products.length === 0 && (
                  <button
                    type="button"
                    disabled={seedingCatalog}
                    onClick={handleSeedCatalog}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition"
                  >
                    <Sprout size={18} />
                    {seedingCatalog ? 'Publishing...' : 'Publish Initial Catalog'}
                  </button>
                )}
                <button
                  onClick={() => {
                    const defaultImg = 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?auto=format&fit=crop&q=80&w=600';
                    setEditingProduct(null);
                    setProductForm({
                      name: '',
                      category: 'Root Vegetables',
                      pricePerKg: 50,
                      image: defaultImg,
                      images: [defaultImg],
                      description: 'Fresh organic produce',
                      available: true
                    });
                    setNewProductImageUrl('');
                    setShowProductModal(true);
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition"
                >
                  <Plus size={18} /> Add Vegetable
                </button>
              </div>
            </div>

            {/* Filter & Search */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search vegetable..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <select
                value={productCategoryFilter}
                onChange={e => setProductCategoryFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-medium outline-none"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProductsList.map(prod => {
                const prodImages = getProductImages(prod);
                const frontImg = prodImages[0] || getProductFrontImage(prod);
                return (
                <div key={prod.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col justify-between">
                  <div className="relative h-40 bg-gray-100">
                    <img src={frontImg} alt={prod.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    <span className="absolute top-2 left-2 bg-white/90 backdrop-blur-xs text-xs font-bold px-2 py-0.5 rounded-md text-gray-700 shadow-xs">
                      {prod.category}
                    </span>
                    {prodImages.length > 1 && (
                      <span className="absolute bottom-2 left-2 bg-black/65 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md tabular-nums">
                        {prodImages.length} photos · Front #1
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await toggleStock(prod.id);
                          showToast(
                            `${prod.name} marked ${prod.available ? 'Out of Stock' : 'In Stock'}`,
                            'info'
                          );
                        } catch {
                          showToast('Failed to update stock status.', 'error');
                        }
                      }}
                      className={`absolute top-2 right-2 px-2.5 py-1 rounded-full text-[11px] font-bold shadow-md transition ${
                        prod.available
                          ? 'bg-green-600 text-white'
                          : 'bg-red-600 text-white'
                      }`}
                    >
                      {prod.available ? 'In Stock' : 'Out of Stock'}
                    </button>
                  </div>

                  <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="font-bold text-gray-800 text-base">{prod.name}</h4>
                      <p className="text-xs text-gray-500 line-clamp-2 mt-1">{prod.description}</p>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <div>
                        <span className="text-[10px] text-gray-400 font-medium uppercase">Price</span>
                        <p className="text-lg font-bold text-green-700">{formatCurrency(prod.pricePerKg)}/kg</p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const gallery = getProductImages(prod);
                            const primaryImg = gallery[0] || getProductFrontImage(prod);
                            setEditingProduct(prod);
                            setProductForm({
                              name: prod.name,
                              category: prod.category,
                              pricePerKg: prod.pricePerKg,
                              image: primaryImg,
                              images: gallery.length > 0 ? gallery : primaryImg ? [primaryImg] : [],
                              description: prod.description,
                              available: prod.available
                            });
                            setNewProductImageUrl('');
                            setShowProductModal(true);
                          }}
                          className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await deleteProduct(prod.id);
                              showToast(`Deleted ${prod.name} from catalog`, 'info');
                            } catch {
                              showToast('Failed to delete product.', 'error');
                            }
                          }}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        );

      // 6. Payment Management
      case 'payments':
        const activeOrdersList = allOrders.filter(o => o.status !== 'cancelled');
        const codTotal = activeOrdersList.filter(o => o.paymentMethod === 'cod').reduce((s, o) => s + o.total, 0);
        const codPendingTotal = activeOrdersList.filter(o => o.paymentMethod === 'cod' && o.paymentStatus !== 'collected').reduce((s, o) => s + o.total, 0);
        const upiTotal = activeOrdersList.filter(o => o.paymentMethod === 'upi').reduce((s, o) => s + o.total, 0);
        const cardTotal = activeOrdersList.filter(o => o.paymentMethod === 'debit_card' || o.paymentMethod === 'credit_card').reduce((s, o) => s + o.total, 0);
        const bankTransferTotal = activeOrdersList.filter(o => o.paymentMethod === 'bank_transfer').reduce((s, o) => s + o.total, 0);
        const digitalBankTotal = activeOrdersList.filter(o => isOnlinePaymentMethod(o.paymentMethod)).reduce((s, o) => s + o.total, 0);
        const merchantSettlementSummary = getAdminSettlementSummary(settingsForm);

        const handleSaveBankAndUpi = async (e: React.FormEvent) => {
          e.preventDefault();
          const trimmedUpi = (settingsForm.upiId || '').trim();
          const trimmedIfsc = (settingsForm.bankIfscCode || '').trim().toUpperCase();
          const trimmedAcc = (settingsForm.bankAccountNumber || '').replace(/\s+/g, '').trim();

          if (trimmedUpi && !trimmedUpi.includes('@')) {
            showToast('Enter a valid UPI ID (example: merchant@okaxis).', 'error');
            return;
          }
          if (trimmedIfsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(trimmedIfsc)) {
            showToast('IFSC Code must be 11 characters (e.g. SBIN0001234).', 'error');
            return;
          }
          if (trimmedAcc && !/^[A-Za-z0-9-]{6,34}$/.test(trimmedAcc)) {
            showToast('Bank Account Number must be 6 to 34 alphanumeric characters.', 'error');
            return;
          }
          if (
            !settingsForm.acceptUpi &&
            !settingsForm.acceptDebitCard &&
            !settingsForm.acceptCreditCard &&
            !settingsForm.acceptBankTransfer &&
            !settingsForm.acceptCod
          ) {
            showToast('Enable at least one payment method for customers.', 'error');
            return;
          }

          setSavingBankSettings(true);
          try {
            await updateAppSettings({
              upiId: trimmedUpi,
              upiPayeeName: (settingsForm.upiPayeeName || '').trim(),
              bankAccountHolder: (settingsForm.bankAccountHolder || '').trim(),
              bankName: (settingsForm.bankName || '').trim(),
              bankAccountNumber: trimmedAcc,
              bankBranch: (settingsForm.bankBranch || '').trim(),
              bankIfscCode: trimmedIfsc,
              acceptUpi: settingsForm.acceptUpi ?? true,
              acceptDebitCard: settingsForm.acceptDebitCard ?? true,
              acceptCreditCard: settingsForm.acceptCreditCard ?? true,
              acceptBankTransfer: settingsForm.acceptBankTransfer ?? true,
              acceptCod: settingsForm.acceptCod ?? true
            });
            setBankSettingsSaved(true);
            setTimeout(() => setBankSettingsSaved(false), 3500);
            showToast('Admin Bank Account & UPI receiving details saved!', 'success');
          } catch {
            showToast('Unable to save Bank & UPI details. Please retry.', 'error');
          } finally {
            setSavingBankSettings(false);
          }
        };

        return (
          <div className="space-y-6 animate-in fade-in">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Payment & Charges Management</h2>
              <p className="text-sm text-gray-500">Configure your direct receiving Bank Account, UPI ID, accepted payment modes (UPI, Debit/Credit Card, Bank Transfer, COD), and delivery fees.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Processed</span>
                <p className="text-3xl font-extrabold text-gray-900 mt-2">{formatCurrency(totalRevenue)}</p>
                <p className="text-xs text-gray-400 mt-2">Combined Online + Bank + COD volume</p>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Direct Bank / Digital Paid</span>
                <p className="text-3xl font-extrabold text-green-600 mt-2">{formatCurrency(digitalBankTotal)}</p>
                <p className="text-xs text-green-700 mt-2">
                  UPI {formatCurrency(upiTotal)} • Cards {formatCurrency(cardTotal)} • Bank {formatCurrency(bankTransferTotal)}
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">COD Total / Pending</span>
                <p className="text-3xl font-extrabold text-orange-500 mt-2">{formatCurrency(codTotal)}</p>
                <p className="text-xs text-orange-500 mt-2">{formatCurrency(codPendingTotal)} pending collection</p>
              </div>
            </div>

            {/* Admin Direct Receiving Bank Account & UPI Configuration */}
            <form onSubmit={handleSaveBankAndUpi} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                    <Landmark size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-gray-900">Admin Direct Bank Account &amp; UPI Receiving Details</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Customer payments via UPI, Debit Card, Credit Card, and Direct Bank Transfer settle directly into these configured merchant credentials.
                    </p>
                  </div>
                </div>
                {merchantSettlementSummary && (
                  <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-xl">
                    Active Settlement: {merchantSettlementSummary}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* UPI Receiving Setup */}
                <div className="bg-gray-50/80 border border-gray-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                    <Smartphone size={16} className="text-green-600" />
                    Direct UPI Receiving ID
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Admin UPI ID (VPA)</label>
                    <input
                      type="text"
                      placeholder="e.g. freshveggie@okaxis"
                      value={settingsForm.upiId || ''}
                      onChange={e => setSettingsForm({ ...settingsForm, upiId: e.target.value })}
                      className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <span className="text-[11px] text-gray-400">Used for Google Pay, PhonePe, Paytm, BHIM &amp; QR deep links</span>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">UPI Payee / Merchant Name</label>
                    <input
                      type="text"
                      placeholder="e.g. FreshVeggie Farms Pvt Ltd"
                      value={settingsForm.upiPayeeName || ''}
                      onChange={e => setSettingsForm({ ...settingsForm, upiPayeeName: e.target.value })}
                      className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>

                {/* Bank Account Settlement Setup */}
                <div className="bg-gray-50/80 border border-gray-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                    <Landmark size={16} className="text-blue-600" />
                    Admin Settlement Bank Account
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Account Holder Name</label>
                      <input
                        type="text"
                        placeholder="e.g. FreshVeggie Store"
                        value={settingsForm.bankAccountHolder || ''}
                        onChange={e => setSettingsForm({ ...settingsForm, bankAccountHolder: e.target.value })}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Bank Name</label>
                      <input
                        type="text"
                        placeholder="e.g. State Bank of India"
                        value={settingsForm.bankName || ''}
                        onChange={e => setSettingsForm({ ...settingsForm, bankName: e.target.value })}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Bank Account Number</label>
                      <input
                        type="text"
                        placeholder="e.g. 40928173645"
                        value={settingsForm.bankAccountNumber || ''}
                        onChange={e => setSettingsForm({ ...settingsForm, bankAccountNumber: e.target.value })}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">IFSC Code</label>
                      <input
                        type="text"
                        maxLength={11}
                        placeholder="e.g. SBIN0001234"
                        value={settingsForm.bankIfscCode || ''}
                        onChange={e => setSettingsForm({ ...settingsForm, bankIfscCode: e.target.value.toUpperCase() })}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono font-bold uppercase text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Branch Name</label>
                    <input
                      type="text"
                      placeholder="e.g. City Center Branch, Gwalior"
                      value={settingsForm.bankBranch || ''}
                      onChange={e => setSettingsForm({ ...settingsForm, bankBranch: e.target.value })}
                      className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Accepted Checkout Payment Channels */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">Accepted Customer Checkout Methods</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                  {[
                    { key: 'acceptUpi' as const, label: 'UPI Direct' },
                    { key: 'acceptDebitCard' as const, label: 'Debit Card' },
                    { key: 'acceptCreditCard' as const, label: 'Credit Card' },
                    { key: 'acceptBankTransfer' as const, label: 'Bank Account' },
                    { key: 'acceptCod' as const, label: 'Cash on Delivery' }
                  ].map(ch => {
                    const enabled = settingsForm[ch.key] ?? true;
                    return (
                      <label
                        key={ch.key}
                        className={`flex items-center justify-between gap-2 p-3 rounded-xl border text-xs font-bold cursor-pointer transition ${
                          enabled ? 'bg-green-50 border-green-300 text-green-900' : 'bg-gray-50 border-gray-200 text-gray-500'
                        }`}
                      >
                        <span>{ch.label}</span>
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={e => setSettingsForm({ ...settingsForm, [ch.key]: e.target.checked })}
                          className="w-4 h-4 accent-green-600 rounded"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              {bankSettingsSaved && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 size={16} /> Admin Bank Account &amp; UPI details synced across customer checkout!
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={savingBankSettings}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold px-5 py-2.5 rounded-xl text-sm shadow-sm transition"
                >
                  {savingBankSettings ? 'Saving Bank & UPI Details...' : 'Save Bank & UPI Details'}
                </button>
                <span className="text-xs text-gray-400">Changes update live checkout settlement details immediately.</span>
              </div>
            </form>

            {/* Delivery charge configuration card */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
              <h3 className="font-bold text-base text-gray-800">Dynamic Delivery Fee Rules</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Base Delivery Fee (₹)</label>
                  <input
                    type="number"
                    value={settingsForm.baseDeliveryFee}
                    onChange={e => setSettingsForm({ ...settingsForm, baseDeliveryFee: Number(e.target.value) })}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-gray-400">Charged on orders below free threshold</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Free Delivery Minimum (₹)</label>
                  <input
                    type="number"
                    value={settingsForm.freeDeliveryThreshold}
                    onChange={e => setSettingsForm({ ...settingsForm, freeDeliveryThreshold: Number(e.target.value) })}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-gray-400">Orders above this qualify for free shipping</span>
                </div>
              </div>

              <button
                onClick={async () => {
                  try {
                    await updateAppSettings({
                      baseDeliveryFee: settingsForm.baseDeliveryFee,
                      freeDeliveryThreshold: settingsForm.freeDeliveryThreshold
                    });
                    showToast('Delivery charges updated successfully across customer storefront!', 'success');
                  } catch {
                    showToast('Unable to update delivery charges.', 'error');
                  }
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-sm transition"
              >
                Update Delivery Charges
              </button>
            </div>

            {/* Transaction Ledger */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <h3 className="font-bold text-base text-gray-800">Payment Transactions &amp; Direct Settlement Reconciliation</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-400 font-bold border-b border-gray-100">
                    <tr>
                      <th className="p-4">Order ID</th>
                      <th className="p-4">Customer</th>
                      <th className="p-4">Method &amp; Reference</th>
                      <th className="p-4">Amount</th>
                      <th className="p-4">Payment Status</th>
                      <th className="p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeOrdersList.map(o => {
                      const isSettled = o.paymentStatus === 'paid' || o.paymentStatus === 'collected';
                      return (
                        <tr key={o.id} className="hover:bg-gray-50/80">
                          <td className="p-4 font-bold text-gray-900">#{o.id}</td>
                          <td className="p-4 text-gray-800">{o.customerName || 'Customer'}</td>
                          <td className="p-4">
                            <div className="text-xs font-bold text-gray-800">
                              {o.paymentChannelLabel || formatPaymentMethodLabel(o.paymentMethod)}
                              {o.cardLast4 ? ` (${o.cardNetwork || 'Card'} •••• ${o.cardLast4})` : ''}
                            </div>
                            {o.paymentReference && (
                              <div className="text-[11px] font-mono text-blue-700 mt-0.5">
                                Ref/UTR: {o.paymentReference}
                              </div>
                            )}
                            {o.settlementTargetSummary && (
                              <div className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[260px]">
                                To: {o.settlementTargetSummary}
                              </div>
                            )}
                          </td>
                          <td className="p-4 font-bold text-gray-900">{formatCurrency(o.total)}</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                              isSettled ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                            }`}>
                              {o.paymentStatus || 'pending'}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            {!isSettled ? (
                              <button
                                onClick={async () => {
                                  try {
                                    await updateOrderStatus(o.id, o.status, o.paymentMethod === 'cod' ? 'collected' : 'paid');
                                    showToast(`Marked #${o.id} payment as settled`, 'success');
                                  } catch {
                                    showToast('Failed to update payment status.', 'error');
                                  }
                                }}
                                className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700"
                              >
                                {o.paymentMethod === 'cod' ? 'Mark Cash Collected' : 'Mark Settled'}
                              </button>
                            ) : (
                              <span className="text-xs text-green-600 font-semibold">Reconciled</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );

      // 7. Offers & Coupons
      case 'offers':
        return (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Offers & Coupons</h2>
                <p className="text-sm text-gray-500">Create promotional coupons, seasonal discounts, and customer incentives.</p>
              </div>

              <button
                onClick={() => setShowCouponModal(true)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition"
              >
                <Plus size={18} /> Create Discount Offer
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {coupons.map(cpn => (
                <div key={cpn.code} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-bold text-gray-900 tracking-wider bg-orange-50 text-orange-700 px-2.5 py-0.5 rounded-lg border border-orange-200">
                        {cpn.code}
                      </span>
                      <button
                        onClick={async () => {
                          try {
                            await toggleCoupon(cpn.code);
                          } catch {
                            showToast('Unable to toggle coupon status.', 'error');
                          }
                        }}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          cpn.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {cpn.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </button>
                    </div>

                    <p className="text-sm font-semibold text-gray-800 mt-2">{cpn.description}</p>
                    <div className="text-xs text-gray-500 space-y-1 mt-2">
                      <p>Discount: <strong className="text-gray-800">{cpn.discountType === 'percent' ? `${cpn.discountValue}%` : `₹${cpn.discountValue}`}</strong></p>
                      <p>Min Order: <strong className="text-gray-800">{formatCurrency(cpn.minOrder)}</strong></p>
                      <p>Expires: <strong className="text-gray-800">{cpn.expiry}</strong></p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-xs text-gray-400">Available at Checkout</span>
                    <button
                      onClick={async () => {
                        try {
                          await deleteCoupon(cpn.code);
                          showToast(`Deleted coupon code ${cpn.code}`, 'info');
                        } catch {
                          showToast('Unable to delete coupon.', 'error');
                        }
                      }}
                      className="text-xs font-bold text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      // 8. Reports & Analytics
      case 'reports': {
        const validOrders = allOrders.filter(o => o.status !== 'cancelled');
        const salesByProduct: Record<string, { product: Product; unitsSold: number; revenue: number }> = {};
        validOrders.forEach(order => {
          (order.items || []).forEach(item => {
            const existing = salesByProduct[item.id] || { product: item, unitsSold: 0, revenue: 0 };
            existing.unitsSold += item.quantity;
            existing.revenue += (item.pricePerKg / 1000) * item.selectedWeight * item.quantity;
            salesByProduct[item.id] = existing;
          });
        });

        const topSoldList = Object.values(salesByProduct)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);

        return (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Reports &amp; Sales Analytics</h2>
                <p className="text-sm text-gray-500">Financial insights, top revenue-generating vegetables, and fulfillment rates.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    downloadCsv(
                      `freshveggie_orders_${new Date().toISOString().split('T')[0]}.csv`,
                      ['Order ID', 'Date', 'Customer', 'Phone', 'City', 'Total (INR)', 'Payment Method', 'Payment Status', 'Order Status', 'Partner'],
                      allOrders.map((o) => [
                        o.id,
                        o.date,
                        o.customerName,
                        o.customerPhone,
                        o.address?.city || '',
                        o.total,
                        formatPaymentMethodLabel(o.paymentMethod),
                        o.paymentStatus,
                        o.status,
                        o.assignedToName || 'Unassigned'
                      ])
                    );
                    showToast(`Exported ${allOrders.length} orders to CSV`, 'success');
                  }}
                  className="bg-gray-900 hover:bg-gray-800 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition"
                >
                  <Download size={15} /> Export Orders CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    downloadCsv(
                      `freshveggie_rider_ledger_${new Date().toISOString().split('T')[0]}.csv`,
                      ['Entry ID', 'Partner UID', 'Partner Name', 'Order ID', 'Type', 'Amount (INR)', 'Note'],
                      walletLedger.map((entry) => [
                        entry.id,
                        entry.partnerUid,
                        entry.partnerName,
                        entry.orderId || '-',
                        entry.type,
                        entry.amount,
                        entry.note
                      ])
                    );
                    showToast(`Exported ${walletLedger.length} ledger entries to CSV`, 'success');
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition"
                >
                  <Download size={15} /> Export Rider Payouts CSV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase">Gross Revenue</p>
                <p className="text-2xl font-extrabold text-gray-900 mt-1">{formatCurrency(totalRevenue)}</p>
                <p className="text-xs text-green-600 mt-2">{validOrders.length} active/completed orders</p>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase">Average Order Value</p>
                <p className="text-2xl font-extrabold text-blue-600 mt-1">
                  {validOrders.length > 0 ? formatCurrency(Math.round(totalRevenue / validOrders.length)) : '₹0'}
                </p>
                <p className="text-xs text-gray-400 mt-2">Per non-cancelled checkout</p>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase">Fulfillment Rate</p>
                <p className="text-2xl font-extrabold text-emerald-600 mt-1">
                  {allOrders.length > 0 
                    ? `${Math.round((allOrders.filter(o => o.status === 'delivered').length / allOrders.length) * 100)}%` 
                    : '100%'}
                </p>
                <p className="text-xs text-gray-400 mt-2">Successfully delivered</p>
              </div>
            </div>

            {sqlSummary && sqlSummary.archivedOrders > 0 && (
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-base text-gray-800">Relational SQL Archive Summary</h3>
                    <p className="text-xs text-gray-500">Aggregated via {sqlSummary.databaseEngine}</p>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <div>
                      <span className="text-gray-400 block">Archived Orders</span>
                      <span className="font-bold text-gray-900">{sqlSummary.archivedOrders}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block">Archived GMV</span>
                      <span className="font-bold text-green-700">{formatCurrency(sqlSummary.grossRevenue)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block">Rider Payouts</span>
                      <span className="font-bold text-blue-700">{formatCurrency(sqlSummary.totalRiderPayouts)}</span>
                    </div>
                  </div>
                </div>
                {sqlSummary.topCities.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {sqlSummary.topCities.map((c) => (
                      <span
                        key={c.city}
                        className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-700"
                      >
                        {c.city}: {c.orderCount} orders ({formatCurrency(c.revenue)})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Top Vegetables */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="font-bold text-base text-gray-800 mb-4">Top Selling Vegetables</h3>
              <div className="space-y-3">
                {topSoldList.length > 0 ? (
                  topSoldList.map((entry, i) => (
                    <div key={entry.product.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 font-bold text-xs flex items-center justify-center">
                          {i + 1}
                        </span>
                        <img src={getProductFrontImage(entry.product)} alt={entry.product.name} referrerPolicy="no-referrer" className="w-10 h-10 rounded-lg object-cover" />
                        <div>
                          <p className="font-bold text-gray-800 text-sm">{entry.product.name}</p>
                          <p className="text-xs text-gray-400">{entry.product.category} • {formatCurrency(entry.product.pricePerKg)}/kg</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-900 text-sm">{formatCurrency(entry.revenue)}</p>
                        <span className="text-[11px] text-green-600 font-medium">{entry.unitsSold} units ordered</span>
                      </div>
                    </div>
                  ))
                ) : (
                  products.slice(0, 5).map((p, i) => (
                    <div key={p.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 font-bold text-xs flex items-center justify-center">
                          {i + 1}
                        </span>
                        <img src={getProductFrontImage(p)} alt={p.name} referrerPolicy="no-referrer" className="w-10 h-10 rounded-lg object-cover" />
                        <div>
                          <p className="font-bold text-gray-800 text-sm">{p.name}</p>
                          <p className="text-xs text-gray-400">{p.category} • {formatCurrency(p.pricePerKg)}/kg</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-900 text-sm">★ {p.rating}</p>
                        <span className="text-[11px] text-green-600 font-medium">{p.reviews} reviews</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      }

      // 9. Complaint & Support
      case 'support':
        return (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Complaint & Support Desk</h2>
                <p className="text-sm text-gray-500">Handle customer quality issues, delayed order reports, and issue refunds.</p>
              </div>
            </div>

            <div className="space-y-3">
              {complaints.map(tkt => (
                <div key={tkt.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400">#{tkt.id}</span>
                        <span className="bg-red-50 text-red-700 font-bold text-[10px] px-2 py-0.5 rounded border border-red-200">
                          {tkt.category || 'Other'}
                        </span>
                        <span className="text-xs text-gray-400">• Order #{tkt.orderId || 'GENERAL'}</span>
                      </div>
                      <h4 className="font-bold text-gray-800 text-base mt-1">{tkt.subject}</h4>
                    </div>

                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      tkt.status === 'resolved' ? 'bg-green-100 text-green-700' :
                      tkt.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {tkt.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>

                  <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-xl">{tkt.description}</p>

                  {tkt.resolutionNotes && (
                    <div className="text-xs text-green-700 bg-green-50 p-2.5 rounded-lg border border-green-200 font-medium">
                      <strong>Resolution Note:</strong> {tkt.resolutionNotes}
                    </div>
                  )}

                  <div className="flex flex-wrap justify-between items-center gap-2 pt-2 text-xs text-gray-400">
                    <span>Customer: <strong className="text-gray-700">{tkt.customerName}</strong> ({tkt.customerPhone})</span>
                    <div className="flex gap-2">
                      {tkt.status === 'open' && (
                        <button
                          onClick={async () => {
                            try {
                              await updateComplaintStatus(tkt.id, 'in_progress');
                              showToast(`Ticket #${tkt.id} marked In Progress`, 'info');
                            } catch {
                              showToast('Failed to update support ticket.', 'error');
                            }
                          }}
                          className="bg-yellow-100 text-yellow-800 font-bold px-3 py-1.5 rounded-lg hover:bg-yellow-200"
                        >
                          Mark In Progress
                        </button>
                      )}
                      {tkt.status !== 'resolved' && (
                        <button
                          onClick={() => {
                            setSelectedComplaint(tkt);
                            setResolutionText(tkt.resolutionNotes || '');
                          }}
                          className="bg-green-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-green-700"
                        >
                          Resolve Ticket
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      // 10. App Settings
      case 'settings':
        return (
          <div className="space-y-6 animate-in fade-in max-w-2xl">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">App Settings</h2>
              <p className="text-sm text-gray-500">Global configurations for tax calculation, delivery pricing, and push notification alerts.</p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Applicable GST / Tax Rate (%)</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={settingsForm.taxRate}
                  onChange={e => setSettingsForm({ ...settingsForm, taxRate: Number(e.target.value) })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Base Delivery Fee (₹)</label>
                <input
                  type="number"
                  min={0}
                  max={5000}
                  value={settingsForm.baseDeliveryFee}
                  onChange={e => setSettingsForm({ ...settingsForm, baseDeliveryFee: Number(e.target.value) })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Free Delivery Order Threshold (₹)</label>
                <input
                  type="number"
                  min={0}
                  max={50000}
                  value={settingsForm.freeDeliveryThreshold}
                  onChange={e => setSettingsForm({ ...settingsForm, freeDeliveryThreshold: Number(e.target.value) })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div>
                  <p className="font-bold text-sm text-gray-800">Store Ordering Status</p>
                  <p className="text-xs text-gray-400">Accept live orders from customers</p>
                </div>
                <input
                  type="checkbox"
                  checked={settingsForm.storeOpen}
                  onChange={e => setSettingsForm({ ...settingsForm, storeOpen: e.target.checked })}
                  className="w-5 h-5 accent-green-600 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div>
                  <p className="font-bold text-sm text-gray-800">Push Notifications & SMS</p>
                  <p className="text-xs text-gray-400">Send order tracking updates to customers & drivers</p>
                </div>
                <input
                  type="checkbox"
                  checked={settingsForm.notificationsEnabled}
                  onChange={e => setSettingsForm({ ...settingsForm, notificationsEnabled: e.target.checked })}
                  className="w-5 h-5 accent-green-600 rounded"
                />
              </div>

              {settingsSaved && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 size={16} /> Global App Settings saved successfully!
                </div>
              )}

              <button
                onClick={async () => {
                  try {
                    await updateAppSettings(settingsForm);
                    setSettingsSaved(true);
                    setTimeout(() => setSettingsSaved(false), 3000);
                  } catch {
                    showToast('Failed to save App Settings.', 'error');
                  }
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl shadow-md transition"
              >
                Save App Settings
              </button>
            </div>

            {isBootstrappedAdmin && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Authorized Phone &amp; Staff Admins</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Grant admin access to Phone OTP authenticated team members using their Firebase Auth UID from the Admin Login screen.
                  </p>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newAdminUid.trim()) return;
                    setSavingAdmin(true);
                    try {
                      await grantAdminAccess(newAdminUid, newAdminContact);
                      showToast('Granted Admin role to UID!', 'success');
                      setNewAdminUid('');
                      setNewAdminContact('');
                    } catch (err) {
                      showToast(err instanceof Error ? err.message : 'Unable to add admin UID', 'error');
                    } finally {
                      setSavingAdmin(false);
                    }
                  }}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                >
                  <input
                    type="text"
                    required
                    placeholder="Firebase Auth UID *"
                    value={newAdminUid}
                    onChange={(e) => setNewAdminUid(e.target.value)}
                    className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    placeholder="Mobile (+91...) or Email"
                    value={newAdminContact}
                    onChange={(e) => setNewAdminContact(e.target.value)}
                    className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={savingAdmin}
                    className="bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition disabled:opacity-50"
                  >
                    {savingAdmin ? 'Granting...' : 'Authorize UID'}
                  </button>
                </form>

                {adminList.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {adminList.map((entry) => (
                      <div
                        key={entry.uid}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-mono font-bold text-gray-800 truncate">{entry.uid}</p>
                          <p className="text-gray-500 truncate">{entry.email || 'Phone OTP Admin'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await revokeAdminAccess(entry.uid);
                              showToast('Revoked admin access', 'info');
                            } catch {
                              showToast('Failed to revoke admin access.', 'error');
                            }
                          }}
                          className="text-red-500 hover:text-red-700 font-bold ml-3 shrink-0"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 'areas':
        return <AreaPincodeControlCenter onExportCsv={downloadCsv} />;

      case 'databases':
        return <DatabaseControlCenter />;

      case 'servers':
        return <ServerApiControlCenter />;

      default:
        return null;
    }
  };

  if (!authReady || !firebaseUser || !isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-72 bg-gray-900 text-white transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col shadow-2xl lg:shadow-none
      `}>
        <div className="p-6 flex items-center justify-between border-b border-gray-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
            <AppLogo size={34} roundedClassName="rounded-lg" className="shadow-xs" />
            Admin Control
          </h1>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all ${
                    isActive 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <Icon size={18} className={isActive ? 'text-white' : 'text-gray-400'} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-gray-800 space-y-2">
          <button
            onClick={() => navigate('/home')}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-gray-300 bg-gray-800 hover:bg-gray-700 transition"
          >
            ← View Customer Storefront
          </button>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-red-400 hover:bg-red-500/10 transition"
          >
            <LogOut size={16} /> Logout Admin
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between lg:hidden sticky top-0 z-30 safe-top">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="text-gray-600 hover:text-gray-900 p-1">
              <Menu size={24} />
            </button>
            <h1 className="text-base font-bold text-gray-800">Admin Control</h1>
          </div>
          <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded uppercase">
            {activeTab}
          </span>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="sm:hidden mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-2.5 text-xs text-blue-800">
            <Monitor size={16} className="shrink-0 text-blue-600" />
            <span>For wide analytics tables and bulk operations, Desktop or Tablet web view is recommended.</span>
          </div>
          {!isBootstrappedAdmin && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2.5 text-xs text-amber-900">
              <Shield size={16} className="shrink-0 text-amber-600" />
              <span>
                Signed in as a delegated Admin UID. Store catalog &amp; settings management are active; full cross-customer/fleet table listing requires the Store Owner Google session.
              </span>
            </div>
          )}
          <div className="max-w-6xl mx-auto pb-16">
            {renderContent()}
          </div>
        </div>
      </main>

      {/* ----------------------------------------------------------------- */}
      {/* Product Add / Edit Modal */}
      {/* ----------------------------------------------------------------- */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-lg text-gray-800">
                {editingProduct ? 'Edit Vegetable' : 'Add New Vegetable'}
              </h3>
              <button onClick={() => setShowProductModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const finalImages = sanitizeProductImages(productForm.images, productForm.image);
                if (finalImages.length === 0) {
                  showToast('Please provide at least one front product image.', 'error');
                  return;
                }
                const payload = {
                  ...productForm,
                  image: finalImages[0],
                  images: finalImages
                };
                try {
                  if (editingProduct) {
                    await updateProduct(editingProduct.id, payload);
                    showToast(`Updated ${productForm.name}`, 'success');
                  } else {
                    await addProduct({
                      ...payload,
                      rating: 4.8,
                      reviews: 1
                    });
                    showToast(`Added ${productForm.name} to store catalog`, 'success');
                  }
                  setShowProductModal(false);
                } catch {
                  showToast('Unable to save vegetable. Please verify inputs and retry.', 'error');
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Vegetable Name</label>
                <input
                  type="text"
                  required
                  value={productForm.name}
                  onChange={e => setProductForm({ ...productForm, name: e.target.value })}
                  placeholder="e.g. Green Bell Pepper"
                  className="w-full p-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Category</label>
                  <select
                    value={productForm.category}
                    onChange={e => setProductForm({ ...productForm, category: e.target.value })}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  >
                    {CATEGORIES.filter(c => c !== 'All').map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Price per Kg (₹)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    max={100000}
                    value={productForm.pricePerKg}
                    onChange={e => setProductForm({ ...productForm, pricePerKg: Number(e.target.value) })}
                    className="w-full p-2.5 border rounded-xl text-sm font-bold outline-none"
                  />
                </div>
              </div>

              {/* Multi-Image Gallery Manager (Image #1 is always used as Front Image) */}
              {(() => {
                const galleryList = sanitizeProductImages(productForm.images, productForm.image);
                const handleAddExtraUrl = () => {
                  const candidate = newProductImageUrl.trim().slice(0, 500);
                  if (!candidate) return;
                  if (galleryList.includes(candidate)) {
                    showToast('This image URL is already in the gallery.', 'info');
                    return;
                  }
                  if (galleryList.length >= 8) {
                    showToast('Maximum 8 images supported per product.', 'error');
                    return;
                  }
                  syncProductGallery([...galleryList, candidate]);
                  setNewProductImageUrl('');
                };

                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <label className="block text-xs font-bold text-gray-700">
                          Product Photos ({galleryList.length}/8)
                        </label>
                        <p className="text-[11px] text-gray-500">
                          First photo (#1) is used everywhere as the Front Image.
                        </p>
                      </div>
                      <label className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg cursor-pointer flex items-center gap-1 shrink-0 transition">
                        <Upload size={12} />
                        {uploadingProductImg ? 'Compressing...' : 'Upload Photo(s)'}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          disabled={uploadingProductImg || galleryList.length >= 8}
                          onChange={async (e) => {
                            const files: File[] = e.target.files ? Array.from(e.target.files) : [];
                            e.target.value = '';
                            if (files.length === 0) return;
                            const availableSlots = Math.max(0, 8 - galleryList.length);
                            if (availableSlots <= 0) {
                              showToast('Maximum 8 images reached for this product.', 'error');
                              return;
                            }
                            const batch = files.slice(0, availableSlots);
                            setUploadingProductImg(true);
                            try {
                              const uploadedUrls: string[] = [];
                              for (const file of batch) {
                                const res = await uploadCompressedMedia(file, 'product');
                                if (res.url) uploadedUrls.push(res.url);
                              }
                              if (uploadedUrls.length > 0) {
                                syncProductGallery([...galleryList, ...uploadedUrls]);
                                showToast(
                                  `Added ${uploadedUrls.length} photo${uploadedUrls.length > 1 ? 's' : ''} to product gallery`,
                                  'success'
                                );
                              }
                            } catch (err) {
                              const msg = err instanceof Error ? err.message : 'Image upload failed';
                              showToast(msg, 'error');
                            } finally {
                              setUploadingProductImg(false);
                            }
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* Visual Thumbnail Strip with Reorder & Make Front */}
                    {galleryList.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {galleryList.map((imgUrl, idx) => (
                          <div
                            key={`${imgUrl}-${idx}`}
                            className={`relative rounded-xl overflow-hidden border bg-white ${
                              idx === 0 ? 'border-green-500 ring-1 ring-green-500' : 'border-gray-200'
                            }`}
                          >
                            <div className="h-20 bg-gray-100 relative">
                              <img
                                src={imgUrl}
                                alt={`Gallery ${idx + 1}`}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                              {idx === 0 ? (
                                <span className="absolute top-1 left-1 bg-green-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                  Front Image
                                </span>
                              ) : (
                                <span className="absolute top-1 left-1 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded tabular-nums">
                                  #{idx + 1}
                                </span>
                              )}
                              {galleryList.length > 1 && (
                                <button
                                  type="button"
                                  title="Remove image"
                                  onClick={() => {
                                    const filtered = galleryList.filter((_, i) => i !== idx);
                                    syncProductGallery(filtered);
                                  }}
                                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-red-600 transition"
                                >
                                  <X size={11} />
                                </button>
                              )}
                            </div>
                            <div className="p-1 flex items-center justify-between gap-1 bg-gray-50 border-t border-gray-100">
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  title="Move left"
                                  onClick={() => {
                                    const next = [...galleryList];
                                    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                    syncProductGallery(next);
                                  }}
                                  className="p-0.5 rounded text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                                >
                                  <ChevronLeft size={13} />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === galleryList.length - 1}
                                  title="Move right"
                                  onClick={() => {
                                    const next = [...galleryList];
                                    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                                    syncProductGallery(next);
                                  }}
                                  className="p-0.5 rounded text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                                >
                                  <ChevronRight size={13} />
                                </button>
                              </div>
                              {idx > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = [imgUrl, ...galleryList.filter((_, i) => i !== idx)];
                                    syncProductGallery(next);
                                  }}
                                  className="text-[10px] font-bold text-green-700 hover:underline px-1"
                                >
                                  Make Front
                                </button>
                              ) : (
                                <span className="text-[10px] font-semibold text-green-700 px-1">Primary</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Direct Front Image URL (#1) */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 mb-1">
                        Front Image URL (#1)
                      </label>
                      <input
                        type="text"
                        required
                        value={productForm.image}
                        onChange={(e) => {
                          const val = e.target.value;
                          setProductForm((prev) => ({
                            ...prev,
                            image: val,
                            images: [val, ...prev.images.slice(1)]
                          }));
                        }}
                        placeholder="https://... (front product image)"
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg outline-none text-xs focus:ring-2 focus:ring-green-500"
                      />
                    </div>

                    {/* Add Additional Image URL (#2-#8) */}
                    {galleryList.length < 8 && (
                      <div>
                        <label className="block text-[11px] font-bold text-gray-600 mb-1">
                          Add Additional Product Image URL
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newProductImageUrl}
                            onChange={(e) => setNewProductImageUrl(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddExtraUrl();
                              }
                            }}
                            placeholder="https://... (side view, sliced, packaging)"
                            className="flex-1 p-2 bg-white border border-gray-200 rounded-lg outline-none text-xs focus:ring-2 focus:ring-green-500"
                          />
                          <button
                            type="button"
                            onClick={handleAddExtraUrl}
                            className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold rounded-lg shrink-0 transition"
                          >
                            Add Photo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={productForm.description}
                  onChange={e => setProductForm({ ...productForm, description: e.target.value })}
                  className="w-full p-2.5 border rounded-xl text-sm outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="prodAvail"
                  checked={productForm.available}
                  onChange={e => setProductForm({ ...productForm, available: e.target.checked })}
                  className="w-4 h-4 accent-green-600 rounded"
                />
                <label htmlFor="prodAvail" className="text-xs font-bold text-gray-700">
                  Mark as Available In Stock
                </label>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="flex-1 py-2.5 border rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold"
                >
                  Save Vegetable
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Delivery Partner Add Modal */}
      {/* ----------------------------------------------------------------- */}
      {showDriverModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-lg text-gray-800">Provision Delivery Partner</h3>
              <button onClick={() => setShowDriverModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const finalArea = (useCustomDriverZone ? customDriverZone : driverForm.area)
                  .trim()
                  .slice(0, 80);
                if (!finalArea) {
                  showToast('Please select or enter an assigned area/pincode.', 'error');
                  return;
                }
                try {
                  const created = await addDeliveryBoy({
                    uid: driverForm.uid,
                    email: driverForm.email,
                    name: driverForm.name,
                    phone: driverForm.phone,
                    area: finalArea,
                    vehicle: driverForm.vehicle,
                    isOnline: false,
                    isApproved: true
                  });
                  showToast(`Added ${created.name} (${created.partnerCode}) to fleet`, 'success');
                  setDriverForm({
                    uid: '',
                    email: '',
                    name: '',
                    phone: '',
                    area: driverZoneOptions[0] || 'Central Zone',
                    vehicle: 'Motorcycle'
                  });
                  setUseCustomDriverZone(false);
                  setCustomDriverZone('');
                  setShowDriverModal(false);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'Unable to add partner';
                  showToast(msg, 'error');
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Partner Firebase UID *</label>
                <input
                  type="text"
                  required
                  placeholder="Firebase Auth UID (from registered customer list)"
                  value={driverForm.uid}
                  onChange={e => setDriverForm({ ...driverForm, uid: e.target.value })}
                  className="w-full p-2.5 border rounded-xl text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Partner Email (Optional for Mobile OTP)</label>
                <input
                  type="email"
                  placeholder="partner@gmail.com (optional)"
                  value={driverForm.email}
                  onChange={e => setDriverForm({ ...driverForm, email: e.target.value })}
                  className="w-full p-2.5 border rounded-xl text-sm outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Partner Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Chandra"
                  value={driverForm.name}
                  onChange={e => setDriverForm({ ...driverForm, name: e.target.value })}
                  className="w-full p-2.5 border rounded-xl text-sm outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Mobile Number *</label>
                <input
                  type="tel"
                  required
                  placeholder="10-digit number"
                  value={driverForm.phone}
                  onChange={e => setDriverForm({ ...driverForm, phone: e.target.value })}
                  className="w-full p-2.5 border rounded-xl text-sm outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Assigned Area</label>
                  <select
                    value={useCustomDriverZone ? '__custom__' : driverForm.area}
                    onChange={e => {
                      if (e.target.value === '__custom__') {
                        setUseCustomDriverZone(true);
                      } else {
                        setUseCustomDriverZone(false);
                        setDriverForm({ ...driverForm, area: e.target.value });
                      }
                    }}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  >
                    {driverZoneOptions.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                    <option value="__custom__">+ Custom Area / Pincode</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Vehicle Type</label>
                  <select
                    value={driverForm.vehicle}
                    onChange={e => setDriverForm({ ...driverForm, vehicle: e.target.value })}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  >
                    <option value="Motorcycle">Motorcycle</option>
                    <option value="Electric Scooter">Electric Scooter</option>
                    <option value="Scooter">Scooter</option>
                    <option value="Van">Van</option>
                  </select>
                </div>
              </div>

              {useCustomDriverZone && (
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Custom Area / Pincode *</label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    placeholder="e.g. Gwalior (474011)"
                    value={customDriverZone}
                    onChange={e => setCustomDriverZone(e.target.value)}
                    className="w-full p-2.5 border border-blue-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowDriverModal(false)}
                  className="flex-1 py-2.5 border rounded-xl text-sm font-bold text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold"
                >
                  Save Partner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Create Coupon Modal */}
      {/* ----------------------------------------------------------------- */}
      {showCouponModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-lg text-gray-800">Create Discount Offer</h3>
              <button onClick={() => setShowCouponModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const cleanCode = couponForm.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').trim();
                if (cleanCode.length < 2) {
                  showToast('Promo code must be at least 2 alphanumeric characters.', 'error');
                  return;
                }
                const numericDiscount = Number(couponForm.discountValue);
                if (!Number.isFinite(numericDiscount) || numericDiscount <= 0) {
                  showToast('Discount value must be greater than zero.', 'error');
                  return;
                }
                if (couponForm.discountType === 'percent' && numericDiscount > 100) {
                  showToast('Percentage discount cannot exceed 100%.', 'error');
                  return;
                }
                try {
                  await addCoupon({
                    code: cleanCode,
                    description: couponForm.description,
                    discountType: couponForm.discountType,
                    discountValue: numericDiscount,
                    minOrder: Math.max(0, Number(couponForm.minOrder) || 0),
                    isActive: true,
                    expiry: couponForm.expiry
                  });
                  showToast(`Coupon ${cleanCode} created!`, 'success');
                  setShowCouponModal(false);
                } catch {
                  showToast('Failed to create coupon code. Please retry.', 'error');
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Coupon Promo Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SUMMER25"
                  value={couponForm.code}
                  onChange={e => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })}
                  className="w-full p-2.5 border rounded-xl text-sm uppercase font-bold outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Description</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 25% OFF on Summer harvest"
                  value={couponForm.description}
                  onChange={e => setCouponForm({ ...couponForm, description: e.target.value })}
                  className="w-full p-2.5 border rounded-xl text-sm outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Discount Type</label>
                  <select
                    value={couponForm.discountType}
                    onChange={e => setCouponForm({ ...couponForm, discountType: e.target.value as 'percent' | 'flat' })}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  >
                    <option value="percent">Percentage (%)</option>
                    <option value="flat">Flat Amount (₹)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Discount Value</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={couponForm.discountType === 'percent' ? 100 : 10000}
                    value={couponForm.discountValue}
                    onChange={e => setCouponForm({ ...couponForm, discountValue: Number(e.target.value) })}
                    className="w-full p-2.5 border rounded-xl text-sm font-bold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Min Order Value (₹)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    max={100000}
                    value={couponForm.minOrder}
                    onChange={e => setCouponForm({ ...couponForm, minOrder: Number(e.target.value) })}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Expiry Date</label>
                  <input
                    type="date"
                    required
                    value={couponForm.expiry}
                    onChange={e => setCouponForm({ ...couponForm, expiry: e.target.value })}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCouponModal(false)}
                  className="flex-1 py-2.5 border rounded-xl text-sm font-bold text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold"
                >
                  Save Coupon
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Support Ticket Resolution Modal */}
      {/* ----------------------------------------------------------------- */}
      {selectedComplaint && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-gray-800">Resolve Support Ticket</h3>
                <p className="text-xs text-gray-500">#{selectedComplaint.id} • {selectedComplaint.customerName}</p>
              </div>
              <button onClick={() => setSelectedComplaint(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!resolutionText.trim()) return;
                try {
                  await updateComplaintStatus(selectedComplaint.id, 'resolved', resolutionText.trim());
                  showToast(`Ticket #${selectedComplaint.id} marked as resolved`, 'success');
                  setSelectedComplaint(null);
                  setResolutionText('');
                } catch {
                  showToast('Failed to resolve ticket. Please retry.', 'error');
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Resolution Note / Refund Details *</label>
                <textarea
                  rows={3}
                  required
                  value={resolutionText}
                  onChange={e => setResolutionText(e.target.value)}
                  placeholder="e.g. Refund of ₹80 issued via UPI / Replacement dispatched"
                  className="w-full p-3 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedComplaint(null)}
                  className="flex-1 py-2.5 border rounded-xl text-sm font-bold text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold"
                >
                  Confirm Resolution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Order Inspection Modal */}
      {/* ----------------------------------------------------------------- */}
      {viewingOrder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b pb-3 gap-3">
              <div>
                <h3 className="font-bold text-lg text-gray-800">Order #{viewingOrder.id}</h3>
                <p className="text-xs text-gray-500">
                  Order Date: {formatOrderDateTime(viewingOrder.date)}
                </p>
                <p className="text-xs font-semibold text-blue-700 mt-0.5">
                  Slot: {viewingOrder.deliverySlot}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingOrder;
                    setViewingOrderId(null);
                    openEditOrderModal(target);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1.5 rounded-lg transition"
                >
                  <Edit2 size={12} /> Edit Details
                </button>
                <button onClick={() => setViewingOrderId(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="bg-gray-50 p-3 rounded-xl text-xs space-y-1">
              <p><strong>Customer:</strong> {viewingOrder.customerName} (+{viewingOrder.customerPhone})</p>
              <p><strong>Address ({viewingOrder.address?.label || 'Home'}):</strong> {viewingOrder.address?.street}, {viewingOrder.address?.city} - {viewingOrder.address?.zip}</p>
              <p>
                <strong>Payment:</strong>{' '}
                {viewingOrder.paymentChannelLabel || formatPaymentMethodLabel(viewingOrder.paymentMethod)}
                {viewingOrder.cardLast4 ? ` (${viewingOrder.cardNetwork || 'Card'} •••• ${viewingOrder.cardLast4})` : ''}{' '}
                <span className="uppercase font-semibold">({viewingOrder.paymentStatus || 'pending'})</span>
              </p>
              {viewingOrder.paymentReference && (
                <p><strong>UTR / Auth Ref:</strong> <span className="font-mono text-blue-700">{viewingOrder.paymentReference}</span></p>
              )}
              {viewingOrder.settlementTargetSummary && (
                <p><strong>Settled To:</strong> <span className="text-emerald-700 font-medium">{viewingOrder.settlementTargetSummary}</span></p>
              )}
              <p><strong>Driver:</strong> {viewingOrder.assignedToName || 'Unassigned'}</p>
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-xs uppercase text-gray-500">
                Ordered Items ({viewingOrder.items?.length || 0})
              </h4>
              {viewingOrder.items?.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm bg-gray-50 p-2.5 rounded-lg">
                  <div className="flex items-center gap-2.5">
                    <img src={getProductFrontImage(item)} alt={item.name} referrerPolicy="no-referrer" className="w-9 h-9 rounded object-cover" />
                    <div>
                      <p className="font-semibold text-gray-800">{item.name}</p>
                      <p className="text-xs text-gray-500">
                        {item.selectedWeight}g × {item.quantity} ({formatCurrency(item.pricePerKg)}/kg)
                      </p>
                    </div>
                  </div>
                  <span className="font-bold text-gray-900">
                    {formatCurrency((item.pricePerKg / 1000) * item.selectedWeight * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            {(() => {
              const billing = getOrderBillingBreakdown(viewingOrder, appSettings);
              return (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                    <h4 className="font-bold uppercase tracking-wider text-gray-600">
                      Bill &amp; Price Breakdown
                    </h4>
                    {billing.isEstimated && (
                      <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                        Legacy Order (Auto-Reconciled)
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center text-gray-700">
                    <span>Order Total (Items Subtotal)</span>
                    <span className="font-semibold text-gray-900">{formatCurrency(billing.subtotal)}</span>
                  </div>

                  <div className="flex justify-between items-center text-gray-700">
                    <span>
                      + GST / Taxes{billing.taxRate > 0 ? ` (${billing.taxRate}%)` : ''}
                    </span>
                    <span className="font-semibold text-gray-900">+ {formatCurrency(billing.taxAmount)}</span>
                  </div>

                  <div className="flex justify-between items-center text-gray-700">
                    <span>+ Delivery Fees</span>
                    {billing.deliveryFee === 0 ? (
                      <span className="font-bold text-green-600">Free (₹0)</span>
                    ) : (
                      <span className="font-semibold text-gray-900">+ {formatCurrency(billing.deliveryFee)}</span>
                    )}
                  </div>

                  <div className="flex justify-between items-center text-gray-700">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>- Discount Coupon</span>
                      {billing.couponCode ? (
                        <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 border border-green-300 font-mono font-bold text-[10px] px-2 py-0.5 rounded">
                          <Tag size={10} /> {billing.couponCode}
                        </span>
                      ) : billing.discountAmount > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 font-bold text-[10px] px-2 py-0.5 rounded">
                          APPLIED
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">(No coupon applied)</span>
                      )}
                    </div>
                    <span
                      className={`font-bold ${
                        billing.discountAmount > 0 ? 'text-green-600' : 'text-gray-400'
                      }`}
                    >
                      {billing.discountAmount > 0
                        ? `- ${formatCurrency(billing.discountAmount)}`
                        : formatCurrency(0)}
                    </span>
                  </div>

                  <div className="border-t border-gray-300 pt-2.5 mt-1 flex justify-between items-center text-base font-extrabold">
                    <span className="text-gray-900">Grand Total</span>
                    <span className="text-green-700">= {formatCurrency(billing.grandTotal)}</span>
                  </div>
                </div>
              );
            })()}
            {viewingOrder.proofImageUrl && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-green-800 flex items-center gap-1.5">
                  <Camera size={14} /> Rider Delivery Proof Photo
                </p>
                <img
                  src={viewingOrder.proofImageUrl}
                  alt={`Delivery proof for #${viewingOrder.id}`}
                  className="w-full max-h-48 object-cover rounded-lg border border-green-200 bg-white"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Edit Order Details Modal (Date, Slot, Address, Pincode & Phone) */}
      {/* ----------------------------------------------------------------- */}
      {editingOrder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-gray-800">Edit Order #{editingOrder.id}</h3>
                <p className="text-xs text-gray-500">
                  Update order date, delivery slot time, customer phone, address, and pincode.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const cleanDigits = editOrderForm.customerPhone.replace(/\D/g, '');
                if (cleanDigits.length < 10 || cleanDigits.length > 15) {
                  showToast('Customer phone number must contain 10 to 15 digits.', 'error');
                  return;
                }
                if (!editOrderForm.street.trim() || !editOrderForm.city.trim()) {
                  showToast('Street address and city are required.', 'error');
                  return;
                }
                if (editOrderForm.zip.trim().length < 3) {
                  showToast('Please enter a valid pincode (minimum 3 characters).', 'error');
                  return;
                }

                const safeTime = (editOrderForm.orderTime || '12:00').trim().slice(0, 5);
                const combinedIso = editOrderForm.orderDate
                  ? new Date(`${editOrderForm.orderDate}T${safeTime}:00`)
                  : new Date(editingOrder.date);
                if (Number.isNaN(combinedIso.getTime())) {
                  showToast('Please select a valid order date.', 'error');
                  return;
                }

                let finalSlot = '';
                if (editOrderForm.slotWindow === '__custom__') {
                  finalSlot = editOrderForm.customSlotText.trim();
                } else {
                  const slotDayObj = editOrderForm.slotDate
                    ? new Date(`${editOrderForm.slotDate}T12:00:00`)
                    : combinedIso;
                  const datePrefix = !Number.isNaN(slotDayObj.getTime())
                    ? format(slotDayObj, 'EEE, MMM d')
                    : '';
                  finalSlot = datePrefix
                    ? `${datePrefix} - ${editOrderForm.slotWindow}`
                    : editOrderForm.slotWindow;
                }

                if (!finalSlot) {
                  showToast('Delivery slot time cannot be empty.', 'error');
                  return;
                }

                setSavingOrderEdit(true);
                try {
                  await updateOrderDetails(editingOrder.id, {
                    date: combinedIso.toISOString(),
                    deliverySlot: finalSlot,
                    customerName: editOrderForm.customerName.trim() || editingOrder.customerName,
                    customerPhone: cleanDigits,
                    address: {
                      label: editOrderForm.addressLabel.trim() || 'Home',
                      street: editOrderForm.street.trim(),
                      city: editOrderForm.city.trim(),
                      zip: editOrderForm.zip.trim()
                    }
                  });
                  showToast(`Order #${editingOrder.id} updated cleanly!`, 'success');
                  setEditingOrder(null);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'Unable to update order details.';
                  showToast(msg, 'error');
                } finally {
                  setSavingOrderEdit(false);
                }
              }}
              className="space-y-4"
            >
              {/* Order Date & Time */}
              <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 space-y-2.5">
                <p className="text-xs font-bold text-gray-700 uppercase flex items-center gap-1.5">
                  <Calendar size={14} className="text-blue-600" /> Order Date &amp; Time
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1">Order Date *</label>
                    <input
                      type="date"
                      required
                      value={editOrderForm.orderDate}
                      onChange={e => setEditOrderForm({ ...editOrderForm, orderDate: e.target.value })}
                      className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1">Order Time</label>
                    <input
                      type="time"
                      value={editOrderForm.orderTime}
                      onChange={e => setEditOrderForm({ ...editOrderForm, orderTime: e.target.value })}
                      className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Delivery Slot Date & Window */}
              <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200 space-y-2.5">
                <p className="text-xs font-bold text-blue-900 uppercase flex items-center gap-1.5">
                  <Clock size={14} className="text-blue-600" /> Delivery Slot Schedule
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1">Slot Date</label>
                    <input
                      type="date"
                      disabled={editOrderForm.slotWindow === '__custom__'}
                      value={editOrderForm.slotDate}
                      onChange={e => setEditOrderForm({ ...editOrderForm, slotDate: e.target.value })}
                      className="w-full p-2 bg-white border border-blue-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1">Slot Time Window</label>
                    <select
                      value={editOrderForm.slotWindow}
                      onChange={e => setEditOrderForm({ ...editOrderForm, slotWindow: e.target.value })}
                      className="w-full p-2 bg-white border border-blue-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {SLOT_TIME_WINDOWS.map((win) => (
                        <option key={win} value={win}>
                          {win}
                        </option>
                      ))}
                      <option value="__custom__">+ Custom Slot Text</option>
                    </select>
                  </div>
                </div>

                {editOrderForm.slotWindow === '__custom__' ? (
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1">Custom Delivery Slot *</label>
                    <input
                      type="text"
                      required
                      maxLength={120}
                      placeholder="e.g. Sat, Nov 21 - Express 2:00 PM - 3:00 PM"
                      value={editOrderForm.customSlotText}
                      onChange={e => setEditOrderForm({ ...editOrderForm, customSlotText: e.target.value })}
                      className="w-full p-2 bg-white border border-blue-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ) : (
                  <p className="text-[11px] text-blue-800">
                    Saved Slot:{' '}
                    <strong>
                      {editOrderForm.slotDate && !Number.isNaN(new Date(`${editOrderForm.slotDate}T12:00:00`).getTime())
                        ? `${format(new Date(`${editOrderForm.slotDate}T12:00:00`), 'EEE, MMM d')} - ${editOrderForm.slotWindow}`
                        : editOrderForm.slotWindow}
                    </strong>
                  </p>
                )}
              </div>

              {/* Customer Contact */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Customer Name *</label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={editOrderForm.customerName}
                    onChange={e => setEditOrderForm({ ...editOrderForm, customerName: e.target.value })}
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    maxLength={15}
                    placeholder="10-15 digits"
                    value={editOrderForm.customerPhone}
                    onChange={e => setEditOrderForm({ ...editOrderForm, customerPhone: e.target.value })}
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Address & Pincode */}
              <div className="space-y-3 border-t pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-gray-700 uppercase flex items-center gap-1.5">
                    <MapPin size={14} className="text-green-600" /> Delivery Address &amp; Pincode
                  </p>
                  <select
                    value={editOrderForm.addressLabel}
                    onChange={e => setEditOrderForm({ ...editOrderForm, addressLabel: e.target.value })}
                    className="px-2 py-1 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 outline-none"
                  >
                    <option value="Home">Home</option>
                    <option value="Office">Office</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Street / House / Landmark *</label>
                  <input
                    type="text"
                    required
                    maxLength={300}
                    value={editOrderForm.street}
                    onChange={e => setEditOrderForm({ ...editOrderForm, street: e.target.value })}
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">City *</label>
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={editOrderForm.city}
                      onChange={e => setEditOrderForm({ ...editOrderForm, city: e.target.value })}
                      className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Pincode *</label>
                    <input
                      type="text"
                      required
                      maxLength={20}
                      value={editOrderForm.zip}
                      onChange={e => setEditOrderForm({ ...editOrderForm, zip: e.target.value })}
                      className="w-full p-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {editOrderForm.zip.trim().length >= 4 && (() => {
                  const zoneCheck = checkPincodeServiceability(editOrderForm.zip.trim());
                  return zoneCheck.matchedArea ? (
                    <p className="text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1.5 rounded-lg">
                      ✓ Matches configured area: <strong>{zoneCheck.matchedArea.name} ({zoneCheck.matchedArea.pincode})</strong>
                    </p>
                  ) : (
                    <p className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
                      Note: Pincode {editOrderForm.zip.trim()} is not yet added to configured Service Areas (order will auto-appear in Area &amp; Fleet assignment lists).
                    </p>
                  );
                })()}
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  disabled={savingOrderEdit}
                  onClick={() => setEditingOrder(null)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOrderEdit}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold"
                >
                  {savingOrderEdit ? 'Saving Changes...' : 'Save Order Details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Customer Details Modal */}
      {/* ----------------------------------------------------------------- */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-gray-800">{selectedCustomer.name}</h3>
                <p className="text-xs text-gray-500">{selectedCustomer.phone} • {selectedCustomer.email || 'No email'}</p>
              </div>
              <button onClick={() => setSelectedCustomerId(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-xs uppercase text-gray-500">Saved Addresses ({selectedCustomer.addresses?.length || 0})</h4>
              {selectedCustomer.addresses?.map(a => (
                <div key={a.id} className="p-2.5 bg-gray-50 rounded-lg text-xs">
                  <span className="font-bold text-gray-700">{a.label}:</span> {a.street}, {a.city} - {a.zip}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-xs uppercase text-gray-500">Customer Orders</h4>
              {allOrders.filter(o => o.userId === selectedCustomer.id).map(o => (
                <div key={o.id} className="p-2.5 bg-gray-50 rounded-lg text-xs flex justify-between items-center">
                  <div>
                    <p className="font-bold text-gray-800">#{o.id}</p>
                    <p className="text-gray-500">{o.status.replace(/_/g, ' ').toUpperCase()}</p>
                  </div>
                  <span className="font-bold text-green-700">{formatCurrency(o.total)}</span>
                </div>
              ))}
              {allOrders.filter(o => o.userId === selectedCustomer.id).length === 0 && (
                <p className="text-xs text-gray-400">No orders placed yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
