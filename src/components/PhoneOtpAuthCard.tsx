import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import { Phone, KeyRound, ShieldCheck, RefreshCw, ArrowLeft, AlertCircle } from 'lucide-react';
import { auth } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface PhoneOtpAuthCardProps {
  title?: string;
  subtitle?: string;
  theme?: 'light' | 'dark';
  accent?: 'green' | 'blue';
  askNameOnCustomerOtp?: boolean;
  createCustomerProfile?: boolean;
  showGoogleFallback?: boolean;
  googleLabel?: string;
  onSuccess?: () => void;
}

const COUNTRY_CODES = [
  { code: '+91', dial: '91', label: '🇮🇳 +91', minLen: 10, maxLen: 10 },
  { code: '+1', dial: '1', label: '🇺🇸 +1', minLen: 10, maxLen: 10 },
  { code: '+44', dial: '44', label: '🇬🇧 +44', minLen: 10, maxLen: 11 },
  { code: '+971', dial: '971', label: '🇦🇪 +971', minLen: 9, maxLen: 9 },
  { code: '+61', dial: '61', label: '🇦🇺 +61', minLen: 9, maxLen: 9 },
  { code: '+65', dial: '65', label: '🇸🇬 +65', minLen: 8, maxLen: 8 }
];

const normalizeLocalPhone = (rawDigits: string, countryCode: string): string => {
  const country = COUNTRY_CODES.find((c) => c.code === countryCode);
  let clean = rawDigits.replace(/\D/g, '');
  // Strip duplicate pasted country dial prefix (e.g. 919876543210 when +91 is selected)
  if (country && clean.startsWith(country.dial) && clean.length > country.maxLen) {
    clean = clean.slice(country.dial.length);
  }
  // Strip national leading trunk zero (e.g. 09876543210 -> 9876543210)
  clean = clean.replace(/^0+/, '');
  return clean.slice(0, 14);
};

