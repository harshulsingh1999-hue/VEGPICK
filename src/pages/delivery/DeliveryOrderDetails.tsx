import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDelivery } from '../../context/DeliveryContext';
import { Phone, Navigation, ArrowLeft, CheckCircle, Package, Truck, IndianRupee, Camera, QrCode, XCircle, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export const DeliveryOrderDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { deliveryUser, assignedOrders, updateOrderStatus, collectPayment } = useDelivery();
  
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [showFailedModal, setShowFailedModal] = useState(false);
  const [customerOtp, setCustomerOtp] = useState('');
  const [failedReason, setFailedReason] = useState('');

  useEffect(() => {
    if (!deliveryUser) {
      navigate('/delivery/login');
    }
  }, [deliveryUser, navigate]);

  if (!deliveryUser) return null;

  const order = assignedOrders.find(o => o.id === id);

  if (!order) return null;

  const handlePickup = () => {
    updateOrderStatus(order.id, 'picked_up');
    setShowPickupModal(false);
  };

  const handleStartDelivery = () => {
    updateOrderStatus(order.id, 'out_for_delivery');
  };

  const handleCompleteDelivery = () => {
    if (customerOtp.length === 4) {
      updateOrderStatus(order.id, 'delivered');
      setShowDeliveryModal(false);
      navigate('/delivery/dashboard');
    }
  };

  const handleFailedDelivery = () => {
    if (failedReason) {
      // In a real app, this would update status to 'failed' or 'returned'
      updateOrderStatus(order.id, 'delivered'); // Mocking completion for now
      setShowFailedModal(false);
      navigate('/delivery/dashboard');
    }
  };

  const openMaps = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.customerAddress)}`;
    window.open(url, '_blank');
  };

  const callCustomer = () => {
    window.open(`tel:${order.customerPhone}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-32">
      {/* Header */}
      <div className="bg-gray-800 p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10 border-b border-gray-700">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-700 rounded-full text-gray-300">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h1 className="font-bold text-lg">Order #{order.id}</h1>
          <p className="text-xs text-gray-400">{order.deliverySlot}</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Customer Details */}
        <div className="bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-700">
          <h2 className="text-sm font-bold text-gray-400 uppercase mb-4">Customer Details</h2>
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="font-bold text-lg text-white">{order.customerName}</h3>
              <p className="text-gray-400 text-sm mt-1">{order.customerAddress}</p>
            </div>
          </div>
          
          <div className="flex gap-3">
            <button 
              onClick={callCustomer}
              className="flex-1 bg-blue-500/20 text-blue-400 py-3 rounded-lg font-bold flex items-center justify-center gap-2 border border-blue-500/30"
            >
              <Phone size={18} /> Call
            </button>
            <button 
              onClick={openMaps}
              className="flex-1 bg-green-500/20 text-green-400 py-3 rounded-lg font-bold flex items-center justify-center gap-2 border border-green-500/30"
            >
              <Navigation size={18} /> Navigate
            </button>
          </div>
        </div>

        {/* Payment Status */}
        <div className="bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-700">
          <h2 className="text-sm font-bold text-gray-400 uppercase mb-4">Payment</h2>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-400">Amount to Collect</p>
              <p className="text-2xl font-bold text-white">{formatCurrency(order.total)}</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${
              order.paymentStatus === 'pending' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'
            }`}>
              {order.paymentStatus.toUpperCase()}
            </div>
          </div>

          {order.paymentMethod === 'cod' && order.paymentStatus === 'pending' && (
            <button 
              onClick={() => collectPayment(order.id)}
              className="w-full mt-4 bg-orange-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-orange-500"
            >
              <IndianRupee size={18} /> Mark Cash Collected
            </button>
          )}
        </div>

        {/* Order Status Timeline */}
        <div className="bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-700">
          <h2 className="text-sm font-bold text-gray-400 uppercase mb-4">Order Status</h2>
          <div className="space-y-6 relative pl-4 border-l-2 border-gray-700 ml-2">
            <div className="relative">
              <div className="absolute -left-[21px] top-0 w-4 h-4 rounded-full bg-green-500 border-2 border-gray-800 shadow-sm"></div>
              <p className="font-bold text-sm text-white">Order Assigned</p>
              <p className="text-xs text-gray-400">Ready for pickup at hub</p>
            </div>
            
            <div className={`relative ${['picked_up', 'out_for_delivery', 'delivered'].includes(order.deliveryStatus) ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`absolute -left-[21px] top-0 w-4 h-4 rounded-full border-2 border-gray-800 shadow-sm ${['picked_up', 'out_for_delivery', 'delivered'].includes(order.deliveryStatus) ? 'bg-green-500' : 'bg-gray-600'}`}></div>
              <p className="font-bold text-sm text-white">Picked Up</p>
              <p className="text-xs text-gray-400">Package collected from store</p>
            </div>

            <div className={`relative ${['out_for_delivery', 'delivered'].includes(order.deliveryStatus) ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`absolute -left-[21px] top-0 w-4 h-4 rounded-full border-2 border-gray-800 shadow-sm ${['out_for_delivery', 'delivered'].includes(order.deliveryStatus) ? 'bg-green-500' : 'bg-gray-600'}`}></div>
              <p className="font-bold text-sm text-white">Out for Delivery</p>
              <p className="text-xs text-gray-400">On the way to customer</p>
            </div>

            <div className={`relative ${order.deliveryStatus === 'delivered' ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`absolute -left-[21px] top-0 w-4 h-4 rounded-full border-2 border-gray-800 shadow-sm ${order.deliveryStatus === 'delivered' ? 'bg-green-500' : 'bg-gray-600'}`}></div>
              <p className="font-bold text-sm text-white">Delivered</p>
              <p className="text-xs text-gray-400">Handed over to customer</p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {order.deliveryStatus !== 'delivered' && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-900 border-t border-gray-800 flex flex-col gap-3">
          
          {order.deliveryStatus === 'assigned' && (
            <button 
              onClick={() => setShowPickupModal(true)}
              className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-green-600/20 active:scale-[0.98]"
            >
              Pick Up Order
            </button>
          )}

          {order.deliveryStatus === 'picked_up' && (
            <button 
              onClick={handleStartDelivery}
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-blue-600/20 active:scale-[0.98]"
            >
              Start Delivery
            </button>
          )}

          {order.deliveryStatus === 'out_for_delivery' && (
            <>
              <button 
                onClick={() => setShowDeliveryModal(true)}
                disabled={order.paymentMethod === 'cod' && order.paymentStatus === 'pending'}
                className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-green-600/20 disabled:bg-gray-700 disabled:text-gray-500 disabled:shadow-none active:scale-[0.98]"
              >
                Confirm Delivery
              </button>
              
              <button 
                onClick={() => setShowFailedModal(true)}
                className="w-full bg-red-500/10 text-red-500 py-3 rounded-xl font-bold border border-red-500/20 active:scale-[0.98]"
              >
                Mark as Failed / Return
              </button>

              {order.paymentMethod === 'cod' && order.paymentStatus === 'pending' && (
                <p className="text-center text-xs text-orange-400 font-medium">Collect payment to complete delivery</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Pickup Modal */}
      {showPickupModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-lg font-bold">Pickup Verification</h2>
              <button onClick={() => setShowPickupModal(false)} className="text-gray-400 hover:text-white"><XCircle size={24} /></button>
            </div>
            <div className="p-6 space-y-6">
              <button className="w-full py-4 border-2 border-dashed border-green-500 rounded-xl flex flex-col items-center justify-center text-green-400 bg-green-500/10 hover:bg-green-500/20 transition-colors">
                <QrCode size={32} className="mb-2" />
                <span className="font-bold">Scan Package QR Code</span>
              </button>
              
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-700"></div>
                <span className="text-xs text-gray-500 font-bold uppercase">OR</span>
                <div className="flex-1 h-px bg-gray-700"></div>
              </div>

              <button className="w-full py-4 border-2 border-dashed border-blue-500 rounded-xl flex flex-col items-center justify-center text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                <Camera size={32} className="mb-2" />
                <span className="font-bold">Upload Package Photo</span>
              </button>

              <div className="flex items-center gap-2 text-sm text-gray-300 bg-gray-700/50 p-3 rounded-lg">
                <input type="checkbox" id="condition" className="w-4 h-4 rounded border-gray-600 text-green-500 focus:ring-green-500 focus:ring-offset-gray-800 bg-gray-700" />
                <label htmlFor="condition">I confirm the package is in good condition</label>
              </div>

              <button onClick={handlePickup} className="w-full bg-green-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-green-600/20">
                Confirm Pickup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Modal */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-lg font-bold">Delivery Confirmation</h2>
              <button onClick={() => setShowDeliveryModal(false)} className="text-gray-400 hover:text-white"><XCircle size={24} /></button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-2 text-center">Enter Customer OTP</label>
                <input 
                  type="text" 
                  value={customerOtp}
                  onChange={(e) => setCustomerOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="1234"
                  className="w-full text-center text-3xl tracking-widest py-4 bg-gray-900 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white font-mono"
                />
                <p className="text-xs text-center text-gray-500 mt-2">Ask customer for 4-digit delivery PIN</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-700"></div>
                <span className="text-xs text-gray-500 font-bold uppercase">AND</span>
                <div className="flex-1 h-px bg-gray-700"></div>
              </div>

              <button className="w-full py-4 border-2 border-dashed border-blue-500 rounded-xl flex flex-col items-center justify-center text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                <Camera size={32} className="mb-2" />
                <span className="font-bold">Take Delivery Proof Photo</span>
              </button>

              <button 
                onClick={handleCompleteDelivery}
                disabled={customerOtp.length !== 4}
                className="w-full bg-green-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-green-600/20 disabled:bg-gray-700 disabled:text-gray-500 disabled:shadow-none"
              >
                Complete Delivery
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Failed Delivery Modal */}
      {showFailedModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-red-500/10">
              <h2 className="text-lg font-bold text-red-400 flex items-center gap-2"><AlertTriangle size={20} /> Mark as Failed</h2>
              <button onClick={() => setShowFailedModal(false)} className="text-gray-400 hover:text-white"><XCircle size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-300 mb-4">Select the reason for failed delivery. This will initiate a return process.</p>
              
              <div className="space-y-2">
                {['Customer Not Available', 'Wrong Address / Cannot Locate', 'Customer Rejected Order', 'Other'].map(reason => (
                  <button
                    key={reason}
                    onClick={() => setFailedReason(reason)}
                    className={`w-full text-left px-4 py-3 rounded-xl border ${failedReason === reason ? 'bg-red-500/20 border-red-500 text-red-400 font-bold' : 'bg-gray-900 border-gray-700 text-gray-300'}`}
                  >
                    {reason}
                  </button>
                ))}
              </div>

              {failedReason && (
                <button className="w-full py-3 mt-4 border-2 border-dashed border-gray-600 rounded-xl flex items-center justify-center gap-2 text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
                  <Camera size={20} />
                  <span className="font-bold text-sm">Upload Proof (Optional)</span>
                </button>
              )}

              <button 
                onClick={handleFailedDelivery}
                disabled={!failedReason}
                className="w-full mt-6 bg-red-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-red-600/20 disabled:bg-gray-700 disabled:text-gray-500 disabled:shadow-none"
              >
                Confirm Failed Delivery
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
