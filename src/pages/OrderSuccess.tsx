import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';

export const OrderSuccess = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 text-center bg-white">
      <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6 animate-bounce">
        <CheckCircle className="text-green-600" size={48} />
      </div>
      <h1 className="text-3xl font-bold text-gray-800 mb-2">Order Placed!</h1>
      <p className="text-gray-500 mb-8 max-w-xs">Your fresh veggies will be delivered to your doorstep soon.</p>
      
      <div className="space-y-3 w-full max-w-xs">
        <Link to="/orders" className="block w-full bg-green-600 text-white py-3 rounded-xl font-medium hover:bg-green-700">
          Track Order
        </Link>
        <Link to="/home" className="block w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200">
          Continue Shopping
        </Link>
      </div>
    </div>
  );
};
