import React, { useState } from 'react';
import {
  AlertTriangle,
  Clock,
  EyeOff,
  Image,
  Lock,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { getMissingEnvVars, isFirebaseConfigured } from '../lib/env';

interface LoginScreenProps {
  onSignIn: () => Promise<void>;
  onOpenTerms: () => void;
  authError: string | null;
  isSigningIn: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSignIn,
  onOpenTerms,
  authError,
  isSigningIn,
}) => {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const missingVars = getMissingEnvVars();

  const handleContinue = async () => {
    setLocalError(null);
    if (!acceptedTerms) {
      setLocalError('Please confirm that you are 18+ and accept the Terms and Privacy Policy.');
      return;
    }
    await onSignIn();
  };

  const displayError = localError || authError;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-neutral-100 flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-8">
        <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
          Buddy Chat
        </span>
        <button
          type="button"
          onClick={onOpenTerms}
          className="text-sm font-medium text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-100 transition-colors min-h-[44px] px-2 whitespace-nowrap shrink-0"
        >
          Terms & Privacy
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <section className="lg:col-span-7 space-y-8">
            <div className="space-y-4">
              <p className="text-xs font-semibold text-[#2B84F6] tracking-wide">
                Anonymous real-time rooms & direct messaging
              </p>
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-balance leading-[1.12]">
                Chat freely with a random handle. Leave no trail after 24 hours.
              </h1>
              <p className="text-base text-slate-600 dark:text-neutral-400 leading-relaxed max-w-xl">
                Connect one-to-one or inside public and private groups without revealing your name, email, or Google photo.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 border-t border-slate-200 dark:border-white/[0.1]">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-[#2B84F6] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold">Anonymous profiles</h2>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-neutral-400 mt-0.5 leading-relaxed">
                    Custom or random handle, optional bio & avatar, friend nicknames, and username history.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-[#2B84F6] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold">24-hour auto-delete</h2>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-neutral-400 mt-0.5 leading-relaxed">
                    Every message and shared file expires automatically after 24 hours.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Image className="w-5 h-5 text-[#2B84F6] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold">Photos, view-once & files</h2>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-neutral-400 mt-0.5 leading-relaxed">
                    Share photos, single-view disappearing photos, and files up to 5 MB.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Users className="w-5 h-5 text-[#2B84F6] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold">Public & private groups</h2>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-neutral-400 mt-0.5 leading-relaxed">
                    Open public rooms or private invite-requested rooms approved by the group admin.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="lg:col-span-5">
            <div className="rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] p-6 sm:p-8 space-y-6">
              <div className="space-y-1.5">
                <h2 className="text-xl font-semibold tracking-tight">Sign in to Buddy Chat</h2>
                <p className="text-sm text-slate-600 dark:text-neutral-400">
                  Sign in once with Google to keep your anonymous session saved on this device.
                </p>
              </div>

              {!isFirebaseConfigured && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Firebase configuration required</span>
                  </div>
                  <p className="text-xs leading-relaxed opacity-90">
                    Missing Firebase keys: <span className="font-mono">{missingVars.join(', ')}</span>.
                  </p>
                </div>
              )}

              <label className="flex items-start gap-3 cursor-pointer select-none min-h-[44px] py-1">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    setAcceptedTerms(e.target.checked);
                    if (e.target.checked) setLocalError(null);
                  }}
                  className="mt-1 h-5 w-5 rounded border-slate-300 dark:border-neutral-700 bg-white dark:bg-[#1C1C1E] text-[#2B84F6] focus:ring-2 focus:ring-[#2B84F6] focus:ring-offset-0 shrink-0"
                />
                <span className="text-sm text-slate-700 dark:text-neutral-300 leading-snug">
                  I am 18+ and accept the{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenTerms();
                    }}
                    className="text-[#2B84F6] underline underline-offset-2 hover:text-[#1D74E8] font-medium"
                  >
                    terms and privacy policy
                  </button>
                  .
                </span>
              </label>

              {displayError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <button
                type="button"
                onClick={handleContinue}
                disabled={isSigningIn || !isFirebaseConfigured}
                className="w-full min-h-[48px] px-5 py-3 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B84F6] whitespace-nowrap"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                <span>{isSigningIn ? 'Signing in...' : 'Continue with Google'}</span>
              </button>

              <div className="pt-1 flex items-center justify-center gap-3 text-xs text-slate-500 dark:text-neutral-400">
                <span className="inline-flex items-center gap-1">
                  <EyeOff className="w-3.5 h-3.5" />
                  24h ephemeral
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" />
                  Zero PII stored
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
