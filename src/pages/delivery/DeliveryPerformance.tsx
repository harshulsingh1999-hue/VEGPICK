import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDelivery } from '../../context/DeliveryContext';
import { TrendingUp, Star, Clock, XCircle, Award, Target } from 'lucide-react';
import { DeliveryNavbar } from '../../components/DeliveryNavbar';

export const DeliveryPerformance = () => {
  const { deliveryUser } = useDelivery();
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
        <h1 className="text-2xl font-bold mb-2">Performance</h1>
        <p className="text-gray-400 text-sm mb-6">Track your delivery metrics and ratings</p>
        
        <div className="flex items-center justify-between bg-gray-700/50 p-4 rounded-xl border border-gray-600 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border-4 border-green-500 flex items-center justify-center relative">
              <span className="text-xl font-bold">98</span>
              <div className="absolute -bottom-2 -right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                EXCELLENT
              </div>
            </div>
            <div>
              <p className="font-bold text-lg">Performance Score</p>
              <p className="text-xs text-gray-400">Top 5% in your zone</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <Star size={20} className="text-yellow-500" />
              </div>
              <span className="text-xs font-bold text-green-400">+0.2</span>
            </div>
            <p className="text-2xl font-bold">4.8</p>
            <p className="text-xs text-gray-400 mt-1">Customer Rating</p>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Clock size={20} className="text-blue-500" />
              </div>
              <span className="text-xs font-bold text-green-400">+2%</span>
            </div>
            <p className="text-2xl font-bold">96%</p>
            <p className="text-xs text-gray-400 mt-1">On-Time Delivery</p>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Target size={20} className="text-green-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">100%</p>
            <p className="text-xs text-gray-400 mt-1">Success Rate</p>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <XCircle size={20} className="text-red-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">0%</p>
            <p className="text-xs text-gray-400 mt-1">Cancellation Ratio</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4 mt-4">
        <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
          <Award size={20} className="text-yellow-400" />
          Incentive Eligibility
        </h3>
        
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="flex justify-between items-center mb-2">
            <p className="font-medium text-sm">Weekly Target: 50 Orders</p>
            <p className="text-sm font-bold text-green-400">32 / 50</p>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2.5 mb-2">
            <div className="bg-green-500 h-2.5 rounded-full" style={{ width: '64%' }}></div>
          </div>
          <p className="text-xs text-gray-400">Complete 18 more orders to earn ₹500 bonus!</p>
        </div>

        <h3 className="font-bold text-lg mb-2 mt-6">Attendance History</h3>
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          {[
            { date: 'Today', hours: '6h 30m', status: 'Active' },
            { date: 'Yesterday', hours: '8h 15m', status: 'Present' },
            { date: 'Mon, 23 Feb', hours: '7h 45m', status: 'Present' },
          ].map((log, i) => (
            <div key={i} className="flex justify-between items-center p-4 border-b border-gray-700 last:border-0">
              <div>
                <p className="font-medium">{log.date}</p>
                <p className="text-xs text-gray-400 mt-1">Logged in: {log.hours}</p>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded ${log.status === 'Active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-300'}`}>
                {log.status}
              </span>
            </div>
          ))}
        </div>
      </div>
      
      <DeliveryNavbar />
    </div>
  );
};
