import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  ArrowRight,
  Menu,
  Shield,
  Sprout,
  MapPin,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { CATEGORIES, Product } from '../lib/data';
import { useStore } from '../context/StoreContext';
import { ProductCard } from '../components/ProductCard';
import { Sidebar } from '../components/Sidebar';
import { AppLogo } from '../components/AppLogo';
import { useToast } from '../context/ToastContext';

const BANNER_PALETTES = [
  {
    bg: 'bg-orange-100',
    text: 'text-orange-900',
    accent: 'bg-orange-500',
    image:
      'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=200'
  },
  {
    bg: 'bg-red-100',
    text: 'text-red-900',
    accent: 'bg-red-500',
    image:
      'https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&q=80&w=200'
  },
  {
    bg: 'bg-green-100',
    text: 'text-green-900',
    accent: 'bg-green-600',
    image:
      'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&q=80&w=200'
  }
];

const FRESH_ARRIVALS_CATEGORY = 'Fresh Arrivals';

const getCategoryVisual = (cat: string): { emoji: string; surface: string; tagline: string } => {
  switch (cat) {
    case FRESH_ARRIVALS_CATEGORY:
      return { emoji: '🌱', surface: 'bg-green-100 text-green-800', tagline: 'Newest farm harvest picks' };
    case 'Leafy Greens':
      return { emoji: '🥬', surface: 'bg-emerald-50 text-emerald-700', tagline: 'Spinach, kale & crisp greens' };
    case 'Root Vegetables':
      return { emoji: '🥕', surface: 'bg-orange-50 text-orange-700', tagline: 'Potatoes, onions, carrots' };
    case 'Fruits':
      return { emoji: '🍎', surface: 'bg-rose-50 text-rose-700', tagline: 'Vine tomatoes & orchard picks' };
    case 'Herbs':
      return { emoji: '🌿', surface: 'bg-green-50 text-green-700', tagline: 'Coriander, mint & aromatics' };
    case 'Exotic':
      return { emoji: '🥦', surface: 'bg-teal-50 text-teal-700', tagline: 'Broccoli, peppers & specialty' };
    default:
      return { emoji: '🧺', surface: 'bg-lime-50 text-lime-700', tagline: 'Farm fresh seasonal produce' };
  }
};

const toTimestampMs = (raw: unknown): number => {
  if (!raw) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof raw === 'object' && raw !== null) {
    if ('toMillis' in raw && typeof (raw as { toMillis: () => number }).toMillis === 'function') {
      return (raw as { toMillis: () => number }).toMillis();
    }
    if ('seconds' in raw && typeof (raw as { seconds: number }).seconds === 'number') {
      return (raw as { seconds: number }).seconds * 1000;
    }
  }
  return 0;
};

