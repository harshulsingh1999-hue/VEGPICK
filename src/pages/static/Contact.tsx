import React, { useState, useEffect } from 'react';
import { ArrowLeft, Mail, Phone, MapPin, Send, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../context/StoreContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PhoneOtpAuthCard } from '../../components/PhoneOtpAuthCard';

export const Contact = () => {
  const navigate = useNavigate();
  const { addComplaint } = useStore();
  const { firebaseUser, user } = useAuth();
  const { showToast } = useToast();

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [orderId, setOrderId] = useState('');
  const [category, setCategory] = useState<
    'Quality' | 'Delay' | 'Missing Item' | 'Refund' | 'Other'
  >('Other');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.name && !name) setName(user.name);
    if (user?.phone && !phone) setPhone(user.phone);
    if (!user?.phone && firebaseUser?.phoneNumber && !phone) {
      setPhone(firebaseUser.phoneNumber.replace(/\D/g, '').slice(0, 15));
    }
  }, [user?.name, user?.phone, firebaseUser?.phoneNumber]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      showToast('Please sign in via Mobile OTP or Google to submit a support ticket.', 'error');
      return;
    }
    if (!name.trim() || !phone.trim() || !subject.trim() || !message.trim()) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await addComplaint({
        customerName: name.trim(),
        customerPhone: phone.trim(),
        orderId: orderId.trim() || 'GENERAL',
        category,
        subject: subject.trim(),
        description: message.trim(),
        status: 'open'
      });
      setSubmitted(true);
      showToast('Your support ticket has been saved to Firestore.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to submit ticket.';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white p-4 shadow-sm flex items-center gap-4 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-100 rounded-full"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="font-bold text-lg">Contact & Support</h1>
      </div>
      <div className="p-4 max-w-xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm text-center">
          <h2 className="text-xl font-bold text-green-600 mb-2">Get in Touch</h2>
          <p className="text-gray-500 text-sm">
            We'd love to hear from you. Our customer support team is available 7 days a
            week.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white p-4 rounded-xl shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center text-green-600 shrink-0">
              <Mail size={18} />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-bold">Email</p>
              <p className="text-xs font-semibold text-gray-800 break-all">
                support@freshveggie.com
              </p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 shrink-0">
              <Phone size={18} />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-bold">Phone</p>
              <p className="text-xs font-semibold text-gray-800">+91 98765 43210</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center text-orange-600 shrink-0">
              <MapPin size={18} />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-bold">Location</p>
              <p className="text-xs font-semibold text-gray-800">Veggie Town, India</p>
            </div>
          </div>
        </div>

        {/* Submit Ticket Form */}
        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <h3 className="font-bold text-gray-800 mb-1">
            Submit a Complaint or Query
          </h3>
          <p className="text-xs text-gray-500 mb-5">
            Your ticket goes directly to the Admin support desk.
          </p>

          {!firebaseUser ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Sign in via Mobile OTP or Google to verify your ticket and link it to your orders.
              </p>
              <PhoneOtpAuthCard createCustomerProfile />
            </div>
          ) : submitted ? (
            <div className="text-center py-8">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3 text-green-600">
                <CheckCircle size={32} />
              </div>
              <h4 className="font-bold text-gray-800 text-lg mb-1">
                Ticket Submitted!
              </h4>
              <p className="text-sm text-gray-500 mb-5">
                Our support supervisor will review your issue and reach out shortly.
              </p>
              <button
                onClick={() => {
                  setSubmitted(false);
                  setSubject('');
                  setMessage('');
                  setOrderId('');
                }}
                className="text-xs font-semibold text-green-600 hover:underline"
              >
                Send Another Message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Your Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit Mobile"
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) =>
                      setCategory(
                        e.target.value as
                          | 'Quality'
                          | 'Delay'
                          | 'Missing Item'
                          | 'Refund'
                          | 'Other'
                      )
                    }
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none bg-white"
                  >
                    <option value="Quality">Quality</option>
                    <option value="Delay">Delay</option>
                    <option value="Missing Item">Missing Item</option>
                    <option value="Refund">Refund</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Related Order ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    placeholder="e.g. ORD-100234"
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Subject / Issue Topic *
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Late delivery or damaged item"
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Message Details *
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Explain your concern or query..."
                  rows={4}
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <Send size={16} />
                {submitting ? 'Submitting...' : 'Send Message to Support'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
