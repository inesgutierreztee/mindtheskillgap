import React, { useState } from 'react';
import { useDominantHand } from '../context/DominantHandContext';
import {
  X,
  Bus,
  Train,
  Clock,
  Search,
  ArrowLeft,
  Check,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { CommuteRoutine } from '../types';

interface EditRoutineModalProps {
  routine: CommuteRoutine;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: CommuteRoutine) => void;
}

const SAMPLE_LOCATIONS = [
  {
    name: 'Clementi Bus Interchange',
    desc: 'Stop 17009 · Commonwealth Ave West',
    type: 'bus' as const,
    distance: '120m',
  },
  {
    name: 'Kent Ridge MRT (CC24)',
    desc: 'Circle Line · Lower Kent Ridge Rd',
    type: 'train' as const,
    distance: '450m',
  },
  {
    name: 'Buona Vista Interchange',
    desc: 'Stop 11369 · North Buona Vista Rd',
    type: 'bus' as const,
    distance: '1.2km',
  },
  {
    name: 'Jurong East Interchange',
    desc: 'Stop 28009 · Jurong Gateway Rd',
    type: 'bus' as const,
    distance: '3.4km',
  },
  {
    name: 'Botanic Gardens MRT (CC19/DT9)',
    desc: 'Circle & Downtown Line · Bukit Timah Rd',
    type: 'train' as const,
    distance: '4.8km',
  },
];

const SAMPLE_SERVICES = [
  { service: 'Bus 96', route: 'Kent Ridge ↺ Clementi Int', num: '96' },
  { service: 'Bus 151', route: 'Kent Ridge ↔ Hougang Central', num: '151' },
  { service: 'Bus 147', route: 'Hougang Ctrl ↔ Jurong East', num: '147' },
  { service: 'Bus 166', route: 'Clementi ↔ Ang Mo Kio', num: '166' },
  { service: 'Bus 196', route: 'Clementi ↔ Bedok Int', num: '196' },
  { service: 'Bus 282', route: 'Clementi ↺ West Coast Link', num: '282' },
  { service: 'Circle Line', route: 'CC24 Kent Ridge ↔ HarbourFront', num: 'CCL' },
];

