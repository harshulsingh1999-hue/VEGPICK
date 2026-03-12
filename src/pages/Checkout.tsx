import React, { useState, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency } from '../lib/utils';
import { useNavigate } from 'react-router-dom';
import { MapPin, Calendar, CreditCard, CheckCircle, Tag } from 'lucide-react';
import { format, addDays, setHours, setMinutes, isBefore } from 'date-fns';

export const Checkout = () => {
  const { cart, cartTotal, clearCart } = useStore();
  const { user, login, register, checkUserExists, placeOrder } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(user ? 2 : 1); // 1: Login, 2: Address, 3: Slot, 4: Payment
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  
  const [selectedAddress, setSelectedAddress] = useState(user?.addresses[0]?.id || '');
  const [selectedDate, setSelectedDate] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'upi'>('cod');
  const [coupon, setCoupon] = useState('');
  const [discount, setDiscount] = useState(0);

  // Delivery Fee Logic: Free if > 100, else 20
  const deliveryFee = cartTotal > 100 ? 0 : 20;
  const finalTotal = cartTotal + deliveryFee - discount;

  // Generate Slots
  const generateSlots = () => {
    const slots = [];
    // Morning: 6 AM to 12 PM (2-hour slots)
    for (let i = 6; i < 12; i += 2) {
      const endHour = i + 2;
      const endAmPm = endHour === 12 ? 'PM' : 'AM';
      slots.push(`${i}:00 AM - ${endHour}:00 ${endAmPm}`);
    }
    // Evening: 4 PM to 9 PM
    for (let i = 4; i < 9; i++) {
      slots.push(`${i}:00 PM - ${i + 1}:00 PM`);
    }
    return slots;
  };

  const availableSlots = generateSlots();

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length === 10) {
      setShowOtp(true);
      // Simulate OTP send
    }
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length === 4) {
      if (checkUserExists(phone)) {
        login(phone);
        setStep(2);
      } else {
        setShowRegister(true);
        setShowOtp(false);
      }
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && email) {
      register(phone, name, email);
      setStep(2);
    }
  };

  const applyCoupon = (code: string) => {
    const c = code.toUpperCase();
    setCoupon(c);
    if (c === 'FRESH20') {
      setDiscount(cartTotal * 0.2);
    } else if (c === 'WELCOME50') {
      setDiscount(50);
    } else {
      setDiscount(0);
    }
  };

  const handlePlaceOrder = () => {
    if (!user) return;
    
    const order = {
      id: Math.random().toString(36).substr(2, 9).toUpperCase(),
      items: [...cart],
      total: finalTotal,
      status: 'placed' as const,
      date: new Date().toISOString(),
      deliverySlot: `${format(addDays(new Date(), selectedDate), 'EEE, MMM d')} - ${selectedSlot}`,
      address: user.addresses.find(a => a.id === selectedAddress)!,
      paymentMethod
    };

    placeOrder(order);
    clearCart();
    navigate('/order-success');
  };

  if (cart.length === 0) {
    navigate('/cart');
    return null;
  }

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Checkout</h1>

      {/* Step 1: Login */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-4 ${step > 1 ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step > 1 ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700'}`}>
            {step > 1 ? <CheckCircle size={18} /> : '1'}
          </div>
          <h2 className="font-semibold text-lg">Login / Sign Up</h2>
        </div>
        
        {step === 1 && (
          !showOtp ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="Enter 10 digit number"
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  required
                />
              </div>
              <button 
                type="submit"
                disabled={phone.length !== 10}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-medium disabled:bg-gray-300"
              >
                Send OTP
              </button>
            </form>
          ) : showRegister ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  required
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-green-600 text-white py-3 rounded-lg font-medium"
              >
                Complete Registration
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Enter OTP</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="1234"
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none tracking-widest text-center text-xl"
                  required
                />
                <p className="text-xs text-gray-500 mt-2">Use any 4 digits</p>
              </div>
              <button 
                type="submit"
                disabled={otp.length !== 4}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-medium disabled:bg-gray-300"
              >
                Verify & Login
              </button>
            </form>
          )
        )}
        {step > 1 && user && (
          <div className="pl-11 text-gray-600">
            <p>{user.name}</p>
            <p>{user.phone}</p>
          </div>
        )}
      </div>

      {/* Step 2: Address */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-4 ${step !== 2 ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step > 2 ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
            {step > 2 ? <CheckCircle size={18} /> : '2'}
          </div>
          <h2 className="font-semibold text-lg">Delivery Address</h2>
        </div>

        {step === 2 && user && (
          <div className="space-y-3">
            {user.addresses.map(addr => (
              <label key={addr.id} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer ${selectedAddress === addr.id ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
                <input 
                  type="radio" 
                  name="address" 
                  checked={selectedAddress === addr.id}
                  onChange={() => setSelectedAddress(addr.id)}
                  className="mt-1"
                />
                <div>
                  <span className="font-medium block">{addr.label}</span>
                  <p className="text-sm text-gray-600">{addr.street}, {addr.city}, {addr.zip}</p>
                </div>
              </label>
            ))}
            <button 
              onClick={() => setStep(3)}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium mt-4"
            >
              Deliver Here
            </button>
          </div>
        )}
        {step > 2 && user && (
          <div className="pl-11 text-gray-600">
            {(() => {
              const addr = user.addresses.find(a => a.id === selectedAddress);
              return addr ? <p>{addr.street}, {addr.city}</p> : null;
            })()}
          </div>
        )}
      </div>

      {/* Step 3: Slot */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-4 ${step !== 3 ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${step > 3 ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
            {step > 3 ? <CheckCircle size={18} /> : '3'}
          </div>
          <h2 className="font-semibold text-lg">Delivery Slot</h2>
        </div>

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[0, 1, 2].map(day => (
                <button
                  key={day}
                  onClick={() => setSelectedDate(day)}
                  className={`flex-1 min-w-[100px] p-3 rounded-lg border text-center ${selectedDate === day ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200'}`}
                >
                  <p className="text-xs font-medium uppercase">{day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : format(addDays(new Date(), day), 'EEE')}</p>
                  <p className="font-bold">{format(addDays(new Date(), day), 'd MMM')}</p>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
              {availableSlots.map(slot => (
                <button
                  key={slot}
                  onClick={() => setSelectedSlot(slot)}
                  className={`p-2 text-xs border rounded-lg ${selectedSlot === slot ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200'}`}
                >
                  {slot}
                </button>
              ))}
            </div>

            <button 
              onClick={() => setStep(4)}
              disabled={!selectedSlot}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-medium disabled:bg-gray-300"
            >
              Continue
            </button>
          </div>
        )}
        {step > 3 && (
          <div className="pl-11 text-gray-600">
            <p>{format(addDays(new Date(), selectedDate), 'EEE, MMM d')} | {selectedSlot}</p>
          </div>
        )}
      </div>

      {/* Step 4: Payment */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-20 ${step !== 4 ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold bg-gray-100 text-gray-500`}>
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
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Available Coupons</label>
                <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
                  <button onClick={() => applyCoupon('FRESH20')} className="flex items-center gap-1 bg-orange-50 border border-orange-200 text-orange-700 px-3 py-1 rounded-full text-xs whitespace-nowrap">
                    <Tag size={12} /> FRESH20 (20% Off)
                  </button>
                  <button onClick={() => applyCoupon('WELCOME50')} className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1 rounded-full text-xs whitespace-nowrap">
                    <Tag size={12} /> WELCOME50 (₹50 Off)
                  </button>
                </div>

                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={coupon}
                    onChange={(e) => setCoupon(e.target.value)}
                    placeholder="Enter code"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 uppercase"
                  />
                  <button 
                    onClick={() => applyCoupon(coupon)}
                    className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Apply
                  </button>
                </div>
                {discount > 0 && <p className="text-green-600 text-xs mt-1">Coupon applied successfully!</p>}
              </div>

              <div className="space-y-2 mb-4 bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between text-gray-600">
                  <span>Item Total</span>
                  <span>{formatCurrency(cartTotal)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Delivery Fee</span>
                  {deliveryFee === 0 ? (
                    <span className="text-green-600">Free</span>
                  ) : (
                    <span>{formatCurrency(deliveryFee)}</span>
                  )}
                </div>
                {deliveryFee > 0 && (
                  <p className="text-[10px] text-gray-400">Add items worth {formatCurrency(100 - cartTotal)} more for free delivery</p>
                )}
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200 mt-2">
                  <span>To Pay</span>
                  <span>{formatCurrency(finalTotal)}</span>
                </div>
              </div>

              <button 
                onClick={handlePlaceOrder}
                className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold hover:bg-green-700"
              >
                Place Order
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
