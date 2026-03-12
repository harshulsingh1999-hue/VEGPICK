import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDelivery } from '../context/DeliveryContext';
import { ShoppingBag, Truck, Shield } from 'lucide-react';

export const Welcome = () => {
  const { user } = useAuth();
  const { deliveryUser } = useDelivery();

  if (user) {
    return <Navigate to="/home" replace />;
  }
  
  if (deliveryUser) {
    return <Navigate to="/delivery/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-green-600 flex flex-col items-center justify-center p-4 text-white relative">
      <Link 
        to="/admin/login" 
        className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-sm font-medium"
      >
        <Shield size={16} />
        Admin
      </Link>

      <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-8 shadow-xl">
        <ShoppingBag size={48} className="text-green-600" />
      </div>
      
      <h1 className="text-4xl font-bold mb-2 text-center">FreshVeggie</h1>
      <p className="text-green-100 mb-12 text-center max-w-xs">Farm fresh vegetables delivered to your doorstep</p>

      <div className="w-full max-w-sm space-y-4">
        <Link 
          to="/profile"
          className="w-full bg-white text-green-600 py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg hover:bg-gray-50 transition-colors"
        >
          <ShoppingBag size={24} />
          Login as Customer
        </Link>
        
        <Link 
          to="/delivery/login"
          className="w-full bg-green-700 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg hover:bg-green-800 transition-colors border border-green-500"
        >
          <Truck size={24} />
          Login as Delivery Partner
        </Link>
      </div>
    </div>
  );
};
