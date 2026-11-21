import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  ArrowLeft,
  ShieldCheck,
  Truck,
  LogOut
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDelivery } from '../../context/DeliveryContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { PhoneOtpAuthCard } from '../../components/PhoneOtpAuthCard';

const FALLBACK_ZONES = ['Central Zone', 'Sector 14', 'Cyber City', 'Green Park', 'Dwarka', 'Rohini'];

export const DeliveryRegister = () => {
  const navigate = useNavigate();
  const { firebaseUser, isAdmin, logout } = useAuth();
  const { deliveryUser, registerPartner } = useDelivery();
  const { serviceAreas } = useStore();
  const { showToast } = useToast();

  const availableZones = Array.from(
    new Set([
      ...serviceAreas.filter((a) => a.isActive).map((a) => `${a.name} (${a.pincode})`),
      ...FALLBACK_ZONES
    ])
  );

  const [step, setStep] = useState(1);
  const [useCustomArea, setUseCustomArea] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    area: 'Central Zone',
    customArea: '',
    vehicle: 'Motorcycle',
    dlNumber: '',
    bankAccount: '',
    ifsc: ''
  });
  const [createdPartner, setCreatedPartner] = useState<{
    code: string;
    approved: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const verifiedPhone = (firebaseUser?.phoneNumber || '').replace(/\D/g, '').slice(0, 15);
    setFormData((prev) => ({
      ...prev,
      name: prev.name || firebaseUser?.displayName || '',
      phone: prev.phone || verifiedPhone
    }));
  }, [firebaseUser?.displayName, firebaseUser?.phoneNumber]);

  const resolvedArea = (useCustomArea ? formData.customArea : formData.area).trim().slice(0, 80);

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1 && formData.phone.replace(/\D/g, '').length < 10) {
      showToast('Please enter a valid 10-digit mobile number.', 'error');
      return;
    }
    if (step === 1 && useCustomArea && !resolvedArea) {
      showToast('Please enter your city / area and pincode.', 'error');
      return;
    }
    setStep((s) => s + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      showToast('Please verify via Mobile OTP or Google first.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const cleanAccount = formData.bankAccount.replace(/\s+/g, '');
      const created = await registerPartner({
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        area: resolvedArea || 'Central Zone',
        vehicle: formData.vehicle,
        dlNumber: formData.dlNumber.trim(),
        bankLast4: cleanAccount.slice(-4),
        ifsc: formData.ifsc.trim()
      });
      setCreatedPartner({
        code: created.partnerCode,
        approved: created.isApproved
      });
      showToast(
        created.isApproved
          ? `Partner profile activated (${created.partnerCode})!`
          : `Application submitted (${created.partnerCode}). Awaiting Admin approval.`,
        'success'
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to register partner profile.';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (deliveryUser && !createdPartner) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white text-center safe-top">
        <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mb-5 text-green-400">
          <Truck size={36} />
        </div>
        <h1 className="text-2xl font-bold mb-2">Partner Profile Exists</h1>
        <p className="text-sm text-gray-400 max-w-xs mb-6">
          This account ({deliveryUser.phone ? `+${deliveryUser.phone}` : deliveryUser.email}) is already registered under{' '}
          <strong className="text-white">{deliveryUser.partnerCode}</strong>.
        </p>
        <button
          onClick={() =>
            navigate(
              deliveryUser.isApproved ? '/delivery/dashboard' : '/delivery/login'
            )
          }
          className="w-full max-w-sm bg-green-600 text-white py-3.5 rounded-xl font-bold hover:bg-green-700 transition"
        >
          {deliveryUser.isApproved
            ? 'Go to Partner Dashboard'
            : 'Check Approval Status'}
        </button>
      </div>
    );
  }

  if (createdPartner) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white text-center safe-top">
        <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/40">
          <CheckCircle size={48} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold mb-2">
          {createdPartner.approved
            ? 'Partner Account Active!'
            : 'Application Submitted!'}
        </h1>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 my-4 max-w-xs w-full">
          <p className="text-xs text-gray-400">Assigned Partner Code</p>
          <p className="text-2xl font-bold text-green-400 mt-1">
            {createdPartner.code}
          </p>
          <p className="text-xs text-gray-400 mt-2">
            {createdPartner.approved
              ? 'Your partner account is approved and ready for live dispatch.'
              : 'Your KYC details are saved in Firestore. Once the Store Admin approves your application, you can go online and accept trips.'}
          </p>
        </div>
        <Link
          to={createdPartner.approved ? '/delivery/dashboard' : '/delivery/login'}
          className="w-full max-w-sm bg-green-600 text-white py-3.5 rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg"
        >
          {createdPartner.approved ? 'Open Partner Dashboard' : 'View Status'}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 pb-20 safe-top">
      <div className="flex items-center gap-4 mb-6 pt-4">
        <Link
          to="/delivery/login"
          className="p-2 bg-gray-800 rounded-full text-gray-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">Partner Registration</h1>
      </div>

      {!firebaseUser ? (
        <div className="max-w-sm mx-auto space-y-4 mt-4">
          <div className="bg-gray-800/80 border border-gray-700 rounded-2xl p-4 text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mx-auto">
              <ShieldCheck size={24} />
            </div>
            <h2 className="text-base font-bold">Step 1: Verify Your Phone or Account</h2>
            <p className="text-xs text-gray-400">
              Verify via Firebase SMS OTP (or Google) so trip assignments, COD reconciliation, and payouts stay cryptographically tied to you.
            </p>
          </div>
          <PhoneOtpAuthCard
            theme="dark"
            accent="green"
            createCustomerProfile={false}
          />
        </div>
      ) : (
        <>
          <div className="max-w-sm mx-auto bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-2.5 mb-6 flex items-center justify-between text-xs">
            <div className="truncate">
              <span className="text-gray-400">Verified: </span>
              <span className="font-bold text-green-400">
                {firebaseUser.phoneNumber || firebaseUser.email}
              </span>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="text-gray-400 hover:text-white ml-2 shrink-0 flex items-center gap-1"
              title="Switch account"
            >
              <LogOut size={14} />
            </button>
          </div>

          <div className="flex justify-between mb-8 relative max-w-sm mx-auto">
            <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-800 -z-10 -translate-y-1/2"></div>
            <div
              className="absolute top-1/2 left-0 h-1 bg-green-500 -z-10 -translate-y-1/2 transition-all"
              style={{ width: `${((step - 1) / 3) * 100}%` }}
            ></div>

            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  step >= i
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-800 text-gray-500 border border-gray-700'
                }`}
              >
                {i}
              </div>
            ))}
          </div>

          <form
            onSubmit={step === 4 ? handleSubmit : handleNext}
            className="space-y-4 max-w-sm mx-auto"
          >
            {step === 1 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-lg font-bold mb-2">Rider Profile & Zone</h2>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Full Legal Name *
                  </label>
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    10-Digit Mobile Number *
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Preferred Zone
                    </label>
                    <select
                      value={useCustomArea ? '__custom__' : formData.area}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setUseCustomArea(true);
                        } else {
                          setUseCustomArea(false);
                          setFormData({ ...formData, area: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-3 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white outline-none"
                    >
                      {availableZones.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                      <option value="__custom__">+ Enter Custom Area / Pincode</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Vehicle Type
                    </label>
                    <select
                      value={formData.vehicle}
                      onChange={(e) =>
                        setFormData({ ...formData, vehicle: e.target.value })
                      }
                      className="w-full px-3 py-3 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white outline-none"
                    >
                      <option value="Motorcycle">Motorcycle</option>
                      <option value="Electric Scooter">Electric Scooter</option>
                      <option value="Scooter">Scooter</option>
                      <option value="Van">Van</option>
                    </select>
                  </div>
                </div>
                {useCustomArea && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Custom City / Area &amp; Pincode *
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="e.g. Gwalior (474011)"
                      value={formData.customArea}
                      onChange={(e) => setFormData({ ...formData, customArea: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-800 border border-green-500/60 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500 text-sm"
                      required
                    />
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-lg font-bold mb-2">License Verification</h2>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Driving License Number *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. DL-0420200012345"
                    value={formData.dlNumber}
                    onChange={(e) =>
                      setFormData({ ...formData, dlNumber: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500 uppercase"
                    required
                  />
                </div>
                <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4 text-xs text-gray-400">
                  Your Driving License number is recorded for manual fleet onboarding
                  verification by the Store Admin.
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-lg font-bold mb-2">Payout Bank Details</h2>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Bank Account Number *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Account Number (only last 4 digits stored)"
                    value={formData.bankAccount}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        bankAccount: e.target.value.replace(/\D/g, '')
                      })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    IFSC Code *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. HDFC0001234"
                    value={formData.ifsc}
                    onChange={(e) =>
                      setFormData({ ...formData, ifsc: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 outline-none text-white placeholder-gray-500 uppercase"
                    required
                  />
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-lg font-bold mb-2">Review & Submit</h2>
                <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Name:</span>
                    <span className="font-bold text-white">{formData.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Phone:</span>
                    <span className="font-bold text-white">{formData.phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Zone / Vehicle:</span>
                    <span className="font-bold text-white">
                      {resolvedArea || 'Central Zone'} • {formData.vehicle}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">DL Number:</span>
                    <span className="font-bold text-white uppercase">
                      {formData.dlNumber}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Bank Account:</span>
                    <span className="font-bold text-white">
                      ••••{formData.bankAccount.slice(-4)} ({formData.ifsc.toUpperCase()})
                    </span>
                  </div>
                </div>

                <div className="bg-gray-800 p-4 rounded-xl text-xs text-gray-300 border border-gray-700">
                  <p className="font-bold text-white mb-1">Onboarding Review</p>
                  {isAdmin ? (
                    <p className="text-green-400">
                      Admin account detected: partner profile will be auto-approved
                      upon submission.
                    </p>
                  ) : (
                    <p>
                      By submitting, you confirm these details are accurate. Your
                      account will be activated as soon as the Store Admin approves
                      your partner application.
                    </p>
                  )}
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
                disabled={submitting}
                className="flex-[2] bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 disabled:opacity-60 transition-colors shadow-lg shadow-green-600/20"
              >
                {step === 4
                  ? submitting
                    ? 'Submitting...'
                    : 'Submit Application'
                  : 'Continue'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
};
