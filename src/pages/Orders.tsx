import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatCurrency } from '../lib/utils';
import { Package, ChevronRight, ChevronDown, Clock, MapPin, CheckCircle, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';

const STEPS = [
  { id: 'placed', label: 'Order Placed' },
  { id: 'packed', label: 'Packed' },
  { id: 'out_for_delivery', label: 'Out for Delivery' },
  { id: 'delivered', label: 'Delivered' }
];

export const Orders = () => {
  const { orders, user } = useAuth();
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] px-4 text-center">
        <p className="text-gray-500 mb-4">Please login to view your orders</p>
        <Link to="/profile" className="bg-green-600 text-white px-6 py-2 rounded-lg">Login</Link>
      </div>
    );
  }

  const activeOrders = orders
    .filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
  const pastOrders = orders
    .filter(o => o.status === 'delivered' || o.status === 'cancelled')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const displayedOrders = activeTab === 'active' ? activeOrders : pastOrders;

  const toggleOrder = (orderId: string) => {
    setExpandedOrderId(prev => prev === orderId ? null : orderId);
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">My Orders</h1>
      
      {/* Tabs */}
      <div className="flex gap-4 mb-6">
        <button 
          onClick={() => { setActiveTab('active'); setExpandedOrderId(null); }}
          className={`flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${activeTab === 'active' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}
        >
          Active Orders ({activeOrders.length})
        </button>
        <button 
          onClick={() => { setActiveTab('history'); setExpandedOrderId(null); }}
          className={`flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${activeTab === 'history' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}
        >
          History ({pastOrders.length})
        </button>
      </div>

      <div className="space-y-4">
        {displayedOrders.length === 0 ? (
          <div className="text-center py-10 text-gray-500">
            <Package className="mx-auto text-gray-300 mb-4" size={48} />
            <p>No {activeTab} orders found</p>
          </div>
        ) : (
          displayedOrders.map(order => {
            const isExpanded = expandedOrderId === order.id;
            const currentStepIndex = STEPS.findIndex(s => s.id === order.status);

            return (
              <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                {/* Order Header (Clickable) */}
                <button 
                  onClick={() => toggleOrder(order.id)}
                  className="w-full p-4 text-left hover:bg-gray-50 transition-colors flex flex-col"
                >
                  <div className="flex justify-between items-start mb-3 w-full">
                    <div>
                      <p className="font-bold text-gray-800">Order #{order.id}</p>
                      <p className="text-xs text-gray-500">{new Date(order.date).toLocaleDateString()}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      order.status === 'delivered' ? 'bg-green-100 text-green-700' : 
                      order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {order.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>

                  {!isExpanded && (
                    <div className="flex gap-2 overflow-hidden mb-3 w-full">
                      {order.items.slice(0, 3).map((item, i) => (
                        <img key={i} src={item.image} alt={item.name} className="w-12 h-12 rounded object-cover bg-gray-50 border border-gray-100" />
                      ))}
                      {order.items.length > 3 && (
                        <div className="w-12 h-12 rounded bg-gray-50 flex items-center justify-center text-xs text-gray-500 font-medium border border-gray-100">
                          +{order.items.length - 3}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-3 border-t border-gray-50 w-full">
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <Clock size={14} />
                      <span>{order.deliverySlot}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-800">{formatCurrency(order.total)}</span>
                      {isExpanded ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
                    </div>
                  </div>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="p-4 border-t border-gray-100 bg-gray-50/50 space-y-6 animate-in slide-in-from-top-2 duration-200">
                    
                    {/* Status Timeline */}
                    {order.status !== 'cancelled' && (
                      <div>
                        <h3 className="text-sm font-bold text-gray-800 mb-3">Tracking</h3>
                        <div className="relative pl-2">
                          <div className="absolute left-[17px] top-2 bottom-2 w-[2px] bg-gray-200"></div>
                          <div className="space-y-4 relative">
                            {STEPS.map((step, index) => {
                              const isCompleted = index <= currentStepIndex;
                              const isCurrent = index === currentStepIndex;
                              
                              return (
                                <div key={step.id} className="flex items-start gap-3">
                                  <div className={`relative z-10 w-5 h-5 rounded-full flex items-center justify-center ${
                                    isCompleted ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-400'
                                  }`}>
                                    {isCompleted ? <CheckCircle size={12} /> : <Circle size={8} />}
                                  </div>
                                  <div>
                                    <p className={`text-xs font-medium ${isCompleted ? 'text-gray-800' : 'text-gray-400'}`}>
                                      {step.label}
                                    </p>
                                    {isCurrent && order.status !== 'delivered' && <p className="text-[10px] text-green-600 animate-pulse">In Progress...</p>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Items List */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 mb-3">Items</h3>
                      <div className="space-y-3">
                        {order.items.map((item, i) => (
                          <div key={i} className="flex items-center gap-3 bg-white p-2 rounded-lg border border-gray-100">
                            <img src={item.image} alt={item.name} className="w-10 h-10 rounded object-cover" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-800">{item.name}</p>
                              <p className="text-xs text-gray-500">{item.selectedWeight}g × {item.quantity}</p>
                            </div>
                            <p className="text-sm font-bold text-gray-800">
                              {formatCurrency((item.pricePerKg / 1000) * item.selectedWeight * item.quantity)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Delivery Address */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 mb-2">Delivery Address</h3>
                      <div className="flex items-start gap-2 bg-white p-3 rounded-lg border border-gray-100">
                        <MapPin className="text-gray-400 shrink-0 mt-0.5" size={16} />
                        <div>
                          <p className="text-sm text-gray-600">{order.address.street}, {order.address.city}, {order.address.zip}</p>
                        </div>
                      </div>
                    </div>

                    {/* Payment Info */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 mb-2">Payment</h3>
                      <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-100">
                        <span className="text-sm text-gray-600">Method</span>
                        <span className="text-sm font-bold text-gray-800 uppercase">{order.paymentMethod}</span>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
