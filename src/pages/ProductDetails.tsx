import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { formatCurrency } from '../lib/utils';
import { ArrowLeft, Star, ShoppingCart, Truck, ShieldCheck, Clock } from 'lucide-react';

export const ProductDetails = () => {
  const { id } = useParams();
  const { products, addToCart } = useStore();
  const { showToast } = useToast();
  const [selectedWeight, setSelectedWeight] = useState(1000);
  
  const product = products.find(p => p.id === id);

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-gray-500 mb-4">Product not found</p>
        <Link to="/home" className="text-green-600 font-medium">Back to Home</Link>
      </div>
    );
  }

  const price = (product.pricePerKg / 1000) * selectedWeight;

  const handleAddToCart = () => {
    addToCart(product, selectedWeight);
    showToast(`Added ${product.name} to cart`, 'success');
  };

  return (
    <div className="pb-24 bg-white min-h-screen">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 p-4 flex justify-between items-center z-10">
        <Link to="/home" className="w-10 h-10 bg-white/80 backdrop-blur rounded-full flex items-center justify-center shadow-sm">
          <ArrowLeft size={20} className="text-gray-700" />
        </Link>
        <Link to="/cart" className="w-10 h-10 bg-white/80 backdrop-blur rounded-full flex items-center justify-center shadow-sm">
          <ShoppingCart size={20} className="text-gray-700" />
        </Link>
      </div>

      {/* Image Gallery */}
      <div className="w-full aspect-square bg-gray-50 relative">
        <img 
          src={product.image} 
          alt={product.name}
          className="w-full h-full object-contain mix-blend-multiply p-8"
        />
      </div>

      {/* Content */}
      <div className="px-4 pt-6 -mt-6 bg-white rounded-t-3xl relative z-0">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
            <p className="text-gray-500">{product.category}</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 bg-green-50 px-2 py-1 rounded-lg">
              <span className="font-bold text-green-700">{product.rating}</span>
              <Star size={14} className="fill-green-700 text-green-700" />
            </div>
            <p className="text-xs text-gray-400 mt-1">{product.reviews} reviews</p>
          </div>
        </div>

        <div className="flex items-baseline gap-2 mb-6">
          <span className="text-3xl font-bold text-green-600">{formatCurrency(price)}</span>
          <span className="text-gray-400 text-sm">/ {selectedWeight < 1000 ? `${selectedWeight}g` : '1kg'}</span>
        </div>

        {/* Weight Selection */}
        <div className="mb-8">
          <h3 className="font-semibold mb-3 text-gray-800">Select Quantity</h3>
          <div className="flex gap-3">
            {[250, 500, 1000].map(w => (
              <button
                key={w}
                onClick={() => setSelectedWeight(w)}
                className={`flex-1 py-3 rounded-xl border-2 font-medium transition-all ${
                  selectedWeight === w 
                    ? 'border-green-500 bg-green-50 text-green-700' 
                    : 'border-gray-100 text-gray-600 hover:border-green-200'
                }`}
              >
                {w < 1000 ? `${w}g` : '1kg'}
              </button>
            ))}
          </div>
        </div>

        {/* Product Details */}
        <div className="mb-8 space-y-4">
          <h3 className="font-semibold text-gray-800">Product Details</h3>
          <p className="text-gray-600 leading-relaxed text-sm">
            Fresh and high-quality {product.name.toLowerCase()} sourced directly from local farms. 
            Rich in vitamins and minerals, perfect for your daily cooking needs. 
            We ensure strict quality checks before delivery.
          </p>
          
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <Truck className="text-green-600" size={20} />
              <div>
                <p className="text-xs font-bold text-gray-800">Fast Delivery</p>
                <p className="text-[10px] text-gray-500">Within 24 hours</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <ShieldCheck className="text-green-600" size={20} />
              <div>
                <p className="text-xs font-bold text-gray-800">Quality Check</p>
                <p className="text-[10px] text-gray-500">100% Organic</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <Clock className="text-green-600" size={20} />
              <div>
                <p className="text-xs font-bold text-gray-800">Freshness</p>
                <p className="text-[10px] text-gray-500">Guaranteed</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 flex items-center gap-4 z-20">
        <div className="flex-1">
          <p className="text-xs text-gray-500">Total Price</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(price)}</p>
        </div>
        <button 
          onClick={handleAddToCart}
          disabled={!product.available}
          className="flex-1 bg-green-600 text-white py-3.5 rounded-xl font-bold hover:bg-green-700 disabled:bg-gray-300 shadow-lg shadow-green-200"
        >
          Add to Cart
        </button>
      </div>
    </div>
  );
};
