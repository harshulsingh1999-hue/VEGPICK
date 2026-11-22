import React from 'react';
import { useStore } from '../context/StoreContext';
import { Minus, Plus, Trash2, ArrowRight, AlertTriangle } from 'lucide-react';
import { formatCurrency, getProductFrontImage } from '../lib/utils';
import { Link, useNavigate } from 'react-router-dom';

export const Cart = () => {
  const { cart, products, appSettings, updateQuantity, removeFromCart, cartTotal } = useStore();
  const navigate = useNavigate();

  const freeThreshold = appSettings?.freeDeliveryThreshold ?? 100;
  const storeOpen = appSettings?.storeOpen ?? true;
  const amountForFreeDelivery = Math.max(0, freeThreshold - cartTotal);

  const hasUnavailableItem = cart.some(item => {
    const liveProduct = products.find(p => p.id === item.id);
    return liveProduct && !liveProduct.available;
  });

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] px-4 text-center">
        <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-6">
          <Trash2 className="text-green-600" size={40} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Your cart is empty</h2>
        <p className="text-gray-500 mb-8">Looks like you haven't added any fresh veggies yet.</p>
        <Link to="/browse" className="bg-green-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-green-700">
          Start Shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-56 pt-4 px-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Shopping Cart</h1>

      {/* Dynamic Free Delivery Banner */}
      <div className={`p-3 rounded-xl mb-4 text-xs font-medium flex items-center justify-between ${
        amountForFreeDelivery === 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
      }`}>
        {amountForFreeDelivery === 0 ? (
          <span>You've unlocked FREE delivery on this order!</span>
        ) : (
          <span>Add items worth <strong>{formatCurrency(amountForFreeDelivery)}</strong> more for free delivery</span>
        )}
      </div>

      {!storeOpen && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl mb-4 flex items-center gap-2 text-xs font-medium">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Ordering is temporarily paused by Store Admin.</span>
        </div>
      )}
      
      <div className="space-y-4">
        {cart.map((item) => {
          const liveProduct = products.find(p => p.id === item.id);
          const isOutOfStock = liveProduct ? !liveProduct.available : false;
          const itemPrice = (item.pricePerKg / 1000) * item.selectedWeight;
          
          return (
            <div key={`${item.id}-${item.selectedWeight}`} className={`bg-white p-4 rounded-xl shadow-sm border flex gap-4 ${isOutOfStock ? 'border-red-200 bg-red-50/40' : 'border-gray-100'}`}>
              <img src={getProductFrontImage(item)} alt={item.name} referrerPolicy="no-referrer" className={`w-20 h-20 object-cover rounded-lg ${isOutOfStock ? 'grayscale opacity-70' : ''}`} />
              
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-gray-800">{item.name}</h3>
                    <p className="text-sm text-gray-500">
                      {item.selectedWeight >= 1000 ? `${item.selectedWeight / 1000}kg` : `${item.selectedWeight}g`} Pack
                    </p>
                    {isOutOfStock && (
                      <span className="inline-block mt-1 text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded">
                        Currently Out of Stock
                      </span>
                    )}
                  </div>
                  <button 
                    onClick={() => removeFromCart(item.id, item.selectedWeight)}
                    className="text-gray-400 hover:text-red-500 p-1"
                    aria-label="Remove item"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="flex justify-between items-end mt-4">
                  <div className="font-bold text-green-700">
                    {formatCurrency(itemPrice * item.quantity)}
                  </div>
                  
                  <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                    <button 
                      onClick={() => updateQuantity(item.id, item.selectedWeight, item.quantity - 1)}
                      className="w-7 h-7 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-green-600"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="text-sm font-medium w-4 text-center">{item.quantity}</span>
                    <button 
                      onClick={() => updateQuantity(item.id, item.selectedWeight, item.quantity + 1)}
                      disabled={isOutOfStock}
                      className="w-7 h-7 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-green-600 disabled:opacity-40"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-[calc(58px+env(safe-area-inset-bottom,0px))] left-0 right-0 bg-white border-t border-gray-100 p-4 z-40 shadow-lg md:static md:bg-transparent md:border-0 md:mt-8 md:shadow-none">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white md:p-6 md:rounded-2xl md:shadow-sm md:border md:border-gray-100">
            <div className="flex justify-between items-center mb-4 text-lg font-bold">
              <span>Total</span>
              <span>{formatCurrency(cartTotal)}</span>
            </div>
            
            {hasUnavailableItem ? (
              <p className="text-xs text-red-600 font-medium text-center mb-2">
                Please remove out-of-stock items to proceed to checkout.
              </p>
            ) : null}

            <button 
              onClick={() => navigate('/checkout')}
              disabled={hasUnavailableItem || !storeOpen}
              className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 active:scale-95 transition-all disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {!storeOpen ? 'Store Temporarily Closed' : 'Proceed to Checkout'}
              {storeOpen && <ArrowRight size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