export const EditRoutineModal: React.FC<EditRoutineModalProps> = ({
  routine,
  isOpen,
  onClose,
  onSave,
}) => {
  // Working state for edits
  const [boardingName, setBoardingName] = useState(routine.boardingName);
  const [boardingDesc, setBoardingDesc] = useState(routine.boardingDesc);
  const [serviceName, setServiceName] = useState(routine.serviceName);
  const [serviceRoute, setServiceRoute] = useState(routine.serviceRoute);
  const [days, setDays] = useState<string[]>(routine.days);
  const [fromTime, setFromTime] = useState(routine.fromTime);
  const [toTime, setToTime] = useState(routine.toTime);

  // Sub-overlays
  const [showLocationSearch, setShowLocationSearch] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [showServicePicker, setShowServicePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState<'from' | 'to' | null>(null);

  // Time picker internal state
  const [pickerHour, setPickerHour] = useState(8);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [pickerPeriod, setPickerPeriod] = useState<'AM' | 'PM'>('AM');

  const [daysError, setDaysError] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const dominantHand = useDominantHand();

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const toggleDay = (day: string) => {
    setDays((prev) => {
      const next = prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
      if (next.length > 0) setDaysError(false);
      return next;
    });
  };

  const getDaysSummary = () => {
    if (days.length === 5 && !days.includes('Sat') && !days.includes('Sun')) return 'Weekdays';
    if (days.length === 2 && days.includes('Sat') && days.includes('Sun')) return 'Weekends';
    if (days.length === 7) return 'Every day';
    if (days.length === 0) return 'None selected';
    return `${days.length} days / week`;
  };

  const openTimeModal = (target: 'from' | 'to') => {
    const rawTime = target === 'from' ? fromTime : toTime;
    const parts = rawTime.split(' ');
    const period = (parts[1] || 'AM').toUpperCase() as 'AM' | 'PM';
    const [h, m] = (parts[0] || '8:00').split(':');
    setPickerHour(parseInt(h, 10) || 8);
    setPickerMinute(parseInt(m, 10) || 0);
    setPickerPeriod(period);
    setShowTimePicker(target);
  };

  const applyTimePicker = () => {
    const formatted = `${pickerHour}:${pickerMinute < 10 ? '0' + pickerMinute : pickerMinute} ${pickerPeriod.toLowerCase()}`;
    if (showTimePicker === 'from') {
      setFromTime(formatted);
    } else if (showTimePicker === 'to') {
      setToTime(formatted);
    }
    setShowTimePicker(null);
  };

  const handleSave = () => {
    if (days.length === 0) {
      setDaysError(true);
      return;
    }

    const updated: CommuteRoutine = {
      ...routine,
      boardingName,
      boardingDesc,
      serviceName,
      serviceRoute,
      days,
      fromTime,
      toTime,
      // Note: saving edits does not itself confirm the routine!
    };

    onSave(updated);
  };

  const filteredLocations = SAMPLE_LOCATIONS.filter(
    (loc) =>
      loc.name.toLowerCase().includes(locationQuery.toLowerCase()) ||
      loc.desc.toLowerCase().includes(locationQuery.toLowerCase())
  );

  return (
    <div
      id="edit-routine-modal-backdrop"
      className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end justify-center"
    >
      <div
        id="edit-routine-bottom-sheet"
        className="w-full max-w-[430px] bg-surface-container-lowest rounded-t-[28px] custom-sheet-shadow flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom duration-250 relative"
      >
        {/* Drag handle */}
        <div className="w-full flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-outline-variant rounded-full" />
        </div>

        {/* Header */}
        <div className={`px-5 pb-3 pt-1 border-b border-outline-variant/30 flex items-center justify-between ${dominantHand === 'left' ? 'flex-row-reverse' : ''}`}>
          <div>
            <h2 className="text-xl font-bold text-on-surface tracking-tight">Edit routine</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Adjust the details so we show the right arrivals and alerts.
            </p>
          </div>
          <button
            id="btn-close-edit-routine"
            type="button"
            onClick={onClose}
            aria-label="Close edit routine"
            className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-5 no-scrollbar flex-1">
          {toastMessage && (
            <div className="p-3 bg-tertiary-container/15 border border-tertiary/20 rounded-xl text-tertiary text-xs font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 text-tertiary shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* FIELD 1: Boarding Point */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider">
              Where do you usually board?
            </label>
            <div className="bg-surface-container-low border border-outline-variant/40 rounded-2xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed shrink-0">
                  {boardingName.includes('MRT') ? (
                    <Train className="w-5 h-5" />
                  ) : (
                    <Bus className="w-5 h-5" />
                  )}
                </div>
                <div className="truncate max-w-[200px]">
                  <div className="font-bold text-sm text-on-surface truncate">{boardingName}</div>
                  <div className="text-xs text-on-surface-variant truncate">{boardingDesc}</div>
                </div>
              </div>
              <button
                id="btn-change-boarding-location"
                type="button"
                onClick={() => setShowLocationSearch(true)}
                className="text-primary font-semibold text-xs px-2 py-1 rounded-lg hover:bg-secondary-fixed/30 active:scale-95 transition-all cursor-pointer"
              >
                Change
              </button>
            </div>
          </div>

          {/* FIELD 2: Service Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider">
              Which service do you usually take?
            </label>
            <div className="bg-surface-container-low border border-outline-variant/40 rounded-2xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="bg-on-primary-fixed text-surface-container-lowest font-bold text-xs px-3 py-1.5 rounded-full shrink-0 shadow-xs">
                  {serviceName}
                </span>
                <div className="truncate max-w-[190px]">
                  <div className="font-medium text-xs text-on-surface truncate">{serviceRoute}</div>
                  <div className="text-[11px] text-outline">Regular frequency · ~6-8 min</div>
                </div>
              </div>
              <button
                id="btn-change-routine-service"
                type="button"
                onClick={() => setShowServicePicker(true)}
                className="text-primary font-semibold text-xs px-2 py-1 rounded-lg hover:bg-secondary-fixed/30 active:scale-95 transition-all cursor-pointer"
              >
                Change
              </button>
            </div>
          </div>

          {/* FIELD 3: Days Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                Which days?
              </label>
              <span className="text-xs font-semibold text-primary">{getDaysSummary()}</span>
            </div>
            <div className="grid grid-cols-7 gap-1.5 pt-0.5">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => {
                const active = days.includes(day);
                return (
                  <button
                    key={day}
                    id={`routine-day-${day}`}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`py-2.5 rounded-xl font-bold text-xs text-center transition-all cursor-pointer ${
                      active
                        ? 'bg-primary-container text-on-primary shadow-xs'
                        : 'bg-surface-container text-on-surface-variant border border-outline-variant/40 hover:bg-surface-container-high'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            {daysError && (
              <p className="text-[11px] text-error font-semibold pt-0.5">
                Please select at least one day for your routine.
              </p>
            )}
          </div>

          {/* FIELD 4: Time Window */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider">
              When do you usually board?
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                id="btn-open-from-time"
                type="button"
                onClick={() => openTimeModal('from')}
                className="bg-surface-container-low hover:bg-secondary-fixed/20 border border-outline-variant/40 p-3 rounded-2xl flex items-center justify-between text-left transition-all active:scale-[0.98] cursor-pointer"
              >
                <div>
                  <span className="block text-[11px] font-semibold text-outline uppercase tracking-wider">
                    From
                  </span>
                  <span className="text-base font-bold text-on-surface">{fromTime}</span>
                </div>
                <div className="p-1.5 rounded-full bg-surface-container-lowest text-on-surface-variant shadow-xs">
                  <Clock className="w-4 h-4" />
                </div>
              </button>

              <button
                id="btn-open-to-time"
                type="button"
                onClick={() => openTimeModal('to')}
                className="bg-surface-container-low hover:bg-secondary-fixed/20 border border-outline-variant/40 p-3 rounded-2xl flex items-center justify-between text-left transition-all active:scale-[0.98] cursor-pointer"
              >
                <div>
                  <span className="block text-[11px] font-semibold text-outline uppercase tracking-wider">
                    To
                  </span>
                  <span className="text-base font-bold text-on-surface">{toTime}</span>
                </div>
                <div className="p-1.5 rounded-full bg-surface-container-lowest text-on-surface-variant shadow-xs">
                  <Clock className="w-4 h-4" />
                </div>
              </button>
            </div>
            <p className="text-[11px] text-on-surface-variant leading-tight mt-1">
              We'll use this window to time relevant arrivals and alerts proactively.
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <footer className="p-5 pt-3 pb-6 bg-surface-container-lowest border-t border-outline-variant/30 flex flex-col gap-2 shrink-0">
          <button
            id="btn-save-routine-changes"
            type="button"
            onClick={handleSave}
            className="w-full py-3.5 rounded-full bg-primary-container hover:bg-primary text-on-primary font-semibold text-center shadow-sm active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <span>Save changes</span>
            <Check className="w-4 h-4 stroke-[2.5]" />
          </button>
          <button
            id="btn-cancel-routine-edit"
            type="button"
            onClick={onClose}
            className="text-on-surface-variant font-semibold py-1.5 text-center w-full cursor-pointer hover:text-on-surface transition-colors text-xs"
          >
            Cancel
          </button>
        </footer>

        {/* SUB-MODAL 1: LOCATION SEARCH OVERLAY */}
        {showLocationSearch && (
          <div className="absolute inset-0 bg-surface-container-lowest z-30 flex flex-col animate-in slide-in-from-bottom duration-200">
            <div className="p-4 border-b border-outline-variant/30 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowLocationSearch(false)}
                className="p-2 -ml-1 text-on-surface-variant hover:bg-surface-container rounded-full cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 relative">
                <Search className="w-4 h-4 text-outline absolute left-3 top-3" />
                <input
                  type="text"
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  placeholder="Search bus stop or MRT..."
                  className="w-full bg-surface-container border-none rounded-xl pl-9 pr-4 py-2 text-xs font-medium text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
              <div className="text-[11px] font-bold text-outline uppercase tracking-wider px-1">
                Nearby & Suggested
              </div>
              {filteredLocations.map((loc) => (
                <button
                  key={loc.name}
                  type="button"
                  onClick={() => {
                    setBoardingName(loc.name);
                    setBoardingDesc(loc.desc);
                    setShowLocationSearch(false);
                    showToast(`Selected boarding: ${loc.name}`);
                  }}
                  className="w-full p-3 rounded-2xl flex items-center justify-between hover:bg-surface-container-low border border-transparent hover:border-outline-variant/30 text-left transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                        loc.type === 'train'
                          ? 'bg-secondary-container text-on-secondary-container'
                          : 'bg-secondary-fixed text-on-secondary-fixed'
                      }`}
                    >
                      {loc.type === 'train' ? 'MRT' : 'Bus'}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-on-surface">{loc.name}</div>
                      <div className="text-[11px] text-on-surface-variant">{loc.desc}</div>
                    </div>
                  </div>
                  <span className="text-[11px] text-outline">{loc.distance}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* SUB-MODAL 2: SERVICE PICKER OVERLAY */}
        {showServicePicker && (
          <div className="absolute inset-0 bg-surface-container-lowest z-30 flex flex-col animate-in slide-in-from-bottom duration-200">
            <div className="p-4 border-b border-outline-variant/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowServicePicker(false)}
                  className="p-2 -ml-1 text-on-surface-variant hover:bg-surface-container rounded-full cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h3 className="text-sm font-bold text-on-surface">Select Service / Line</h3>
              </div>
              <span className="text-[11px] font-semibold text-outline truncate max-w-[140px]">
                {boardingName}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
              <div className="text-[11px] font-bold text-outline uppercase tracking-wider px-1">
                Services at this location
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SAMPLE_SERVICES.map((s) => (
                  <button
                    key={s.service}
                    type="button"
                    onClick={() => {
                      setServiceName(s.service);
                      setServiceRoute(s.route);
                      setShowServicePicker(false);
                      showToast(`Selected service: ${s.service}`);
                    }}
                    className="p-3 rounded-2xl border border-outline-variant/40 hover:border-primary-container hover:bg-secondary-fixed/20 text-left transition-all flex items-center gap-2.5 cursor-pointer"
                  >
                    <span className="bg-on-primary-fixed text-surface-container-lowest font-bold text-xs px-2.5 py-1 rounded-full shrink-0">
                      {s.num}
                    </span>
                    <span className="text-xs font-semibold text-on-surface truncate">
                      {s.service}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SUB-MODAL 3: TIME PICKER OVERLAY */}
        {showTimePicker && (
          <div className="absolute inset-0 bg-surface-container-lowest z-30 flex flex-col justify-between p-5 animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant/30">
              <div>
                <h3 className="text-base font-bold text-on-surface">
                  Set "{showTimePicker === 'from' ? 'From' : 'To'}" Time
                </h3>
                <p className="text-xs text-on-surface-variant">Choose typical boarding time</p>
              </div>
              <button
                type="button"
                onClick={applyTimePicker}
                className="bg-primary-container text-on-primary font-semibold text-xs px-4 py-2 rounded-full hover:bg-primary cursor-pointer"
              >
                Done
              </button>
            </div>

            {/* Presets */}
            <div className="py-2">
              <div className="text-[11px] font-bold text-outline uppercase tracking-wider mb-2">
                Quick Presets
              </div>
              <div className="grid grid-cols-4 gap-2">
                {['7:30 am', '8:00 am', '8:30 am', '9:00 am'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      const [t, p] = preset.split(' ');
                      const [h, m] = t.split(':');
                      setPickerHour(parseInt(h, 10));
                      setPickerMinute(parseInt(m, 10));
                      setPickerPeriod(p.toUpperCase() as 'AM' | 'PM');
                    }}
                    className="py-2 text-xs font-semibold rounded-xl bg-surface-container text-on-surface-variant hover:bg-secondary-fixed/40 hover:text-primary cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Wheels / Steppers */}
            <div className="bg-surface-container-low border border-outline-variant/40 rounded-2xl p-4 flex items-center justify-center gap-6 my-auto">
              {/* Hour */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setPickerHour((h) => (h >= 12 ? 1 : h + 1))}
                  className="p-1 text-on-surface-variant hover:text-on-surface cursor-pointer"
                >
                  <ChevronUp className="w-5 h-5" />
                </button>
                <span className="text-3xl font-black text-on-surface py-1">
                  {pickerHour < 10 ? '0' + pickerHour : pickerHour}
                </span>
                <button
                  type="button"
                  onClick={() => setPickerHour((h) => (h <= 1 ? 12 : h - 1))}
                  className="p-1 text-on-surface-variant hover:text-on-surface cursor-pointer"
                >
                  <ChevronDown className="w-5 h-5" />
                </button>
                <span className="text-[11px] text-outline uppercase font-bold mt-1">Hour</span>
              </div>

              <span className="text-3xl font-black text-outline -mt-4">:</span>

              {/* Minute */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setPickerMinute((m) => (m + 5) % 60)}
                  className="p-1 text-on-surface-variant hover:text-on-surface cursor-pointer"
                >
                  <ChevronUp className="w-5 h-5" />
                </button>
                <span className="text-3xl font-black text-on-surface py-1">
                  {pickerMinute < 10 ? '0' + pickerMinute : pickerMinute}
                </span>
                <button
                  type="button"
                  onClick={() => setPickerMinute((m) => (m - 5 + 60) % 60)}
                  className="p-1 text-on-surface-variant hover:text-on-surface cursor-pointer"
                >
                  <ChevronDown className="w-5 h-5" />
                </button>
                <span className="text-[11px] text-outline uppercase font-bold mt-1">Min</span>
              </div>

              {/* AM/PM */}
              <div className="flex flex-col gap-1.5 pl-2">
                <button
                  type="button"
                  onClick={() => setPickerPeriod('AM')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    pickerPeriod === 'AM'
                      ? 'bg-primary-container text-on-primary'
                      : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => setPickerPeriod('PM')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    pickerPeriod === 'PM'
                      ? 'bg-primary-container text-on-primary'
                      : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  PM
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTimePicker(null)}
              className="w-full py-2.5 text-center text-xs font-semibold text-outline hover:text-on-surface cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
