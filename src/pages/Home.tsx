import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowRight, Menu, Shield, Sprout } from 'lucide-react';
import { CATEGORIES } from '../lib/data';
import { useStore } from '../context/StoreContext';
import { ProductCard } from '../components/ProductCard';
import { Sidebar } from '../components/Sidebar';
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

export const Home = () => {
  const { setSelectedCategory, products, productsLoading, coupons } = useStore();
  const { showToast } = useToast();
  const featuredProducts = products.slice(0, 4);
  const [currentBanner, setCurrentBanner] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
    <div className="pb-24">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {/* Hero Section */}
      <div className="bg-green-600 text-white p-6 rounded-b-3xl shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full -ml-10 -mb-10"></div>

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
            >
              <Menu size={24} className="text-white" />
            </button>
            <h1 className="text-xl font-bold">FreshVeggie</h1>
            <div className="w-10"></div>
          </div>

          <h1 className="text-3xl font-bold mb-2">Fresh Vegetables</h1>
          <p className="text-green-100 mb-6">
            Delivered directly from farm to your doorstep.
          </p>

          <Link
            to="/browse"
            className="bg-white text-green-700 w-full py-3 rounded-xl flex items-center px-4 gap-3 shadow-sm"
          >
            <Search size={20} className="text-gray-400" />
            <span className="text-gray-400">Search for vegetables...</span>
          </Link>
        </div>
      </div>

      {/* Categories */}
      <div className="px-4 mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg text-gray-800">Categories</h2>
          <Link
            to="/browse"
            className="text-green-600 text-sm font-medium flex items-center gap-1"
          >
            See All <ArrowRight size={14} />
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {CATEGORIES.slice(1, 5).map((cat, i) => (
            <Link
              to="/browse"
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className="flex flex-col items-center gap-2"
            >
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl shadow-sm ${
                  i % 2 === 0
                    ? 'bg-green-50 text-green-600'
                    : 'bg-orange-50 text-orange-600'
                }`}
              >
                {cat === 'Fruits'
                  ? '🍎'
                  : cat === 'Leafy Greens'
                  ? '🥬'
                  : cat === 'Root Vegetables'
                  ? '🥕'
                  : '🥦'}
              </div>
              <span className="text-xs font-medium text-gray-600 text-center leading-tight">
                {cat}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Live Offers Slider (backed by Firestore coupons) */}
      <div className="px-4 mt-8">
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
                      onClick={() => {
                        try {
                          navigator.clipboard?.writeText(banner.code);
                          showToast(
                            `Coupon ${banner.code} copied! Apply at checkout.`,
                            'success'
                          );
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
              className="bg-green-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl shrink-0 hover:bg-green-700 transition"
            >
              Browse
            </Link>
          </div>
        )}
      </div>

      {/* Featured Products */}
      <div className="px-4 mt-8">
        <h2 className="font-bold text-lg text-gray-800 mb-4">Fresh Arrivals</h2>

        {productsLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((skeleton) => (
              <div
                key={skeleton}
                className="bg-white rounded-2xl p-3 border border-gray-100 h-52 animate-pulse"
              >
                <div className="bg-gray-100 h-28 rounded-xl mb-3"></div>
                <div className="bg-gray-100 h-4 w-2/3 rounded mb-2"></div>
                <div className="bg-gray-100 h-3 w-1/2 rounded"></div>
              </div>
            ))}
          </div>
        ) : featuredProducts.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {featuredProducts.map((product) => (
              <div key={product.id}>
                <ProductCard product={product} />
              </div>
            ))}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
};
