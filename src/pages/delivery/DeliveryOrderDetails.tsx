import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
  Camera,
  Settings2
} from 'lucide-react';
import { formatCurrency, formatPaymentMethodLabel, getProductFrontImage } from '../../lib/utils';
import { haversineDistanceMeters, uploadCompressedMedia } from '../../lib/imageUtils';
import { LocationPermissionModal } from '../../components/delivery/LocationPermissionModal';
import { PushPermissionBanner } from '../../components/PushPermissionBanner';
import {
  GeoPermissionState,
  openDeviceLocationSettingsDirectly,
  subscribeGeolocationPermissionChange
} from '../../lib/locationPermission';
import {
  enableAndSubscribePush,
  getNotificationPermissionState,
  sendLocationPermissionPushReminder
} from '../../lib/pushNotifications';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [geoPermission, setGeoPermission] = useState<GeoPermissionState>('prompt');
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'streaming' | 'denied' | 'error' | 'unsupported'>('idle');
  const [gpsErrorMsg, setGpsErrorMsg] = useState('');
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [lastPingCoords, setLastPingCoords] = useState<{ lat: number; lng: number; time: string } | null>(null);
  const lastPingRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null);

  useEffect(() => {
    return subscribeGeolocationPermissionChange(setGeoPermission);
  }, []);

  // Proof photo upload state (< 200 KB compressed)
  const [proofUrl, setProofUrl] = useState('');
  const [proofInfo, setProofInfo] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);

  const order = assignedOrders.find((o) => o.id === id);
  const dispatchItem = !order
    ? availableOrders.find((f) => f.orderId === id)
    : undefined;

  const orderRef = useRef(order);
  orderRef.current = order;

  const handleGoBack = () => {
    const historyState = window.history.state as { idx?: number } | null;
    if (historyState && typeof historyState.idx === 'number' && historyState.idx > 0) {
      navigate(-1);
    } else {
      navigate('/delivery/dashboard', { replace: true });
    }
  };

  useEffect(() => {
    setProofUrl('');
    setProofInfo('');
    setCustomerOtp('');
    setPinError('');
    lastPingRef.current = null;
    setLastPingCoords(null);
  }, [id]);

  useEffect(() => {
    if (authReady && !partnerLoading && (!deliveryUser || !deliveryUser.isApproved)) {
      navigate('/delivery/login', { replace: true });
    }
  }, [authReady, partnerLoading, deliveryUser, navigate]);

  // Stream rider GPS to ephemeral /active_deliveries/{orderId} throttled to >= 10s OR >= 30m
  const orderId = order?.id;
  const orderStatus = order?.status;
  const orderAssignedUid = order?.assignedToUid;

  useEffect(() => {
    if (
      !gpsEnabled ||
      !orderId ||
      !deliveryUser?.isApproved ||
      orderAssignedUid !== deliveryUser.uid ||
      (orderStatus !== 'packed' && orderStatus !== 'out_for_delivery')
    ) {
      setGpsStatus('idle');
      setGpsErrorMsg('');
      return undefined;
    }

    if (!('geolocation' in navigator)) {
      setGpsStatus('unsupported');
      setGpsErrorMsg('Device browser does not support GPS geolocation.');
      return undefined;
    }

    setGpsStatus('streaming');
    setGpsErrorMsg('');
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const latestOrder = orderRef.current;
        if (!latestOrder) return;
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
          setGpsStatus('streaming');
          setGpsErrorMsg('');
          setLastPingCoords({
            lat: latitude,
            lng: longitude,
            time: new Date(now).toLocaleTimeString()
          });
          upsertActiveGpsLocation(latestOrder, {
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
          setGpsErrorMsg('Location access denied. Enable GPS permission in browser settings.');
        } else {
          setGpsStatus('error');
          setGpsErrorMsg('GPS signal temporarily weak — retrying automatically.');
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
  }, [gpsEnabled, orderId, orderStatus, orderAssignedUid, deliveryUser?.isApproved, deliveryUser?.uid, upsertActiveGpsLocation]);

  const triggerLocationPermissionPushFallback = useCallback(async (targetOrderId: string) => {
    if (getNotificationPermissionState() === 'default') {
      await enableAndSubscribePush({ role: 'delivery', sendTest: false });
    }
    if (getNotificationPermissionState() === 'granted') {
      await sendLocationPermissionPushReminder({
        url: `/delivery/order/${targetOrderId}`,
        orderId: targetOrderId
      });
    }
  }, []);

  const openDirectLocationSettings = useCallback(() => {
    setSyncingNow(false);
    openDeviceLocationSettingsDirectly('location_source');
    setShowLocationModal(true);
  }, []);

  const handleManualGpsRefresh = useCallback(() => {
    const latestOrder = orderRef.current;
    if (!latestOrder) return;
    if (!('geolocation' in navigator) || geoPermission === 'unsupported') {
      setGpsStatus('unsupported');
      setGpsErrorMsg('Open Device Location Settings to allow GPS access.');
      openDirectLocationSettings();
      void triggerLocationPermissionPushFallback(latestOrder.id);
      return;
    }

    if (geoPermission === 'denied') {
      setGpsStatus('denied');
      setGpsErrorMsg('Allow Location in Device Settings, then return here.');
      openDirectLocationSettings();
      void triggerLocationPermissionPushFallback(latestOrder.id);
      return;
    }

    setSyncingNow(true);
    // Call geolocation synchronously on click to preserve Android/iOS user gesture
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSyncingNow(false);
        setGeoPermission('granted');
        const { latitude, longitude, accuracy, speed, heading } = position.coords;
        const now = Date.now();
        lastPingRef.current = { lat: latitude, lng: longitude, timestamp: now };
        setGpsEnabled(true);
        setGpsStatus('streaming');
        setGpsErrorMsg('');
        setShowLocationModal(false);
        setLastPingCoords({
          lat: latitude,
          lng: longitude,
          time: new Date(now).toLocaleTimeString()
        });
        void upsertActiveGpsLocation(latestOrder, {
          lat: latitude,
          lng: longitude,
          accuracy: accuracy ?? 15,
          speed: speed ?? 0,
          heading: heading ?? 0
        })
          .then(() => showToast('GPS location synced', 'success'))
          .catch(() => showToast('Failed to sync GPS ping.', 'error'));
      },
      (geoErr) => {
        setSyncingNow(false);
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          setGeoPermission('denied');
          setGpsStatus('denied');
          setGpsErrorMsg('Allow Location in Device Settings, then return here.');
        } else {
          setGpsStatus('error');
          setGpsErrorMsg('Turn ON Location in Device Settings and allow permission.');
        }
        openDirectLocationSettings();
        void triggerLocationPermissionPushFallback(latestOrder.id);
      },
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 6000 }
    );
  }, [geoPermission, openDirectLocationSettings, showToast, triggerLocationPermissionPushFallback, upsertActiveGpsLocation]);

  useEffect(() => {
    const onRequestSync = () => {
      handleManualGpsRefresh();
    };
    window.addEventListener('fv-request-location-sync', onRequestSync);
    return () => {
      window.removeEventListener('fv-request-location-sync', onRequestSync);
    };
  }, [handleManualGpsRefresh]);

  useEffect(() => {
    if (searchParams.get('syncLocation') === '1' && order?.id) {
      const next = new URLSearchParams(searchParams);
      next.delete('syncLocation');
      setSearchParams(next, { replace: true });
      handleManualGpsRefresh();
    }
  }, [searchParams, setSearchParams, order?.id, handleManualGpsRefresh]);

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
            onClick={handleGoBack}
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
                  {formatPaymentMethodLabel(dispatchItem.paymentMethod)})
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
                  err instanceof Error && !err.message.trim().startsWith('{')
                    ? err.message
                    : 'Unable to accept order. It may have been claimed or cancelled.';
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
    } catch (err) {
      const msg =
        err instanceof Error && !err.message.trim().startsWith('{')
          ? err.message
          : 'Unable to update pickup status. Please retry.';
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleStartDelivery = async () => {
    setBusy(true);
    try {
      await updateDeliveryOrderStatus(assignedOrder.id, 'out_for_delivery');
      showToast('Trip started — Live GPS sharing enabled!', 'info');
    } catch (err) {
      const msg =
        err instanceof Error && !err.message.trim().startsWith('{')
          ? err.message
          : 'Unable to start trip. Please retry.';
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.currentTarget;
    const file = inputEl.files?.[0];
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
      inputEl.value = '';
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
    } catch (err) {
      const msg =
        err instanceof Error && !err.message.trim().startsWith('{')
          ? err.message
          : 'Could not complete delivery. Please check connection and retry.';
      showToast(msg, 'error');
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
    } catch (err) {
      const msg =
        err instanceof Error && !err.message.trim().startsWith('{')
          ? err.message
          : 'Unable to submit failed return. Please retry.';
      showToast(msg, 'error');
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
    } catch (err) {
      const msg =
        err instanceof Error && !err.message.trim().startsWith('{')
          ? err.message
          : 'Failed to record COD collection. Please retry.';
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-40">
      {/* Header */}
      <div className="bg-gray-800 p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10 border-b border-gray-700 safe-top">
        <button
          onClick={handleGoBack}
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
        <PushPermissionBanner role="delivery" theme="dark" />

        {!isAssignedToMe && (
          <div className="bg-amber-500/15 border border-amber-500/30 p-3.5 rounded-xl flex items-center gap-2.5 text-xs text-amber-300">
            <AlertTriangle size={16} className="shrink-0" />
            <span>This trip is currently assigned to another partner ({assignedOrder.assignedToName || 'Reassigned'}).</span>
          </div>
        )}

        {/* Live GPS Telemetry Bar (shown when active) */}
        {isAssignedToMe &&
          (assignedOrder.status === 'packed' ||
            assignedOrder.status === 'out_for_delivery') && (
            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      gpsStatus === 'streaming'
                        ? 'bg-blue-500/20 text-blue-400'
                        : gpsStatus === 'denied' || gpsStatus === 'unsupported'
                        ? 'bg-red-500/20 text-red-400'
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
                        : gpsStatus === 'unsupported'
                        ? 'GPS unavailable on this device'
                        : gpsStatus === 'error'
                        ? 'GPS signal temporarily weak'
                        : 'GPS paused'}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {gpsErrorMsg
                        ? gpsErrorMsg
                        : lastPingCoords
                        ? `Last ping ${lastPingCoords.time} (${lastPingCoords.lat.toFixed(4)}, ${lastPingCoords.lng.toFixed(4)})`
                        : 'Acquiring GPS coordinates...'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={openDirectLocationSettings}
                    className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-amber-300 border border-gray-600"
                    title="Open Device Location Settings"
                  >
                    <Settings2 size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={syncingNow}
                    onClick={handleManualGpsRefresh}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold border bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white transition disabled:opacity-60"
                  >
                    {syncingNow ? 'Syncing...' : 'Sync Now'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setGpsEnabled((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                      gpsEnabled
                        ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                        : 'bg-gray-700 border-gray-600 text-gray-300'
                    }`}
                  >
                    {gpsEnabled ? 'Pause GPS' : 'Resume GPS'}
                  </button>
                </div>
              </div>

              {(gpsStatus === 'denied' || gpsStatus === 'unsupported') && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-red-200">
                    GPS blocked by device settings. Open device location settings to allow access.
                  </p>
                  <button
                    type="button"
                    onClick={openDirectLocationSettings}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Settings2 size={14} />
                    Open Location Settings
                  </button>
                </div>
              )}
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
                      src={getProductFrontImage(item)}
                      alt={item.name}
                      referrerPolicy="no-referrer"
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
                Method: {assignedOrder.paymentChannelLabel || formatPaymentMethodLabel(assignedOrder.paymentMethod)}
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
            assignedOrder.status !== 'delivered' &&
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
          {assignedOrder.status === 'cancelled' ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
              <XCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-red-300">Trip Cancelled / Returned</p>
                <p className="text-xs text-red-200/80 mt-0.5">
                  {assignedOrder.failureReason
                    ? `Reason: ${assignedOrder.failureReason}`
                    : 'Order was cancelled before delivery completion.'}
                </p>
              </div>
            </div>
          ) : (
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
          )}
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
                <div className="relative">
                  <img
                    src={proofUrl}
                    alt="Compressed delivery proof"
                    className="w-full h-32 object-cover rounded-lg border border-gray-700"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setProofUrl('');
                      setProofInfo('');
                    }}
                    className="mt-2 text-[11px] font-bold text-red-400 hover:underline"
                  >
                    Remove Photo
                  </button>
                </div>
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
      <LocationPermissionModal
        open={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onRetrySync={handleManualGpsRefresh}
        orderId={assignedOrder.id}
        targetRoute={`/delivery/order/${assignedOrder.id}`}
      />
    </div>
  );
};
