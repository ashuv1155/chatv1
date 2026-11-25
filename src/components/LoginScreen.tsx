import React, { useState } from 'react';
import { Lock, MessageSquare, ShieldCheck, AlertTriangle } from 'lucide-react';
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
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
          VeilChat
        </span>
        <button
          type="button"
          onClick={onOpenTerms}
          className="text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors min-h-[44px] px-2 whitespace-nowrap shrink-0"
        >
          Terms & Privacy
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <section className="lg:col-span-6 space-y-6">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance leading-tight">
              Speak freely with a random handle.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-md">
              Join public groups or start private one-to-one conversations without exposing your real identity.
            </p>

            <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-white/[0.08]">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold">Zero personal profile data</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Your Google name, email, and photo are never stored, logged, or shown to other members.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MessageSquare className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold">Public groups & direct messages</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Create rooms on any topic, discover existing groups, or message anyone directly.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Lock className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold">7-day message window</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Messages are immutable and scoped to the most recent 7 days of conversation.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="lg:col-span-6">
            <div className="rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] p-6 sm:p-8 space-y-6">
              <div className="space-y-1.5">
                <h2 className="text-xl font-semibold tracking-tight">Sign in to VeilChat</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Google sign-in verifies you are human and assigns a random anonymous handle.
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
                  className="mt-1 h-5 w-5 rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-[#0B0E14] text-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 shrink-0"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300 leading-snug">
                  I am 18+ and accept the{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenTerms();
                    }}
                    className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:text-indigo-500 font-medium"
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
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                <span>{isSigningIn ? 'Signing in...' : 'Continue with Google'}</span>
              </button>

              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                No typing indicators · No read receipts · No online status
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
