import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDelivery } from '../../context/DeliveryContext';
import { IndianRupee, Wallet, ArrowUpRight, ArrowDownRight, Calendar, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { DeliveryNavbar } from '../../components/DeliveryNavbar';

export const DeliveryEarnings = () => {
  const { deliveryUser, stats } = useDelivery();
  const navigate = useNavigate();

  useEffect(() => {
    if (!deliveryUser) {
      navigate('/delivery/login');
    }
  }, [deliveryUser, navigate]);

  if (!deliveryUser) return null;

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-24">
      <div className="p-6 bg-gray-800 rounded-b-3xl shadow-lg">
        <h1 className="text-2xl font-bold mb-6">Earnings & COD</h1>
        
        <div className="bg-gradient-to-br from-green-600 to-green-800 rounded-2xl p-5 shadow-lg shadow-green-900/50 mb-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10"></div>
          <p className="text-green-100 text-sm font-medium mb-1">Today's Earnings</p>
          <h2 className="text-4xl font-bold mb-4">{formatCurrency(850)}</h2>
          
          <div className="flex gap-4 text-sm">
            <div>
              <p className="text-green-200 text-xs">Orders</p>
              <p className="font-bold">{stats.completed}</p>
            </div>
            <div>
              <p className="text-green-200 text-xs">Incentives</p>
              <p className="font-bold">{formatCurrency(150)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <Calendar size={16} />
              <span className="text-xs font-medium uppercase">This Week</span>
            </div>
            <p className="text-xl font-bold">{formatCurrency(4250)}</p>
            <p className="text-xs text-green-400 flex items-center mt-1"><ArrowUpRight size={12} /> +12% vs last week</p>
          </div>
          <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <Calendar size={16} />
              <span className="text-xs font-medium uppercase">This Month</span>
            </div>
            <p className="text-xl font-bold">{formatCurrency(18500)}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6 mt-4">
        {/* COD Management */}
        <div>
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <Wallet size={20} className="text-orange-400" />
            COD Settlement
          </h3>
          
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-gray-400 text-sm">Cash in Hand</p>
                <p className="text-2xl font-bold text-orange-400">{formatCurrency(stats.cashCollected)}</p>
              </div>
              <button className="bg-orange-500/20 text-orange-400 px-4 py-2 rounded-lg text-sm font-bold border border-orange-500/30">
                Deposit Now
              </button>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-400">Deposit Required</p>
                <p className="text-xs text-gray-400 mt-1">Please deposit cash at the hub or via UPI before 10 PM to avoid penalty.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Transactions */}
        <div>
          <h3 className="font-bold text-lg mb-4">Recent Orders</h3>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                <div>
                  <p className="font-bold">ORD-100{i}</p>
                  <p className="text-xs text-gray-400 mt-1">Today, 2:30 PM</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-400">+{formatCurrency(45)}</p>
                  <p className="text-[10px] text-gray-500 mt-1">Base: ₹30 | Dist: ₹15</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <DeliveryNavbar />
    </div>
  );
};
