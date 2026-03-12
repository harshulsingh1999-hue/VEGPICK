import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Truck, Upload, Camera, CheckCircle, ArrowLeft } from 'lucide-react';

export const DeliveryRegister = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    phone: '',
    otp: '',
    password: '',
    name: '',
    dlNumber: '',
    bankAccount: '',
    ifsc: ''
  });
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(step + 1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white text-center">
        <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/50">
          <CheckCircle size={48} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Application Submitted!</h1>
        <p className="text-gray-400 mb-8 max-w-xs">Your KYC details have been sent for background check. Admin approval is required before activation.</p>
        <Link to="/delivery/login" className="w-full max-w-sm bg-gray-800 text-white py-3 rounded-xl font-bold hover:bg-gray-700 transition-colors border border-gray-700">
          Back to Login
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 pb-20">
      <div className="flex items-center gap-4 mb-8 pt-4">
        <Link to="/delivery/login" className="p-2 bg-gray-800 rounded-full text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">Partner Registration</h1>
      </div>

      <div className="flex justify-between mb-8 relative">
        <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-800 -z-10 -translate-y-1/2"></div>
        <div className="absolute top-1/2 left-0 h-1 bg-green-500 -z-10 -translate-y-1/2 transition-all" style={{ width: `${((step - 1) / 3) * 100}%` }}></div>
        
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= i ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
            {i}
          </div>
        ))}
      </div>

      <form onSubmit={step === 4 ? handleSubmit : handleNext} className="space-y-4 max-w-sm mx-auto">
        {step === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-lg font-bold mb-4">Basic Details</h2>
            <input
              type="text"
              placeholder="Full Name"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
              required
            />
            <input
              type="tel"
              placeholder="Mobile Number"
              value={formData.phone}
              onChange={e => setFormData({...formData, phone: e.target.value})}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
              required
            />
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="OTP"
                value={formData.otp}
                onChange={e => setFormData({...formData, otp: e.target.value})}
                className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
                required
              />
              <button type="button" className="bg-gray-700 px-4 rounded-xl text-sm font-bold text-green-400">Send</button>
            </div>
            <input
              type="password"
              placeholder="Create Password"
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
              required
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-lg font-bold mb-4">KYC Documents</h2>
            <div className="p-4 border border-dashed border-gray-600 rounded-xl text-center bg-gray-800/50">
              <Upload size={24} className="mx-auto text-gray-400 mb-2" />
              <p className="text-sm text-gray-300">Upload Aadhaar / PAN</p>
              <input type="file" className="hidden" id="aadhaar" />
              <label htmlFor="aadhaar" className="mt-2 inline-block bg-gray-700 px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer">Choose File</label>
            </div>
            
            <input
              type="text"
              placeholder="Driving License Number"
              value={formData.dlNumber}
              onChange={e => setFormData({...formData, dlNumber: e.target.value})}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500 uppercase"
              required
            />
            
            <div className="p-4 border border-dashed border-gray-600 rounded-xl text-center bg-gray-800/50">
              <Upload size={24} className="mx-auto text-gray-400 mb-2" />
              <p className="text-sm text-gray-300">Upload Driving License</p>
              <input type="file" className="hidden" id="dl" />
              <label htmlFor="dl" className="mt-2 inline-block bg-gray-700 px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer">Choose File</label>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-lg font-bold mb-4">Bank Details</h2>
            <input
              type="text"
              placeholder="Account Number"
              value={formData.bankAccount}
              onChange={e => setFormData({...formData, bankAccount: e.target.value})}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
              required
            />
            <input
              type="text"
              placeholder="IFSC Code"
              value={formData.ifsc}
              onChange={e => setFormData({...formData, ifsc: e.target.value})}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500 uppercase"
              required
            />
            <div className="p-4 border border-dashed border-gray-600 rounded-xl text-center bg-gray-800/50">
              <Upload size={24} className="mx-auto text-gray-400 mb-2" />
              <p className="text-sm text-gray-300">Upload Cancelled Cheque / Passbook</p>
              <input type="file" className="hidden" id="bank" />
              <label htmlFor="bank" className="mt-2 inline-block bg-gray-700 px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer">Choose File</label>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-lg font-bold mb-4">Live Selfie Verification</h2>
            <div className="aspect-square border-2 border-dashed border-green-500 rounded-full flex flex-col items-center justify-center bg-gray-800/50 relative overflow-hidden w-48 mx-auto mb-6">
              <Camera size={40} className="text-gray-400 mb-2" />
              <p className="text-xs text-gray-400 text-center px-4">Ensure your face is clearly visible</p>
              <button type="button" className="absolute bottom-4 bg-green-500 text-white px-4 py-1.5 rounded-full text-xs font-bold">Take Photo</button>
            </div>
            
            <div className="bg-gray-800 p-4 rounded-xl text-sm text-gray-300">
              <p className="font-bold text-white mb-2">Consent</p>
              <p>By submitting, you agree to a background check and our terms of service. Admin approval is required before your account is activated.</p>
            </div>
          </div>
        )}

        <div className="pt-6 flex gap-3">
          {step > 1 && (
            <button 
              type="button"
              onClick={() => setStep(step - 1)}
              className="flex-1 bg-gray-800 text-white py-3 rounded-xl font-bold hover:bg-gray-700 transition-colors border border-gray-700"
            >
              Back
            </button>
          )}
          <button 
            type="submit"
            className="flex-[2] bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-600/20"
          >
            {step === 4 ? 'Submit Application' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
};
