import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatCurrency } from '../lib/utils';
import { CheckCircle, Circle, ArrowLeft, Phone, MapPin, Star } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const STEPS = [
  { id: 'placed', label: 'Order Placed' },
  { id: 'packed', label: 'Packed' },
  { id: 'out_for_delivery', label: 'Out for Delivery' },
  { id: 'delivered', label: 'Delivered' }
];

export const OrderDetails = () => {
  const { id } = useParams();
  const { orders } = useAuth();
  const { showToast } = useToast();
  const order = orders.find(o => o.id === id);

  if (!order) return <div>Order not found</div>;

  // Map the current status to the index in the STEPS array
  const currentStepIndex = STEPS.findIndex(s => s.id === order.status);

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link to="/orders" className="p-2 hover:bg-gray-100 rounded-full">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">Order #{order.id}</h1>
      </div>

      {/* Tracking Timeline */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
        <h2 className="font-semibold mb-4">Order Status</h2>
        <div className="relative">
          <div className="absolute left-[11px] top-2 bottom-2 w-[2px] bg-gray-100"></div>
          <div className="space-y-6 relative">
            {STEPS.map((step, index) => {
              const isCompleted = index <= currentStepIndex;
              const isCurrent = index === currentStepIndex;
              
              return (
                <div key={step.id} className="flex items-start gap-4">
                  <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center ${
                    isCompleted ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                    {isCompleted ? <CheckCircle size={14} /> : <Circle size={10} />}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isCompleted ? 'text-gray-800' : 'text-gray-400'}`}>
                      {step.label}
                    </p>
                    {isCurrent && order.status !== 'delivered' && <p className="text-xs text-green-600 mt-1 animate-pulse">In Progress...</p>}
                    {isCompleted && !isCurrent && <p className="text-xs text-gray-500 mt-1">Completed</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {order.status === 'delivered' && (
          <div className="mt-6 pt-4 border-t">
            <button 
              onClick={() => showToast('Thank you for your rating!', 'success')}
              className="w-full py-2 border border-green-600 text-green-600 rounded-lg font-medium hover:bg-green-50 flex items-center justify-center gap-2"
            >
              <Star size={18} />
              Rate this Order
            </button>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
        <h2 className="font-semibold mb-4">Items</h2>
        <div className="space-y-4">
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600">
                  {item.quantity}x
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{item.name}</p>
                  <p className="text-xs text-gray-500">{item.selectedWeight}g</p>
                </div>
              </div>
              <p className="text-sm font-medium">
                {formatCurrency((item.pricePerKg / 1000) * item.selectedWeight * item.quantity)}
              </p>
            </div>
          ))}
          <div className="border-t pt-3 mt-3 flex justify-between font-bold">
            <span>Total</span>
            <span>{formatCurrency(order.total)}</span>
          </div>
        </div>
      </div>

      {/* Delivery Info */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="font-semibold mb-4">Delivery Details</h2>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <MapPin className="text-gray-400 mt-1" size={18} />
            <div>
              <p className="font-medium text-sm">Address</p>
              <p className="text-sm text-gray-600">{order.address.street}, {order.address.city}, {order.address.zip}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Phone className="text-gray-400 mt-1" size={18} />
            <div>
              <p className="font-medium text-sm">Phone</p>
              <p className="text-sm text-gray-600">9876543210</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