export const Home = () => {
  const {
    setSelectedCategory,
    products,
    productsLoading,
    coupons,
    appSettings,
    serviceAreas,
    selectedPincode,
    setSelectedPincode,
    checkPincodeServiceability
  } = useStore();
  const { showToast } = useToast();
  const [currentBanner, setCurrentBanner] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState(selectedPincode);
  const [editingPin, setEditingPin] = useState(false);
  const [activeHomeCategory, setActiveHomeCategory] = useState<string>('All');

  const areaStatus = checkPincodeServiceability(selectedPincode);

  // Fresh Arrivals: newest catalog additions first, prioritizing in-stock produce
  const freshArrivals = useMemo(() => {
    const sorted = [...products].sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      const aTime = Math.max(toTimestampMs(a.createdAt), toTimestampMs(a.updatedAt));
      const bTime = Math.max(toTimestampMs(b.createdAt), toTimestampMs(b.updatedAt));
      if (bTime !== aTime) return bTime - aTime;
      return (b.rating || 0) - (a.rating || 0);
    });
    return sorted.slice(0, 8);
  }, [products]);

  // All Categories list: "Fresh Arrivals" FIRST, followed by all store produce categories
  const allCategories = useMemo(() => {
    const base = CATEGORIES.filter((c) => c !== 'All') as string[];
    const seen = new Set(base.map((c) => c.toLowerCase()));
    const storeCategories = [...base];
    products.forEach((p) => {
      const cat = (p.category || '').trim();
      if (
        cat &&
        cat.toLowerCase() !== 'all' &&
        cat.toLowerCase() !== FRESH_ARRIVALS_CATEGORY.toLowerCase() &&
        !seen.has(cat.toLowerCase())
      ) {
        seen.add(cat.toLowerCase());
        storeCategories.push(cat);
      }
    });
    return [FRESH_ARRIVALS_CATEGORY, ...storeCategories];
  }, [products]);

  const productsByCategory = useMemo(() => {
    const grouped: Record<string, Product[]> = {
      [FRESH_ARRIVALS_CATEGORY]: freshArrivals
    };
    allCategories.forEach((cat) => {
      if (cat !== FRESH_ARRIVALS_CATEGORY) {
        grouped[cat] = [];
      }
    });
    products.forEach((p) => {
      const key =
        allCategories.find(
          (c) => c !== FRESH_ARRIVALS_CATEGORY && c.toLowerCase() === (p.category || '').trim().toLowerCase()
        ) || (p.category || '').trim();
      if (!key || key === FRESH_ARRIVALS_CATEGORY) return;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(p);
    });
    return grouped;
  }, [allCategories, freshArrivals, products]);

  const visibleCategorySections = useMemo(() => {
    if (activeHomeCategory !== 'All') {
      return allCategories.filter((c) => c === activeHomeCategory);
    }
    return allCategories;
  }, [allCategories, activeHomeCategory]);

  const liveBanners = useMemo(() => {
    const active = coupons.filter((c) => c.isActive);
    return active.map((coupon, index) => {
      const palette = BANNER_PALETTES[index % BANNER_PALETTES.length];
      return {
        id: coupon.code,
        title:
          coupon.discountType === 'percent'
            ? `Get ${coupon.discountValue}% OFF`
            : `Flat ₹${coupon.discountValue} OFF`,
        subtitle: coupon.description || `Min order ₹${coupon.minOrder}`,
        code: coupon.code,
        ...palette
      };
    });
  }, [coupons]);

  useEffect(() => {
    if (liveBanners.length <= 1) {
      setCurrentBanner(0);
      return;
    }
    const timer = setInterval(() => {
      setCurrentBanner((prev) => (prev + 1) % liveBanners.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [liveBanners.length]);

  return (
    <div className="pb-24 max-w-6xl mx-auto">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {/* Hero Section */}
      <div className="bg-green-600 text-white p-6 rounded-b-3xl shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full -ml-10 -mb-10"></div>

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open menu"
              className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
            >
              <Menu size={24} className="text-white" />
            </button>
            <div className="flex items-center gap-2.5">
              <AppLogo
                size={34}
                roundedClassName="rounded-lg"
                className="shadow-xs ring-1 ring-white/25"
              />
              <span className="text-xl font-bold tracking-tight whitespace-nowrap">FreshVeggie</span>
            </div>
            <div className="w-10"></div>
          </div>

          <h1 className="text-3xl font-bold mb-2">Fresh Vegetables</h1>
          <p className="text-green-100 mb-6">
            Delivered directly from farm to your doorstep.
          </p>

          <Link
            to="/browse"
            onClick={() => setSelectedCategory('All')}
            className="bg-white text-green-700 w-full py-3 rounded-xl flex items-center px-4 gap-3 shadow-sm hover:bg-green-50/40 transition-colors"
          >
            <Search size={20} className="text-gray-400 shrink-0" />
            <span className="text-gray-500 text-sm">Search for vegetables...</span>
          </Link>
        </div>
      </div>

      {/* Local Area & Pincode Checker */}
      {(appSettings.restrictToServiceAreas || serviceAreas.length > 0 || selectedPincode) && (
        <div className="px-4 mt-4">
          <div
            className={`rounded-2xl border p-3.5 shadow-xs transition ${
              selectedPincode && !areaStatus.serviceable
                ? 'bg-red-50 border-red-200'
                : 'bg-white border-gray-100'
            }`}
          >
            {editingPin || (!selectedPincode && appSettings.restrictToServiceAreas) ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = pinDraft.replace(/\D/g, '').trim();
                  if (clean.length < 4) {
                    showToast('Enter a valid delivery pincode (4-10 digits)', 'error');
                    return;
                  }
                  setSelectedPincode(clean);
                  setEditingPin(false);
                  const check = checkPincodeServiceability(clean);
                  if (check.serviceable) {
                    showToast(
                      check.matchedArea
                        ? `Delivering to ${check.matchedArea.name} (${clean})`
                        : `Pincode ${clean} saved`,
                      'success'
                    );
                  } else {
                    showToast(check.reason || 'Area currently outside delivery range', 'error');
                  }
                }}
                className="flex items-center gap-2"
              >
                <MapPin size={18} className="text-green-600 shrink-0" />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="Enter delivery pincode (e.g. 122001)"
                  value={pinDraft}
                  onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))}
                  className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  type="submit"
                  className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg shrink-0"
                >
                  Check
                </button>
                {editingPin && (
                  <button
                    type="button"
                    onClick={() => setEditingPin(false)}
                    className="text-xs text-gray-500 px-2 py-1"
                  >
                    Cancel
                  </button>
                )}
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {selectedPincode && !areaStatus.serviceable ? (
                    <AlertTriangle size={18} className="text-red-600 shrink-0" />
                  ) : (
                    <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                  )}
                  <div className="min-w-0">
                    {selectedPincode ? (
                      areaStatus.serviceable ? (
                        <p className="text-xs font-semibold text-gray-800 truncate">
                          Delivering to{' '}
                          <span className="text-green-700 font-bold">
                            {areaStatus.matchedArea
                              ? `${areaStatus.matchedArea.name}, ${areaStatus.matchedArea.city} (${selectedPincode})`
                              : `Pincode ${selectedPincode}`}
                          </span>
                          {areaStatus.matchedArea && (
                            <span className="text-gray-500 font-normal">
                              {' '}
                              · ~{areaStatus.matchedArea.etaMinutes} mins
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs font-semibold text-red-700">
                          {areaStatus.reason || `Pincode ${selectedPincode} is not serviceable yet.`}
                        </p>
                      )
                    ) : (
                      <p className="text-xs text-gray-600 truncate">
                        Check local pincode availability &amp; estimated delivery time
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPinDraft(selectedPincode);
                    setEditingPin(true);
                  }}
                  className="text-xs font-bold text-green-700 hover:underline shrink-0"
                >
                  {selectedPincode ? 'Change' : 'Set Pincode'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Offers Slider (backed by Firestore coupons) */}
      <div className="px-4 mt-6">
        {liveBanners.length > 0 ? (
          <div className="relative overflow-hidden rounded-2xl h-40">
            <div
              className="flex transition-transform duration-500 ease-out h-full"
              style={{ transform: `translateX(-${currentBanner * 100}%)` }}
            >
              {liveBanners.map((banner) => (
                <div
                  key={banner.id}
                  className={`min-w-full h-full ${banner.bg} p-5 flex items-center justify-between relative`}
                >
                  <div className="relative z-10">
                    <span
                      className={`${banner.accent} text-white text-[10px] font-bold px-2 py-1 rounded mb-2 inline-block`}
                    >
                      LIVE OFFER
                    </span>
                    <h3
                      className={`font-bold text-xl ${banner.text} leading-tight mb-1`}
                    >
                      {banner.title}
                    </h3>
                    <p className="text-xs opacity-80 mb-3 font-medium line-clamp-1">
                      {banner.subtitle}
                    </p>
                    <button
                      onClick={async () => {
                        try {
                          if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(banner.code);
                            showToast(
                              `Coupon ${banner.code} copied! Apply at checkout.`,
                              'success'
                            );
                          } else {
                            showToast(`Code: ${banner.code}`, 'info');
                          }
                        } catch {
                          showToast(`Code: ${banner.code}`, 'info');
                        }
                      }}
                      className={`${banner.accent} text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm hover:opacity-90 active:scale-95 transition`}
                    >
                      Use Code: {banner.code}
                    </button>
                  </div>
                  <img
                    src={banner.image}
                    alt="Fresh produce offer"
                    referrerPolicy="no-referrer"
                    className="w-32 h-32 object-contain -mr-6 drop-shadow-lg"
                  />
                </div>
              ))}
            </div>

            {liveBanners.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {liveBanners.map((_, i) => (
                  <div
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      currentBanner === i ? 'bg-gray-800 w-4' : 'bg-gray-400/50'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-gradient-to-r from-emerald-50 to-green-100 border border-green-200 p-5 flex items-center justify-between">
            <div>
              <span className="bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded mb-2 inline-block">
                FARM DIRECT
              </span>
              <h3 className="font-bold text-lg text-green-900">
                100% Harvest Fresh Produce
              </h3>
              <p className="text-xs text-green-700 mt-1">
                Morning-picked vegetables delivered to your neighborhood hub.
              </p>
            </div>
            <Link
              to="/browse"
              onClick={() => setSelectedCategory('All')}
              className="bg-green-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl shrink-0 hover:bg-green-700 transition"
            >
              Browse
            </Link>
          </div>
        )}
      </div>

      {/* All Categories Section with Fresh Arrivals Listed Firstly */}
      <section aria-labelledby="all-categories-heading" className="px-4 mt-8 space-y-8">
        <div>
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 id="all-categories-heading" className="font-bold text-lg sm:text-xl text-gray-900">
                All Categories
              </h2>
              <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                Fresh Arrivals first · {allCategories.length} categories · {products.length} total items
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {activeHomeCategory !== 'All' && (
                <button
                  type="button"
                  onClick={() => setActiveHomeCategory('All')}
                  className="text-xs font-semibold text-gray-600 hover:text-gray-900 underline whitespace-nowrap"
                >
                  Show All
                </button>
              )}
              <Link
                to="/browse"
                onClick={() => setSelectedCategory('All')}
                className="text-green-700 hover:text-green-800 text-xs sm:text-sm font-semibold flex items-center gap-1 whitespace-nowrap"
              >
                Full Catalog <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          {/* Interactive All Categories Grid (Fresh Arrivals is #1 first card) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {allCategories.map((cat) => {
              const visual = getCategoryVisual(cat);
              const count = productsByCategory[cat]?.length || 0;
              const isSelected = activeHomeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() =>
                    setActiveHomeCategory((prev) => (prev === cat ? 'All' : cat))
                  }
                  className={`text-left p-3 rounded-2xl border transition-all flex items-center gap-3 ${
                    isSelected
                      ? 'bg-green-50 border-green-500 shadow-xs'
                      : 'bg-white border-gray-200 hover:border-green-300 hover:bg-gray-50/70'
                  }`}
                >
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0 ${visual.surface}`}
                  >
                    {visual.emoji}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-gray-900 truncate">{cat}</p>
                    <p className="text-xs text-gray-500 tabular-nums mt-0.5">
                      {count} {count === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Product Shelves: Fresh Arrivals first, followed by all other categories below */}
        {productsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map((skeleton) => (
              <div
                key={skeleton}
                className="bg-white rounded-2xl p-3 border border-gray-100 h-56 animate-pulse"
              >
                <div className="bg-gray-100 h-28 rounded-xl mb-3"></div>
                <div className="bg-gray-100 h-4 w-2/3 rounded mb-2"></div>
                <div className="bg-gray-100 h-3 w-1/2 rounded"></div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-3 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto">
              <Sprout size={24} />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">
                Store Catalog Awaiting Setup
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                No vegetables have been published to Firestore yet. Store Admin can
                publish the initial catalog or add items in the Admin Portal.
              </p>
            </div>
            <Link
              to="/admin/login"
              className="inline-flex items-center gap-1.5 text-xs font-bold bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition"
            >
              <Shield size={14} />
              Open Admin Portal
            </Link>
          </div>
        ) : (
          <div className="space-y-9">
            {visibleCategorySections.map((cat) => {
              const catProducts = productsByCategory[cat] || [];
              const visual = getCategoryVisual(cat);
              const browseTarget = cat === FRESH_ARRIVALS_CATEGORY ? 'All' : cat;

              return (
                <div key={cat} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${visual.surface}`}
                        aria-hidden="true"
                      >
                        {visual.emoji}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-bold text-base sm:text-lg text-gray-900 truncate">{cat}</h3>
                        <p className="text-xs text-gray-500 truncate">
                          {visual.tagline} · <span className="tabular-nums">{catProducts.length} items</span>
                        </p>
                      </div>
                    </div>

                    <Link
                      to="/browse"
                      onClick={() => setSelectedCategory(browseTarget)}
                      className="text-green-700 hover:text-green-800 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      {cat === FRESH_ARRIVALS_CATEGORY ? 'See All' : `Explore ${cat}`}{' '}
                      <ArrowRight size={13} />
                    </Link>
                  </div>

                  {catProducts.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                      {catProducts.map((product) => (
                        <div key={`${cat}-${product.id}`}>
                          <ProductCard product={product} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-3 text-xs text-gray-500">
                      <span>No items currently listed under {cat}.</span>
                      <Link
                        to="/browse"
                        onClick={() => setSelectedCategory('All')}
                        className="text-green-700 font-semibold hover:underline shrink-0"
                      >
                        View all produce
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
