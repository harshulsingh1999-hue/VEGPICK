import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { formatCurrency, getProductFrontImage, getProductImages } from '../lib/utils';
import {
  ArrowLeft,
  Star,
  ShoppingCart,
  Truck,
  ShieldCheck,
  Clock,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export const ProductDetails = () => {
  const { id } = useParams();
  const { products, addToCart } = useStore();
  const { showToast } = useToast();
  const [selectedWeight, setSelectedWeight] = useState(1000);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const product = products.find((p) => p.id === id);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [id]);

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-gray-500 mb-4">Product not found</p>
        <Link to="/home" className="text-green-600 font-medium">
          Back to Home
        </Link>
      </div>
    );
  }

  const galleryImages = getProductImages(product);
  const safeIndex = activeImageIndex < galleryImages.length ? activeImageIndex : 0;
  const activeImage = galleryImages[safeIndex] || getProductFrontImage(product);
  const frontImage = galleryImages[0] || getProductFrontImage(product);
  const price = (product.pricePerKg / 1000) * selectedWeight;

  const handleAddToCart = () => {
    addToCart({ ...product, image: frontImage }, selectedWeight);
    showToast(`Added ${product.name} to cart`, 'success');
  };

  return (
    <div className="pb-24 bg-white min-h-screen max-w-4xl mx-auto">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 p-4 flex justify-between items-center z-20 max-w-4xl mx-auto pointer-events-none">
        <Link
          to="/home"
          aria-label="Back to Home"
          className="w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-sm pointer-events-auto hover:bg-white transition"
        >
          <ArrowLeft size={20} className="text-gray-700" />
        </Link>
        <Link
          to="/cart"
          aria-label="View Cart"
          className="w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-sm pointer-events-auto hover:bg-white transition"
        >
          <ShoppingCart size={20} className="text-gray-700" />
        </Link>
      </div>

      {/* Multi-Image Gallery (First image is the product front image) */}
      <div className="bg-gray-50">
        <div className="w-full aspect-square sm:aspect-[4/3] max-h-[420px] relative flex items-center justify-center overflow-hidden">
          <img
            src={activeImage}
            alt={`${product.name} view ${safeIndex + 1}`}
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain mix-blend-multiply p-8 transition-opacity duration-200"
          />

          {galleryImages.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={() =>
                  setActiveImageIndex((prev) =>
                    prev === 0 ? galleryImages.length - 1 : prev - 1
                  )
                }
                className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 border border-gray-200 flex items-center justify-center text-gray-700 shadow-xs hover:bg-white transition"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={() =>
                  setActiveImageIndex((prev) => (prev + 1) % galleryImages.length)
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 border border-gray-200 flex items-center justify-center text-gray-700 shadow-xs hover:bg-white transition"
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}

          {galleryImages.length > 0 && (
            <div className="absolute bottom-8 right-4 bg-white/90 border border-gray-200 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-700 tabular-nums">
              {safeIndex + 1} / {galleryImages.length}
              {safeIndex === 0 ? ' · Front' : ''}
            </div>
          )}
        </div>

        {/* Thumbnails Strip */}
        {galleryImages.length > 0 && (
          <div className="px-4 pb-8 pt-1 flex gap-2.5 overflow-x-auto no-scrollbar">
            {galleryImages.map((imgUrl, idx) => {
              const isActive = idx === safeIndex;
              return (
                <button
                  key={`${imgUrl}-${idx}`}
                  type="button"
                  onClick={() => setActiveImageIndex(idx)}
                  aria-label={idx === 0 ? 'Front product image' : `Product image ${idx + 1}`}
                  className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 bg-white shrink-0 transition ${
                    isActive
                      ? 'border-green-600 shadow-xs'
                      : 'border-gray-200 opacity-75 hover:opacity-100'
                  }`}
                >
                  <img
                    src={imgUrl}
                    alt={`${product.name} thumbnail ${idx + 1}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  {idx === 0 && (
                    <span className="absolute bottom-0 inset-x-0 bg-green-700/90 text-white text-[9px] font-bold text-center py-0.5 leading-none">
                      Front
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pt-6 -mt-5 bg-white rounded-t-3xl relative z-10 border-t border-gray-100">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
            <p className="text-gray-500 text-sm">{product.category}</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 bg-green-50 px-2 py-1 rounded-lg">
              <span className="font-bold text-green-700 tabular-nums">{product.rating}</span>
              <Star size={14} className="fill-green-700 text-green-700" />
            </div>
            <p className="text-xs text-gray-400 mt-1 tabular-nums">{product.reviews} reviews</p>
          </div>
        </div>

        <div className="flex items-baseline gap-2 mb-6">
          <span className="text-3xl font-bold text-green-600 tabular-nums">
            {formatCurrency(price)}
          </span>
          <span className="text-gray-400 text-sm">
            / {selectedWeight < 1000 ? `${selectedWeight}g` : '1kg'}
          </span>
        </div>

        {/* Weight Selection */}
        <div className="mb-8">
          <h3 className="font-semibold mb-3 text-gray-800">Select Quantity</h3>
          <div className="flex gap-3">
            {[250, 500, 1000].map((w) => (
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
            {product.description?.trim()
              ? product.description
              : `Fresh and high-quality ${product.name.toLowerCase()} sourced directly from local farms. Rich in vitamins and minerals, perfect for your daily cooking needs.`}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <Truck className="text-green-600 shrink-0" size={20} />
              <div>
                <p className="text-xs font-bold text-gray-800">Fast Delivery</p>
                <p className="text-[11px] text-gray-500">Within same-day slots</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <ShieldCheck className="text-green-600 shrink-0" size={20} />
              <div>
                <p className="text-xs font-bold text-gray-800">Quality Check</p>
                <p className="text-[11px] text-gray-500">Hand-sorted harvest</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <Clock className="text-green-600 shrink-0" size={20} />
              <div>
                <p className="text-xs font-bold text-gray-800">Freshness</p>
                <p className="text-[11px] text-gray-500">Farm-to-door cold chain</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 flex items-center gap-4 z-20 max-w-4xl mx-auto">
        <div className="flex-1">
          <p className="text-xs text-gray-500">Total Price</p>
          <p className="text-xl font-bold text-gray-900 tabular-nums">{formatCurrency(price)}</p>
        </div>
        <button
          onClick={handleAddToCart}
          disabled={!product.available}
          className="flex-1 bg-green-600 text-white py-3.5 rounded-xl font-bold hover:bg-green-700 disabled:bg-gray-300 shadow-lg shadow-green-200 disabled:shadow-none transition"
        >
          {product.available ? 'Add to Cart' : 'Out of Stock'}
        </button>
      </div>
    </div>
  );
};
