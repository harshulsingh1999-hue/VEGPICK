import React from 'react';
import { useStore } from '../context/StoreContext';
import { Plus, Minus, Star } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { Product } from '../lib/data';

import { useToast } from '../context/ToastContext';

import { Link } from 'react-router-dom';

export const ProductCard = ({ product }: { product: Product }) => {
  const { addToCart } = useStore();
  const { showToast } = useToast();
  const [selectedWeight, setSelectedWeight] = React.useState(1000); // Default 1kg

  const price = (product.pricePerKg / 1000) * selectedWeight;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigation
    e.stopPropagation(); // Prevent bubbling to Link
    addToCart(product, selectedWeight);
    showToast(`Added ${product.name} (${selectedWeight < 1000 ? `${selectedWeight}g` : '1kg'}) to cart`, 'success');
  };

  return (
    <Link to={`/product/${product.id}`} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col block">
      <div className="relative w-full aspect-square bg-gray-50 p-2">
        <img 
          src={product.image} 
          alt={product.name}
          className="w-full h-full object-contain mix-blend-multiply"
        />
        {!product.available && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-bold">
            Out of Stock
          </div>
        )}
      </div>
      
      <div className="p-3 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-1">
          <div>
            <h3 className="font-semibold text-gray-800">{product.name}</h3>
            <p className="text-xs text-gray-500">{product.category}</p>
          </div>
          <div className="text-right">
            <span className="font-bold text-green-700">{formatCurrency(price)}</span>
            <p className="text-[10px] text-gray-400">per {selectedWeight < 1000 ? `${selectedWeight}g` : '1kg'}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 mb-3">
          <div className="flex items-center bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-bold text-green-700">
            {product.rating} <Star size={8} className="fill-green-700 ml-0.5" />
          </div>
          <span className="text-[10px] text-gray-400">({product.reviews} reviews)</span>
        </div>

        <div className="mt-auto space-y-3">
          <div className="flex gap-2 text-xs">
            {[250, 500, 1000].map(w => (
              <button
                key={w}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedWeight(w); }}
                className={`flex-1 py-1 rounded border ${
                  selectedWeight === w 
                    ? 'bg-green-50 border-green-500 text-green-700' 
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                {w < 1000 ? `${w}g` : '1kg'}
              </button>
            ))}
          </div>

          <button
            onClick={handleAddToCart}
            disabled={!product.available}
            className="w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 active:scale-95 transition-all disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add to Cart
          </button>
        </div>
      </div>
    </Link>
  );
};
