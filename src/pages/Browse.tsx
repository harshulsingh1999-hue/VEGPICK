import React from 'react';
import { useStore } from '../context/StoreContext';
import { CATEGORIES } from '../lib/data';
import { ProductCard } from '../components/ProductCard';
import { Search, Filter } from 'lucide-react';

export const Browse = () => {
  const { 
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search vegetables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {CATEGORIES.map(cat => (
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

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
        {filteredProducts.map(product => (
          <div key={product.id}>
            <ProductCard product={product} />
          </div>
        ))}
      </div>

      {filteredProducts.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <p>No vegetables found matching your criteria.</p>
        </div>
      )}
    </div>
  );
};
