import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDelivery } from '../../context/DeliveryContext';
import { useToast } from '../../context/ToastContext';
import {
  Phone,
  Navigation,
  ArrowLeft,
  CheckCircle,
  IndianRupee,
  XCircle,
  AlertTriangle,
  PackagePlus,
  MapPin,
  Clock,
  Radio,
  Camera
} from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { haversineDistanceMeters, uploadCompressedMedia } from '../../lib/imageUtils';

export const DeliveryOrderDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { authReady } = useAuth();
  const {
    deliveryUser,
    partnerLoading,
    assignedOrders,
    availableOrders,
    acceptOrder,
    upsertActiveGpsLocation,
    updateDeliveryOrderStatus,
    collectDeliveryPayment
  } = useDelivery();
  const { showToast } = useToast();

  const [showPickupModal, setShowPickupModal] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [showFailedModal, setShowFailedModal] = useState(false);
  const [customerOtp, setCustomerOtp] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedReason, setFailedReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Throttled GPS Streaming state (every 10s or 30m)
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'streaming' | 'denied' | 'unsupported'>('idle');
  const [lastPingCoords, setLastPingCoords] = useState<{ lat: number; lng: number; time: string } | null>(null);
  const lastPingRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null);

  // Proof photo upload state (< 200 KB compressed)
  const [proofUrl, setProofUrl] = useState('');
  const [proofInfo, setProofInfo] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);

  const order = assignedOrders.find((o) => o.id === id);
  const dispatchItem = !order
    ? availableOrders.find((f) => f.orderId === id)
    : undefined;

  useEffect(() => {
    if (authReady && !partnerLoading && (!deliveryUser || !deliveryUser.isApproved)) {
      navigate('/delivery/login', { replace: true });
    }
  }, [authReady, partnerLoading, deliveryUser, navigate]);

  // Stream rider GPS to ephemeral /active_deliveries/{orderId} throttled to >= 10s OR >= 30m
  useEffect(() => {
    if (
      !gpsEnabled ||
      !order ||
      !deliveryUser?.isApproved ||
      order.assignedToUid !== deliveryUser.uid ||
      (order.status !== 'packed' && order.status !== 'out_for_delivery')
    ) {
      setGpsStatus('idle');
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsStatus('unsupported');
      return;
    }

    setGpsStatus('streaming');
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, speed, heading } = position.coords;
        const now = Date.now();
        const prev = lastPingRef.current;

        const elapsedMs = prev ? now - prev.timestamp : Infinity;
        const movedMeters = prev
          ? haversineDistanceMeters(prev.lat, prev.lng, latitude, longitude)
          : Infinity;

        // Throttle Firestore writes to >= 10 seconds OR >= 30 meters moved
        if (elapsedMs >= 10_000 || movedMeters >= 30) {
          lastPingRef.current = { lat: latitude, lng: longitude, timestamp: now };
          setLastPingCoords({
            lat: latitude,
            lng: longitude,
            time: new Date(now).toLocaleTimeString()
          });
          upsertActiveGpsLocation(order, {
            lat: latitude,
            lng: longitude,
            accuracy: accuracy ?? 15,
            speed: speed ?? 0,
            heading: heading ?? 0
          }).catch(() => {
            // Silently retry on next throttled interval
          });
        }
      },
      (geoErr) => {
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          setGpsStatus('denied');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [gpsEnabled, order, deliveryUser?.isApproved, deliveryUser?.uid, upsertActiveGpsLocation]);

  if (!authReady || partnerLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!deliveryUser || !deliveryUser.isApproved) return null;

  if (!order && !dispatchItem) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
        <p className="text-gray-400 mb-4">Order #{id} not found</p>
        <button
          onClick={() => navigate('/delivery/dashboard')}
          className="bg-green-600 px-4 py-2 rounded-lg text-sm font-bold"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Unassigned Dispatch Feed preview (protects customer PII until accepted)
  if (!order && dispatchItem) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pb-28">
        <div className="bg-gray-800 p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10 border-b border-gray-700 safe-top">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-700 rounded-full text-gray-300"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-lg">Dispatch #{dispatchItem.orderId}</h1>
            <p className="text-xs text-gray-400">{dispatchItem.deliverySlot}</p>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-400">
            AVAILABLE
          </span>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 space-y-4">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              Delivery Summary
            </h2>
            <div className="flex items-start gap-3">
              <MapPin size={20} className="text-green-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-white">
                  {dispatchItem.city} — {dispatchItem.zip}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Exact street address, customer phone, and delivery PIN unlock
                  immediately after accepting.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="bg-gray-900 p-3 rounded-lg border border-gray-700">
                <p className="text-[11px] text-gray-400">Package Items</p>
                <p className="font-bold text-white">{dispatchItem.itemCount} items</p>
              </div>
              <div className="bg-gray-900 p-3 rounded-lg border border-gray-700">
                <p className="text-[11px] text-gray-400">Order Total</p>
                <p className="font-bold text-green-400">
                  {formatCurrency(dispatchItem.total)} (
                  {dispatchItem.paymentMethod.toUpperCase()})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-300 bg-gray-900/60 p-3 rounded-lg">
              <Clock size={14} className="text-blue-400" />
              <span>Scheduled Slot: {dispatchItem.deliverySlot}</span>
            </div>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] bg-gray-900/95 backdrop-blur border-t border-gray-800 z-20">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await acceptOrder(dispatchItem.orderId);
                showToast(`Order #${dispatchItem.orderId} accepted!`, 'success');
              } catch (err) {
                const msg =
                  err instanceof Error ? err.message : 'Unable to accept order';
                showToast(msg, 'error');
              } finally {
                setBusy(false);
              }
            }}
            className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold text-base shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 transition"
          >
            <PackagePlus size={20} />{' '}
            {busy ? 'Accepting...' : 'Accept Delivery Request'}
          </button>
        </div>
      </div>
    );
  }

  // Full assigned order view
  const assignedOrder = order!;
  const isAssignedToMe = assignedOrder.assignedToUid === deliveryUser.uid;
  const customerName = assignedOrder.customerName || 'Customer';
  const customerPhone = assignedOrder.customerPhone || 'Not provided';
  const fullAddress = assignedOrder.address?.street
    ? `${assignedOrder.address.street}, ${assignedOrder.address.city} - ${assignedOrder.address.zip}`
    : 'Customer Address';

  const handlePickup = async () => {
    setBusy(true);
    try {
      await updateDeliveryOrderStatus(assignedOrder.id, 'packed');
      setShowPickupModal(false);
      showToast('Package marked as picked up from hub', 'success');
    } catch {
      showToast('Unable to update pickup status. Please retry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleStartDelivery = async () => {
    setBusy(true);
    try {
      await updateDeliveryOrderStatus(assignedOrder.id, 'out_for_delivery');
      showToast('Trip started — Live GPS sharing enabled!', 'info');
    } catch {
      showToast('Unable to start trip. Please retry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProof(true);
    try {
      const uploaded = await uploadCompressedMedia(file, 'proof');
      setProofUrl(uploaded.url);
      const kb = Math.max(1, Math.round(uploaded.sizeBytes / 1024));
      setProofInfo(`${kb} KB compressed`);
      showToast(`Delivery proof uploaded (${kb} KB)`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Proof image compression/upload failed';
      showToast(msg, 'error');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleCompleteDelivery = async () => {
    setPinError('');
    const expectedPin = assignedOrder.deliveryPin;
    if (!expectedPin || customerOtp !== expectedPin) {
      setPinError(
        'Incorrect customer delivery PIN. Ask the customer for the 4-digit PIN shown in their Orders page.'
      );
      return;
    }

    setBusy(true);
    try {
      await updateDeliveryOrderStatus(
        assignedOrder.id,
        'delivered',
        undefined,
        proofUrl || undefined
      );
      setShowDeliveryModal(false);
      showToast(`Order #${assignedOrder.id} delivered! +₹45 credited to wallet`, 'success');
      navigate('/delivery/dashboard');
    } catch {
      showToast('Could not complete delivery. Please check connection and retry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleFailedDelivery = async () => {
    if (!failedReason) return;
    setBusy(true);
    try {
      await updateDeliveryOrderStatus(
        assignedOrder.id,
        'cancelled',
        failedReason
      );
      setShowFailedModal(false);
      showToast(
        `Order #${assignedOrder.id} marked as failed: ${failedReason}`,
        'info'
      );
      navigate('/delivery/dashboard');
    } catch {
      showToast('Unable to submit failed return. Please retry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCollectCash = async () => {
    setBusy(true);
    try {
      await collectDeliveryPayment(assignedOrder.id);
      showToast(
        `Collected ${formatCurrency(assignedOrder.total)} cash for #${assignedOrder.id}`,
        'success'
      );
    } catch {
      showToast('Failed to record COD collection. Please retry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-40">
      {/* Header */}
      <div className="bg-gray-800 p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10 border-b border-gray-700 safe-top">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-700 rounded-full text-gray-300"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-lg">Order #{assignedOrder.id}</h1>
          <p className="text-xs text-gray-400">{assignedOrder.deliverySlot}</p>
        </div>
        <span
          className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
            assignedOrder.status === 'delivered'
              ? 'bg-green-500/20 text-green-400'
              : assignedOrder.status === 'out_for_delivery'
              ? 'bg-blue-500/20 text-blue-400'
              : assignedOrder.status === 'packed'
              ? 'bg-yellow-500/20 text-yellow-400'
              : assignedOrder.status === 'cancelled'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-orange-500/20 text-orange-400'
          }`}
        >
          {assignedOrder.status.replace(/_/g, ' ').toUpperCase()}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Live GPS Telemetry Bar (shown when active) */}
        {isAssignedToMe &&
          (assignedOrder.status === 'packed' ||
            assignedOrder.status === 'out_for_delivery') && (
            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    gpsStatus === 'streaming'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  <Radio
                    size={18}
                    className={gpsStatus === 'streaming' ? 'animate-pulse' : ''}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white">
                    {gpsStatus === 'streaming'
                      ? 'Live GPS Streaming (10s / 30m throttle)'
                      : gpsStatus === 'denied'
                      ? 'Location permission denied'
                      : 'GPS paused'}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {lastPingCoords
                      ? `Last ping ${lastPingCoords.time} (${lastPingCoords.lat.toFixed(4)}, ${lastPingCoords.lng.toFixed(4)})`
                      : 'Acquiring GPS coordinates...'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGpsEnabled((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition shrink-0 ${
                  gpsEnabled
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                    : 'bg-gray-700 border-gray-600 text-gray-300'
                }`}
              >
                {gpsEnabled ? 'Pause GPS' : 'Resume GPS'}
              </button>
            </div>
          )}

        {/* Customer Details */}
        <div className="bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-700">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            Customer Details
          </h2>
          <div className="mb-4">
            <h3 className="font-bold text-lg text-white">{customerName}</h3>
            <p className="text-gray-300 text-sm mt-1">{fullAddress}</p>
            <p className="text-gray-400 text-xs mt-1">Phone: {customerPhone}</p>
          </div>

          <div className="flex gap-3">
            {assignedOrder.customerPhone && (
              <a
                href={`tel:${assignedOrder.customerPhone}`}
                className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 border border-blue-500/30 text-sm transition"
              >
                <Phone size={16} /> Call Customer
              </a>
            )}
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                fullAddress
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 border border-green-500/30 text-sm transition"
            >
              <Navigation size={16} /> Open Maps
            </a>
          </div>
        </div>

        {/* Items List */}
        {assignedOrder.items && assignedOrder.items.length > 0 && (
          <div className="bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-700">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
              Items in Package ({assignedOrder.items.length})
            </h2>
            <div className="space-y-2.5">
              {assignedOrder.items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center bg-gray-900/60 p-2.5 rounded-lg border border-gray-700/40 text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-9 h-9 object-cover rounded bg-gray-800"
                    />
                    <div>
                      <p className="font-medium text-white">{item.name}</p>
                      <p className="text-xs text-gray-400">
                        {item.selectedWeight >= 1000
                          ? `${item.selectedWeight / 1000}kg`
                          : `${item.selectedWeight}g`}{' '}
                        × {item.quantity}
                      </p>
                    </div>
                  </div>
                  <span className="font-bold text-green-400">
                    {formatCurrency(
                      (item.pricePerKg / 1000) *
                        item.selectedWeight *
                        item.quantity
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Payment Status */}
        <div className="bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-700">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            Payment Info
          </h2>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-gray-400">Total Bill</p>
              <p className="text-2xl font-bold text-white">
                {formatCurrency(assignedOrder.total)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Method: {assignedOrder.paymentMethod.toUpperCase()}
              </p>
            </div>
            <div
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                assignedOrder.paymentStatus === 'collected' ||
                assignedOrder.paymentStatus === 'paid'
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
              }`}
            >
              {(assignedOrder.paymentStatus || 'pending').toUpperCase()}
            </div>
          </div>

          {isAssignedToMe &&
            assignedOrder.paymentMethod === 'cod' &&
            assignedOrder.paymentStatus !== 'collected' &&
            assignedOrder.status !== 'cancelled' && (
              <button
                disabled={busy}
                onClick={handleCollectCash}
                className="w-full mt-4 bg-orange-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-orange-500 disabled:opacity-60 transition shadow-md"
              >
                <IndianRupee size={18} /> Mark ₹{assignedOrder.total} Cash
                Collected
              </button>
            )}
        </div>

        {/* Order Status Timeline */}
        <div className="bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-700">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            Live Progress
          </h2>
          <div className="space-y-5 relative pl-4 border-l-2 border-gray-700 ml-2">
            <div className="relative">
              <div className="absolute -left-[21px] top-0 w-4 h-4 rounded-full bg-green-500 border-2 border-gray-800 shadow-sm"></div>
              <p className="font-bold text-sm text-white">Order Placed</p>
              <p className="text-xs text-gray-400">
                {assignedOrder.assignedToName
                  ? `Assigned to ${assignedOrder.assignedToName}`
                  : 'Awaiting driver acceptance'}
              </p>
            </div>

            <div
              className={`relative ${
                ['packed', 'out_for_delivery', 'delivered'].includes(
                  assignedOrder.status
                )
                  ? 'opacity-100'
                  : 'opacity-40'
              }`}
            >
              <div
                className={`absolute -left-[21px] top-0 w-4 h-4 rounded-full border-2 border-gray-800 shadow-sm ${
                  ['packed', 'out_for_delivery', 'delivered'].includes(
                    assignedOrder.status
                  )
                    ? 'bg-green-500'
                    : 'bg-gray-600'
                }`}
              ></div>
              <p className="font-bold text-sm text-white">
                Packed &amp; Picked Up at Hub
              </p>
              <p className="text-xs text-gray-400">Package verified by partner</p>
            </div>

            <div
              className={`relative ${
                ['out_for_delivery', 'delivered'].includes(assignedOrder.status)
                  ? 'opacity-100'
                  : 'opacity-40'
              }`}
            >
              <div
                className={`absolute -left-[21px] top-0 w-4 h-4 rounded-full border-2 border-gray-800 shadow-sm ${
                  ['out_for_delivery', 'delivered'].includes(
                    assignedOrder.status
                  )
                    ? 'bg-green-500'
                    : 'bg-gray-600'
                }`}
              ></div>
              <p className="font-bold text-sm text-white">Out for Delivery</p>
              <p className="text-xs text-gray-400">
                Driver en-route to customer address
              </p>
            </div>

            <div
              className={`relative ${
                assignedOrder.status === 'delivered'
                  ? 'opacity-100'
                  : 'opacity-40'
              }`}
            >
              <div
                className={`absolute -left-[21px] top-0 w-4 h-4 rounded-full border-2 border-gray-800 shadow-sm ${
                  assignedOrder.status === 'delivered'
                    ? 'bg-green-500'
                    : 'bg-gray-600'
                }`}
              ></div>
              <p className="font-bold text-sm text-white">Delivered</p>
              <p className="text-xs text-gray-400">
                Handed over to customer with 4-digit PIN verification
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {isAssignedToMe &&
        assignedOrder.status !== 'delivered' &&
        assignedOrder.status !== 'cancelled' && (
          <div className="fixed bottom-0 left-0 right-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] bg-gray-900/95 backdrop-blur border-t border-gray-800 flex flex-col gap-3 z-20">
            {assignedOrder.status === 'placed' && (
              <button
                onClick={() => setShowPickupModal(true)}
                className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold text-base shadow-lg shadow-green-600/20 active:scale-[0.98] transition"
              >
                Pick Up Package from Hub
              </button>
            )}

            {assignedOrder.status === 'packed' && (
              <button
                disabled={busy}
                onClick={handleStartDelivery}
                className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold text-base shadow-lg shadow-blue-600/20 disabled:opacity-60 active:scale-[0.98] transition"
              >
                {busy ? 'Starting Trip...' : 'Start Trip (Out for Delivery)'}
              </button>
            )}

            {assignedOrder.status === 'out_for_delivery' && (
              <>
                <button
                  onClick={() => {
                    setCustomerOtp('');
                    setPinError('');
                    setProofUrl('');
                    setProofInfo('');
                    setShowDeliveryModal(true);
                  }}
                  className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold text-base shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 active:scale-[0.98] transition"
                >
                  <CheckCircle size={20} /> Confirm Delivery
                </button>

                <button
                  onClick={() => setShowFailedModal(true)}
                  className="w-full bg-red-500/10 text-red-400 py-2.5 rounded-xl font-bold border border-red-500/20 text-sm active:scale-[0.98] transition"
                >
                  Mark as Failed / Cancel Trip
                </button>
              </>
            )}
          </div>
        )}

      {/* Pickup Modal */}
      {showPickupModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 p-6 pb-8 space-y-4">
            <div className="flex justify-between items-center border-b border-gray-700 pb-3">
              <h2 className="text-lg font-bold">Confirm Hub Pickup</h2>
              <button
                onClick={() => setShowPickupModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <XCircle size={24} />
              </button>
            </div>
            <p className="text-sm text-gray-300">
              Package #{assignedOrder.id} containing{' '}
              {assignedOrder.items?.length || 0} items.
            </p>
            <div className="p-3 bg-gray-900 rounded-lg text-xs text-gray-400 space-y-1">
              <p>• Check seal &amp; package condition</p>
              <p>• Verify delivery address matches destination</p>
            </div>
            <button
              disabled={busy}
              onClick={handlePickup}
              className="w-full bg-green-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-green-600/20 disabled:opacity-60"
            >
              {busy ? 'Confirming...' : 'Confirm Package Picked Up'}
            </button>
          </div>
        </div>
      )}

      {/* Delivery Confirmation Modal */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-gray-700 pb-3">
              <h2 className="text-lg font-bold">Delivery PIN &amp; Photo Proof</h2>
              <button
                onClick={() => setShowDeliveryModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2 text-center uppercase tracking-wider">
                Enter Customer&apos;s 4-Digit Delivery PIN
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={customerOtp}
                onChange={(e) => {
                  setCustomerOtp(
                    e.target.value.replace(/\D/g, '').slice(0, 4)
                  );
                  setPinError('');
                }}
                placeholder="••••"
                className="w-full text-center text-3xl tracking-widest py-3 bg-gray-900 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white font-mono"
              />
              {pinError && (
                <p className="text-xs text-center text-red-400 mt-2 font-medium">
                  {pinError}
                </p>
              )}
            </div>

            {/* On-Device Compressed Photo Proof (< 200 KB) */}
            <div className="bg-gray-900 p-3.5 rounded-xl border border-gray-700 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                  <Camera size={14} className="text-green-400" />
                  Delivery Photo Proof (Optional)
                </span>
                {proofInfo && (
                  <span className="text-[10px] font-bold bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                    {proofInfo}
                  </span>
                )}
              </div>

              {proofUrl && (
                <img
                  src={proofUrl}
                  alt="Compressed delivery proof"
                  className="w-full h-32 object-cover rounded-lg border border-gray-700"
                />
              )}

              <label className="w-full py-2.5 px-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-xs font-bold text-gray-200 flex items-center justify-center gap-2 cursor-pointer transition">
                <Camera size={15} />
                {uploadingProof
                  ? 'Compressing (<200KB) & Uploading...'
                  : proofUrl
                  ? 'Retake Delivery Photo'
                  : 'Capture / Upload Photo (<200KB)'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleProofFileChange}
                  disabled={uploadingProof}
                  className="hidden"
                />
              </label>
            </div>

            <button
              onClick={handleCompleteDelivery}
              disabled={customerOtp.length !== 4 || busy || uploadingProof}
              className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-green-600/20 disabled:bg-gray-700 disabled:text-gray-500"
            >
              {busy ? 'Completing...' : 'Verify PIN & Mark Delivered'}
            </button>
          </div>
        </div>
      )}

      {/* Failed Modal */}
      {showFailedModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-gray-700 pb-3">
              <h2 className="text-lg font-bold text-red-400 flex items-center gap-2">
                <AlertTriangle size={20} /> Failed Delivery
              </h2>
              <button
                onClick={() => setShowFailedModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <XCircle size={24} />
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Select reason for order return:
            </p>
            <div className="space-y-2">
              {[
                'Customer Not Available',
                'Address Incorrect',
                'Customer Rejected Order'
              ].map((r) => (
                <button
                  key={r}
                  onClick={() => setFailedReason(r)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm border ${
                    failedReason === r
                      ? 'bg-red-500/20 border-red-500 text-red-300'
                      : 'bg-gray-900 border-gray-700 text-gray-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              onClick={handleFailedDelivery}
              disabled={!failedReason || busy}
              className="w-full bg-red-600 text-white py-3 rounded-xl font-bold disabled:bg-gray-700 disabled:text-gray-500"
            >
              {busy ? 'Submitting...' : 'Submit Failed Return'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
