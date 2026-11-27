import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  LogOut,
  Palette,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  PROFILE_ACCENT_COLORS,
  generateSuggestedUsername,
  validateUsernameInput,
} from '../lib/api';

interface UsernameOnboardingScreenProps {
  onComplete: (params: { username: string; bio: string; color: string }) => Promise<void>;
  onSwitchAccount: () => Promise<void>;
}

const USERNAME_CHAR_REGEX = /^[A-Za-z0-9_]*$/;

export const UsernameOnboardingScreen: React.FC<UsernameOnboardingScreenProps> = ({
  onComplete,
  onSwitchAccount,
}) => {
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(PROFILE_ACCENT_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedUsername = username.trim();

  const formatHint = useMemo(() => {
    if (!trimmedUsername) return null;
    if (!USERNAME_CHAR_REGEX.test(trimmedUsername)) {
      return 'Only letters, numbers, and underscores (_) are allowed.';
    }
    if (trimmedUsername.length < 3) {
      return 'Enter at least 3 characters.';
    }
    if (trimmedUsername.length > 32) {
      return 'Username cannot exceed 32 characters.';
    }
    return null;
  }, [trimmedUsername]);

  const handleSuggestRandom = () => {
    setError(null);
    setUsername(generateSuggestedUsername());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let cleanUsername: string;
    try {
      cleanUsername = validateUsernameInput(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please enter a valid username.');
      return;
    }

    setSubmitting(true);
    try {
      await onComplete({
        username: cleanUsername,
        bio: bio.trim().slice(0, 240),
        color: selectedColor,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);
    try {
      await onSwitchAccount();
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-neutral-100 flex flex-col">
      <header className="w-full max-w-4xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
        <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
          Buddy Chat
        </span>
        <button
          type="button"
          onClick={handleSwitchAccount}
          disabled={submitting || switchingAccount}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-100 transition-colors min-h-[44px] px-3 rounded-lg disabled:opacity-50"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>{switchingAccount ? 'Signing out...' : 'Use different account'}</span>
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-6">
        <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-4">
            <Avatar
              username={trimmedUsername || 'Buddy'}
              color={selectedColor}
              size="lg"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#2B84F6] tracking-wide">
                Step 1 of 1 · Account setup
              </p>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Choose your username
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-neutral-400 mt-0.5">
                Pick the anonymous handle people will see in chats and groups.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="onboarding-username"
                  className="text-sm font-semibold text-slate-800 dark:text-neutral-200"
                >
                  Username
                </label>
                <span className="text-xs tabular-nums text-slate-500 dark:text-neutral-400">
                  {trimmedUsername.length}/32
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span
                    aria-hidden="true"
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-neutral-500 text-sm font-medium select-none"
                  >
                    @
                  </span>
                  <input
                    id="onboarding-username"
                    type="text"
                    autoFocus
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. VelvetFox42"
                    className="w-full min-h-[46px] pl-8 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.12] text-sm text-slate-900 dark:text-neutral-100 placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSuggestRandom}
                  disabled={submitting}
                  className="min-h-[46px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#242426] hover:bg-slate-200 dark:hover:bg-[#2E2E32] border border-slate-200 dark:border-white/[0.1] text-xs sm:text-sm font-medium text-slate-700 dark:text-neutral-200 transition-colors inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <span>Randomize</span>
                </button>
              </div>

              <p
                className={`text-xs ${
                  formatHint
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-500 dark:text-neutral-400'
                }`}
              >
                {formatHint ?? '3–32 characters. Letters, numbers, and underscores (_) only.'}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-neutral-200">
                <Palette className="w-4 h-4 text-slate-500 dark:text-neutral-400" />
                <span>Badge color</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {PROFILE_ACCENT_COLORS.map((hex) => {
                  const active = selectedColor === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setSelectedColor(hex)}
                      aria-label={`Select badge color ${hex}`}
                      aria-pressed={active}
                      className={`h-8 w-8 rounded-full flex items-center justify-center transition-transform ${
                        active
                          ? 'ring-2 ring-offset-2 ring-[#2B84F6] ring-offset-white dark:ring-offset-[#141414] scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: hex }}
                    >
                      {active && <Check className="w-4 h-4 text-white" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="onboarding-bio"
                  className="text-sm font-semibold text-slate-800 dark:text-neutral-200"
                >
                  Bio <span className="font-normal text-slate-400 dark:text-neutral-500">(optional)</span>
                </label>
                <span className="text-xs tabular-nums text-slate-500 dark:text-neutral-400">
                  {bio.trim().length}/240
                </span>
              </div>
              <textarea
                id="onboarding-bio"
                rows={2}
                maxLength={240}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Say a little about yourself..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.12] text-sm text-slate-900 dark:text-neutral-100 placeholder:text-slate-400 dark:placeholder:text-neutral-500 resize-none focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || Boolean(formatHint) || trimmedUsername.length < 3}
              className="w-full min-h-[48px] px-5 py-3 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B84F6]"
            >
              <span>{submitting ? 'Creating profile...' : 'Continue to Buddy Chat'}</span>
              {!submitting && <ArrowRight className="w-4 h-4 shrink-0" />}
            </button>

            <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-neutral-400 text-center">
              <ShieldCheck className="w-3.5 h-3.5 text-[#2B84F6] shrink-0" />
              <span>Your Google name, email, and photo are never shared.</span>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
};
