import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDelivery } from '../../context/DeliveryContext';
import { useToast } from '../../context/ToastContext';
import { useNavigate, Link } from 'react-router-dom';
import {
  Power,
  MapPin,
  ChevronRight,
  CheckCircle,
  IndianRupee,
  Bell,
  X,
  Check,
  PackagePlus,
  Clock
} from 'lucide-react';
import { formatCurrency, formatPaymentMethodLabel } from '../../lib/utils';
import { DeliveryNavbar } from '../../components/DeliveryNavbar';

export const DeliveryDashboard = () => {
  const { authReady } = useAuth();
  const {
    deliveryUser,
    partnerLoading,
    toggleOnline,
    assignedOrders,
    availableOrders,
    acceptOrder,
    stats,
    logoutPartner
  } = useDelivery();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'pending' | 'completed' | 'available'>(
    'pending'
  );
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [dismissedOrderIds, setDismissedOrderIds] = useState<string[]>([]);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && !partnerLoading && (!deliveryUser || !deliveryUser.isApproved)) {
      navigate('/delivery/login', { replace: true });
    }
  }, [authReady, partnerLoading, deliveryUser, navigate]);

  const nextAvailableOrder = availableOrders.find(
    (o) => !dismissedOrderIds.includes(o.orderId)
  );

  useEffect(() => {
    if (deliveryUser?.isApproved && deliveryUser?.isOnline && nextAvailableOrder) {
      const timer = setTimeout(() => {
        setShowNewOrder(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
    setShowNewOrder(false);
    return undefined;
  }, [deliveryUser?.isApproved, deliveryUser?.isOnline, nextAvailableOrder?.orderId]);

  const handleLogout = async () => {
    await logoutPartner();
    navigate('/');
  };

  const handleToggleOnline = async () => {
    if (!deliveryUser) return;
    const willBeOnline = !deliveryUser.isOnline;
    await toggleOnline();
    showToast(
      willBeOnline
        ? 'You are now Online & ready for deliveries'
        : 'You are now Off Duty (Offline)',
      'info'
    );
  };

  const handleAcceptDispatch = async (orderId: string) => {
    setBusyOrderId(orderId);
    try {
      await acceptOrder(orderId);
      setShowNewOrder(false);
      setActiveTab('pending');
      showToast(
        deliveryUser?.isOnline
          ? `Order #${orderId} accepted!`
          : `Order #${orderId} accepted! Remember to toggle On Duty to share live dispatch updates.`,
        'success'
      );
    } catch (err) {
      const msg =
        err instanceof Error && !err.message.trim().startsWith('{')
          ? err.message
          : 'Unable to accept order. It may have been claimed or cancelled.';
      showToast(msg, 'error');
    } finally {
      setBusyOrderId(null);
    }
  };

  if (!authReady || partnerLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!deliveryUser || !deliveryUser.isApproved) {
    return null;
  }

  const isZoneMatch = (city?: string, zip?: string) => {
    const areaTokens = (deliveryUser.area || '')
      .toLowerCase()
      .split(/[\s,()\-]+/)
      .filter((t) => t.length >= 3);
    if (areaTokens.length === 0) return false;
    const target = `${city || ''} ${zip || ''}`.toLowerCase();
    return areaTokens.some((tok) => target.includes(tok));
  };

  const sortedAvailableOrders = [...availableOrders].sort((a, b) => {
    const aMatch = isZoneMatch(a.city, a.zip) ? 1 : 0;
    const bMatch = isZoneMatch(b.city, b.zip) ? 1 : 0;
    return bMatch - aMatch;
  });

  const pendingOrders = assignedOrders.filter(
    (o) => o.status !== 'delivered' && o.status !== 'cancelled'
  );
  const completedOrders = assignedOrders.filter(
    (o) => o.status === 'delivered' || o.status === 'cancelled'
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-28">
      {/* New Order Request Modal (PII-free Dispatch Feed preview) */}
      {showNewOrder && nextAvailableOrder && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl w-full max-w-sm overflow-hidden border border-green-500/30 shadow-2xl shadow-green-500/20 animate-in zoom-in-95">
            <div className="bg-green-600 p-4 text-center relative">
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full border border-white/40 text-[10px] font-bold animate-pulse">
                NEW
              </div>
              <Bell size={32} className="mx-auto text-white mb-2 animate-bounce" />
              <h2 className="text-xl font-bold text-white">New Order Available!</h2>
              <p className="text-green-100 text-sm">
                Zone: {deliveryUser.area || 'All Areas'}
              </p>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-gray-700 pb-3">
                <div>
                  <p className="text-xs text-gray-400">Order Value</p>
                  <p className="text-xl font-bold text-green-400">
                    {formatCurrency(nextAvailableOrder.total)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Order ID</p>
                  <p className="text-sm font-bold text-gray-200">
                    #{nextAvailableOrder.orderId}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="w-8 flex flex-col items-center">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <div className="w-0.5 h-8 bg-gray-700"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  </div>
                  <div className="flex-1 space-y-3">
                    <div>
                      <p className="text-xs text-gray-400">Pickup Hub</p>
                      <p className="text-sm font-medium">
                        FreshVeggie Central Hub ({nextAvailableOrder.itemCount} items)
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Drop Zone & Slot</p>
                      <p className="text-sm font-medium">
                        {nextAvailableOrder.city} — {nextAvailableOrder.zip}
                      </p>
                      <p className="text-xs text-gray-400">
                        {nextAvailableOrder.deliverySlot}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  onClick={() => {
                    setDismissedOrderIds((prev) => [
                      ...prev,
                      nextAvailableOrder.orderId
                    ]);
                    setShowNewOrder(false);
                  }}
                  className="flex-1 py-3 rounded-xl font-bold bg-gray-700 text-white flex items-center justify-center gap-2 hover:bg-gray-600"
                >
                  <X size={20} /> Skip
                </button>
                <button
                  disabled={busyOrderId === nextAvailableOrder.orderId}
                  onClick={() => handleAcceptDispatch(nextAvailableOrder.orderId)}
                  className="flex-[2] py-3 rounded-xl font-bold bg-green-600 text-white flex items-center justify-center gap-2 hover:bg-green-500 disabled:opacity-60 shadow-lg shadow-green-600/30"
                >
                  <Check size={20} /> Accept Order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-800 p-6 rounded-b-3xl shadow-lg border-b border-gray-700 safe-top">
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{deliveryUser.name}</h1>
              <span className="text-[10px] bg-green-900/60 text-green-300 font-bold px-2 py-0.5 rounded border border-green-700">
                {deliveryUser.vehicle}
              </span>
            </div>
            <p className="text-gray-400 text-xs mt-0.5">
              Code: {deliveryUser.partnerCode} • Zone:{' '}
              {deliveryUser.area || 'Citywide'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-white text-xs bg-gray-700 px-3 py-1.5 rounded-lg transition"
          >
            Logout
          </button>
        </div>

        <div className="flex justify-between items-center bg-gray-900 p-4 rounded-xl border border-gray-700">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                deliveryUser.isOnline
                  ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse'
                  : 'bg-red-500'
              }`}
            ></div>
            <div>
              <span className="font-medium text-sm block">
                {deliveryUser.isOnline
                  ? 'On Duty (Online)'
                  : 'Off Duty (Offline)'}
              </span>
              {!deliveryUser.isOnline && (
                <span className="text-[10px] text-gray-400">
                  Go online to receive new delivery requests
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleToggleOnline}
            className={`p-2 rounded-full transition ${
              deliveryUser.isOnline
                ? 'bg-green-500/20 text-green-400'
                : 'bg-gray-700 text-gray-400'
            }`}
            title="Toggle Shift Status"
          >
            <Power size={20} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          <div className="bg-gray-900 p-3 rounded-xl text-center border border-gray-700">
            <p className="text-xl font-bold text-green-400">{stats.completed}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
              Delivered
            </p>
          </div>
          <div className="bg-gray-900 p-3 rounded-xl text-center border border-gray-700">
            <p className="text-xl font-bold text-orange-400">{stats.pending}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
              Active
            </p>
          </div>
          <div className="bg-gray-900 p-3 rounded-xl text-center border border-gray-700">
            <p className="text-base font-bold text-white truncate">
              {formatCurrency(stats.cashCollected)}
            </p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
              COD Cash
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-4 gap-2">
        <button
          onClick={() => setActiveTab('pending')}
          className={`flex-1 py-2 rounded-lg font-medium text-xs transition-colors ${
            activeTab === 'pending'
              ? 'bg-green-600 text-white shadow-md'
              : 'bg-gray-800 text-gray-400 border border-gray-700'
          }`}
        >
          My Trips ({stats.pending})
        </button>
        <button
          onClick={() => setActiveTab('available')}
          className={`flex-1 py-2 rounded-lg font-medium text-xs transition-colors relative ${
            activeTab === 'available'
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-gray-800 text-gray-400 border border-gray-700'
          }`}
        >
          Available ({availableOrders.length})
          {availableOrders.length > 0 && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`flex-1 py-2 rounded-lg font-medium text-xs transition-colors ${
            activeTab === 'completed'
              ? 'bg-green-600 text-white shadow-md'
              : 'bg-gray-800 text-gray-400 border border-gray-700'
          }`}
        >
          History ({completedOrders.length})
        </button>
      </div>

      {/* Orders List */}
      <div className="px-4 space-y-3">
        {activeTab === 'available'
          ? sortedAvailableOrders.map((item) => {
              const matchedZone = isZoneMatch(item.city, item.zip);
              return (
              <div
                key={item.orderId}
                className={`block bg-gray-800 p-4 rounded-xl shadow-sm border transition ${
                  matchedZone ? 'border-green-500/40' : 'border-gray-700'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="bg-blue-500/20 text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        #{item.orderId}
                      </span>
                      {matchedZone && (
                        <span className="bg-green-500/20 text-green-300 text-[10px] font-bold px-2 py-0.5 rounded">
                          ★ Your Zone
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-white mt-1.5 text-base">
                      {item.city} — {item.zip}
                    </h3>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                      <Clock size={12} /> {item.deliverySlot} • {item.itemCount} items
                    </p>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">
                    {item.status.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>

                <div className="flex justify-between items-center pt-3 border-t border-gray-700 mt-3">
                  <div>
                    {item.paymentMethod === 'cod' ? (
                      <span className="flex items-center gap-1 text-orange-400 text-xs font-bold bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                        <IndianRupee size={12} /> {item.total} COD
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-green-400 text-xs font-bold bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                        PAID ({formatPaymentMethodLabel(item.paymentMethod)} • {formatCurrency(item.total)})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      to={`/delivery/order/${item.orderId}`}
                      className="text-xs font-bold text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-gray-700"
                    >
                      Details
                    </Link>
                    <button
                      disabled={busyOrderId === item.orderId}
                      onClick={() => handleAcceptDispatch(item.orderId)}
                      className="flex items-center gap-1.5 bg-green-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-green-500 disabled:opacity-60 active:scale-95 transition"
                    >
                      <PackagePlus size={15} />
                      Accept
                    </button>
                  </div>
                </div>
              </div>
              );
            })
          : (activeTab === 'pending' ? pendingOrders : completedOrders).map(
              (order) => (
                <div
                  key={order.id}
                  className="block bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-700 transition"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="bg-gray-700 text-gray-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        #{order.id}
                      </span>
                      <h3 className="font-bold text-white mt-1 text-base">
                        {order.customerName || 'Customer'}
                      </h3>
                      <p className="text-xs text-gray-400">
                        {order.customerPhone || 'Phone verified'}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                          order.status === 'delivered'
                            ? 'bg-green-500/20 text-green-400'
                            : order.status === 'cancelled'
                            ? 'bg-red-500/20 text-red-400'
                            : order.status === 'out_for_delivery'
                            ? 'bg-blue-500/20 text-blue-400'
                            : order.status === 'packed'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-orange-500/20 text-orange-400'
                        }`}
                      >
                        {order.status.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 text-gray-400 text-xs mb-3">
                    <MapPin size={15} className="mt-0.5 shrink-0 text-gray-500" />
                    <p className="line-clamp-2">
                      {order.address?.street
                        ? `${order.address.street}, ${order.address.city} - ${order.address.zip}`
                        : 'Delivery Address'}
                    </p>
                  </div>

                  {order.items && order.items.length > 0 && (
                    <div className="bg-gray-900/60 p-2.5 rounded-lg mb-3 text-xs text-gray-300 border border-gray-700/50">
                      <p className="font-medium text-gray-400 mb-1 text-[11px]">
                        Items: {order.items.length}
                      </p>
                      <div className="truncate">
                        {order.items
                          .map(
                            (i) =>
                              `${i.name} (${
                                i.selectedWeight >= 1000
                                  ? `${i.selectedWeight / 1000}kg`
                                  : `${i.selectedWeight}g`
                              } × ${i.quantity})`
                          )
                          .join(', ')}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-3 border-t border-gray-700">
                    <div className="flex items-center gap-2">
                      {order.paymentMethod === 'cod' ? (
                        <span className="flex items-center gap-1 text-orange-400 text-xs font-bold bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                          <IndianRupee size={12} /> {order.total} COD
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-green-400 text-xs font-bold bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                          PAID ({formatPaymentMethodLabel(order.paymentMethod)} • {formatCurrency(order.total)})
                        </span>
                      )}
                    </div>

                    <Link
                      to={`/delivery/order/${order.id}`}
                      className="flex items-center gap-1 text-xs font-bold text-green-400 hover:text-green-300"
                    >
                      Manage Trip <ChevronRight size={16} />
                    </Link>
                  </div>
                </div>
              )
            )}

        {((activeTab === 'available' && availableOrders.length === 0) ||
          (activeTab === 'pending' && pendingOrders.length === 0) ||
          (activeTab === 'completed' && completedOrders.length === 0)) && (
          <div className="text-center py-12 text-gray-500 bg-gray-800/40 rounded-2xl border border-gray-800">
            <CheckCircle
              size={44}
              className="mx-auto mb-2 opacity-30 text-gray-400"
            />
            <p className="font-medium text-sm">
              No {activeTab} orders at this moment
            </p>
            {activeTab === 'pending' && (
              <p className="text-xs text-gray-500 mt-1">
                Check the &quot;Available&quot; tab to pick up unassigned orders
              </p>
            )}
          </div>
        )}
      </div>

      <DeliveryNavbar />
    </div>
  );
};
