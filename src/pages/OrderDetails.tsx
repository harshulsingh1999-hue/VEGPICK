import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { formatCurrency, formatPaymentMethodLabel, getOrderBillingBreakdown, getProductFrontImage } from '../lib/utils';
import { db } from '../lib/firebase';
import { ActiveDelivery } from '../lib/data';
import {
  CheckCircle,
  Circle,
  ArrowLeft,
  Phone,
  MapPin,
  Star,
  Truck,
  AlertCircle,
  MessageSquare,
  KeyRound,
  Navigation,
  Camera,
  XCircle,
  Tag
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const STEPS = [
  { id: 'placed', label: 'Order Placed' },
  { id: 'packed', label: 'Packed & Dispatched' },
  { id: 'out_for_delivery', label: 'Out for Delivery' },
  { id: 'delivered', label: 'Delivered' }
];

export const OrderDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { orders, allOrders, user, firebaseUser, isAdmin } = useAuth();
  const { addComplaint, appSettings } = useStore();
  const { showToast } = useToast();

  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [complaintSubject, setComplaintSubject] = useState('');
  const [complaintDescription, setComplaintDescription] = useState('');
  const [submittingComplaint, setSubmittingComplaint] = useState(false);
  const [liveTelemetry, setLiveTelemetry] = useState<ActiveDelivery | null>(null);

  const order = orders.find((o) => o.id === id) || allOrders.find((o) => o.id === id);

  // Subscribe to ephemeral /active_deliveries/{orderId} live GPS stream when active
  useEffect(() => {
    if (
      !firebaseUser ||
      !order ||
      order.status === 'delivered' ||
      order.status === 'cancelled'
    ) {
      setLiveTelemetry(null);
      return undefined;
    }

    const q = isAdmin
      ? query(collection(db, 'active_deliveries'), where('orderId', '==', order.id))
      : query(
          collection(db, 'active_deliveries'),
          where('orderId', '==', order.id),
          where('customerUid', '==', firebaseUser.uid)
        );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setLiveTelemetry(null);
          return;
        }
        const docSnap = snapshot.docs[0];
        setLiveTelemetry({ ...(docSnap.data() as ActiveDelivery), orderId: docSnap.id });
      },
      () => {
        setLiveTelemetry(null);
      }
    );

    return () => unsub();
  }, [firebaseUser, order?.id, order?.status, isAdmin]);

  if (!order) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Order Not Found</h2>
        <p className="text-gray-500 text-sm mb-6 max-w-xs">
          We couldn&apos;t locate order #{id}. Make sure you are signed in with the account used to place the order.
        </p>
        <button
          onClick={() => navigate('/orders')}
          className="bg-green-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-green-700 transition-colors"
        >
          Back to My Orders
        </button>
      </div>
    );
  }

  const currentStepIndex = STEPS.findIndex((s) => s.id === order.status);

  const mapSubjectToCategory = (topic: string): 'Quality' | 'Delay' | 'Missing Item' | 'Refund' | 'Other' => {
    if (topic.includes('Damaged')) return 'Quality';
    if (topic.includes('Missing')) return 'Missing Item';
    if (topic.includes('Delayed')) return 'Delay';
    if (topic.includes('Billing')) return 'Refund';
    return 'Other';
  };

  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      showToast('Please sign in to submit a support ticket.', 'error');
      return;
    }
    if (!complaintSubject.trim() || !complaintDescription.trim()) {
      showToast('Please fill in both subject and description', 'error');
      return;
    }

    setSubmittingComplaint(true);
    try {
      await addComplaint({
        customerName: order.customerName || user?.name || 'Customer',
        customerPhone: order.customerPhone || user?.phone || '9000000000',
        orderId: order.id,
        category: mapSubjectToCategory(complaintSubject),
        subject: complaintSubject.trim(),
        description: complaintDescription.trim(),
        status: 'open'
      });

      showToast('Your support ticket has been submitted to store administration.', 'success');
      setShowComplaintModal(false);
      setComplaintSubject('');
      setComplaintDescription('');
    } catch {
      showToast('Failed to submit support ticket. Please check your connection and retry.', 'error');
    } finally {
      setSubmittingComplaint(false);
    }
  };

  const addressText = order.address?.street
    ? `${order.address.street}, ${order.address.city || ''} ${order.address.zip || ''}`.trim()
    : 'Delivery Address';

  const formatPingTime = (ts: unknown): string => {
    if (ts && typeof ts === 'object' && 'toDate' in ts) {
      return (ts as { toDate: () => Date }).toDate().toLocaleTimeString();
    }
    return 'Just now';
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/orders')} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Order #{order.id}</h1>
            <p className="text-xs text-gray-500">{new Date(order.date).toLocaleString()}</p>
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
          order.status === 'delivered' ? 'bg-green-100 text-green-700' :
          order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {order.status.replace(/_/g, ' ').toUpperCase()}
        </span>
      </div>

      {/* Real Delivery Verification PIN */}
      {order.status !== 'delivered' && order.status !== 'cancelled' && order.deliveryPin && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center">
              <KeyRound size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Delivery Confirmation PIN</p>
              <p className="text-xs text-amber-700">Share this 4-digit PIN with your delivery partner upon arrival</p>
            </div>
          </div>
          <span className="font-mono font-extrabold text-xl tracking-widest bg-white px-3.5 py-1.5 rounded-xl border border-amber-300 text-amber-900">
            {order.deliveryPin}
          </span>
        </div>
      )}

      {/* Ephemeral Live Rider GPS Telemetry Card */}
      {liveTelemetry && (Math.abs(liveTelemetry.lat) > 0.0001 || Math.abs(liveTelemetry.lng) > 0.0001) ? (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl mb-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-blue-600 text-white rounded-full flex items-center justify-center">
                <Navigation size={18} />
              </div>
              <div>
                <p className="text-xs font-bold text-blue-900 uppercase tracking-wider">Live Rider GPS Location</p>
                <p className="text-xs text-blue-700">
                  {liveTelemetry.partnerName} • Updated {formatPingTime(liveTelemetry.updatedAt)}
                </p>
              </div>
            </div>
            <span className="text-[11px] font-bold bg-blue-600 text-white px-2.5 py-1 rounded-full animate-pulse">
              LIVE
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs bg-white/90 p-2.5 rounded-xl border border-blue-100">
            <div>
              <span className="text-gray-400 block text-[10px]">COORDINATES</span>
              <span className="font-mono font-bold text-gray-800">
                {liveTelemetry.lat.toFixed(4)}, {liveTelemetry.lng.toFixed(4)}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">ACCURACY</span>
              <span className="font-bold text-gray-800">±{Math.round(liveTelemetry.accuracy)}m</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">SPEED</span>
              <span className="font-bold text-gray-800">{Math.round((liveTelemetry.speed || 0) * 3.6)} km/h</span>
            </div>
          </div>

          <a
            href={`https://www.google.com/maps/search/?api=1&query=${liveTelemetry.lat},${liveTelemetry.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition"
          >
            <MapPin size={15} /> View Rider Pin in Google Maps
          </a>
        </div>
      ) : (
        order.assignedToName &&
        (order.status === 'packed' || order.status === 'out_for_delivery') && (
          <div className="bg-blue-50/70 border border-blue-200 p-3.5 rounded-2xl mb-5 flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center shrink-0">
              <Navigation size={16} />
            </div>
            <div>
              <p className="text-xs font-bold text-blue-900">
                {order.assignedToName} is assigned to your delivery
              </p>
              <p className="text-[11px] text-blue-700">
                Live GPS pin will appear automatically once your partner starts route location sharing.
              </p>
            </div>
          </div>
        )
      )}

      {/* Tracking Timeline */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 mb-5">
        <h2 className="font-bold text-gray-800 text-sm mb-4">Live Tracking</h2>
        {order.status === 'cancelled' ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <XCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-800">This order was cancelled</p>
              <p className="text-xs text-red-700 mt-0.5">
                {order.failureReason
                  ? `Reason: ${order.failureReason}`
                  : 'Order cancelled prior to delivery completion.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="relative pl-1">
            <div className="absolute left-[13px] top-2 bottom-2 w-[2px] bg-gray-100"></div>
            <div className="space-y-5 relative">
              {STEPS.map((step, index) => {
                const isCompleted = index <= currentStepIndex;
                const isCurrent = index === currentStepIndex;

                return (
                  <div key={step.id} className="flex items-start gap-4">
                    <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                      isCompleted ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-200 text-gray-400'
                    }`}>
                      {isCompleted ? <CheckCircle size={14} /> : <Circle size={8} />}
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${isCompleted ? 'text-gray-800' : 'text-gray-400'}`}>
                        {step.label}
                      </p>
                      {isCurrent && order.status !== 'delivered' && (
                        <p className="text-xs text-green-600 mt-0.5 font-medium animate-pulse">In Progress...</p>
                      )}
                      {isCompleted && !isCurrent && (
                        <p className="text-xs text-gray-400 mt-0.5">Completed</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {order.status === 'delivered' && (
          <div className="mt-5 pt-4 border-t border-gray-100 space-y-3">
            {order.proofImageUrl && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-green-800">
                  <Camera size={14} /> Delivery Photo Proof
                </div>
                <img
                  src={order.proofImageUrl}
                  alt={`Delivery proof for order ${order.id}`}
                  className="w-full max-h-56 object-cover rounded-lg border border-green-200 bg-white"
                />
              </div>
            )}
            <button
              onClick={() => showToast('Thank you for your rating!', 'success')}
              className="w-full py-2.5 border border-green-600 text-green-700 rounded-xl font-medium hover:bg-green-50 flex items-center justify-center gap-2 transition-colors"
            >
              <Star size={18} className="text-yellow-500 fill-yellow-500" />
              Rate this Order
            </button>
          </div>
        )}
      </div>

      {order.assignedToName && (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 text-white rounded-full flex items-center justify-center">
              <Truck size={20} />
            </div>
            <div>
              <p className="text-xs text-emerald-700 font-semibold uppercase tracking-wider">Assigned Delivery Partner</p>
              <p className="text-sm font-bold text-gray-900">{order.assignedToName}</p>
            </div>
          </div>
          <span className="text-xs bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-medium">On Duty</span>
        </div>
      )}

      {/* Items List */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 mb-5">
        <h2 className="font-bold text-gray-800 text-sm mb-4">Ordered Items ({order.items?.length || 0})</h2>
        <div className="space-y-3">
          {order.items?.map((item, i) => (
            <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-b-0">
              <div className="flex items-center gap-3">
                <img
                  src={getProductFrontImage(item)}
                  alt={item.name}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-xl object-cover bg-gray-50 border border-gray-100"
                />
                <div>
                  <p className="text-sm font-bold text-gray-800">{item.name}</p>
                  <p className="text-xs text-gray-500">{item.selectedWeight}g × {item.quantity}</p>
                </div>
              </div>
              <p className="text-sm font-bold text-gray-800">
                {formatCurrency((item.pricePerKg / 1000) * item.selectedWeight * item.quantity)}
              </p>
            </div>
          ))}

          {(() => {
            const billing = getOrderBillingBreakdown(order, appSettings);
            return (
              <div className="pt-3 mt-2 border-t border-gray-100 space-y-2 text-xs">
                <div className="flex justify-between text-gray-600">
                  <span>Order Total (Items Subtotal)</span>
                  <span className="font-semibold text-gray-800">{formatCurrency(billing.subtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>+ GST / Taxes{billing.taxRate > 0 ? ` (${billing.taxRate}%)` : ''}</span>
                  <span className="font-semibold text-gray-800">+ {formatCurrency(billing.taxAmount)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>+ Delivery Fees</span>
                  {billing.deliveryFee === 0 ? (
                    <span className="font-bold text-green-600">Free (₹0)</span>
                  ) : (
                    <span className="font-semibold text-gray-800">+ {formatCurrency(billing.deliveryFee)}</span>
                  )}
                </div>
                {(billing.discountAmount > 0 || billing.couponCode) && (
                  <div className="flex justify-between items-center text-green-700 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      - Discount Coupon
                      {billing.couponCode && (
                        <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-mono font-bold text-[10px]">
                          <Tag size={10} /> {billing.couponCode}
                        </span>
                      )}
                    </span>
                    <span className="font-bold">- {formatCurrency(billing.discountAmount)}</span>
                  </div>
                )}
                <div className="pt-2.5 border-t border-gray-200 flex justify-between items-center font-bold text-base">
                  <span className="text-gray-800">Grand Total</span>
                  <span className="text-green-700">{formatCurrency(billing.grandTotal)}</span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Delivery & Payment Details */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 mb-5 space-y-4">
        <h2 className="font-bold text-gray-800 text-sm">Delivery &amp; Payment Info</h2>

        <div className="flex items-start gap-3">
          <MapPin className="text-gray-400 mt-1 shrink-0" size={18} />
          <div>
            <p className="font-semibold text-xs text-gray-500 uppercase">Delivery Address</p>
            <p className="text-sm text-gray-800 font-medium">{addressText}</p>
            <p className="text-xs text-gray-500 mt-0.5">Slot: {order.deliverySlot}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Phone className="text-gray-400 mt-1 shrink-0" size={18} />
          <div>
            <p className="font-semibold text-xs text-gray-500 uppercase">Contact Phone</p>
            <p className="text-sm text-gray-800 font-medium">{order.customerPhone || user?.phone}</p>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-100 flex justify-between items-center text-sm">
          <span className="text-gray-600">Payment Mode</span>
          <span className="font-bold text-gray-800">
            {order.paymentChannelLabel || formatPaymentMethodLabel(order.paymentMethod)}
            {order.cardLast4 ? ` (${order.cardNetwork || 'Card'} •••• ${order.cardLast4})` : ''}
          </span>
        </div>
        {order.paymentReference && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">Payment Reference / UTR</span>
            <span className="font-mono text-xs font-bold text-gray-800">{order.paymentReference}</span>
          </div>
        )}
        {order.settlementTargetSummary && (
          <div className="flex justify-between items-start gap-3 text-sm">
            <span className="text-gray-600 shrink-0">Settled To</span>
            <span className="text-xs font-medium text-emerald-700 text-right">{order.settlementTargetSummary}</span>
          </div>
        )}
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">Payment Status</span>
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
            order.paymentStatus === 'paid' || order.paymentStatus === 'collected'
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {(order.paymentStatus || 'pending').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Report Issue */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800 text-sm">Need Help with this Order?</h3>
            <p className="text-xs text-gray-500 mt-0.5">Have an issue with produce quality, missing item, or delivery?</p>
          </div>
          <button
            onClick={() => setShowComplaintModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-colors"
          >
            <MessageSquare size={14} />
            Report Issue
          </button>
        </div>
      </div>

      {/* Complaint Modal */}
      {showComplaintModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-xl animate-in zoom-in-95">
            <h3 className="font-bold text-lg text-gray-900 mb-1">Report an Issue</h3>
            <p className="text-xs text-gray-500 mb-4">Order #{order.id} will be linked to this support ticket.</p>

            <form onSubmit={handleSubmitComplaint} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Issue Topic</label>
                <select
                  value={complaintSubject}
                  onChange={(e) => setComplaintSubject(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none"
                  required
                >
                  <option value="">Select an issue category</option>
                  <option value="Damaged or spoiled produce">Damaged or spoiled produce</option>
                  <option value="Missing item in package">Missing item in package</option>
                  <option value="Delayed delivery">Delayed delivery</option>
                  <option value="Incorrect weight or quantity">Incorrect weight or quantity</option>
                  <option value="Billing or payment query">Billing or payment query</option>
                  <option value="Other complaint">Other complaint</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Details &amp; Description</label>
                <textarea
                  value={complaintDescription}
                  onChange={(e) => setComplaintDescription(e.target.value)}
                  placeholder="Please describe what happened..."
                  rows={4}
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowComplaintModal(false)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingComplaint}
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-60"
                >
                  {submittingComplaint ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
