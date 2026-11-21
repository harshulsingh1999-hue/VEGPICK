import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { formatCurrency } from '../lib/utils';
import { Package, ChevronRight, ChevronDown, Clock, MapPin, CheckCircle, Circle, RefreshCw, XCircle, Truck, ArrowRight, KeyRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PhoneOtpAuthCard } from '../components/PhoneOtpAuthCard';

const STEPS = [
  { id: 'placed', label: 'Order Placed' },
  { id: 'packed', label: 'Packed' },
  { id: 'out_for_delivery', label: 'Out for Delivery' },
  { id: 'delivered', label: 'Delivered' }
];

export const Orders = () => {
  const { orders, user, firebaseUser, authReady, ensureCustomerProfile, updateOrderStatus } = useAuth();
  const { addItemsToCart } = useStore();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && firebaseUser && !user) {
      ensureCustomerProfile().catch(() => {
        // ignore if profile initializes cleanly on next snapshot
      });
    }
  }, [authReady, firebaseUser, user, ensureCustomerProfile]);

  if (!authReady || (firebaseUser && !user)) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!firebaseUser || !user) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-8 max-w-md mx-auto">
        <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-4 shadow-inner">
          <Package size={32} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-1.5 text-center">Track Your Orders</h2>
        <p className="text-gray-500 text-xs mb-6 text-center max-w-xs">
          Verify your mobile number via Firebase SMS OTP to view live GPS tracking, delivery PINs, and order history.
        </p>

        <div className="w-full mb-5">
          <PhoneOtpAuthCard createCustomerProfile />
        </div>

        <Link to="/browse" className="text-xs font-semibold text-green-600 hover:underline">
          Continue Browsing Store
        </Link>
      </div>
    );
  }

  const activeOrders = orders
    .filter((o) => o.status !== 'delivered' && o.status !== 'cancelled')
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  const pastOrders = orders
    .filter((o) => o.status === 'delivered' || o.status === 'cancelled')
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  const displayedOrders = activeTab === 'active' ? activeOrders : pastOrders;

  const toggleOrder = (orderId: string) => {
    setExpandedOrderId((prev) => (prev === orderId ? null : orderId));
  };

  const handleCancelOrder = async (orderId: string) => {
    setCancellingOrderId(orderId);
    try {
      await updateOrderStatus(orderId, 'cancelled');
      showToast(`Order #${orderId} has been cancelled.`, 'info');
    } catch {
      showToast('Unable to cancel order right now. Please try again.', 'error');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const handleReorder = (order: typeof orders[0]) => {
    addItemsToCart(
      order.items.map((item) => ({
        product: item,
        weight: item.selectedWeight,
        quantity: item.quantity || 1
      }))
    );
    showToast(`Added ${order.items.length} items to your cart!`, 'success');
    navigate('/cart');
  };

  return (
    <div className="pb-28 pt-4 px-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Orders</h1>
          <p className="text-xs text-gray-500">{user.name} {user.phone ? `• ${user.phone}` : ''}</p>
        </div>
        <Link to="/browse" className="text-xs font-bold text-green-600 hover:underline flex items-center gap-1">
          Shop More <ArrowRight size={14} />
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => { setActiveTab('active'); setExpandedOrderId(null); }}
          className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${
            activeTab === 'active'
              ? 'bg-green-600 text-white shadow-md shadow-green-600/20'
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          Active Orders ({activeOrders.length})
        </button>
        <button
          onClick={() => { setActiveTab('history'); setExpandedOrderId(null); }}
          className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${
            activeTab === 'history'
              ? 'bg-green-600 text-white shadow-md shadow-green-600/20'
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          History ({pastOrders.length})
        </button>
      </div>

      <div className="space-y-4">
        {displayedOrders.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <Package className="mx-auto text-gray-300 mb-3" size={48} />
            <h3 className="font-bold text-gray-800 text-base mb-1">No {activeTab} orders</h3>
            <p className="text-xs text-gray-500 mb-5">
              {activeTab === 'active'
                ? "You don't have any active deliveries right now."
                : 'Your past delivered and cancelled orders will appear here.'}
            </p>
            <Link
              to="/browse"
              className="inline-flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm hover:bg-green-700 transition"
            >
              Browse Fresh Vegetables
            </Link>
          </div>
        ) : (
          displayedOrders.map((order) => {
            const isExpanded = expandedOrderId === order.id;
            const currentStepIndex = STEPS.findIndex((s) => s.id === order.status);

            return (
              <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                <button
                  onClick={() => toggleOrder(order.id)}
                  className="w-full p-4 text-left hover:bg-gray-50/70 transition-colors flex flex-col"
                >
                  <div className="flex justify-between items-start mb-3 w-full">
                    <div>
                      <p className="font-bold text-gray-900 text-base">Order #{order.id}</p>
                      <p className="text-xs text-gray-400">{new Date(order.date).toLocaleDateString()} • {order.deliverySlot}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                      order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {order.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>

                  {!isExpanded && (
                    <div className="flex gap-2 overflow-hidden mb-3 w-full items-center">
                      {order.items.slice(0, 3).map((item, i) => (
                        <img
                          key={i}
                          src={item.image}
                          alt={item.name}
                          className="w-11 h-11 rounded-lg object-cover bg-gray-50 border border-gray-100"
                        />
                      ))}
                      {order.items.length > 3 && (
                        <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-600 font-bold border border-gray-200">
                          +{order.items.length - 3}
                        </div>
                      )}
                      <span className="text-xs text-gray-400 ml-2">
                        {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-3 border-t border-gray-100 w-full">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Clock size={13} className="text-gray-400" />
                      <span>{order.deliverySlot}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-gray-900 text-sm">{formatCurrency(order.total)}</span>
                      {isExpanded ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="p-4 border-t border-gray-100 bg-gray-50/60 space-y-5 animate-in slide-in-from-top-2 duration-200">
                    {order.status !== 'delivered' && order.status !== 'cancelled' && order.deliveryPin && (
                      <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-2 text-amber-800 text-xs font-semibold">
                          <KeyRound size={16} />
                          <span>Delivery Verification PIN (Share with rider)</span>
                        </div>
                        <span className="font-mono font-extrabold text-base tracking-widest bg-white px-3 py-1 rounded-lg border border-amber-300 text-amber-900">
                          {order.deliveryPin}
                        </span>
                      </div>
                    )}

                    {order.status !== 'cancelled' ? (
                      <div>
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Live Order Tracking</h3>
                        <div className="relative pl-2">
                          <div className="absolute left-[17px] top-2 bottom-2 w-[2px] bg-gray-200"></div>
                          <div className="space-y-4 relative">
                            {STEPS.map((step, index) => {
                              const isCompleted = index <= currentStepIndex;
                              const isCurrent = index === currentStepIndex;

                              return (
                                <div key={step.id} className="flex items-start gap-3">
                                  <div className={`relative z-10 w-5 h-5 rounded-full flex items-center justify-center ${
                                    isCompleted ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-200 text-gray-400'
                                  }`}>
                                    {isCompleted ? <CheckCircle size={12} /> : <Circle size={8} />}
                                  </div>
                                  <div>
                                    <p className={`text-xs font-semibold ${isCompleted ? 'text-gray-800' : 'text-gray-400'}`}>
                                      {step.label}
                                    </p>
                                    {isCurrent && order.status !== 'delivered' && (
                                      <p className="text-[10px] text-green-600 font-medium animate-pulse">In Progress...</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-medium">
                        <XCircle size={16} /> This order was cancelled.
                      </div>
                    )}

                    {order.assignedToName && (
                      <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5">
                          <Truck size={18} className="text-emerald-600" />
                          <div>
                            <p className="font-bold text-gray-800">{order.assignedToName}</p>
                            <p className="text-emerald-700 text-[10px]">Your delivery partner ({order.assignedToCode})</p>
                          </div>
                        </div>
                        <span className="font-bold text-[10px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">Dispatched</span>
                      </div>
                    )}

                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2.5">Items in Order</h3>
                      <div className="space-y-2">
                        {order.items.map((item, i) => (
                          <div key={i} className="flex items-center gap-3 bg-white p-2.5 rounded-xl border border-gray-100">
                            <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover bg-gray-50" />
                            <div className="flex-1">
                              <p className="text-xs font-bold text-gray-800">{item.name}</p>
                              <p className="text-[11px] text-gray-500">{item.selectedWeight}g × {item.quantity}</p>
                            </div>
                            <p className="text-xs font-bold text-gray-900">
                              {formatCurrency((item.pricePerKg / 1000) * item.selectedWeight * item.quantity)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Delivery Address</h3>
                      <div className="flex items-start gap-2 bg-white p-3 rounded-xl border border-gray-100">
                        <MapPin className="text-gray-400 shrink-0 mt-0.5" size={16} />
                        <p className="text-xs text-gray-700">
                          {order.address?.street ? `${order.address.street}, ${order.address.city || ''} ${order.address.zip || ''}`.trim() : 'Saved Address'}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 flex flex-col sm:flex-row gap-2">
                      {order.status === 'placed' && (
                        <button
                          disabled={cancellingOrderId === order.id}
                          onClick={() => handleCancelOrder(order.id)}
                          className="flex-1 py-2.5 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition border border-red-200"
                        >
                          <XCircle size={14} /> {cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel Order'}
                        </button>
                      )}

                      <button
                        onClick={() => handleReorder(order)}
                        className="flex-1 py-2.5 bg-white hover:bg-gray-50 text-gray-800 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition border border-gray-200 shadow-sm"
                      >
                        <RefreshCw size={14} className="text-green-600" /> Reorder Items
                      </button>

                      <Link
                        to={`/orders/${order.id}`}
                        className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
                      >
                        <span>Invoice &amp; Tracking</span>
                        <ChevronRight size={14} />
                      </Link>
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
