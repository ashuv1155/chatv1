import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface TermsPrivacyScreenProps {
  onBack: () => void;
}

export const TermsPrivacyScreen: React.FC<TermsPrivacyScreenProps> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-neutral-100">
      <header className="sticky top-0 z-20 bg-slate-50/90 dark:bg-black/90 backdrop-blur-md border-b border-slate-200 dark:border-white/[0.1]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white min-h-[44px] px-2 -ml-2 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <span className="text-sm font-semibold tracking-tight">Terms & Privacy</span>
          <div className="w-14" aria-hidden="true" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        <div className="space-y-2 border-b border-slate-200 dark:border-white/[0.1] pb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Terms of Use & Privacy Policy
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Effective November 2026 · Buddy Chat Anonymous Messaging
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. Eligibility (18+ Only)</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-neutral-300 leading-relaxed">
            You must be at least 18 years old to create an account or participate in any group or direct message on Buddy Chat. By signing in, you confirm that you meet this age requirement.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">2. Anonymity & What We Do Not Store</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-neutral-300 leading-relaxed">
            Buddy Chat uses Google Sign-In via Firebase Authentication solely to prevent automated spam and enforce bans. Our system reads only your opaque user identifier to assign your handle (such as <span className="font-medium">SilentFox4821</span>) and color.
          </p>
          <p className="text-sm sm:text-base text-slate-600 dark:text-neutral-300 leading-relaxed">
            We never store, log, or display your real name, email address, or Google profile photo in our database or user interface. Any bio or custom avatar you choose to upload is completely optional. Whenever you set a new username or generate a random one, previous handles remain visible on your profile history for room transparency.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">3. Message Retention (24-Hour Auto-Delete)</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-neutral-300 leading-relaxed">
            Messages cannot be edited after sending (though senders may delete their own messages). To keep conversations ephemeral, messages and attachments automatically expire after 24 hours. View-once photos permanently lock for each recipient immediately after they open them once.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">4. Media, Files & Private Groups</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-neutral-300 leading-relaxed">
            Members may share photos, view-once photos, and files up to 5 MB per attachment and up to 5 messages per 10 seconds. Private groups require approval from the group creator before new members can enter or read messages.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">5. Acceptable Use & Friend Nicknames</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-neutral-300 leading-relaxed">
            Do not post illegal content, harassment, hate speech, threats, doxxing, or spam. Members can assign private nicknames to friends, block users, or submit reports at any time.
          </p>
        </section>
      </main>
    </div>
  );
};
