import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDelivery } from '../../context/DeliveryContext';
import { Star, Clock, XCircle, Award, Target, PackageCheck } from 'lucide-react';
import { DeliveryNavbar } from '../../components/DeliveryNavbar';

export const DeliveryPerformance = () => {
  const { authReady } = useAuth();
  const { deliveryUser, partnerLoading, assignedOrders } = useDelivery();
  const navigate = useNavigate();

  useEffect(() => {
    if (authReady && !partnerLoading && (!deliveryUser || !deliveryUser.isApproved)) {
      navigate('/delivery/login', { replace: true });
    }
  }, [authReady, partnerLoading, deliveryUser, navigate]);

  if (!authReady || partnerLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!deliveryUser || !deliveryUser.isApproved) return null;

  const totalAssigned = assignedOrders.length;
  const deliveredCount = assignedOrders.filter(
    (o) => o.status === 'delivered'
  ).length;
  const cancelledCount = assignedOrders.filter(
    (o) => o.status === 'cancelled'
  ).length;
  const finalizedCount = deliveredCount + cancelledCount;
  const successRate =
    finalizedCount > 0 ? Math.round((deliveredCount / finalizedCount) * 100) : 100;
  const cancelRate =
    totalAssigned > 0 ? Math.round((cancelledCount / totalAssigned) * 100) : 0;
  const score = Math.min(
    99,
    Math.max(
      70,
      Math.round((deliveryUser.rating / 5) * 50 + successRate * 0.5)
    )
  );

  const weeklyTarget = 50;
  const weeklyDone =
    deliveryUser.completedDeliveries % weeklyTarget ||
    (deliveryUser.completedDeliveries > 0 ? weeklyTarget : 0);
  const progressPct = Math.min(
    100,
    Math.round((weeklyDone / weeklyTarget) * 100)
  );
  const remaining = Math.max(0, weeklyTarget - weeklyDone);

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-24">
      <div className="p-6 bg-gray-800 rounded-b-3xl shadow-lg safe-top">
        <h1 className="text-2xl font-bold mb-2">Performance</h1>
        <p className="text-gray-400 text-sm mb-6">
          Live delivery metrics and partner ratings
        </p>

        <div className="flex items-center justify-between bg-gray-700/50 p-4 rounded-xl border border-gray-600 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border-4 border-green-500 flex items-center justify-center relative">
              <span className="text-xl font-bold">{score}</span>
              <div className="absolute -bottom-2 -right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                {score >= 90 ? 'EXCELLENT' : 'GOOD'}
              </div>
            </div>
            <div>
              <p className="font-bold text-lg">Performance Score</p>
              <p className="text-xs text-gray-400">
                {deliveryUser.completedDeliveries} total completed trips •{' '}
                {deliveryUser.area}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <Star size={20} className="text-yellow-500" />
              </div>
              <span className="text-xs font-bold text-green-400">Live</span>
            </div>
            <p className="text-2xl font-bold">{deliveryUser.rating.toFixed(1)}</p>
            <p className="text-xs text-gray-400 mt-1">Partner Rating</p>
          </div>

          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Clock size={20} className="text-blue-500" />
              </div>
              <span className="text-xs font-bold text-green-400">
                {deliveryUser.isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <p className="text-2xl font-bold">
              {deliveryUser.completedDeliveries}
            </p>
            <p className="text-xs text-gray-400 mt-1">Total Deliveries</p>
          </div>

          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Target size={20} className="text-green-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{successRate}%</p>
            <p className="text-xs text-gray-400 mt-1">Success Rate</p>
          </div>

          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <XCircle size={20} className="text-red-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{cancelRate}%</p>
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
            <p className="font-medium text-sm">
              Milestone Target: {weeklyTarget} Orders
            </p>
            <p className="text-sm font-bold text-green-400">
              {weeklyDone} / {weeklyTarget}
            </p>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2.5 mb-2">
            <div
              className="bg-green-500 h-2.5 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            ></div>
          </div>
          <p className="text-xs text-gray-400">
            {remaining === 0
              ? 'Target achieved! ₹500 bonus unlocked!'
              : `Complete ${remaining} more orders to earn ₹500 bonus!`}
          </p>
        </div>

        <h3 className="font-bold text-lg mb-2 mt-6">Recent Trip History</h3>
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          {assignedOrders.length > 0 ? (
            assignedOrders.slice(0, 6).map((trip) => (
              <div
                key={trip.id}
                className="flex justify-between items-center p-4 border-b border-gray-700 last:border-0"
              >
                <div>
                  <p className="font-medium text-sm text-white">#{trip.id}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(trip.date).toLocaleDateString()} •{' '}
                    {trip.deliverySlot}
                  </p>
                </div>
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded ${
                    trip.status === 'delivered'
                      ? 'bg-green-500/20 text-green-400'
                      : trip.status === 'cancelled'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {trip.status.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
            ))
          ) : (
            <div className="p-6 text-center text-gray-500 text-xs flex flex-col items-center gap-2">
              <PackageCheck size={24} className="opacity-40" />
              <span>No assigned trips recorded yet</span>
            </div>
          )}
        </div>
      </div>

      <DeliveryNavbar />
    </div>
  );
};
