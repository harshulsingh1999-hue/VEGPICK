import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency } from '../lib/utils';
import { useNavigate } from 'react-router-dom';
import { CreditCard, CheckCircle, Tag, AlertTriangle, X, ArrowLeft } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { useToast } from '../context/ToastContext';
import { PhoneOtpAuthCard } from '../components/PhoneOtpAuthCard';
import { apiFetch } from '../lib/apiClient';

interface ApiSlotDay {
  dayOffset: number;
  isoDate: string;
  slots: string[];
}

export const Checkout = () => {
  const { cart, cartTotal, clearCart, coupons, appSettings, refreshCatalog } = useStore();
  const { user, firebaseUser, ensureCustomerProfile, updateProfile, placeOrder, addAddress } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const orderPlacedRef = useRef(false);
  const autoAdvancedStep1Ref = useRef(Boolean(user?.phone));

  const [step, setStep] = useState(user && user.phone ? 2 : 1);
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [savingPhone, setSavingPhone] = useState(false);

  const [selectedAddress, setSelectedAddress] = useState(user?.addresses?.[0]?.id || '');
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [newLabel, setNewLabel] = useState('Home');
  const [newStreet, setNewStreet] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newZip, setNewZip] = useState('');

  const [slotDays, setSlotDays] = useState<ApiSlotDay[]>([]);
  const [selectedDate, setSelectedDate] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'upi'>('cod');
  const [coupon, setCoupon] = useState('');
  const [discount, setDiscount] = useState(0);
  const [placingOrder, setPlacingOrder] = useState(false);

  useEffect(() => {
    if (cart.length === 0 && !orderPlacedRef.current) {
      navigate('/cart', { replace: true });
    }
  }, [cart.length, navigate]);

  useEffect(() => {
    if (firebaseUser && !user) {
      ensureCustomerProfile().catch(() => {
        // ignore
      });
    }
    if (!firebaseUser) {
      autoAdvancedStep1Ref.current = false;
    }
    if (user?.phone) {
      setContactPhone(user.phone);
      if (!autoAdvancedStep1Ref.current) {
        autoAdvancedStep1Ref.current = true;
        setStep((prev) => (prev === 1 ? 2 : prev));
      }
    }
    if (user?.addresses?.length && !selectedAddress) {
      setSelectedAddress(user.addresses[0].id);
    }
  }, [firebaseUser, user, selectedAddress, ensureCustomerProfile]);

  // Fetch live delivery slots from Express backend
  useEffect(() => {
    let active = true;
    apiFetch('/api/slots')
      .then((res) => res.json())
      .then((data: { days?: ApiSlotDay[] }) => {
        if (active && Array.isArray(data.days)) {
          setSlotDays(data.days);
          // Default to tomorrow if today has no remaining slots
          if (data.days[0]?.slots.length === 0 && data.days[1]?.slots.length > 0) {
            setSelectedDate(1);
          }
        }
      })
      .catch(() => {
        // Fallback slot calculation if network temporarily unavailable
        const fallbackSlots = [
          '6:00 AM - 8:00 AM',
          '8:00 AM - 10:00 AM',
          '10:00 AM - 12:00 PM',
          '4:00 PM - 5:00 PM',
          '5:00 PM - 6:00 PM',
          '6:00 PM - 7:00 PM',
          '7:00 PM - 8:00 PM'
        ];
        if (active) {
          setSlotDays([0, 1, 2].map((d) => ({ dayOffset: d, isoDate: '', slots: fallbackSlots })));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const baseFee = appSettings?.baseDeliveryFee ?? 20;
  const freeThreshold = appSettings?.freeDeliveryThreshold ?? 100;
  const taxRate = appSettings?.taxRate ?? 0;
  const storeOpen = appSettings?.storeOpen ?? true;

  const taxAmount = Math.round((cartTotal * taxRate) / 100);
  const deliveryFee = cartTotal >= freeThreshold ? 0 : baseFee;
  const finalTotal = Math.max(0, Math.round(cartTotal) + taxAmount + deliveryFee - discount);

  const availableSlots =
    slotDays.find((d) => d.dayOffset === selectedDate)?.slots || [
      '8:00 AM - 10:00 AM',
      '4:00 PM - 6:00 PM',
      '6:00 PM - 8:00 PM'
    ];


  const handleSavePhoneAndContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = contactPhone.replace(/\D/g, '');
    if (clean.length < 10) {
      showToast('Please enter a valid 10-digit mobile number for order updates.', 'error');
      return;
    }
    setSavingPhone(true);
    try {
      await updateProfile({ phone: clean });
      showToast('Mobile number saved!', 'success');
      setStep(2);
    } catch {
      showToast('Failed to save phone number. Please retry.', 'error');
    } finally {
      setSavingPhone(false);
    }
  };

  const applyCoupon = (code: string) => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setCoupon(c);
    const found = coupons.find((item) => item.code.toUpperCase() === c && item.isActive);
    if (found) {
      if (cartTotal < found.minOrder) {
        showToast(`Minimum order value for code ${found.code} is ₹${found.minOrder}`, 'error');
        setDiscount(0);
        return;
      }
      if (found.discountType === 'percent') {
        const discAmount = Math.round((cartTotal * found.discountValue) / 100);
        setDiscount(discAmount);
        showToast(`Coupon applied! Saved ₹${discAmount}`, 'success');
      } else {
        setDiscount(found.discountValue);
        showToast(`Coupon applied! Saved ₹${found.discountValue}`, 'success');
      }
    } else {
      showToast('Invalid or expired coupon code', 'error');
      setDiscount(0);
    }
  };

  const handlePlaceOrder = async () => {
    if (!firebaseUser || !user) return;

    if (!storeOpen) {
      showToast('Store is currently paused by Admin and not accepting orders.', 'error');
      return;
    }

    if (user.isBlocked) {
      showToast('Your account is currently suspended by store administration.', 'error');
      return;
    }

    const cleanPhone = (user.phone || contactPhone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      showToast('Please save a valid 10-digit contact phone number first.', 'error');
      setStep(1);
      return;
    }

    const resolvedAddress = user.addresses?.find((a) => a.id === selectedAddress) || user.addresses?.[0];
    if (!resolvedAddress) {
      showToast('Please add a delivery address first', 'error');
      setStep(2);
      setShowAddAddress(true);
      return;
    }

    setPlacingOrder(true);
    try {
      // 1. Verify item stock availability via Express backend
      const stockRes = await apiFetch('/api/orders/verify-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart })
      });
      if (!stockRes.ok) {
        const stockErr = (await stockRes.json().catch(() => ({}))) as {
          error?: string;
          staleCatalog?: boolean;
          storeClosed?: boolean;
        };
        if (stockErr.staleCatalog || stockErr.storeClosed) {
          void refreshCatalog();
        }
        showToast(
          stockErr.error || 'One or more items in your cart are unavailable.',
          'error'
        );
        setPlacingOrder(false);
        return;
      }

      // 2. Verify server quote via Express backend
      const activeCouponObj = coupons.find((item) => item.code.toUpperCase() === coupon && item.isActive);
      let verifiedTotal = finalTotal;
      try {
        const quoteRes = await apiFetch('/api/orders/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: cart,
            taxRate,
            baseDeliveryFee: baseFee,
            freeDeliveryThreshold: freeThreshold,
            discountType: activeCouponObj?.discountType,
            discountValue: discount > 0 ? activeCouponObj?.discountValue : 0,
            minOrder: activeCouponObj?.minOrder || 0
          })
        });
        if (quoteRes.ok) {
          const quoteData = (await quoteRes.json()) as { total?: number };
          if (typeof quoteData.total === 'number') {
            verifiedTotal = quoteData.total;
          }
        }
      } catch {
        // Continue with verified client calculation if offline
      }

      const slotText = selectedSlot
        ? `${format(addDays(new Date(), selectedDate), 'EEE, MMM d')} - ${selectedSlot}`
        : `${format(addDays(new Date(), selectedDate), 'EEE, MMM d')} - Standard Delivery`;

      orderPlacedRef.current = true;
      await placeOrder({
        items: [...cart],
        total: verifiedTotal,
        deliverySlot: slotText,
        address: resolvedAddress,
        paymentMethod,
        customerName: user.name,
        customerPhone: cleanPhone
      });

      clearCart();
      navigate('/order-success');
    } catch {
      orderPlacedRef.current = false;
      showToast('Could not place order. Please check your connection and try again.', 'error');
    } finally {
      setPlacingOrder(false);
    }
  };

  if (cart.length === 0) {
    return null;
  }

  return (
    <div className="pb-28 pt-4 px-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/cart')} className="p-2 hover:bg-gray-100 rounded-full">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold">Checkout</h1>
      </div>

      {!storeOpen && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-5 flex items-start gap-3">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-sm">Store Currently Paused</p>
            <p className="text-xs mt-0.5">Ordering is temporarily closed by the store administrator.</p>
          </div>
        </div>
      )}

      {/* Step 1: Account & Verified Contact */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-4 ${step > 1 ? 'bg-gray-50/70' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step > 1 ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700'}`}>
              {step > 1 ? <CheckCircle size={18} /> : '1'}
            </div>
            <h2 className="font-semibold text-lg">Customer Account &amp; Contact</h2>
          </div>
          {step > 1 && user && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs font-bold text-green-600 hover:underline"
            >
              Edit
            </button>
          )}
        </div>

        {step === 1 && (
          !firebaseUser || !user ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Verify your mobile number via Firebase SMS OTP (or Google) to link this order, enable live rider tracking, and receive your delivery PIN.
              </p>
              <PhoneOtpAuthCard createCustomerProfile askNameOnCustomerOtp />
            </div>
          ) : (
            <form onSubmit={handleSavePhoneAndContinue} className="space-y-4">
              <div className="p-3 bg-green-50 border border-green-100 rounded-xl text-sm">
                <p className="font-bold text-gray-800">{user.name}</p>
                {user.email && <p className="text-xs text-gray-500">{user.email}</p>}
                {user.phone && <p className="text-xs text-green-700 font-medium">+{user.phone}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Mobile Number (for delivery coordination)
                </label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  placeholder="Enter 10-digit mobile number"
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={savingPhone || contactPhone.replace(/\D/g, '').length < 10}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-medium disabled:bg-gray-300 hover:bg-green-700 transition"
              >
                {savingPhone ? 'Saving...' : 'Save & Continue'}
              </button>
            </form>
          )
        )}

        {step > 1 && user && (
          <div className="pl-11 text-gray-600 text-sm">
            <p className="font-semibold text-gray-800">{user.name}</p>
            <p>+{user.phone}{user.email ? ` • ${user.email}` : ''}</p>
          </div>
        )}
      </div>

      {/* Step 2: Address */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-4 ${step < 2 ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step > 2 ? 'bg-green-600 text-white' : step === 2 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {step > 2 ? <CheckCircle size={18} /> : '2'}
            </div>
            <h2 className="font-semibold text-lg">Delivery Address</h2>
          </div>
          {step > 2 && (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="text-xs font-bold text-green-600 hover:underline"
            >
              Change
            </button>
          )}
        </div>

        {step === 2 && user && (
          <div className="space-y-3">
            {user.addresses?.map((addr) => (
              <label key={addr.id} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer ${selectedAddress === addr.id ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
                <input
                  type="radio"
                  name="address"
                  checked={selectedAddress === addr.id}
                  onChange={() => setSelectedAddress(addr.id)}
                  className="mt-1 text-green-600 focus:ring-green-500"
                />
                <div>
                  <span className="font-medium block">{addr.label}</span>
                  <p className="text-sm text-gray-600">{addr.street}, {addr.city}, {addr.zip}</p>
                </div>
              </label>
            ))}

            {(!user.addresses || user.addresses.length === 0) && !showAddAddress && (
              <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
                No saved addresses found. Please add a delivery address below.
              </p>
            )}

            {showAddAddress ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3 mt-3">
                <p className="font-bold text-sm text-gray-800">Add New Address</p>
                <div className="flex gap-2">
                  {['Home', 'Work', 'Other'].map((lbl) => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setNewLabel(lbl)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border ${newLabel === lbl ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200'}`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Street / House No. / Landmark"
                  value={newStreet}
                  onChange={(e) => setNewStreet(e.target.value)}
                  className="w-full p-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    className="w-full p-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <input
                    type="text"
                    placeholder="Pincode"
                    value={newZip}
                    onChange={(e) => setNewZip(e.target.value)}
                    className="w-full p-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newStreet.trim() || !newCity.trim() || newZip.trim().length < 3) {
                        showToast('Please enter street, city, and valid pincode', 'error');
                        return;
                      }
                      const added = await addAddress({
                        label: newLabel,
                        street: newStreet.trim(),
                        city: newCity.trim(),
                        zip: newZip.trim()
                      });
                      if (added) setSelectedAddress(added.id);
                      setShowAddAddress(false);
                      setNewStreet('');
                      setNewCity('');
                      setNewZip('');
                      showToast('Address added!', 'success');
                    }}
                    className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700"
                  >
                    Save Address
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddAddress(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddAddress(true)}
                className="w-full py-2.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-green-600 hover:text-green-600 transition font-medium"
              >
                + Add Another Address
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const validAddr = user.addresses?.find((a) => a.id === selectedAddress) || user.addresses?.[0];
                if (!validAddr) {
                  showToast('Please add a delivery address before continuing', 'error');
                  setShowAddAddress(true);
                  return;
                }
                setSelectedAddress(validAddr.id);
                setStep(3);
              }}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium mt-4 shadow-sm hover:bg-green-700"
            >
              Deliver Here
            </button>
          </div>
        )}
        {step > 2 && user && (
          <div className="pl-11 text-gray-600 text-sm">
            {(() => {
              const addr = user.addresses.find((a) => a.id === selectedAddress) || user.addresses[0];
              return addr ? <p>{addr.label}: {addr.street}, {addr.city} - {addr.zip}</p> : null;
            })()}
          </div>
        )}
      </div>

      {/* Step 3: Slot */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-4 ${step < 3 ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step > 3 ? 'bg-green-600 text-white' : step === 3 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {step > 3 ? <CheckCircle size={18} /> : '3'}
            </div>
            <h2 className="font-semibold text-lg">Delivery Slot</h2>
          </div>
          {step > 3 && (
            <button
              type="button"
              onClick={() => setStep(3)}
              className="text-xs font-bold text-green-600 hover:underline"
            >
              Change
            </button>
          )}
        </div>

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[0, 1, 2].map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    setSelectedDate(day);
                    setSelectedSlot('');
                  }}
                  className={`flex-1 min-w-[100px] p-3 rounded-lg border text-center ${selectedDate === day ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200'}`}
                >
                  <p className="text-xs font-medium uppercase">
                    {day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : format(addDays(new Date(), day), 'EEE')}
                  </p>
                  <p className="font-bold">{format(addDays(new Date(), day), 'd MMM')}</p>
                </button>
              ))}
            </div>

            {availableSlots.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
                All delivery slots for today have passed. Please choose Tomorrow or the next day.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    className={`p-2 text-xs border rounded-lg ${selectedSlot === slot ? 'border-green-500 bg-green-50 text-green-700 font-semibold' : 'border-gray-200'}`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setStep(4)}
              disabled={!selectedSlot}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium disabled:bg-gray-300"
            >
              Continue
            </button>
          </div>
        )}
        {step > 3 && (
          <div className="pl-11 text-gray-600 text-sm">
            <p>{format(addDays(new Date(), selectedDate), 'EEE, MMM d')} | {selectedSlot}</p>
          </div>
        )}
      </div>

      {/* Step 4: Payment */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-20 ${step !== 4 ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step === 4 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            4
          </div>
          <h2 className="font-semibold text-lg">Payment</h2>
        </div>

        {step === 4 && (
          <div className="space-y-3">
            <label className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer ${paymentMethod === 'upi' ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
              <input
                type="radio"
                name="payment"
                checked={paymentMethod === 'upi'}
                onChange={() => setPaymentMethod('upi')}
              />
              <CreditCard size={20} className="text-gray-600" />
              <span className="font-medium">UPI / Online Payment</span>
            </label>

            <label className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer ${paymentMethod === 'cod' ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
              <input
                type="radio"
                name="payment"
                checked={paymentMethod === 'cod'}
                onChange={() => setPaymentMethod('cod')}
              />
              <span className="font-bold text-gray-600">₹</span>
              <span className="font-medium">Cash on Delivery</span>
            </label>

            <div className="mt-6 border-t pt-4">
              {coupons.filter((c) => c.isActive).length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Available Coupons</label>
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-2 no-scrollbar">
                    {coupons.filter((c) => c.isActive).map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => applyCoupon(c.code)}
                        className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs whitespace-nowrap border transition ${
                          coupon === c.code
                            ? 'bg-green-600 text-white border-green-600 font-bold'
                            : 'bg-orange-50 border-orange-200 text-orange-700'
                        }`}
                      >
                        <Tag size={12} /> {c.code} ({c.discountType === 'percent' ? `${c.discountValue}%` : `₹${c.discountValue}`} Off)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value)}
                  placeholder="Enter promo code"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 uppercase"
                />
                {discount > 0 ? (
                  <button
                    type="button"
                    onClick={() => { setCoupon(''); setDiscount(0); showToast('Coupon removed', 'info'); }}
                    className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1 border border-red-200"
                  >
                    <X size={14} /> Clear
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => applyCoupon(coupon)}
                    className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Apply
                  </button>
                )}
              </div>
              {discount > 0 && <p className="text-green-600 text-xs mb-3">Coupon applied! Saving {formatCurrency(discount)}</p>}

              <div className="space-y-2 mb-4 bg-gray-50 p-4 rounded-lg text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Item Total</span>
                  <span>{formatCurrency(cartTotal)}</span>
                </div>
                {taxRate > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Taxes &amp; Packaging ({taxRate}%)</span>
                    <span>{formatCurrency(taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Delivery Fee</span>
                  {deliveryFee === 0 ? (
                    <span className="text-green-600 font-medium">Free</span>
                  ) : (
                    <span>{formatCurrency(deliveryFee)}</span>
                  )}
                </div>
                {deliveryFee > 0 && (
                  <p className="text-[11px] text-gray-500">Add items worth {formatCurrency(Math.max(0, freeThreshold - cartTotal))} more for free delivery</p>
                )}
                {discount > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Coupon Discount</span>
                    <span>-{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200 mt-2">
                  <span>To Pay</span>
                  <span>{formatCurrency(finalTotal)}</span>
                </div>
              </div>

              <button
                type="button"
                disabled={!storeOpen || placingOrder}
                onClick={handlePlaceOrder}
                className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
              >
                {!storeOpen
                  ? 'Store Ordering Paused'
                  : placingOrder
                  ? 'Placing Order...'
                  : `Place Order (${formatCurrency(finalTotal)})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