export const PhoneOtpAuthCard: React.FC<PhoneOtpAuthCardProps> = ({
  title,
  subtitle,
  theme = 'light',
  accent = 'green',
  askNameOnCustomerOtp = true,
  createCustomerProfile = true,
  showGoogleFallback = true,
  googleLabel = 'Continue with Google',
  onSuccess
}) => {
  const { sendPhoneOtp, verifyPhoneOtp, signInWithGoogle } = useAuth();
  const { showToast } = useToast();

  const rawId = useId();
  const baseBoxId = `recaptcha-box-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const recaptchaHostRef = useRef<HTMLDivElement | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const mountAttemptRef = useRef(0);

  const [countryCode, setCountryCode] = useState('+91');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [fullName, setFullName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recaptchaMode, setRecaptchaMode] = useState<'invisible' | 'normal'>('invisible');
  const [normalCaptchaSolved, setNormalCaptchaSolved] = useState(false);

  const clearRecaptcha = useCallback(() => {
    try {
      recaptchaVerifierRef.current?.clear();
    } catch {
      // ignore if already cleared or unmounted
    }
    recaptchaVerifierRef.current = null;
    setNormalCaptchaSolved(false);
    if (recaptchaHostRef.current) {
      recaptchaHostRef.current.innerHTML = '';
    }
  }, []);

  const mountRecaptchaVerifier = useCallback(
    async (mode: 'invisible' | 'normal'): Promise<RecaptchaVerifier> => {
      if (!recaptchaHostRef.current) {
        throw new Error('Verification container is not mounted yet. Please retry.');
      }
      clearRecaptcha();

      // Always create a fresh child DOM node so grecaptcha never errors with "already rendered in this element"
      mountAttemptRef.current += 1;
      const childDiv = document.createElement('div');
      childDiv.id = `${baseBoxId}-${mountAttemptRef.current}`;
      recaptchaHostRef.current.appendChild(childDiv);

      const verifier = new RecaptchaVerifier(auth, childDiv, {
        size: mode,
        theme: theme === 'dark' ? 'dark' : 'light',
        callback: () => {
          if (mode === 'normal') {
            setNormalCaptchaSolved(true);
            setErrorMsg(null);
          }
        },
        'expired-callback': () => {
          setNormalCaptchaSolved(false);
          if (mode === 'normal') {
            setErrorMsg('Security check expired. Please tick the verification checkbox again.');
          }
        },
        'error-callback': () => {
          setNormalCaptchaSolved(false);
        }
      });

      recaptchaVerifierRef.current = verifier;
      await verifier.render();
      return verifier;
    },
    [baseBoxId, clearRecaptcha, theme]
  );

  // When switched to interactive ('normal') mode on phone step, render the visible reCAPTCHA checkbox immediately
  useEffect(() => {
    if (step !== 'phone' || recaptchaMode !== 'normal') {
      return undefined;
    }
    let active = true;
    void mountRecaptchaVerifier('normal').catch((err) => {
      if (active) {
        const msg = err instanceof Error ? err.message : 'Unable to load verification checkbox.';
        setErrorMsg(msg);
      }
    });
    return () => {
      active = false;
    };
  }, [step, recaptchaMode, mountRecaptchaVerifier]);

  useEffect(() => {
    return () => {
      clearRecaptcha();
    };
  }, [clearRecaptcha]);

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const normalizedLocal = normalizeLocalPhone(phoneDigits, countryCode);
  const buildE164Phone = (): string => `${countryCode}${normalizedLocal}`;

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);

    const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode);
    const minDigits = selectedCountry?.minLen ?? 8;
    const maxDigits = selectedCountry?.maxLen ?? 14;

    if (normalizedLocal.length < minDigits || normalizedLocal.length > maxDigits) {
      const msg =
        minDigits === 10 && maxDigits === 10
          ? `Enter a valid 10-digit mobile number for ${countryCode} (without leading 0).`
          : `Enter a valid ${minDigits}–${maxDigits} digit mobile number for ${countryCode}.`;
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }

    if (recaptchaMode === 'normal' && !normalCaptchaSolved) {
      const msg = 'Please complete the "I\'m not a robot" verification checkbox below first.';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }

    setSending(true);
    try {
      const verifier =
        recaptchaMode === 'normal' && recaptchaVerifierRef.current
          ? recaptchaVerifierRef.current
          : await mountRecaptchaVerifier(recaptchaMode);

      const e164 = buildE164Phone();
      const res = await sendPhoneOtp(e164, verifier);

      if (res.success && res.confirmationResult) {
        setConfirmationResult(res.confirmationResult);
        setStep('otp');
        setOtpCode('');
        setResendSeconds(30);
        showToast(`OTP sent to ${e164}`, 'success');
      } else {
        clearRecaptcha();
        const rawCode = res.code || '';
        const needsInteractiveFallback =
          recaptchaMode === 'invisible' &&
          [
            'auth/captcha-check-failed',
            'auth/invalid-app-credential',
            'auth/missing-client-identifier',
            'auth/internal-error'
          ].includes(rawCode);

        if (needsInteractiveFallback) {
          setRecaptchaMode('normal');
          const msg =
            'Invisible verification was blocked by your browser or preview iframe. Please tick the "I\'m not a robot" checkbox below and tap Send OTP again.';
          setErrorMsg(msg);
          showToast('Complete the interactive checkbox below to send OTP', 'info');
        } else {
          if (recaptchaMode === 'normal') {
            // Re-render fresh checkbox for next try
            void mountRecaptchaVerifier('normal').catch(() => {});
          }
          const msg = res.message || 'Unable to send OTP. Please try again.';
          setErrorMsg(msg);
          showToast(msg, 'error');
        }
      }
    } catch (err) {
      clearRecaptcha();
      const msg = err instanceof Error ? err.message : 'Could not initialize SMS verification.';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanOtp = otpCode.replace(/\D/g, '');
    if (cleanOtp.length !== 6) {
      const msg = 'Please enter the 6-digit SMS OTP.';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }

    if (!confirmationResult) {
      setErrorMsg('Verification session expired. Please request a new OTP.');
      setStep('phone');
      return;
    }

    setVerifying(true);
    try {
      const res = await verifyPhoneOtp(confirmationResult, cleanOtp, {
        name: fullName.trim() || undefined,
        createCustomerProfile
      });

      if (res.success) {
        clearRecaptcha();
        showToast('Mobile number verified!', 'success');
        onSuccess?.();
      } else {
        const msg = res.message || 'OTP verification failed.';
        setErrorMsg(msg);
        showToast(msg, 'error');
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle();
      if (res.success) {
        showToast('Signed in with Google!', 'success');
        onSuccess?.();
      } else if (res.message) {
        setErrorMsg(res.message);
        showToast(res.message, 'error');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const isDark = theme === 'dark';
  const primaryBtn =
    accent === 'blue'
      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20'
      : 'bg-green-600 hover:bg-green-700 text-white shadow-green-600/20';

  const ringClass = accent === 'blue' ? 'focus:ring-blue-500' : 'focus:ring-green-500';

  return (
    <div
      className={`w-full rounded-2xl p-5 sm:p-6 space-y-4 border ${
        isDark
          ? 'bg-gray-800 border-gray-700 text-white shadow-xl'
          : 'bg-white border-gray-100 text-gray-900 shadow-sm'
      }`}
    >
      {(title || subtitle) && (
        <div className="space-y-1">
          {title && (
            <h2 className={`text-base font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {title}
            </h2>
          )}
          {subtitle && (
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {subtitle}
            </p>
          )}
        </div>
      )}

      {errorMsg && (
        <div
          className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
            isDark
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span className="leading-relaxed">{errorMsg}</span>
        </div>
      )}

      {step === 'phone' ? (
        <form onSubmit={handleSendOtp} className="space-y-3.5">
          <div>
            <label
              className={`block text-xs font-semibold mb-1.5 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Mobile Number (SMS OTP)
            </label>
            <div className="flex gap-2">
              <select
                aria-label="Country code"
                value={countryCode}
                onChange={(e) => {
                  setCountryCode(e.target.value);
                  setErrorMsg(null);
                }}
                className={`px-2.5 py-3 rounded-xl border text-xs font-bold outline-none ${ringClass} ${
                  isDark
                    ? 'bg-gray-900 border-gray-700 text-white'
                    : 'bg-gray-50 border-gray-200 text-gray-800'
                }`}
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>

              <div className="relative flex-1">
                <Phone
                  size={16}
                  className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                    isDark ? 'text-gray-500' : 'text-gray-400'
                  }`}
                />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="Enter 10-digit number"
                  value={phoneDigits}
                  onChange={(e) => {
                    const cleaned = normalizeLocalPhone(e.target.value, countryCode);
                    setPhoneDigits(cleaned);
                  }}
                  className={`w-full pl-9 pr-3 py-3 rounded-xl border text-sm font-medium outline-none focus:ring-2 ${ringClass} ${
                    isDark
                      ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500'
                      : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                  required
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={sending || normalizedLocal.length < 8}
            className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50 ${primaryBtn}`}
          >
            <Phone size={17} />
            {sending ? 'Sending OTP...' : 'Send Verification OTP'}
          </button>

          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                clearRecaptcha();
                setRecaptchaMode((prev) => (prev === 'invisible' ? 'normal' : 'invisible'));
              }}
              className={`text-[11px] font-medium hover:underline ${
                isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {recaptchaMode === 'invisible'
                ? 'Having trouble receiving OTP? Switch to verification checkbox'
                : 'Use automatic security verification'}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-3.5">
          <div
            className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs border ${
              isDark
                ? 'bg-gray-900 border-gray-700 text-gray-300'
                : 'bg-green-50 border-green-100 text-gray-700'
            }`}
          >
            <span>
              Code sent to <strong className={isDark ? 'text-white' : 'text-gray-900'}>{buildE164Phone()}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                clearRecaptcha();
                setStep('phone');
                setOtpCode('');
                setConfirmationResult(null);
                setErrorMsg(null);
              }}
              className={`font-bold flex items-center gap-1 ${
                accent === 'blue' ? 'text-blue-500' : 'text-green-600'
              } hover:underline`}
            >
              <ArrowLeft size={12} /> Change
            </button>
          </div>

          {askNameOnCustomerOtp && createCustomerProfile && (
            <div>
              <label
                className={`block text-xs font-semibold mb-1 ${
                  isDark ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                Your Name (for new accounts)
              </label>
              <input
                type="text"
                placeholder="e.g. Ananya Sharma"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={`w-full px-3 py-2.5 rounded-xl border text-sm outline-none focus:ring-2 ${ringClass} ${
                  isDark
                    ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500'
                    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>
          )}

          <div>
            <label
              className={`block text-xs font-semibold mb-1.5 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              6-Digit SMS OTP
            </label>
            <div className="relative">
              <KeyRound
                size={16}
                className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}
              />
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="• • • • • •"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`w-full pl-9 pr-3 py-3 rounded-xl border text-center tracking-[0.45em] font-mono text-base font-bold outline-none focus:ring-2 ${ringClass} ${
                  isDark
                    ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500'
                    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={verifying || otpCode.length !== 6}
            className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50 ${primaryBtn}`}
          >
            <ShieldCheck size={17} />
            {verifying ? 'Verifying OTP...' : 'Verify OTP & Sign In'}
          </button>

          <div className="flex items-center justify-center pt-1">
            {resendSeconds > 0 ? (
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Resend OTP available in {resendSeconds}s
              </span>
            ) : (
              <button
                type="button"
                disabled={sending}
                onClick={() => handleSendOtp()}
                className={`text-xs font-bold flex items-center gap-1.5 ${
                  accent === 'blue' ? 'text-blue-400' : 'text-green-600'
                } hover:underline disabled:opacity-50`}
              >
                <RefreshCw size={13} />
                {sending ? 'Resending...' : 'Resend OTP'}
              </button>
            )}
          </div>
        </form>
      )}

      {/* Visible/non-hidden reCAPTCHA mount target — never display:none so challenge frames render reliably */}
      <div
        ref={recaptchaHostRef}
        className={`flex justify-center overflow-x-auto ${
          step === 'phone' && recaptchaMode === 'normal' ? 'pt-1 min-h-[78px]' : 'min-h-0'
        }`}
      />

      {showGoogleFallback && (
        <>
          <div className="relative flex items-center py-1">
            <div className={`flex-grow border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`} />
            <span
              className={`px-3 text-[11px] font-medium uppercase tracking-wider ${
                isDark ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              or
            </span>
            <div className={`flex-grow border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`} />
          </div>

          <button
            type="button"
            disabled={googleLoading}
            onClick={handleGoogleSignIn}
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 border transition disabled:opacity-60 ${
              isDark
                ? 'bg-white text-gray-900 border-white hover:bg-gray-100'
                : 'bg-gray-50 text-gray-800 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {googleLoading ? 'Connecting...' : googleLabel}
          </button>
        </>
      )}

      <p className={`text-[11px] text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        Secured by Firebase Phone &amp; Cloud Firestore
      </p>
    </div>
  );
};
