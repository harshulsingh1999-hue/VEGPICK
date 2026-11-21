import React, { useState } from 'react';
import {
  MapPin,
  Plus,
  Search,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Shield,
  Download,
  X,
  Clock
} from 'lucide-react';
import { ServiceArea } from '../../lib/data';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../lib/utils';

interface AreaPincodeControlCenterProps {
  onExportCsv: (filename: string, headers: string[], rows: Array<Array<string | number>>) => void;
}

export const AreaPincodeControlCenter: React.FC<AreaPincodeControlCenterProps> = ({
  onExportCsv
}) => {
  const { allOrders, allUsers } = useAuth();
  const {
    serviceAreas,
    addServiceArea,
    updateServiceArea,
    deleteServiceArea,
    toggleServiceArea,
    appSettings,
    updateAppSettings,
    checkPincodeServiceability
  } = useStore();
  const { showToast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [testPincode, setTestPincode] = useState('');
  const [togglingRestriction, setTogglingRestriction] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingArea, setEditingArea] = useState<ServiceArea | null>(null);
  const [savingArea, setSavingArea] = useState(false);
  const [form, setForm] = useState({
    name: '',
    city: '',
    pincode: '',
    etaMinutes: 30,
    deliveryFeeOverride: '',
    minOrderOverride: '',
    notes: '',
    isActive: true
  });

  const filteredAreas = serviceAreas.filter((area) => {
    const matchesQuery =
      area.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      area.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
      area.pincode.includes(searchTerm.trim());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && area.isActive) ||
      (statusFilter === 'paused' && !area.isActive);
    return matchesQuery && matchesStatus;
  });

  const activeCount = serviceAreas.filter((a) => a.isActive).length;
  const pausedCount = serviceAreas.length - activeCount;
  const isRestricted = Boolean(appSettings.restrictToServiceAreas);
  const testResult = testPincode.trim() ? checkPincodeServiceability(testPincode) : null;

  // Discover pincodes/cities from booked orders & customer addresses not yet added to serviceAreas
  const unconfiguredOrderAreas = React.useMemo(() => {
    const knownPincodes = new Set(serviceAreas.map((a) => a.pincode.replace(/\D/g, '')));
    const map = new Map<string, { city: string; pincode: string; orderCount: number }>();

    const recordArea = (cityRaw?: string, zipRaw?: string, isOrder = false) => {
      const cleanPin = (zipRaw || '').replace(/\D/g, '').slice(0, 10);
      const city = (cityRaw || '').trim().slice(0, 80);
      if (cleanPin.length < 4 || !city || knownPincodes.has(cleanPin)) return;
      const existing = map.get(cleanPin);
      if (existing) {
        if (isOrder) existing.orderCount += 1;
      } else {
        map.set(cleanPin, { city, pincode: cleanPin, orderCount: isOrder ? 1 : 0 });
      }
    };

    allOrders.forEach((o) => recordArea(o.address?.city, o.address?.zip, true));
    allUsers.forEach((u) => (u.addresses || []).forEach((a) => recordArea(a.city, a.zip, false)));

    return Array.from(map.values()).sort((a, b) => b.orderCount - a.orderCount);
  }, [serviceAreas, allOrders, allUsers]);

  const openCreateModal = (prefill?: { city: string; pincode: string }) => {
    setEditingArea(null);
    setForm({
      name: prefill?.city || '',
      city: prefill?.city || '',
      pincode: prefill?.pincode || '',
      etaMinutes: 30,
      deliveryFeeOverride: '',
      minOrderOverride: '',
      notes: '',
      isActive: true
    });
    setShowModal(true);
  };

  const openEditModal = (area: ServiceArea) => {
    setEditingArea(area);
    setForm({
      name: area.name,
      city: area.city,
      pincode: area.pincode,
      etaMinutes: area.etaMinutes || 30,
      deliveryFeeOverride:
        typeof area.deliveryFeeOverride === 'number' ? String(area.deliveryFeeOverride) : '',
      minOrderOverride:
        typeof area.minOrderOverride === 'number' ? String(area.minOrderOverride) : '',
      notes: area.notes || '',
      isActive: area.isActive
    });
    setShowModal(true);
  };

  const handleToggleRestriction = async () => {
    const nextVal = !isRestricted;
    if (nextVal && activeCount === 0) {
      showToast(
        'Warning: Restrict Mode enabled with 0 active pincodes — add an active pincode so customers can place orders.',
        'info'
      );
    }
    setTogglingRestriction(true);
    try {
      await updateAppSettings({ restrictToServiceAreas: nextVal });
      showToast(
        nextVal
          ? 'Strict Local Area & Pincode Access enabled across app & checkout API'
          : 'Open Pincode Access enabled (all pincodes permitted)',
        'success'
      );
    } catch {
      showToast('Failed to update area restriction setting.', 'error');
    } finally {
      setTogglingRestriction(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            Area Location &amp; Pincode Control Center
          </h2>
          <p className="text-sm text-gray-500">
            Decide which local areas and pincodes can access ordering, set area-specific delivery fees/ETAs, and sync partner dispatch zones.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              onExportCsv(
                `freshveggie_service_areas_${new Date().toISOString().split('T')[0]}.csv`,
                ['ID', 'Area Name', 'City', 'Pincode', 'Status', 'ETA (min)', 'Delivery Fee Override', 'Min Order Override'],
                serviceAreas.map((a) => [
                  a.id,
                  a.name,
                  a.city,
                  a.pincode,
                  a.isActive ? 'ACTIVE' : 'PAUSED',
                  a.etaMinutes,
                  typeof a.deliveryFeeOverride === 'number' ? a.deliveryFeeOverride : 'Default',
                  typeof a.minOrderOverride === 'number' ? a.minOrderOverride : 'None'
                ])
              )
            }
            className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Download size={15} /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => openCreateModal()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
          >
            <Plus size={16} /> Add Area / Pincode
          </button>
        </div>
      </div>

      {/* App-Wide Access Enforcement Card + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className={`lg:col-span-2 p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            isRestricted
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-amber-50 border-amber-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isRestricted ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
              }`}
            >
              <Shield size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900 text-sm">
                  App-Wide Pincode Fencing
                </h3>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                    isRestricted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-200 text-amber-900'
                  }`}
                >
                  {isRestricted ? 'STRICT LOCAL ONLY' : 'OPEN ACCESS'}
                </span>
              </div>
              <p className="text-xs text-gray-700 mt-1">
                {isRestricted
                  ? 'Only customers inside Active Pincodes listed below can verify stock and place orders across Android, iOS, and Web.'
                  : 'All pincodes are currently allowed to checkout. Enable strict mode to restrict ordering exclusively to your approved local areas.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={togglingRestriction}
            onClick={handleToggleRestriction}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold shrink-0 transition shadow-xs ${
              isRestricted
                ? 'bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {togglingRestriction
              ? 'Saving...'
              : isRestricted
              ? 'Disable Strict Fencing'
              : 'Enforce Local Pincodes'}
          </button>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-gray-400 uppercase">
            <span>Configured Zones</span>
            <MapPin size={16} className="text-blue-600" />
          </div>
          <div className="flex items-baseline gap-4 mt-2">
            <p className="text-3xl font-extrabold text-gray-900">{serviceAreas.length}</p>
            <div className="text-xs space-x-2">
              <span className="text-green-600 font-bold">{activeCount} Active</span>
              <span className="text-gray-400">•</span>
              <span className="text-orange-500 font-bold">{pausedCount} Paused</span>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Cached at Edge (/api/catalog/bootstrap) &amp; synced to Driver Registration
          </p>
        </div>
      </div>

      {/* Quick Pincode Coverage Tester & Search Filters */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search area, city, or pincode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            {(['all', 'active', 'paused'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize border transition ${
                  statusFilter === tab
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="relative">
            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500" />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Test customer pincode (e.g. 122001)"
              value={testPincode}
              onChange={(e) => setTestPincode(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="w-full pl-9 pr-3 py-2 bg-blue-50/50 border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {testResult && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 border ${
              testResult.serviceable
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {testResult.serviceable ? (
                <CheckCircle2 size={16} className="shrink-0" />
              ) : (
                <AlertTriangle size={16} className="shrink-0" />
              )}
              <span>
                {testResult.serviceable
                  ? testResult.matchedArea
                    ? `Serviceable: ${testResult.matchedArea.name}, ${testResult.matchedArea.city} (${testResult.matchedArea.pincode}) • ~${testResult.matchedArea.etaMinutes} min ETA`
                    : `Permitted (Open Pincode Mode enabled — not matched to a specific local hub)`
                  : testResult.reason}
              </span>
            </div>
            {testResult.matchedArea && (
              <span className="font-bold">
                Fee:{' '}
                {typeof testResult.matchedArea.deliveryFeeOverride === 'number'
                  ? formatCurrency(testResult.matchedArea.deliveryFeeOverride)
                  : `Default (${formatCurrency(appSettings.baseDeliveryFee)})`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Auto-discovered Areas from Booked Customer Orders */}
      {unconfiguredOrderAreas.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-blue-950 text-sm flex items-center gap-1.5">
                <MapPin size={16} className="text-blue-600" />
                Customer Order Areas Not Yet Added ({unconfiguredOrderAreas.length})
              </h3>
              <p className="text-xs text-blue-800 mt-0.5">
                These cities and pincodes were used in customer orders/addresses (already synced to Delivery Partner zones). Add them here to configure custom ETAs, delivery fees, or strict fencing.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {unconfiguredOrderAreas.map((item) => (
              <button
                key={item.pincode}
                type="button"
                onClick={() => openCreateModal({ city: item.city, pincode: item.pincode })}
                className="bg-white hover:bg-blue-100 border border-blue-200 text-blue-900 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition"
              >
                <Plus size={14} className="text-blue-600" />
                <span>
                  {item.city} ({item.pincode})
                  {item.orderCount > 0 ? ` • ${item.orderCount} order${item.orderCount > 1 ? 's' : ''}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Service Areas Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
        {filteredAreas.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
              <MapPin size={22} />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">
                {serviceAreas.length === 0 ? 'No Local Areas Configured Yet' : 'No Matching Areas Found'}
              </h3>
              <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                {serviceAreas.length === 0
                  ? 'Add your local neighborhood hubs and pincodes to control regional ordering access, delivery ETAs, and custom area delivery fees.'
                  : 'Try clearing your search query or switching the status filter above.'}
              </p>
            </div>
            {serviceAreas.length === 0 ? (
              <button
                type="button"
                onClick={() => openCreateModal()}
                className="bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-blue-700"
              >
                + Add First Service Area
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                }}
                className="bg-gray-900 text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-gray-800"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs uppercase text-gray-400 font-bold border-b border-gray-100">
                <tr>
                  <th className="p-4">Local Area &amp; City</th>
                  <th className="p-4">Pincode</th>
                  <th className="p-4">ETA</th>
                  <th className="p-4">Delivery Fee</th>
                  <th className="p-4">Min Order</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAreas.map((area) => (
                  <tr key={area.id} className="hover:bg-gray-50/70 transition">
                    <td className="p-4">
                      <p className="font-bold text-gray-900">{area.name}</p>
                      <p className="text-xs text-gray-500">{area.city}</p>
                      {area.notes && (
                        <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">
                          {area.notes}
                        </p>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="font-mono font-bold text-gray-800 bg-gray-100 px-2.5 py-1 rounded-lg text-xs">
                        {area.pincode}
                      </span>
                    </td>
                    <td className="p-4 text-xs font-semibold text-gray-700">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={13} className="text-gray-400" />
                        {area.etaMinutes} mins
                      </span>
                    </td>
                    <td className="p-4 text-xs font-bold text-gray-800">
                      {typeof area.deliveryFeeOverride === 'number'
                        ? formatCurrency(area.deliveryFeeOverride)
                        : <span className="text-gray-400 font-normal">Global ({formatCurrency(appSettings.baseDeliveryFee)})</span>}
                    </td>
                    <td className="p-4 text-xs font-bold text-gray-800">
                      {typeof area.minOrderOverride === 'number'
                        ? formatCurrency(area.minOrderOverride)
                        : <span className="text-gray-400 font-normal">None</span>}
                    </td>
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await toggleServiceArea(area.id);
                            showToast(
                              `${area.name} (${area.pincode}) ${area.isActive ? 'paused' : 'activated'}`,
                              'info'
                            );
                          } catch {
                            showToast('Failed to toggle area status.', 'error');
                          }
                        }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition ${
                          area.isActive
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {area.isActive ? 'ACTIVE' : 'PAUSED'}
                      </button>
                    </td>
                    <td className="p-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(area)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Edit Area"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await deleteServiceArea(area.id);
                            showToast(`Deleted area ${area.name}`, 'info');
                          } catch {
                            showToast('Unable to delete service area.', 'error');
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete Area"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Service Area Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-lg text-gray-800">
                {editingArea ? 'Edit Service Area' : 'Add Service Area & Pincode'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const cleanPin = form.pincode.replace(/\D/g, '').trim();
                if (cleanPin.length < 4 || cleanPin.length > 10) {
                  showToast('Pincode must be 4 to 10 digits.', 'error');
                  return;
                }
                setSavingArea(true);
                try {
                  const payload = {
                    name: form.name.trim(),
                    city: form.city.trim(),
                    pincode: cleanPin,
                    etaMinutes: Math.max(5, Math.min(1440, Number(form.etaMinutes) || 30)),
                    deliveryFeeOverride:
                      form.deliveryFeeOverride.trim() !== ''
                        ? Number(form.deliveryFeeOverride)
                        : null,
                    minOrderOverride:
                      form.minOrderOverride.trim() !== ''
                        ? Number(form.minOrderOverride)
                        : null,
                    notes: form.notes.trim(),
                    isActive: form.isActive
                  };
                  if (editingArea) {
                    await updateServiceArea(editingArea.id, payload);
                    showToast(`Updated ${payload.name} (${cleanPin})`, 'success');
                  } else {
                    await addServiceArea(payload);
                    showToast(`Added ${payload.name} (${cleanPin})`, 'success');
                  }
                  setShowModal(false);
                } catch (err) {
                  showToast(
                    err instanceof Error ? err.message : 'Unable to save service area.',
                    'error'
                  );
                } finally {
                  setSavingArea(false);
                }
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    Area / Locality Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sector 14"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Gurugram"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    Pincode / ZIP *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    placeholder="e.g. 122001"
                    value={form.pincode}
                    onChange={(e) =>
                      setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 10) })
                    }
                    className="w-full p-2.5 border rounded-xl text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    Est. Delivery ETA (mins)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    required
                    value={form.etaMinutes}
                    onChange={(e) => setForm({ ...form, etaMinutes: Number(e.target.value) })}
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    Fee Override (₹, optional)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    placeholder={`Default ₹${appSettings.baseDeliveryFee}`}
                    value={form.deliveryFeeOverride}
                    onChange={(e) =>
                      setForm({ ...form, deliveryFeeOverride: e.target.value })
                    }
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    Min Order Override (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50000}
                    placeholder="Optional"
                    value={form.minOrderOverride}
                    onChange={(e) =>
                      setForm({ ...form, minOrderOverride: e.target.value })
                    }
                    className="w-full p-2.5 border rounded-xl text-sm outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">
                  Hub / Dispatch Note (optional)
                </label>
                <input
                  type="text"
                  maxLength={240}
                  placeholder="e.g. Covered by North Dispatch Hub"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full p-2.5 border rounded-xl text-sm outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="areaActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 accent-green-600 rounded"
                />
                <label htmlFor="areaActive" className="text-xs font-bold text-gray-700">
                  Enable ordering &amp; rider dispatch for this pincode
                </label>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 border rounded-xl text-sm font-bold text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingArea}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold"
                >
                  {savingArea ? 'Saving...' : 'Save Area'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
