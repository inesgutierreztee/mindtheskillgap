import React, { useState } from 'react';
import { X, Bus, Train, Clock, Check, Bell, Zap, Navigation, Edit3 } from 'lucide-react';
import { CommuteRoutine } from '../types';
import { EditRoutineModal } from './EditRoutineModal';

interface RoutineConfirmationModalProps {
  routine: CommuteRoutine;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (routine: CommuteRoutine) => void;
  onDismissRoutine: (routine: CommuteRoutine) => void;
  onUpdateRoutine: (routine: CommuteRoutine) => void;
}

export const RoutineConfirmationModal: React.FC<RoutineConfirmationModalProps> = ({
  routine,
  isOpen,
  onClose,
  onConfirm,
  onDismissRoutine,
  onUpdateRoutine,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localRoutine, setLocalRoutine] = useState<CommuteRoutine>(routine);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync with prop if it changes
  React.useEffect(() => {
    setLocalRoutine(routine);
  }, [routine]);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleSaveEdits = (updated: CommuteRoutine) => {
    setLocalRoutine(updated);
    onUpdateRoutine(updated);
    setIsEditing(false);
    showToast('Routine details updated in summary');
  };

  const handleConfirm = () => {
    onConfirm(localRoutine);
  };

  const handleDismiss = () => {
    onDismissRoutine(localRoutine);
  };

  const getDaysSummary = (days: string[]) => {
    if (days.length === 5 && !days.includes('Sat') && !days.includes('Sun')) return 'Mon–Fri';
    if (days.length === 2 && days.includes('Sat') && days.includes('Sun')) return 'Sat–Sun';
    if (days.length === 7) return 'Every day';
    return days.join(', ');
  };

  return (
    <>
      <div
        id="routine-confirmation-modal-backdrop"
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end justify-center"
      >
        <div
          id="routine-confirmation-sheet"
          className="w-full max-w-[430px] bg-surface-container-lowest rounded-t-[28px] custom-sheet-shadow flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom duration-250 relative"
        >
          {/* Drag handle */}
          <div className="w-full flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-outline-variant rounded-full" />
          </div>

          {/* Header */}
          <div className="px-5 pb-2 pt-1 border-b border-outline-variant/30 flex items-start justify-between">
            <div className="pr-4">
              <span className="inline-block text-[11px] font-bold text-primary uppercase tracking-wider mb-0.5">
                COMMUTE DETECTION
              </span>
              <h2 className="text-xl font-bold text-on-surface tracking-tight">Is this your routine?</h2>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                We noticed you often check {localRoutine.serviceName} from {localRoutine.boardingName}{' '}
                around {localRoutine.fromTime} on {getDaysSummary(localRoutine.days)}.
              </p>
            </div>
            <button
              id="btn-close-routine-confirmation"
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors cursor-pointer shrink-0 mt-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 overflow-y-auto space-y-4 no-scrollbar flex-1">
            {toastMessage && (
              <div className="p-3 bg-tertiary-container/15 border border-tertiary/20 rounded-xl text-tertiary text-xs font-semibold flex items-center gap-2">
                <Check className="w-4 h-4 text-tertiary shrink-0" />
                <span>{toastMessage}</span>
              </div>
            )}

            {/* Summary Card */}
            <div className="bg-surface-container-low border border-outline-variant/40 rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center shrink-0">
                    {localRoutine.serviceName.includes('MRT') ? (
                      <Train className="w-4 h-4" />
                    ) : (
                      <Bus className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">{localRoutine.boardingName}</h3>
                    <p className="text-xs text-on-surface-variant">{localRoutine.boardingDesc}</p>
                  </div>
                </div>

                <button
                  id="btn-edit-routine-from-confirmation"
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1 text-xs font-semibold text-primary hover:bg-secondary-fixed/40 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit details</span>
                </button>
              </div>

              <div className="border-t border-outline-variant/30 pt-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="bg-on-primary-fixed text-surface-container-lowest font-bold text-xs px-2.5 py-0.5 rounded-full">
                    {localRoutine.serviceName}
                  </span>
                  <span className="text-on-surface-variant truncate max-w-[150px]">
                    {localRoutine.serviceRoute}
                  </span>
                </div>

                <div className="flex items-center gap-1 text-on-surface font-semibold text-xs">
                  <Clock className="w-3.5 h-3.5 text-outline" />
                  <span>
                    {getDaysSummary(localRoutine.days)}, {localRoutine.fromTime} – {localRoutine.toTime}
                  </span>
                </div>
              </div>
            </div>

            {/* Why save this routine? */}
            <div className="space-y-2 pt-1">
              <h4 className="text-xs font-bold text-outline uppercase tracking-wider">
                Why save this routine?
              </h4>

              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-container-lowest border border-outline-variant/30">
                  <div className="w-7 h-7 rounded-xl bg-secondary-fixed flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-on-surface">Faster access</h5>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      Arrival times right on your home screen around {localRoutine.fromTime}.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-container-lowest border border-outline-variant/30">
                  <div className="w-7 h-7 rounded-xl bg-secondary-fixed flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-on-surface">Proactive alerts</h5>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      Get notified before you leave if there is a delay or heavy crowding.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-container-lowest border border-outline-variant/30">
                  <div className="w-7 h-7 rounded-xl bg-secondary-fixed flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <Navigation className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-on-surface">Step-by-step guidance</h5>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      One tap to start your commute with live transfer help and platform guidance.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <footer className="p-5 pt-3 pb-6 bg-surface-container-lowest border-t border-outline-variant/30 flex flex-col gap-2 shrink-0">
            <button
              id="btn-confirm-routine-yes"
              type="button"
              onClick={handleConfirm}
              className="w-full py-3.5 rounded-full bg-primary-container hover:bg-primary text-on-primary font-semibold text-center shadow-sm active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Yes, this is my routine</span>
              <Check className="w-4 h-4 stroke-[2.5]" />
            </button>
            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                id="btn-edit-routine-secondary"
                type="button"
                onClick={() => setIsEditing(true)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-primary hover:bg-surface-container text-center transition-colors cursor-pointer"
              >
                Edit details
              </button>
              <button
                id="btn-dismiss-routine-not-mine"
                type="button"
                onClick={handleDismiss}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-error hover:bg-surface-container text-center transition-colors cursor-pointer"
              >
                Not a routine
              </button>
            </div>
          </footer>
        </div>
      </div>

      {/* Edit Routine Modal */}
      {isEditing && (
        <EditRoutineModal
          routine={localRoutine}
          isOpen={isEditing}
          onClose={() => setIsEditing(false)}
          onSave={handleSaveEdits}
        />
      )}
    </>
  );
};
