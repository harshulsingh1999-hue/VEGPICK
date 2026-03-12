import React, { useState, useEffect } from 'react';
import { useDelivery } from '../../context/DeliveryContext';
import { useNavigate, Link } from 'react-router-dom';
import { Power, MapPin, ChevronRight, CheckCircle, IndianRupee, Bell, X, Check } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { DeliveryNavbar } from '../../components/DeliveryNavbar';

export const DeliveryDashboard = () => {
  const { deliveryUser, toggleOnline, assignedOrders, stats, logout } = useDelivery();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [showNewOrder, setShowNewOrder] = useState(false);

  // Simulate AI order assignment
  useEffect(() => {
    if (deliveryUser?.isOnline) {
      const timer = setTimeout(() => {
        setShowNewOrder(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [deliveryUser?.isOnline]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (!deliveryUser) {
    navigate('/delivery/login');
    return null;
  }

  const filteredOrders = assignedOrders.filter(o => 
    activeTab === 'pending' 
      ? o.deliveryStatus !== 'delivered' 
      : o.deliveryStatus === 'delivered'
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-24">
      {/* New Order Request Modal */}
      {showNewOrder && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl w-full max-w-sm overflow-hidden border border-green-500/30 shadow-2xl shadow-green-500/20 animate-in zoom-in-95">
            <div className="bg-green-600 p-4 text-center relative">
              <div className="absolute top-2 right-2 w-8 h-8 rounded-full border-2 border-white/30 flex items-center justify-center text-xs font-bold animate-pulse">
                30s
              </div>
              <Bell size={32} className="mx-auto text-white mb-2 animate-bounce" />
              <h2 className="text-xl font-bold text-white">New Order Request!</h2>
              <p className="text-green-100 text-sm">AI Assigned - Nearest Partner</p>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-gray-700 pb-3">
                <div>
                  <p className="text-xs text-gray-400">Estimated Earning</p>
                  <p className="text-xl font-bold text-green-400">{formatCurrency(45)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Total Distance</p>
                  <p className="text-lg font-bold">4.2 km</p>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="w-8 flex flex-col items-center">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <div className="w-0.5 h-8 bg-gray-700"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <p className="text-xs text-gray-400">Pickup</p>
                      <p className="text-sm font-medium">FreshVeggie Hub, Sector 14</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Drop</p>
                      <p className="text-sm font-medium">123 Green St, Veggie Town</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setShowNewOrder(false)}
                  className="flex-1 py-3 rounded-xl font-bold bg-gray-700 text-white flex items-center justify-center gap-2 hover:bg-gray-600"
                >
                  <X size={20} /> Reject
                </button>
                <button 
                  onClick={() => setShowNewOrder(false)}
                  className="flex-[2] py-3 rounded-xl font-bold bg-green-600 text-white flex items-center justify-center gap-2 hover:bg-green-500 shadow-lg shadow-green-600/30"
                >
                  <Check size={20} /> Accept Order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-800 p-6 rounded-b-3xl shadow-lg border-b border-gray-700">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-xl font-bold">{deliveryUser.name}</h1>
            <p className="text-gray-400 text-sm">ID: {deliveryUser.id}</p>
          </div>
          <button 
            onClick={handleLogout}
            className="text-gray-400 hover:text-white text-sm bg-gray-700 px-3 py-1.5 rounded-lg"
          >
            Logout
          </button>
        </div>

        <div className="flex justify-between items-center bg-gray-900 p-4 rounded-xl border border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${deliveryUser.isOnline ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`}></div>
            <span className="font-medium">{deliveryUser.isOnline ? 'You are Online' : 'You are Offline'}</span>
          </div>
          <button 
            onClick={toggleOnline}
            className={`p-2 rounded-full ${deliveryUser.isOnline ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}
          >
            <Power size={20} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="bg-gray-900 p-3 rounded-xl text-center border border-gray-700">
            <p className="text-2xl font-bold text-green-400">{stats.completed}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Completed</p>
          </div>
          <div className="bg-gray-900 p-3 rounded-xl text-center border border-gray-700">
            <p className="text-2xl font-bold text-orange-400">{stats.pending}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Pending</p>
          </div>
          <div className="bg-gray-900 p-3 rounded-xl text-center border border-gray-700">
            <p className="text-lg font-bold text-white">{formatCurrency(stats.cashCollected)}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Cash</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-4 gap-4">
        <button 
          onClick={() => setActiveTab('pending')}
          className={`flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${activeTab === 'pending' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}
        >
          Pending ({stats.pending})
        </button>
        <button 
          onClick={() => setActiveTab('completed')}
          className={`flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${activeTab === 'completed' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}
        >
          Completed ({stats.completed})
        </button>
      </div>

      {/* Orders List */}
      <div className="px-4 space-y-4">
        {filteredOrders.map(order => (
          <Link 
            to={`/delivery/order/${order.id}`} 
            key={order.id}
            className="block bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-700 active:scale-[0.98] transition-transform"
          >
            <div className="flex justify-between items-start mb-3">
              <div>
                <span className="bg-gray-700 text-gray-300 text-[10px] font-bold px-2 py-1 rounded">{order.id}</span>
                <h3 className="font-bold text-white mt-2">{order.customerName}</h3>
              </div>
              <div className="text-right">
                <span className={`text-xs font-bold px-2 py-1 rounded ${
                  order.deliveryStatus === 'delivered' ? 'bg-green-500/20 text-green-400' :
                  order.deliveryStatus === 'out_for_delivery' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-orange-500/20 text-orange-400'
                }`}>
                  {order.deliveryStatus.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2 text-gray-400 text-sm mb-3">
              <MapPin size={16} className="mt-0.5 shrink-0" />
              <p className="line-clamp-2">{order.customerAddress}</p>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-gray-700">
              <div className="flex items-center gap-2">
                {order.paymentMethod === 'cod' ? (
                  <span className="flex items-center gap-1 text-orange-400 text-xs font-bold bg-orange-500/10 px-2 py-1 rounded border border-orange-500/20">
                    <IndianRupee size={12} /> {order.total} COD
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-green-400 text-xs font-bold bg-green-500/10 px-2 py-1 rounded border border-green-500/20">
                    PAID ONLINE
                  </span>
                )}
              </div>
              <ChevronRight size={20} className="text-gray-500" />
            </div>
          </Link>
        ))}

        {filteredOrders.length === 0 && (
          <div className="text-center py-10 text-gray-500">
            <CheckCircle size={48} className="mx-auto mb-2 opacity-20" />
            <p>No {activeTab} orders</p>
          </div>
        )}
      </div>
      
      <DeliveryNavbar />
    </div>
  );
};
