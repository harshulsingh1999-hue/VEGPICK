import React from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { CATEGORIES } from '../lib/data';
import { ProductCard } from '../components/ProductCard';
import { Search, Sprout, Shield } from 'lucide-react';

export const Browse = () => {
  const {
    products,
    productsLoading,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    filteredProducts
  } = useStore();

  return (
    <div className="pb-20 pt-4 px-4 max-w-7xl mx-auto">
      <div className="sticky top-0 bg-white/80 backdrop-blur-md py-4 z-10 space-y-4">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={20}
          />
          <input
            type="text"
            placeholder="Search vegetables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === cat
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {productsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <div
              key={idx}
              className="bg-white rounded-2xl p-3 border border-gray-100 h-52 animate-pulse"
            >
              <div className="bg-gray-100 h-28 rounded-xl mb-3"></div>
              <div className="bg-gray-100 h-4 w-2/3 rounded mb-2"></div>
              <div className="bg-gray-100 h-3 w-1/2 rounded"></div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center max-w-md mx-auto mt-10 space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto">
            <Sprout size={24} />
          </div>
          <h3 className="font-bold text-gray-800">Catalog Not Yet Published</h3>
          <p className="text-xs text-gray-500">
            The Firestore product catalog is currently empty. Sign in to the Admin
            Portal to add fresh vegetables or initialize the catalog.
          </p>
          <Link
            to="/admin/login"
            className="inline-flex items-center gap-1.5 text-xs font-bold bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-700 transition"
          >
            <Shield size={14} />
            Go to Admin Portal
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
            {filteredProducts.map((product) => (
              <div key={product.id}>
                <ProductCard product={product} />
              </div>
            ))}
          </div>

          {filteredProducts.length === 0 && (
            <div className="text-center py-20 text-gray-500 space-y-3">
              <p>No vegetables found matching your criteria.</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                }}
                className="text-xs font-bold text-green-600 hover:underline"
              >
                Reset Search & Filters
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
