import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDelivery } from '../../context/DeliveryContext';
import { useToast } from '../../context/ToastContext';
import {
  Wallet,
  ArrowUpRight,
  Calendar,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { DeliveryNavbar } from '../../components/DeliveryNavbar';

export const DeliveryEarnings = () => {
  const { authReady } = useAuth();
  const {
    deliveryUser,
    partnerLoading,
    stats,
    assignedOrders,
    walletLedger,
    settleCashInHand,
    settledCash
  } = useDelivery();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [settling, setSettling] = useState(false);

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

  const deliveredOrders = assignedOrders.filter((o) => o.status === 'delivered');
  const now = new Date();
  const startOfTodayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgoMs = startOfTodayMs - 6 * 24 * 60 * 60 * 1000;

  const todayTrips = deliveredOrders.filter((o) => {
    const t = new Date(o.date || 0).getTime();
    return Number.isFinite(t) && t >= startOfTodayMs;
  }).length;
  const weekTrips = deliveredOrders.filter((o) => {
    const t = new Date(o.date || 0).getTime();
    return Number.isFinite(t) && t >= sevenDaysAgoMs;
  }).length;

  const tripPay = todayTrips * 45;
  const incentives = todayTrips >= 5 ? 150 : todayTrips >= 2 ? 50 : 0;
  const todayEarnings = tripPay + incentives;

  const ledgerTripCredits = walletLedger
    .filter((entry) => entry.type === 'trip_credit')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const totalHistoricalTrips = Math.max(
    deliveryUser.completedDeliveries,
    deliveredOrders.length
  );
  const weekEarnings = Math.max(todayEarnings, weekTrips * 45);
  const lifetimeEarnings = Math.max(
    weekEarnings,
    ledgerTripCredits,
    totalHistoricalTrips * 45
  );

  const handleDeposit = async () => {
    setSettling(true);
    try {
      const amount = await settleCashInHand();
      if (amount > 0) {
        showToast(`Deposited ${formatCurrency(amount)} COD cash to Hub!`, 'success');
      } else {
        showToast('No pending COD cash in hand to deposit', 'info');
      }
    } catch {
      showToast('Failed to record COD deposit. Please retry.', 'error');
    } finally {
      setSettling(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-24">
      <div className="p-6 bg-gray-800 rounded-b-3xl shadow-lg safe-top">
        <h1 className="text-2xl font-bold mb-6">Earnings &amp; COD</h1>

        <div className="bg-gradient-to-br from-green-600 to-green-800 rounded-2xl p-5 shadow-lg shadow-green-900/50 mb-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10"></div>
          <p className="text-green-100 text-sm font-medium mb-1">
            Today&apos;s Earnings
          </p>
          <h2 className="text-4xl font-bold mb-4">
            {formatCurrency(todayEarnings)}
          </h2>

          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-green-200 text-xs">Today&apos;s Trips</p>
              <p className="font-bold">{todayTrips}</p>
            </div>
            <div>
              <p className="text-green-200 text-xs">Trip Base (₹45/trip)</p>
              <p className="font-bold">{formatCurrency(tripPay)}</p>
            </div>
            <div>
              <p className="text-green-200 text-xs">Daily Bonus</p>
              <p className="font-bold">{formatCurrency(incentives)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <Calendar size={16} />
              <span className="text-xs font-medium uppercase">Last 7 Days ({weekTrips})</span>
            </div>
            <p className="text-xl font-bold">{formatCurrency(weekEarnings)}</p>
            <p className="text-xs text-green-400 flex items-center mt-1">
              <ArrowUpRight size={12} /> Active week
            </p>
          </div>
          <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <Calendar size={16} />
              <span className="text-xs font-medium uppercase">
                Lifetime ({totalHistoricalTrips} trips)
              </span>
            </div>
            <p className="text-xl font-bold">{formatCurrency(lifetimeEarnings)}</p>
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
                <p className="text-2xl font-bold text-orange-400">
                  {formatCurrency(stats.cashCollected)}
                </p>
                {settledCash > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Total settled: {formatCurrency(settledCash)}
                  </p>
                )}
              </div>
              <button
                onClick={handleDeposit}
                disabled={stats.cashCollected <= 0 || settling}
                className="bg-orange-500/20 text-orange-400 px-4 py-2 rounded-lg text-sm font-bold border border-orange-500/30 hover:bg-orange-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {settling ? 'Depositing...' : 'Deposit Now'}
              </button>
            </div>

            {stats.cashCollected > 0 ? (
              <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle
                  size={20}
                  className="text-red-400 shrink-0 mt-0.5"
                />
                <div>
                  <p className="text-sm font-bold text-red-400">
                    Deposit Required
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Please deposit collected COD cash at the hub before 10 PM.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <CheckCircle size={20} className="text-green-400 shrink-0" />
                <p className="text-xs text-green-300 font-medium">
                  All COD cash is settled. Zero pending hub balance.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Immutable Wallet & Settlement Ledger */}
        <div>
          <h3 className="font-bold text-lg mb-4">Wallet &amp; Settlement Ledger</h3>
          <div className="space-y-3">
            {walletLedger.slice(0, 10).map((entry) => (
              <div
                key={entry.id}
                className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex justify-between items-center"
              >
                <div>
                  <p className="font-bold text-white text-sm">
                    {entry.type === 'trip_credit' ? 'Trip Payout Credit' : 'COD Hub Settlement'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{entry.note}</p>
                </div>
                <span
                  className={`font-bold text-sm ${
                    entry.type === 'trip_credit' ? 'text-green-400' : 'text-orange-400'
                  }`}
                >
                  {entry.type === 'trip_credit' ? '+' : ''}
                  {formatCurrency(entry.amount)}
                </span>
              </div>
            ))}

            {walletLedger.length === 0 && (
              <div className="text-center py-6 text-gray-500 bg-gray-800/40 rounded-xl">
                <p className="text-sm">No ledger transactions recorded yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Completed Deliveries */}
        <div>
          <h3 className="font-bold text-lg mb-4">Completed Deliveries</h3>
          <div className="space-y-3">
            {assignedOrders
              .filter((o) => o.status === 'delivered')
              .slice(0, 5)
              .map((order) => (
                <div
                  key={order.id}
                  className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex justify-between items-center"
                >
                  <div>
                    <p className="font-bold text-white">#{order.id}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {order.customerName || 'Customer'} • {order.deliverySlot}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-400">
                      +{formatCurrency(45)}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Order total: {formatCurrency(order.total)}
                    </p>
                  </div>
                </div>
              ))}

            {assignedOrders.filter((o) => o.status === 'delivered').length ===
              0 && (
              <div className="text-center py-6 text-gray-500 bg-gray-800/40 rounded-xl">
                <p className="text-sm">No completed trips yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <DeliveryNavbar />
    </div>
  );
};
