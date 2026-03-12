import React from 'react';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import { Minus, Plus, Trash2, ArrowRight } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { Link, useNavigate } from 'react-router-dom';

export const Cart = () => {
  const { cart, updateQuantity, removeFromCart, cartTotal } = useStore();
  const { user } = useAuth();
  const navigate = useNavigate();

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
    <div className="pb-24 pt-4 px-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Shopping Cart</h1>
      
      <div className="space-y-4">
        {cart.map((item) => {
          const itemPrice = (item.pricePerKg / 1000) * item.selectedWeight;
          
          return (
            <div key={`${item.id}-${item.selectedWeight}`} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex gap-4">
              <img src={item.image} alt={item.name} className="w-20 h-20 object-cover rounded-lg" />
              
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-gray-800">{item.name}</h3>
                    <p className="text-sm text-gray-500">{item.selectedWeight < 1000 ? `${item.selectedWeight}g` : '1kg'} Pack</p>
                  </div>
                  <button 
                    onClick={() => removeFromCart(item.id, item.selectedWeight)}
                    className="text-gray-400 hover:text-red-500"
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
                      className="w-7 h-7 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-green-600"
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

      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-100 p-4 md:static md:bg-transparent md:border-0 md:mt-8">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white md:p-6 md:rounded-2xl md:shadow-sm md:border md:border-gray-100">
            <div className="flex justify-between items-center mb-4 text-lg font-bold">
              <span>Total</span>
              <span>{formatCurrency(cartTotal)}</span>
            </div>
            
            <button 
              onClick={() => navigate('/checkout')}
              className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 active:scale-95 transition-all"
            >
              Proceed to Checkout
              <ArrowRight size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
