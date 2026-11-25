import React, { useEffect, useState } from 'react';
import { Globe, Lock, X } from 'lucide-react';
import type { GroupVisibility } from '../types';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, visibility: GroupVisibility) => Promise<void>;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<GroupVisibility>('public');
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
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 60) {
      setError('Group name must be between 2 and 60 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreate(trimmed, description.trim(), visibility);
      setName('');
      setDescription('');
      setVisibility('public');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group.');
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
      aria-labelledby="create-group-title"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="create-group-title" className="text-lg font-semibold tracking-tight">
            Create group
          </h2>
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
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Privacy</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  visibility === 'public'
                    ? 'border-[#2B84F6] bg-[#2B84F6]/10 text-slate-900 dark:text-white'
                    : 'border-slate-200 dark:border-white/[0.1] hover:bg-slate-50 dark:hover:bg-white/[0.05] text-slate-600 dark:text-neutral-300'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Globe className="w-4 h-4 text-[#2B84F6] shrink-0" />
                  <span>Public</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1 leading-snug">
                  Anyone can find and join immediately.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  visibility === 'private'
                    ? 'border-[#2B84F6] bg-[#2B84F6]/10 text-slate-900 dark:text-white'
                    : 'border-slate-200 dark:border-white/[0.1] hover:bg-slate-50 dark:hover:bg-white/[0.05] text-slate-600 dark:text-neutral-300'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Lock className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Private</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1 leading-snug">
                  Requires your approval to join.
                </p>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="group-name" className="block text-sm font-medium">
              Group name
            </label>
            <input
              id="group-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Late Night Thoughts"
              autoFocus
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="group-desc" className="block text-sm font-medium">
              Topic (optional)
            </label>
            <textarea
              id="group-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="What is this room about?"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6] resize-none"
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
              disabled={submitting || name.trim().length < 2}
              className="min-h-[44px] px-5 py-2 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              {submitting ? 'Creating...' : visibility === 'private' ? 'Create private group' : 'Create public group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
