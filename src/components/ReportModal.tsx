import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface ReportModalProps {
  isOpen: boolean;
  targetLabel: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}

const PRESET_REASONS = [
  'Spam or flooding',
  'Harassment or threats',
  'Hate speech',
  'Doxxing or personal info',
];

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  targetLabel,
  onClose,
  onSubmit,
}) => {
  const [selectedPreset, setSelectedPreset] = useState(PRESET_REASONS[0]);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const reason = details.trim()
      ? `${selectedPreset}: ${details.trim()}`.slice(0, 500)
      : selectedPreset;

    setSubmitting(true);
    try {
      await onSubmit(reason);
      setDetails('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 id="report-modal-title" className="text-lg font-semibold tracking-tight">
              Submit report
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400 truncate max-w-[260px]">
              Reporting {targetLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-h-[44px] min-w-[44px] -mr-2 rounded-xl flex items-center justify-center text-slate-500 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Reason</p>
            <div className="space-y-1.5">
              {PRESET_REASONS.map((preset) => (
                <label
                  key={preset}
                  className="flex items-center gap-3 min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/[0.08] cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    checked={selectedPreset === preset}
                    onChange={() => setSelectedPreset(preset)}
                    className="text-[#2B84F6] focus:ring-[#2B84F6]"
                  />
                  <span className="text-sm">{preset}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="report-details" className="block text-sm font-medium">
              Additional context (optional)
            </label>
            <textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={400}
              rows={3}
              placeholder="Briefly describe what happened..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6] resize-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-full text-sm font-medium text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {submitting ? 'Sending...' : 'Send report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
