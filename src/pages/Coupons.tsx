import React from 'react';
import { Copy, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useStore } from '../context/StoreContext';

export const Coupons = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { coupons } = useStore();

  const activeCoupons = coupons.filter(c => c.isActive);

  const copyCode = (code: string) => {
    try {
      navigator.clipboard.writeText(code);
      showToast(`Coupon ${code} copied to clipboard!`, 'success');
    } catch {
      showToast(`Coupon code is ${code}`, 'info');
    }
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold">Available Coupons</h1>
      </div>

      <div className="space-y-4">
        {activeCoupons.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No active discount coupons at the moment.</p>
          </div>
        ) : (
          activeCoupons.map((coupon) => (
            <div key={coupon.code} className="bg-white p-4 rounded-xl shadow-sm border border-dashed border-green-300 flex justify-between items-center relative overflow-hidden">
              <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-gray-50 rounded-full"></div>
              <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-gray-50 rounded-full"></div>
              
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-lg text-gray-800">{coupon.code}</span>
                  <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded">ACTIVE</span>
                </div>
                <p className="text-sm text-gray-600">{coupon.description}</p>
                {coupon.minOrder > 0 && (
                  <p className="text-xs text-gray-400 mt-1">Min Order: ₹{coupon.minOrder}</p>
                )}
              </div>

              <button 
                onClick={() => copyCode(coupon.code)}
                className="p-2 text-gray-400 hover:text-green-600 transition-colors"
                title="Copy coupon code"
              >
                <Copy size={20} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
