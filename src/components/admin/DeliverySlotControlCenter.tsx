import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  Copy,
  Download,
  Edit2,
  Layers,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { addDays, format } from 'date-fns';
import { DEFAULT_DAILY_SLOT_TEMPLATES, DeliverySlot } from '../../lib/data';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';

interface DeliverySlotControlCenterProps {
  onExportCsv: (filename: string, headers: string[], rows: Array<Array<string | number>>) => void;
}

const format24To12Label = (timeStr: string): string => {
  const parts = timeStr.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return timeStr;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minStr = String(Math.max(0, Math.min(59, m))).padStart(2, '0');
  return `${hour12}:${minStr} ${suffix}`;
};

const buildSlotLabel = (startTime: string, endTime: string): string =>
  `${format24To12Label(startTime)} - ${format24To12Label(endTime)}`;

export const DeliverySlotControlCenter: React.FC<DeliverySlotControlCenterProps> = ({
  onExportCsv
}) => {
  const {
    deliverySlots,
    addDeliverySlot,
    updateDeliverySlot,
    deleteDeliverySlot,
    toggleDeliverySlot,
    bulkCreateDeliverySlots,
    deleteDeliverySlotsByDate
  } = useStore();
  const { showToast } = useToast();

  const todayIso = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'date' | 'daily'>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');

  // Add / Edit modal
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [editingSlot, setEditingSlot] = useState<DeliverySlot | null>(null);
  const [savingSlot, setSavingSlot] = useState(false);
  const [autoLabel, setAutoLabel] = useState(true);
  const [slotForm, setSlotForm] = useState({
    scheduleType: 'date' as 'date' | 'daily',
    slotDate: todayIso,
    startTime: '08:00',
    endTime: '10:00',
    label: '8:00 AM - 10:00 AM',
    cutoffMinutes: 0,
    maxOrders: 0,
    sortOrder: 1,
    notes: '',
    isActive: true
  });

  // Bulk Generate / Copy Modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkMode, setBulkMode] = useState<'range' | 'copy'>('range');
  const [bulkStartDate, setBulkStartDate] = useState(todayIso);
  const [bulkEndDate, setBulkEndDate] = useState(format(addDays(new Date(), 3), 'yyyy-MM-dd'));
  const [bulkCutoff, setBulkCutoff] = useState(0);
  const [bulkMaxOrders, setBulkMaxOrders] = useState(0);
  const [selectedTemplateIndices, setSelectedTemplateIndices] = useState<number[]>(
    DEFAULT_DAILY_SLOT_TEMPLATES.map((_, idx) => idx)
  );
  const [copySourceKey, setCopySourceKey] = useState<'daily' | string>('daily');
  const [copyTargetDate, setCopyTargetDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [bulkSaving, setBulkSaving] = useState(false);

  // In-app Delete Confirmations (no window.confirm)
  const [slotPendingDelete, setSlotPendingDelete] = useState<DeliverySlot | null>(null);
  const [datePendingClear, setDatePendingClear] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [seedingDefaults, setSeedingDefaults] = useState(false);

  const dateOverrideCount = useMemo(
    () => deliverySlots.filter((s) => s.scheduleType === 'date').length,
    [deliverySlots]
  );
  const dailyTemplateCount = useMemo(
    () => deliverySlots.filter((s) => s.scheduleType === 'daily').length,
    [deliverySlots]
  );
  const activeCount = useMemo(
    () => deliverySlots.filter((s) => s.isActive).length,
    [deliverySlots]
  );
  const distinctDates = useMemo(
    () =>
      Array.from(
        new Set(
          deliverySlots
            .filter((s) => s.scheduleType === 'date' && s.slotDate)
            .map((s) => s.slotDate)
        )
      ).sort(),
    [deliverySlots]
  );

  const filteredSlots = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return deliverySlots.filter((s) => {
      if (typeFilter !== 'all' && s.scheduleType !== typeFilter) return false;
      if (dateFilter && s.slotDate !== dateFilter) return false;
      if (statusFilter === 'active' && !s.isActive) return false;
      if (statusFilter === 'paused' && s.isActive) return false;
      if (q) {
        const hay = `${s.label} ${s.slotDate} ${s.startTime} ${s.endTime} ${s.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [deliverySlots, searchTerm, typeFilter, dateFilter, statusFilter]);

  const templatePool = useMemo(() => {
    const existingDaily = deliverySlots.filter((s) => s.scheduleType === 'daily');
    if (existingDaily.length > 0) {
      return existingDaily.map((s) => ({
        startTime: s.startTime,
        endTime: s.endTime,
        label: s.label,
        sortOrder: s.sortOrder,
        notes: s.notes || ''
      }));
    }
    return DEFAULT_DAILY_SLOT_TEMPLATES.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      label: s.label,
      sortOrder: s.sortOrder,
      notes: s.notes || ''
    }));
  }, [deliverySlots]);

  const openCreateModal = (presetDate?: string) => {
    setEditingSlot(null);
    setAutoLabel(true);
    const startTime = '08:00';
    const endTime = '10:00';
    setSlotForm({
      scheduleType: presetDate ? 'date' : 'date',
      slotDate: presetDate || dateFilter || todayIso,
      startTime,
      endTime,
      label: buildSlotLabel(startTime, endTime),
      cutoffMinutes: 0,
      maxOrders: 0,
      sortOrder: deliverySlots.length + 1,
      notes: '',
      isActive: true
    });
    setShowSlotModal(true);
  };

  const openEditModal = (slot: DeliverySlot) => {
    setEditingSlot(slot);
    setAutoLabel(false);
    setSlotForm({
      scheduleType: slot.scheduleType,
      slotDate: slot.slotDate || todayIso,
      startTime: slot.startTime,
      endTime: slot.endTime,
      label: slot.label,
      cutoffMinutes: slot.cutoffMinutes || 0,
      maxOrders: slot.maxOrders || 0,
      sortOrder: slot.sortOrder || 1,
      notes: slot.notes || '',
      isActive: slot.isActive
    });
    setShowSlotModal(true);
  };

  const openDuplicateModal = (slot: DeliverySlot) => {
    setEditingSlot(null);
    setAutoLabel(true);
    setSlotForm({
      scheduleType: slot.scheduleType,
      slotDate:
        slot.scheduleType === 'date'
          ? slot.slotDate || todayIso
          : format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      startTime: slot.startTime,
      endTime: slot.endTime,
      label: slot.label,
      cutoffMinutes: slot.cutoffMinutes || 0,
      maxOrders: slot.maxOrders || 0,
      sortOrder: (slot.sortOrder || 0) + 1,
      notes: slot.notes || '',
      isActive: true
    });
    setShowSlotModal(true);
  };

  const handleTimeChange = (field: 'startTime' | 'endTime', value: string) => {
    setSlotForm((prev) => {
      const next = { ...prev, [field]: value };
      if (autoLabel && next.startTime && next.endTime) {
        next.label = buildSlotLabel(next.startTime, next.endTime);
      }
      return next;
    });
  };

  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (slotForm.scheduleType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(slotForm.slotDate)) {
      showToast('Please select a valid Slot Date (YYYY-MM-DD).', 'error');
      return;
    }
    if (!slotForm.startTime || !slotForm.endTime) {
      showToast('Please select valid Start Time and End Time.', 'error');
      return;
    }
    if (slotForm.endTime <= slotForm.startTime) {
      showToast('End Time must be later than Start Time.', 'error');
      return;
    }
    const cleanLabel = (slotForm.label || buildSlotLabel(slotForm.startTime, slotForm.endTime)).trim();
    if (!cleanLabel) {
      showToast('Slot Label cannot be empty.', 'error');
      return;
    }

    setSavingSlot(true);
    try {
      const payload = {
        scheduleType: slotForm.scheduleType,
        slotDate: slotForm.scheduleType === 'date' ? slotForm.slotDate : '',
        startTime: slotForm.startTime,
        endTime: slotForm.endTime,
        label: cleanLabel,
        isActive: slotForm.isActive,
        maxOrders: Math.max(0, Math.round(Number(slotForm.maxOrders) || 0)),
        cutoffMinutes: Math.max(0, Math.round(Number(slotForm.cutoffMinutes) || 0)),
        sortOrder: Math.max(0, Math.round(Number(slotForm.sortOrder) || 0)),
        notes: slotForm.notes.trim()
      };

      if (editingSlot) {
        await updateDeliverySlot(editingSlot.id, payload);
        showToast(`Updated delivery slot "${cleanLabel}"`, 'success');
      } else {
        await addDeliverySlot(payload);
        showToast(
          payload.scheduleType === 'date'
            ? `Created slot "${cleanLabel}" for ${payload.slotDate}`
            : `Created daily slot "${cleanLabel}"`,
          'success'
        );
      }
      setShowSlotModal(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save delivery slot.', 'error');
    } finally {
      setSavingSlot(false);
    }
  };

  const handleSeedDefaultDailySlots = async () => {
    setSeedingDefaults(true);
    try {
      await bulkCreateDeliverySlots(DEFAULT_DAILY_SLOT_TEMPLATES);
      showToast(
        `Added ${DEFAULT_DAILY_SLOT_TEMPLATES.length} standard daily delivery slots! Customers now use your admin schedule.`,
        'success'
      );
    } catch {
      showToast('Failed to seed default daily delivery slots.', 'error');
    } finally {
      setSeedingDefaults(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkSaving(true);
    try {
      if (bulkMode === 'range') {
        if (!bulkStartDate || !bulkEndDate || bulkEndDate < bulkStartDate) {
          showToast('End Date must be on or after Start Date.', 'error');
          setBulkSaving(false);
          return;
        }
        const startMs = Date.parse(`${bulkStartDate}T00:00:00Z`);
        const endMs = Date.parse(`${bulkEndDate}T00:00:00Z`);
        const dayDiff = Math.round((endMs - startMs) / 86_400_000) + 1;
        if (dayDiff > 31) {
          showToast('Bulk generate supports up to 31 days at once.', 'error');
          setBulkSaving(false);
          return;
        }
        const pickedTemplates = templatePool.filter((_, idx) =>
          selectedTemplateIndices.includes(idx)
        );
        if (pickedTemplates.length === 0) {
          showToast('Select at least one time window to generate.', 'error');
          setBulkSaving(false);
          return;
        }

        const toCreate: Array<Omit<DeliverySlot, 'id'>> = [];
        for (let d = 0; d < dayDiff; d++) {
          const iso = new Date(startMs + d * 86_400_000).toISOString().split('T')[0];
          pickedTemplates.forEach((tpl, idx) => {
            toCreate.push({
              scheduleType: 'date',
              slotDate: iso,
              startTime: tpl.startTime,
              endTime: tpl.endTime,
              label: tpl.label,
              isActive: true,
              maxOrders: Math.max(0, Math.round(Number(bulkMaxOrders) || 0)),
              cutoffMinutes: Math.max(0, Math.round(Number(bulkCutoff) || 0)),
              sortOrder: tpl.sortOrder || idx + 1,
              notes: tpl.notes
            });
          });
        }
        await bulkCreateDeliverySlots(toCreate);
        showToast(
          `Generated ${toCreate.length} delivery slots across ${dayDiff} day(s)!`,
          'success'
        );
        setShowBulkModal(false);
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(copyTargetDate)) {
          showToast('Select a valid target date to copy slots into.', 'error');
          setBulkSaving(false);
          return;
        }
        const sourceSlots =
          copySourceKey === 'daily'
            ? deliverySlots.filter((s) => s.scheduleType === 'daily')
            : deliverySlots.filter((s) => s.scheduleType === 'date' && s.slotDate === copySourceKey);

        if (sourceSlots.length === 0) {
          showToast('Selected source schedule has no slots to copy.', 'error');
          setBulkSaving(false);
          return;
        }

        const cloned: Array<Omit<DeliverySlot, 'id'>> = sourceSlots.map((s) => ({
          scheduleType: 'date',
          slotDate: copyTargetDate,
          startTime: s.startTime,
          endTime: s.endTime,
          label: s.label,
          isActive: s.isActive,
          maxOrders: s.maxOrders,
          cutoffMinutes: s.cutoffMinutes,
          sortOrder: s.sortOrder,
          notes: s.notes || ''
        }));

        await bulkCreateDeliverySlots(cloned);
        showToast(`Copied ${cloned.length} slots to ${copyTargetDate}!`, 'success');
        setShowBulkModal(false);
      }
    } catch {
      showToast('Unable to bulk generate delivery slots.', 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  // Live 7-day Checkout Schedule Preview
  const sevenDayPreview = useMemo(() => {
    const customConfigured = deliverySlots.length > 0;
    const dailyActive = deliverySlots
      .filter((s) => s.scheduleType === 'daily' && s.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime));

    return Array.from({ length: 7 }, (_, offset) => {
      const dateObj = addDays(new Date(), offset);
      const iso = format(dateObj, 'yyyy-MM-dd');
      const dayLabel = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : format(dateObj, 'EEE');
      const shortDate = format(dateObj, 'd MMM');

      if (!customConfigured) {
        const defaults = offset <= 2 ? DEFAULT_DAILY_SLOT_TEMPLATES : [];
        return {
          iso,
          dayLabel,
          shortDate,
          mode: offset <= 2 ? ('default' as const) : ('none' as const),
          slots: defaults.map((d) => d.label)
        };
      }

      const dateEntries = deliverySlots.filter((s) => s.scheduleType === 'date' && s.slotDate === iso);
      if (dateEntries.length > 0) {
        const activeDateSlots = dateEntries
          .filter((s) => s.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime));
        return {
          iso,
          dayLabel,
          shortDate,
          mode: activeDateSlots.length > 0 ? ('override' as const) : ('closed' as const),
          slots: activeDateSlots.map((s) => s.label)
        };
      }

      return {
        iso,
        dayLabel,
        shortDate,
        mode: dailyActive.length > 0 ? ('daily' as const) : ('none' as const),
        slots: dailyActive.map((s) => s.label)
      };
    });
  }, [deliverySlots]);

  const handleConfirmDeleteSlot = async () => {
    if (!slotPendingDelete) return;
    setDeletingBusy(true);
    try {
      await deleteDeliverySlot(slotPendingDelete.id);
      showToast(`Removed slot "${slotPendingDelete.label}"`, 'info');
      setSlotPendingDelete(null);
    } catch {
      showToast('Failed to remove delivery slot.', 'error');
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleConfirmClearDate = async () => {
    if (!datePendingClear) return;
    setDeletingBusy(true);
    try {
      const removed = await deleteDeliverySlotsByDate(datePendingClear);
      showToast(`Removed ${removed} slot(s) on ${datePendingClear}`, 'info');
      setDatePendingClear(null);
      if (dateFilter === datePendingClear) {
        setDateFilter('');
      }
    } catch {
      showToast('Failed to delete slots for that date.', 'error');
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Delivery Slot Schedule Control</h2>
          <p className="text-sm text-gray-500">
            Create, edit, pause, duplicate, or remove slot dates &amp; time windows. Specific date schedules automatically override daily templates in Checkout.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              onExportCsv(
                `delivery_slots_${todayIso}.csv`,
                ['Slot ID', 'Schedule Type', 'Slot Date', 'Start Time', 'End Time', 'Label', 'Status', 'Cutoff (Min)', 'Max Orders', 'Notes'],
                deliverySlots.map((s) => [
                  s.id,
                  s.scheduleType,
                  s.slotDate || 'DAILY',
                  s.startTime,
                  s.endTime,
                  s.label,
                  s.isActive ? 'Active' : 'Paused',
                  s.cutoffMinutes,
                  s.maxOrders,
                  s.notes || ''
                ])
              );
              showToast('Exported delivery slot schedules CSV', 'success');
            }}
            className="px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            <Download size={14} /> Export CSV
          </button>

          {dailyTemplateCount === 0 && (
            <button
              type="button"
              disabled={seedingDefaults}
              onClick={handleSeedDefaultDailySlots}
              className="px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold inline-flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <Sparkles size={14} /> {seedingDefaults ? 'Importing...' : 'Import 8 Default Daily Windows'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowBulkModal(true)}
            className="px-3.5 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            <Layers size={14} /> Bulk Generate / Copy Date
          </button>

          <button
            type="button"
            onClick={() => openCreateModal()}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition"
          >
            <Plus size={15} /> Create Delivery Slot
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase text-gray-400">Total Slots Configured</p>
          <p className="text-2xl font-extrabold text-gray-900 mt-1">{deliverySlots.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {deliverySlots.length === 0 ? 'Using built-in 8 system windows' : `${activeCount} active across store`}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase text-gray-400">Specific Date Slots</p>
          <p className="text-2xl font-extrabold text-blue-600 mt-1">{dateOverrideCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Across {distinctDates.length} scheduled date(s)</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase text-gray-400">Daily Recurring Slots</p>
          <p className="text-2xl font-extrabold text-emerald-600 mt-1">{dailyTemplateCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Applied when date has no override</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase text-gray-400">Paused / Disabled</p>
          <p className="text-2xl font-extrabold text-amber-600 mt-1">
            {deliverySlots.length - activeCount}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Hidden from customer checkout</p>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search slot time, date, or note..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-0.5 text-xs font-bold">
            {(['all', 'date', 'daily'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg capitalize transition ${
                  typeFilter === t ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {t === 'all' ? 'All Types' : t === 'date' ? 'Date Specific' : 'Daily Templates'}
              </button>
            ))}
          </div>

          <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-0.5 text-xs font-bold">
            {(['all', 'active', 'paused'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg capitalize transition ${
                  statusFilter === st ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5">
            <Calendar size={14} className="text-blue-600" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent text-xs font-semibold text-gray-700 outline-none"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="text-gray-400 hover:text-gray-700"
                title="Clear date filter"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {dateFilter && (
            <>
              <button
                type="button"
                onClick={() => openCreateModal(dateFilter)}
                className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs font-bold transition"
              >
                + Add Slot for {dateFilter}
              </button>
              {deliverySlots.some((s) => s.scheduleType === 'date' && s.slotDate === dateFilter) && (
                <button
                  type="button"
                  onClick={() => setDatePendingClear(dateFilter)}
                  className="px-3 py-1.5 rounded-xl bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-xs font-bold inline-flex items-center gap-1 transition"
                >
                  <Trash2 size={13} /> Delete Date Slots
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Slot Schedules Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
        {filteredSlots.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <Clock size={36} className="mx-auto text-gray-300" />
            <h3 className="font-bold text-gray-800">
              {deliverySlots.length === 0
                ? 'No Custom Delivery Slots Created Yet'
                : 'No Delivery Slots Match Your Current Filters'}
            </h3>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              {deliverySlots.length === 0
                ? 'Checkout is currently serving the 8 built-in system windows. Create a date-specific or daily slot, or import the default daily windows to customize timings.'
                : 'Try clearing search filters or add a new delivery slot for this date.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {deliverySlots.length === 0 && (
                <button
                  type="button"
                  disabled={seedingDefaults}
                  onClick={handleSeedDefaultDailySlots}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
                >
                  <Sparkles size={14} /> Import Default Daily Slots
                </button>
              )}
              <button
                type="button"
                onClick={() => openCreateModal(dateFilter || undefined)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
              >
                <Plus size={14} /> Add Custom Slot
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs uppercase text-gray-400 font-bold border-b border-gray-100">
                <tr>
                  <th className="p-4">Schedule Date</th>
                  <th className="p-4">Time Window &amp; Label</th>
                  <th className="p-4">Booking Rules</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSlots.map((slot) => (
                  <tr key={slot.id} className="hover:bg-gray-50/70 transition">
                    <td className="p-4">
                      {slot.scheduleType === 'date' ? (
                        <div>
                          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                            <Calendar size={12} /> {slot.slotDate}
                          </span>
                          <p className="text-[11px] text-gray-400 mt-1">
                            {(() => {
                              const parsed = new Date(`${slot.slotDate}T12:00:00`);
                              return Number.isNaN(parsed.getTime())
                                ? ''
                                : format(parsed, 'EEEE, MMM d, yyyy');
                            })()}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Clock size={12} /> Daily Recurring
                          </span>
                          <p className="text-[11px] text-gray-400 mt-1">Used on dates without overrides</p>
                        </div>
                      )}
                    </td>

                    <td className="p-4">
                      <p className="font-bold text-gray-900">{slot.label}</p>
                      <p className="text-xs font-mono text-gray-500">
                        {slot.startTime} – {slot.endTime} • Order #{slot.sortOrder}
                      </p>
                      {slot.notes && (
                        <p className="text-[11px] text-gray-500 mt-0.5">{slot.notes}</p>
                      )}
                    </td>

                    <td className="p-4 text-xs">
                      <p className="font-semibold text-gray-700">
                        Cutoff: {slot.cutoffMinutes > 0 ? `${slot.cutoffMinutes} min before start` : 'At slot start time'}
                      </p>
                      <p className="text-gray-500 mt-0.5">
                        Capacity: {slot.maxOrders > 0 ? `${slot.maxOrders} orders/slot` : 'Unlimited'}
                      </p>
                    </td>

                    <td className="p-4">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await toggleDeliverySlot(slot.id);
                            showToast(
                              `${slot.label} ${slot.isActive ? 'paused' : 'activated'}`,
                              'info'
                            );
                          } catch {
                            showToast('Could not update slot status.', 'error');
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition ${
                          slot.isActive
                            ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                            : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        {slot.isActive ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                        {slot.isActive ? 'Active' : 'Paused'}
                      </button>
                    </td>

                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(slot)}
                          className="p-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition"
                          title="Edit slot date or time"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openDuplicateModal(slot)}
                          className="p-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition"
                          title="Duplicate slot"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSlotPendingDelete(slot)}
                          className="p-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition"
                          title="Remove slot"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Live 7-Day Customer Checkout Schedule Preview */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-gray-800 text-base">Live 7-Day Customer Checkout Preview</h3>
            <p className="text-xs text-gray-500">
              Shows active delivery windows per day based on Date Overrides (priority) and Daily Templates.
            </p>
          </div>
          <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg">
            Syncs to /api/slots &amp; Checkout
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
          {sevenDayPreview.map((day) => (
            <div
              key={day.iso}
              className={`rounded-xl border p-3 flex flex-col justify-between ${
                day.mode === 'override'
                  ? 'border-blue-200 bg-blue-50/40'
                  : day.mode === 'closed'
                  ? 'border-red-200 bg-red-50/40'
                  : 'border-gray-200 bg-gray-50/50'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-extrabold text-gray-800">{day.dayLabel}</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                    {day.mode === 'override'
                      ? 'Override'
                      : day.mode === 'closed'
                      ? 'Paused'
                      : day.mode === 'daily'
                      ? 'Daily'
                      : day.mode === 'default'
                      ? 'Default'
                      : 'Empty'}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 font-medium mb-2">{day.shortDate} ({day.iso})</p>

                {day.slots.length === 0 ? (
                  <p className="text-[11px] text-red-600 font-semibold">
                    {day.mode === 'closed' ? 'All date slots paused' : 'No active slots'}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {day.slots.map((lbl, i) => (
                      <li
                        key={`${day.iso}_${i}`}
                        className="text-[11px] font-semibold text-gray-700 bg-white border border-gray-100 rounded px-1.5 py-0.5 truncate"
                      >
                        {lbl}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                onClick={() => openCreateModal(day.iso)}
                className="mt-2.5 text-[11px] font-bold text-blue-600 hover:underline text-left"
              >
                + Add for {day.shortDate}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Add / Edit Single Slot Modal */}
      {showSlotModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-gray-800">
                  {editingSlot ? 'Edit Delivery Slot' : 'Create Delivery Slot'}
                </h3>
                <p className="text-xs text-gray-500">
                  Configure schedule date, slot time window, cutoff time, and order capacity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSlotModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveSlot} className="space-y-4">
              {/* Schedule Type Toggle */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">Schedule Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSlotForm((prev) => ({
                        ...prev,
                        scheduleType: 'date',
                        slotDate: prev.slotDate || todayIso
                      }))
                    }
                    className={`p-2.5 rounded-xl border text-xs font-bold text-left transition ${
                      slotForm.scheduleType === 'date'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Specific Date Override
                    <span className="block font-normal text-[11px] mt-0.5 opacity-80">
                      Applies only to the selected calendar date
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlotForm((prev) => ({ ...prev, scheduleType: 'daily', slotDate: '' }))}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-left transition ${
                      slotForm.scheduleType === 'daily'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Daily Recurring Template
                    <span className="block font-normal text-[11px] mt-0.5 opacity-80">
                      Applies every day unless overridden
                    </span>
                  </button>
                </div>
              </div>

              {slotForm.scheduleType === 'date' && (
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Slot Date *</label>
                  <input
                    type="date"
                    required
                    value={slotForm.slotDate}
                    onChange={(e) => setSlotForm((prev) => ({ ...prev, slotDate: e.target.value }))}
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* Start / End Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Start Time (24h) *</label>
                  <input
                    type="time"
                    required
                    value={slotForm.startTime}
                    onChange={(e) => handleTimeChange('startTime', e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">End Time (24h) *</label>
                  <input
                    type="time"
                    required
                    value={slotForm.endTime}
                    onChange={(e) => handleTimeChange('endTime', e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Display Label */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-600">Customer Display Label *</label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextAuto = buildSlotLabel(slotForm.startTime, slotForm.endTime);
                      setAutoLabel(true);
                      setSlotForm((prev) => ({ ...prev, label: nextAuto }));
                    }}
                    className="text-[11px] font-bold text-blue-600 hover:underline"
                  >
                    Auto-format from times
                  </button>
                </div>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={slotForm.label}
                  onChange={(e) => {
                    setAutoLabel(false);
                    setSlotForm((prev) => ({ ...prev, label: e.target.value }));
                  }}
                  placeholder="e.g. 8:00 AM - 10:00 AM (Morning Express)"
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Cutoff (min)</label>
                  <input
                    type="number"
                    min={0}
                    max={720}
                    value={slotForm.cutoffMinutes}
                    onChange={(e) =>
                      setSlotForm((prev) => ({ ...prev, cutoffMinutes: Number(e.target.value) || 0 }))
                    }
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Max Orders (0=∞)</label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={slotForm.maxOrders}
                    onChange={(e) =>
                      setSlotForm((prev) => ({ ...prev, maxOrders: Number(e.target.value) || 0 }))
                    }
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Sort Order</label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={slotForm.sortOrder}
                    onChange={(e) =>
                      setSlotForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) || 0 }))
                    }
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Optional Note (shown in slot pill)</label>
                <input
                  type="text"
                  maxLength={160}
                  value={slotForm.notes}
                  onChange={(e) => setSlotForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="e.g. Fresh morning harvest, Express dispatch"
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <label className="flex items-center gap-2.5 text-sm font-semibold text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={slotForm.isActive}
                  onChange={(e) => setSlotForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Slot Enabled &amp; Visible to Customers
              </label>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  disabled={savingSlot}
                  onClick={() => setShowSlotModal(false)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSlot}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold"
                >
                  {savingSlot ? 'Saving...' : editingSlot ? 'Save Changes' : 'Create Slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Generate / Copy Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-gray-800">Bulk Generate or Copy Delivery Schedule</h3>
                <p className="text-xs text-gray-500">
                  Quickly populate multiple calendar dates or clone an existing day schedule.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setBulkMode('range')}
                className={`py-2 rounded-lg text-xs font-bold transition ${
                  bulkMode === 'range' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500'
                }`}
              >
                Generate Date Range
              </button>
              <button
                type="button"
                onClick={() => setBulkMode('copy')}
                className={`py-2 rounded-lg text-xs font-bold transition ${
                  bulkMode === 'copy' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500'
                }`}
              >
                Copy Date Schedule
              </button>
            </div>

            <form onSubmit={handleBulkSubmit} className="space-y-4">
              {bulkMode === 'range' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">From Date *</label>
                      <input
                        type="date"
                        required
                        value={bulkStartDate}
                        onChange={(e) => setBulkStartDate(e.target.value)}
                        className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">To Date *</label>
                      <input
                        type="date"
                        required
                        value={bulkEndDate}
                        onChange={(e) => setBulkEndDate(e.target.value)}
                        className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Cutoff Minutes</label>
                      <input
                        type="number"
                        min={0}
                        max={720}
                        value={bulkCutoff}
                        onChange={(e) => setBulkCutoff(Number(e.target.value) || 0)}
                        className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1">Max Orders (0=∞)</label>
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        value={bulkMaxOrders}
                        onChange={(e) => setBulkMaxOrders(Number(e.target.value) || 0)}
                        className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-gray-600">Select Time Windows to Apply</label>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTemplateIndices(
                            selectedTemplateIndices.length === templatePool.length
                              ? []
                              : templatePool.map((_, i) => i)
                          )
                        }
                        className="text-[11px] font-bold text-blue-600 hover:underline"
                      >
                        {selectedTemplateIndices.length === templatePool.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-xl p-2.5 bg-gray-50">
                      {templatePool.map((tpl, idx) => (
                        <label
                          key={`${tpl.startTime}_${idx}`}
                          className="flex items-center gap-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg px-2.5 py-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTemplateIndices.includes(idx)}
                            onChange={(e) =>
                              setSelectedTemplateIndices((prev) =>
                                e.target.checked ? [...prev, idx] : prev.filter((i) => i !== idx)
                              )
                            }
                            className="rounded border-gray-300 text-blue-600"
                          />
                          <span className="truncate">{tpl.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Copy From Schedule</label>
                    <select
                      value={copySourceKey}
                      onChange={(e) => setCopySourceKey(e.target.value)}
                      className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="daily">Daily Recurring Templates ({dailyTemplateCount} slots)</option>
                      {distinctDates.map((d) => (
                        <option key={d} value={d}>
                          Date: {d} ({deliverySlots.filter((s) => s.slotDate === d).length} slots)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Copy Into Target Date *</label>
                    <input
                      type="date"
                      required
                      value={copyTargetDate}
                      onChange={(e) => setCopyTargetDate(e.target.value)}
                      className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => setShowBulkModal(false)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkSaving}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold"
                >
                  {bulkSaving
                    ? 'Applying...'
                    : bulkMode === 'range'
                    ? 'Generate Schedule'
                    : 'Copy Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Single Slot Remove Confirmation Modal */}
      {slotPendingDelete && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h3 className="font-bold text-lg text-gray-900">Remove Delivery Slot?</h3>
            <p className="text-sm text-gray-600">
              Permanently remove <strong>{slotPendingDelete.label}</strong> (
              {slotPendingDelete.scheduleType === 'date'
                ? `Date: ${slotPendingDelete.slotDate}`
                : 'Daily Recurring Template'}
              )? Customers will immediately stop seeing this window in Checkout.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={deletingBusy}
                onClick={() => setSlotPendingDelete(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingBusy}
                onClick={handleConfirmDeleteSlot}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold"
              >
                {deletingBusy ? 'Removing...' : 'Remove Slot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Slots on Date Confirmation Modal */}
      {datePendingClear && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h3 className="font-bold text-lg text-gray-900">Delete All Slots on {datePendingClear}?</h3>
            <p className="text-sm text-gray-600">
              This will remove all date-specific delivery slots scheduled for{' '}
              <strong>{datePendingClear}</strong>. After removal, that date will fall back to your Daily Recurring Templates (if any).
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={deletingBusy}
                onClick={() => setDatePendingClear(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingBusy}
                onClick={handleConfirmClearDate}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold"
              >
                {deletingBusy ? 'Deleting...' : 'Delete Date Slots'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
