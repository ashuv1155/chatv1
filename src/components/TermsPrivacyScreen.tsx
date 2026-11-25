import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface TermsPrivacyScreenProps {
  onBack: () => void;
}

export const TermsPrivacyScreen: React.FC<TermsPrivacyScreenProps> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-20 bg-slate-50/90 dark:bg-[#0B0E14]/90 backdrop-blur-md border-b border-slate-200 dark:border-white/[0.08]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white min-h-[44px] px-2 -ml-2 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <span className="text-sm font-semibold tracking-tight">Terms & Privacy</span>
          <div className="w-14" aria-hidden="true" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        <div className="space-y-2 border-b border-slate-200 dark:border-white/[0.08] pb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Terms of Use & Privacy Policy
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Effective November 2026 · Buddy Chat Anonymous Messaging
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. Eligibility (18+ Only)</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            You must be at least 18 years old to create an account or participate in any public group or direct message on Buddy Chat. By signing in, you confirm that you meet this age requirement.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">2. Anonymity & What We Do Not Store</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            Buddy Chat uses Google Sign-In via Firebase Authentication solely to prevent automated spam and enforce bans. Our backend extracts only your opaque Firebase user ID (<code className="font-mono text-xs px-1 py-0.5 rounded bg-slate-200 dark:bg-white/[0.06]">sub</code>) to generate your random handle (such as <span className="font-medium">SilentFox4821</span>) and color.
          </p>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            We never store, log, or display your real name, email address, or Google profile photo in our database, server logs, or user interface.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">3. Message Retention (7-Day Auto-Delete)</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            Messages cannot be edited or deleted individually after sending. To keep conversations ephemeral, an automated database job deletes all messages older than 7 days every night.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">4. Acceptable Use & Safety</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            Do not post illegal content, harassment, hate speech, threats, doxxing, or spam. Messages are limited to 1,000 characters and 5 messages per 10 seconds. Members can block users or submit reports at any time; accounts that violate these rules may be banned from sending or joining rooms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">5. No Tracking Signals</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            Buddy Chat intentionally omits typing indicators, online presence status, and read receipts. Only members of a chat room can read or send messages in that room.
          </p>
        </section>
      </main>
    </div>
  );
};
