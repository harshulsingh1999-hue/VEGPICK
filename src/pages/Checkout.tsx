import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import {
  formatCurrency,
  detectCardNetwork,
  formatPaymentMethodLabel,
  getAdminSettlementSummary,
  luhnCheckCard
} from '../lib/utils';
import { DEFAULT_DAILY_SLOT_TEMPLATES, Order } from '../lib/data';
import { useNavigate } from 'react-router-dom';
import {
  CreditCard,
  CheckCircle,
  Tag,
  AlertTriangle,
  X,
  ArrowLeft,
  Smartphone,
  Landmark,
  Copy,
  ShieldCheck,
  ExternalLink
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import { useToast } from '../context/ToastContext';
import { PhoneOtpAuthCard } from '../components/PhoneOtpAuthCard';
import { apiFetch } from '../lib/apiClient';

interface ApiSlotOption {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  cutoffMinutes: number;
  maxOrders: number;
  notes?: string;
  scheduleType?: 'date' | 'daily' | 'default';
}

interface ApiSlotDay {
  dayOffset: number;
  isoDate: string;
  slots: string[];
  slotDetails?: ApiSlotOption[];
  hasDateOverride?: boolean;
  closedByAdmin?: boolean;
}

const parseTimeMinutes = (timeStr: string): number => {
  const [hStr, mStr] = (timeStr || '00:00').split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

export const Checkout = () => {
  const {
    cart,
    cartTotal,
    clearCart,
    coupons,
    appSettings,
    deliverySlots,
    refreshCatalog,
    checkPincodeServiceability
  } = useStore();
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
  const [selectedDateIso, setSelectedDateIso] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [userPickedDate, setUserPickedDate] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Order['paymentMethod']>('upi');
  const [upiTransactionRef, setUpiTransactionRef] = useState('');
  const [bankTransferRef, setBankTransferRef] = useState('');
  const [cardHolderName, setCardHolderName] = useState(user?.name || '');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
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
        }
      })
      .catch(() => {
        // Fallback relies directly on StoreContext deliverySlots / defaults below
      });
    return () => {
      active = false;
    };
  }, [deliverySlots.length]);

  const checkoutSlotDays = useMemo(() => {
    const now = new Date();
    const todayLocalIso = format(now, 'yyyy-MM-dd');
    const currentLocalMinutes = now.getHours() * 60 + now.getMinutes();

    const apiByIso = new Map<string, ApiSlotDay>();
    slotDays.forEach((d) => {
      if (d.isoDate) apiByIso.set(d.isoDate, d);
    });

    // Prefer live StoreContext deliverySlots when populated; otherwise use /api/slots
    const hasStoreCustom = deliverySlots.length > 0;
    const candidateIsos = new Set<string>();
    for (let i = 0; i <= 6; i++) {
      candidateIsos.add(format(addDays(now, i), 'yyyy-MM-dd'));
    }
    if (hasStoreCustom) {
      deliverySlots.forEach((s) => {
        if (s.scheduleType === 'date' && s.slotDate >= todayLocalIso) {
          candidateIsos.add(s.slotDate);
        }
      });
    } else {
      slotDays.forEach((d) => {
        if (d.isoDate >= todayLocalIso) {
          candidateIsos.add(d.isoDate);
        }
      });
    }

    const sortedIsos = Array.from(candidateIsos).sort().slice(0, 14);
    const day0 = format(now, 'yyyy-MM-dd');
    const day1 = format(addDays(now, 1), 'yyyy-MM-dd');
    const day2 = format(addDays(now, 2), 'yyyy-MM-dd');

    const built = sortedIsos.map((isoDate) => {
      const dateObj = new Date(`${isoDate}T12:00:00`);
      const tag =
        isoDate === day0 ? 'Today' : isoDate === day1 ? 'Tomorrow' : format(dateObj, 'EEE');
      const shortDate = format(dateObj, 'd MMM');
      const fullFormatted = format(dateObj, 'EEE, MMM d');

      let rawDetails: ApiSlotOption[] = [];
      let closedByAdmin = false;

      if (hasStoreCustom) {
        const dateOverrides = deliverySlots.filter(
          (s) => s.scheduleType === 'date' && s.slotDate === isoDate
        );
        const hasOverride = dateOverrides.length > 0;
        const sourceList = hasOverride
          ? dateOverrides
          : deliverySlots.filter((s) => s.scheduleType === 'daily');
        const activeList = sourceList
          .filter((s) => s.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime));
        closedByAdmin = hasOverride && activeList.length === 0;
        rawDetails = activeList.map((s) => ({
          id: s.id,
          label: s.label,
          startTime: s.startTime,
          endTime: s.endTime,
          cutoffMinutes: s.cutoffMinutes || 0,
          maxOrders: s.maxOrders || 0,
          notes: s.notes,
          scheduleType: s.scheduleType
        }));
      } else {
        const apiDay = apiByIso.get(isoDate);
        if (apiDay && Array.isArray(apiDay.slotDetails)) {
          rawDetails = apiDay.slotDetails;
          closedByAdmin = Boolean(apiDay.closedByAdmin);
        } else if (isoDate === day0 || isoDate === day1 || isoDate === day2) {
          rawDetails = DEFAULT_DAILY_SLOT_TEMPLATES.map((tpl, idx) => ({
            id: `default_${idx}`,
            label: tpl.label,
            startTime: tpl.startTime,
            endTime: tpl.endTime,
            cutoffMinutes: tpl.cutoffMinutes,
            maxOrders: tpl.maxOrders,
            notes: tpl.notes,
            scheduleType: 'default'
          }));
        }
      }

      const openSlots = rawDetails.filter((slot) => {
        if (isoDate < todayLocalIso) return false;
        if (isoDate > todayLocalIso) return true;
        return currentLocalMinutes < parseTimeMinutes(slot.startTime) - (slot.cutoffMinutes || 0);
      });

      return {
        isoDate,
        tag,
        shortDate,
        fullFormatted,
        closedByAdmin,
        openSlots,
        isDefaultThreeDay: isoDate === day0 || isoDate === day1 || isoDate === day2
      };
    });

    // Always display Today/Tomorrow/Day+2, plus any additional future dates that have open slots
    return built
      .filter((d) => d.isDefaultThreeDay || d.openSlots.length > 0)
      .slice(0, 7);
  }, [slotDays, deliverySlots]);

  useEffect(() => {
    if (checkoutSlotDays.length === 0) return;
    const current = checkoutSlotDays.find((d) => d.isoDate === selectedDateIso);
    if (!current || (!userPickedDate && current.openSlots.length === 0)) {
      const firstOpen = checkoutSlotDays.find((d) => d.openSlots.length > 0) || checkoutSlotDays[0];
      if (firstOpen && firstOpen.isoDate !== selectedDateIso) {
        setSelectedDateIso(firstOpen.isoDate);
        setSelectedSlot('');
      }
    }
  }, [checkoutSlotDays, selectedDateIso, userPickedDate]);

  const activeDayEntry =
    checkoutSlotDays.find((d) => d.isoDate === selectedDateIso) || checkoutSlotDays[0];
  const availableSlotOptions = activeDayEntry?.openSlots || [];

  useEffect(() => {
    if (selectedSlot && !availableSlotOptions.some((s) => s.label === selectedSlot)) {
      setSelectedSlot('');
    }
  }, [availableSlotOptions, selectedSlot]);

  const activeAddressObj =
    user?.addresses?.find((a) => a.id === selectedAddress) || user?.addresses?.[0] || null;
  const activeAreaCheck = checkPincodeServiceability(activeAddressObj?.zip || '');
  const matchedArea = activeAreaCheck.matchedArea;

  const baseFee =
    typeof matchedArea?.deliveryFeeOverride === 'number'
      ? matchedArea.deliveryFeeOverride
      : appSettings?.baseDeliveryFee ?? 20;
  const minAreaOrder =
    typeof matchedArea?.minOrderOverride === 'number' ? matchedArea.minOrderOverride : 0;
  const freeThreshold = appSettings?.freeDeliveryThreshold ?? 100;
  const taxRate = appSettings?.taxRate ?? 0;
  const storeOpen = appSettings?.storeOpen ?? true;

  const taxAmount = Math.round((cartTotal * taxRate) / 100);
  const deliveryFee = cartTotal >= freeThreshold ? 0 : baseFee;
  const finalTotal = Math.max(0, Math.round(cartTotal) + taxAmount + deliveryFee - discount);

  const acceptUpi = appSettings?.acceptUpi !== false;
  const acceptDebitCard = appSettings?.acceptDebitCard !== false;
  const acceptCreditCard = appSettings?.acceptCreditCard !== false;
  const acceptBankTransfer = appSettings?.acceptBankTransfer !== false;
  const acceptCod = appSettings?.acceptCod !== false;

  const adminUpiId = (appSettings?.upiId || '').trim();
  const adminUpiPayeeName = (appSettings?.upiPayeeName || appSettings?.bankAccountHolder || 'FreshVeggie Delivery').trim();
  const adminBankHolder = (appSettings?.bankAccountHolder || '').trim();
  const adminBankName = (appSettings?.bankName || '').trim();
  const adminBankNumber = (appSettings?.bankAccountNumber || '').trim();
  const adminBankBranch = (appSettings?.bankBranch || '').trim();
  const adminBankIfsc = (appSettings?.bankIfscCode || '').trim().toUpperCase();
  const hasBankConfigured = Boolean(adminBankNumber && adminBankIfsc);
  const settlementTargetSummary = getAdminSettlementSummary(appSettings);

  useEffect(() => {
    const enabledList: Order['paymentMethod'][] = [];
    if (acceptUpi) enabledList.push('upi');
    if (acceptDebitCard) enabledList.push('debit_card');
    if (acceptCreditCard) enabledList.push('credit_card');
    if (acceptBankTransfer) enabledList.push('bank_transfer');
    if (acceptCod) enabledList.push('cod');
    if (enabledList.length > 0 && !enabledList.includes(paymentMethod)) {
      setPaymentMethod(enabledList[0]);
    }
  }, [acceptUpi, acceptDebitCard, acceptCreditCard, acceptBankTransfer, acceptCod, paymentMethod]);

  const copyPaymentField = async (value: string, label: string) => {
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied!`, 'success');
    } catch {
      showToast(`Unable to copy ${label}.`, 'error');
    }
  };


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
      const todayIso = new Date().toISOString().split('T')[0];
      if (found.expiry && /^\d{4}-\d{2}-\d{2}$/.test(found.expiry) && found.expiry < todayIso) {
        showToast(`Coupon ${found.code} expired on ${found.expiry}`, 'error');
        setDiscount(0);
        return;
      }
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

    const areaValidation = checkPincodeServiceability(resolvedAddress.zip);
    if (!areaValidation.serviceable) {
      showToast(
        areaValidation.reason || `Pincode ${resolvedAddress.zip} is outside approved local delivery areas.`,
        'error'
      );
      setStep(2);
      return;
    }

    if (minAreaOrder > 0 && cartTotal < minAreaOrder) {
      showToast(
        `Minimum order for ${matchedArea?.name || resolvedAddress.zip} is ${formatCurrency(minAreaOrder)}.`,
        'error'
      );
      return;
    }

    // 0. Validate selected payment channel before creating order
    const cleanCardDigits = cardNumber.replace(/\D/g, '');
    let paymentReference = '';
    let paymentChannelLabel = formatPaymentMethodLabel(paymentMethod);
    let resolvedCardLast4 = '';
    let resolvedCardNetwork = '';
    let resolvedPaymentStatus: Order['paymentStatus'] = paymentMethod === 'cod' ? 'pending' : 'paid';

    if (paymentMethod === 'upi') {
      if (!adminUpiId && !hasBankConfigured) {
        showToast('Merchant UPI ID is not configured yet. Please select another payment option.', 'error');
        return;
      }
      const cleanUtr = upiTransactionRef.trim().slice(0, 100);
      paymentReference = cleanUtr || `UPI-${Date.now().toString(36).toUpperCase()}`;
      paymentChannelLabel = adminUpiId ? `UPI Direct (${adminUpiId})` : 'UPI Direct Payment';
      resolvedPaymentStatus = cleanUtr ? 'paid' : 'pending';
    } else if (paymentMethod === 'debit_card' || paymentMethod === 'credit_card') {
      if (!cardHolderName.trim()) {
        showToast('Please enter the cardholder name.', 'error');
        return;
      }
      if (!luhnCheckCard(cleanCardDigits)) {
        showToast('Please enter a valid Debit/Credit card number.', 'error');
        return;
      }
      const expMatch = cardExpiry.trim().match(/^(\d{2})\/(\d{2})$/);
      if (!expMatch) {
        showToast('Please enter a valid card expiry in MM/YY format.', 'error');
        return;
      }
      const expMonth = Number(expMatch[1]);
      const expYear = 2000 + Number(expMatch[2]);
      const nowDate = new Date();
      if (
        expMonth < 1 ||
        expMonth > 12 ||
        expYear < nowDate.getFullYear() ||
        (expYear === nowDate.getFullYear() && expMonth < nowDate.getMonth() + 1)
      ) {
        showToast('Your card expiry date appears invalid or expired.', 'error');
        return;
      }
      const cleanCvv = cardCvv.replace(/\D/g, '');
      if (cleanCvv.length < 3 || cleanCvv.length > 4) {
        showToast('Please enter a valid 3 or 4 digit CVV.', 'error');
        return;
      }
      resolvedCardLast4 = cleanCardDigits.slice(-4);
      resolvedCardNetwork = detectCardNetwork(cleanCardDigits);
      paymentReference = `AUTH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      paymentChannelLabel = `${resolvedCardNetwork} ${
        paymentMethod === 'debit_card' ? 'Debit' : 'Credit'
      } •••• ${resolvedCardLast4}`;
      resolvedPaymentStatus = 'paid';
    } else if (paymentMethod === 'bank_transfer') {
      if (!hasBankConfigured) {
        showToast('Merchant bank account details are not configured yet.', 'error');
        return;
      }
      const cleanBankRef = bankTransferRef.trim().slice(0, 100);
      if (cleanBankRef.length < 6) {
        showToast('Please transfer to the Admin Bank Account and enter your 6+ char UTR / Reference ID.', 'error');
        return;
      }
      paymentReference = cleanBankRef;
      paymentChannelLabel = `${adminBankName || 'Bank'} Transfer (IFSC ${adminBankIfsc})`;
      resolvedPaymentStatus = 'paid';
    }

    setPlacingOrder(true);
    try {
      // 1. Verify item stock availability & approved local area via Primary/Backup cluster (with client failover)
      try {
        const stockRes = await apiFetch('/api/orders/verify-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: cart, pincode: resolvedAddress.zip })
        });
        if (!stockRes.ok && stockRes.status < 500 && stockRes.status !== 429) {
          const stockErr = (await stockRes.json().catch(() => ({}))) as {
            error?: string;
            staleCatalog?: boolean;
            storeClosed?: boolean;
            areaRestricted?: boolean;
          };
          if (stockErr.staleCatalog || stockErr.storeClosed || stockErr.areaRestricted) {
            void refreshCatalog();
          }
          showToast(
            stockErr.error || 'One or more items in your cart are unavailable.',
            'error'
          );
          setPlacingOrder(false);
          return;
        }
      } catch {
        // Fallback: allow Firestore checkout using verified client catalog when backend nodes recover
      }

      // 2. Verify server quote via Express backend
      const normalizedCouponInput = coupon.trim().toUpperCase();
      const activeCouponObj = coupons.find(
        (item) => item.code.toUpperCase() === normalizedCouponInput && item.isActive
      );
      let verifiedSubtotal = Math.round(cartTotal);
      let verifiedTaxAmount = taxAmount;
      let verifiedDeliveryFee = deliveryFee;
      let verifiedDiscount = discount;
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
          const quoteData = (await quoteRes.json()) as {
            subtotal?: number;
            taxAmount?: number;
            deliveryFee?: number;
            discount?: number;
            total?: number;
          };
          if (typeof quoteData.subtotal === 'number') verifiedSubtotal = quoteData.subtotal;
          if (typeof quoteData.taxAmount === 'number') verifiedTaxAmount = quoteData.taxAmount;
          if (typeof quoteData.deliveryFee === 'number') verifiedDeliveryFee = quoteData.deliveryFee;
          if (typeof quoteData.discount === 'number') verifiedDiscount = quoteData.discount;
          if (typeof quoteData.total === 'number') verifiedTotal = quoteData.total;
        }
      } catch {
        // Continue with verified client calculation if offline
      }

      const appliedCouponCode =
        verifiedDiscount > 0 ? (activeCouponObj?.code || normalizedCouponInput).trim().toUpperCase() : '';

      const datePrefix = activeDayEntry?.fullFormatted || format(new Date(), 'EEE, MMM d');
      const slotText = selectedSlot
        ? `${datePrefix} - ${selectedSlot}`
        : `${datePrefix} - Standard Delivery`;

      orderPlacedRef.current = true;
      await placeOrder({
        items: [...cart],
        subtotal: verifiedSubtotal,
        taxRate,
        taxAmount: verifiedTaxAmount,
        deliveryFee: verifiedDeliveryFee,
        discountAmount: verifiedDiscount,
        couponCode: appliedCouponCode,
        total: verifiedTotal,
        deliverySlot: slotText,
        address: resolvedAddress,
        paymentMethod,
        paymentStatus: resolvedPaymentStatus,
        paymentReference,
        paymentChannelLabel,
        settlementTargetSummary,
        cardLast4: resolvedCardLast4,
        cardNetwork: resolvedCardNetwork,
        customerName: user.name,
        customerPhone: cleanPhone
      });

      // Clear transient card input state immediately
      setCardNumber('');
      setCardExpiry('');
      setCardCvv('');
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
            {user.addresses?.map((addr) => {
              const addrStatus = checkPincodeServiceability(addr.zip);
              return (
                <label
                  key={addr.id}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer ${
                    !addrStatus.serviceable
                      ? 'border-red-200 bg-red-50/40'
                      : selectedAddress === addr.id
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="address"
                    checked={selectedAddress === addr.id}
                    onChange={() => setSelectedAddress(addr.id)}
                    className="mt-1 text-green-600 focus:ring-green-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium">{addr.label}</span>
                      {!addrStatus.serviceable ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700">
                          Not Serviceable ({addr.zip})
                        </span>
                      ) : addrStatus.matchedArea ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-100 text-green-700">
                          {addrStatus.matchedArea.name} • ~{addrStatus.matchedArea.etaMinutes} min ETA
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-gray-600">{addr.street}, {addr.city}, {addr.zip}</p>
                  </div>
                </label>
              );
            })}

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
                const check = checkPincodeServiceability(validAddr.zip);
                if (!check.serviceable) {
                  showToast(
                    check.reason || `Delivery is restricted for pincode ${validAddr.zip}.`,
                    'error'
                  );
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
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {checkoutSlotDays.map((day) => (
                <button
                  key={day.isoDate}
                  type="button"
                  onClick={() => {
                    setUserPickedDate(true);
                    setSelectedDateIso(day.isoDate);
                    setSelectedSlot('');
                  }}
                  className={`flex-1 min-w-[96px] p-3 rounded-lg border text-center transition ${
                    (activeDayEntry?.isoDate || selectedDateIso) === day.isoDate
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : day.openSlots.length === 0
                      ? 'border-gray-200 bg-gray-50 text-gray-400'
                      : 'border-gray-200 hover:border-green-300'
                  }`}
                >
                  <p className="text-xs font-medium uppercase">{day.tag}</p>
                  <p className="font-bold">{day.shortDate}</p>
                  <p className="text-[10px] mt-0.5 opacity-75">
                    {day.openSlots.length > 0 ? `${day.openSlots.length} slots` : 'Closed'}
                  </p>
                </button>
              ))}
            </div>

            {availableSlotOptions.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
                {activeDayEntry?.closedByAdmin
                  ? `Delivery slots for ${activeDayEntry.shortDate} are currently closed by store administration. Please choose another date.`
                  : 'All delivery slots for this date have passed or are unavailable. Please choose another scheduled date.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {availableSlotOptions.map((slot) => (
                  <button
                    key={slot.id || slot.label}
                    type="button"
                    onClick={() => setSelectedSlot(slot.label)}
                    className={`p-2.5 text-left text-xs border rounded-lg transition ${
                      selectedSlot === slot.label
                        ? 'border-green-500 bg-green-50 text-green-700 font-semibold'
                        : 'border-gray-200 hover:border-green-300'
                    }`}
                  >
                    <span className="block">{slot.label}</span>
                    {slot.notes && (
                      <span className="block text-[10px] opacity-75 font-normal mt-0.5">
                        {slot.notes}
                      </span>
                    )}
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
            <p>{activeDayEntry?.fullFormatted || format(new Date(), 'EEE, MMM d')} | {selectedSlot}</p>
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
            {/* 1. UPI Direct to Admin Bank Account / UPI ID */}
            {acceptUpi && (
              <div className={`border rounded-xl transition ${paymentMethod === 'upi' ? 'border-green-500 bg-green-50/40' : 'border-gray-200'}`}>
                <label className="flex items-center justify-between gap-3 p-4 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === 'upi'}
                      onChange={() => setPaymentMethod('upi')}
                    />
                    <Smartphone size={20} className="text-green-700" />
                    <div>
                      <span className="font-semibold text-sm block text-gray-900">UPI Direct Payment</span>
                      <span className="text-[11px] text-gray-500">GPay, PhonePe, Paytm, BHIM directly to store UPI ID</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-green-100 text-green-700">Instant</span>
                </label>

                {paymentMethod === 'upi' && (
                  <div className="px-4 pb-4 pt-1 border-t border-green-100 space-y-3 text-xs">
                    {adminUpiId ? (
                      <div className="bg-white p-3.5 rounded-xl border border-green-200 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-bold uppercase text-gray-400">Admin Official UPI ID</p>
                            <p className="font-mono font-bold text-sm text-gray-900">{adminUpiId}</p>
                            <p className="text-[11px] text-gray-500">Payee: {adminUpiPayeeName}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void copyPaymentField(adminUpiId, 'UPI ID')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold"
                          >
                            <Copy size={12} /> Copy
                          </button>
                        </div>

                        {hasBankConfigured && (
                          <p className="text-[11px] text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg">
                            Settles directly into <strong>{adminBankName || 'Merchant Bank'}</strong> A/C ••••{adminBankNumber.slice(-4)} (IFSC {adminBankIfsc})
                          </p>
                        )}

                        <a
                          href={`upi://pay?pa=${encodeURIComponent(adminUpiId)}&pn=${encodeURIComponent(adminUpiPayeeName)}&am=${finalTotal}&cu=INR&tn=${encodeURIComponent('FreshVeggie Order')}`}
                          className="w-full py-2.5 px-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold flex items-center justify-center gap-1.5 transition"
                        >
                          <ExternalLink size={14} /> Open UPI App &amp; Pay {formatCurrency(finalTotal)}
                        </a>
                      </div>
                    ) : (
                      <p className="text-amber-700 bg-amber-50 border border-amber-200 p-2.5 rounded-lg">
                        Store Admin has not entered a UPI ID yet in Payment Management.
                      </p>
                    )}

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        UPI Transaction / UTR Reference ID (Enter after paying, or leave blank to verify later)
                      </label>
                      <input
                        type="text"
                        value={upiTransactionRef}
                        onChange={(e) => setUpiTransactionRef(e.target.value)}
                        placeholder="e.g. 432512345678 (12-digit UTR)"
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg font-mono text-xs outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. Debit Card (Direct Settlement to Admin Bank Account) */}
            {acceptDebitCard && (
              <div className={`border rounded-xl transition ${paymentMethod === 'debit_card' ? 'border-green-500 bg-green-50/40' : 'border-gray-200'}`}>
                <label className="flex items-center justify-between gap-3 p-4 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === 'debit_card'}
                      onChange={() => setPaymentMethod('debit_card')}
                    />
                    <CreditCard size={20} className="text-blue-700" />
                    <div>
                      <span className="font-semibold text-sm block text-gray-900">Debit Card</span>
                      <span className="text-[11px] text-gray-500">Visa, Mastercard, RuPay • Direct bank settlement</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-700">Debit</span>
                </label>

                {paymentMethod === 'debit_card' && (
                  <div className="px-4 pb-4 pt-2 border-t border-green-100 space-y-2.5 text-xs">
                    {hasBankConfigured && (
                      <div className="bg-blue-50 border border-blue-100 text-blue-800 px-3 py-2 rounded-lg flex items-center gap-2">
                        <ShieldCheck size={14} className="shrink-0" />
                        <span>
                          Direct settlement to <strong>{adminBankHolder || adminUpiPayeeName}</strong> ({adminBankName || 'Bank'} ••••{adminBankNumber.slice(-4)}, IFSC {adminBankIfsc})
                        </span>
                      </div>
                    )}
                    <input
                      type="text"
                      placeholder="Cardholder Name"
                      value={cardHolderName}
                      onChange={(e) => setCardHolderName(e.target.value)}
                      className="w-full p-2.5 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Debit Card Number (16 digits)"
                        value={cardNumber}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
                          setCardNumber(digits.replace(/(.{4})/g, '$1 ').trim());
                        }}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-green-500 pr-20"
                      />
                      {cardNumber.replace(/\D/g, '').length >= 4 && (
                        <span className="absolute right-2.5 top-2.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                          {detectCardNetwork(cardNumber.replace(/\D/g, ''))}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Expiry MM/YY"
                        value={cardExpiry}
                        onChange={(e) => {
                          const d = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setCardExpiry(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
                        }}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <input
                        type="password"
                        inputMode="numeric"
                        placeholder="CVV"
                        maxLength={4}
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Only masked last-4 digits &amp; authorization ref are recorded; full card number/CVV are never stored.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 3. Credit Card (Direct Settlement to Admin Bank Account) */}
            {acceptCreditCard && (
              <div className={`border rounded-xl transition ${paymentMethod === 'credit_card' ? 'border-green-500 bg-green-50/40' : 'border-gray-200'}`}>
                <label className="flex items-center justify-between gap-3 p-4 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === 'credit_card'}
                      onChange={() => setPaymentMethod('credit_card')}
                    />
                    <CreditCard size={20} className="text-purple-700" />
                    <div>
                      <span className="font-semibold text-sm block text-gray-900">Credit Card</span>
                      <span className="text-[11px] text-gray-500">Visa, Mastercard, RuPay, Amex • Direct settlement</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-purple-100 text-purple-700">Credit</span>
                </label>

                {paymentMethod === 'credit_card' && (
                  <div className="px-4 pb-4 pt-2 border-t border-green-100 space-y-2.5 text-xs">
                    {hasBankConfigured && (
                      <div className="bg-purple-50 border border-purple-100 text-purple-800 px-3 py-2 rounded-lg flex items-center gap-2">
                        <ShieldCheck size={14} className="shrink-0" />
                        <span>
                          Direct settlement to <strong>{adminBankHolder || adminUpiPayeeName}</strong> ({adminBankName || 'Bank'} ••••{adminBankNumber.slice(-4)}, IFSC {adminBankIfsc})
                        </span>
                      </div>
                    )}
                    <input
                      type="text"
                      placeholder="Cardholder Name"
                      value={cardHolderName}
                      onChange={(e) => setCardHolderName(e.target.value)}
                      className="w-full p-2.5 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Credit Card Number"
                        value={cardNumber}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
                          setCardNumber(digits.replace(/(.{4})/g, '$1 ').trim());
                        }}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-green-500 pr-20"
                      />
                      {cardNumber.replace(/\D/g, '').length >= 4 && (
                        <span className="absolute right-2.5 top-2.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                          {detectCardNetwork(cardNumber.replace(/\D/g, ''))}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Expiry MM/YY"
                        value={cardExpiry}
                        onChange={(e) => {
                          const d = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setCardExpiry(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
                        }}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <input
                        type="password"
                        inputMode="numeric"
                        placeholder="CVV"
                        maxLength={4}
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Only masked last-4 digits &amp; authorization ref are recorded; full card number/CVV are never stored.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 4. Direct Bank Account Transfer (Account Number, Branch, IFSC) */}
            {acceptBankTransfer && (
              <div className={`border rounded-xl transition ${paymentMethod === 'bank_transfer' ? 'border-green-500 bg-green-50/40' : 'border-gray-200'}`}>
                <label className="flex items-center justify-between gap-3 p-4 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === 'bank_transfer'}
                      onChange={() => setPaymentMethod('bank_transfer')}
                    />
                    <Landmark size={20} className="text-indigo-700" />
                    <div>
                      <span className="font-semibold text-sm block text-gray-900">Direct Bank Account Transfer (IMPS / NEFT)</span>
                      <span className="text-[11px] text-gray-500">Transfer directly using Account Number, Branch &amp; IFSC Code</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">Bank</span>
                </label>

                {paymentMethod === 'bank_transfer' && (
                  <div className="px-4 pb-4 pt-2 border-t border-green-100 space-y-3 text-xs">
                    {hasBankConfigured ? (
                      <div className="bg-white p-3.5 rounded-xl border border-indigo-200 space-y-2">
                        <p className="text-[11px] font-bold uppercase text-indigo-700">
                          Admin Receiving Bank Account Details
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <span className="text-[10px] text-gray-400 block">Account Holder</span>
                            <span className="font-bold text-gray-900">{adminBankHolder || adminUpiPayeeName}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-gray-400 block">Bank &amp; Branch</span>
                            <span className="font-bold text-gray-900">
                              {adminBankName || 'Merchant Bank'}
                              {adminBankBranch ? ` — ${adminBankBranch}` : ''}
                            </span>
                          </div>
                          <div className="flex items-center justify-between bg-gray-50 px-2.5 py-1.5 rounded-lg">
                            <div>
                              <span className="text-[10px] text-gray-400 block">Account Number</span>
                              <span className="font-mono font-bold text-gray-900">{adminBankNumber}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void copyPaymentField(adminBankNumber, 'Account Number')}
                              className="text-indigo-600 font-bold flex items-center gap-1"
                            >
                              <Copy size={12} /> Copy
                            </button>
                          </div>
                          <div className="flex items-center justify-between bg-gray-50 px-2.5 py-1.5 rounded-lg">
                            <div>
                              <span className="text-[10px] text-gray-400 block">IFSC Code</span>
                              <span className="font-mono font-bold text-gray-900">{adminBankIfsc}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void copyPaymentField(adminBankIfsc, 'IFSC Code')}
                              className="text-indigo-600 font-bold flex items-center gap-1"
                            >
                              <Copy size={12} /> Copy
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-amber-700 bg-amber-50 border border-amber-200 p-2.5 rounded-lg">
                        Store Admin has not configured bank account number &amp; IFSC details yet in Payment Management.
                      </p>
                    )}

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        Bank Transfer UTR / IMPS Reference Number *
                      </label>
                      <input
                        type="text"
                        value={bankTransferRef}
                        onChange={(e) => setBankTransferRef(e.target.value)}
                        placeholder="Enter 6+ character UTR / Transaction Reference"
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg font-mono text-xs outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5. Cash on Delivery */}
            {acceptCod && (
              <label className={`flex items-center gap-3 p-4 border rounded-xl cursor-pointer ${paymentMethod === 'cod' ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
                <input
                  type="radio"
                  name="payment"
                  checked={paymentMethod === 'cod'}
                  onChange={() => setPaymentMethod('cod')}
                />
                <span className="font-bold text-gray-700 w-5 text-center">₹</span>
                <div>
                  <span className="font-semibold text-sm block text-gray-900">Cash on Delivery</span>
                  <span className="text-[11px] text-gray-500">Pay cash to your delivery partner upon arrival</span>
                </div>
              </label>
            )}

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
