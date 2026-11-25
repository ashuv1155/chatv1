import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Laptop,
  LogOut,
  MessageSquareMore,
  Moon,
  RefreshCw,
  ShieldAlert,
  Sun,
  UserCircle2,
  UserX,
  Volume2,
} from 'lucide-react';
import { Avatar } from './Avatar';
import type { BrowserNotifPermission } from '../lib/notifications';
import type {
  BlockEntry,
  NotificationSettings,
  Profile,
  ThemePreference,
} from '../types';

interface SettingsScreenProps {
  profile: Profile;
  blocks: BlockEntry[];
  themePreference: ThemePreference;
  notificationSettings: NotificationSettings;
  browserNotifPermission: BrowserNotifPermission;
  onChangeTheme: (pref: ThemePreference) => void;
  onUpdateNotificationSettings: (next: NotificationSettings) => void;
  onRequestBrowserPermission: () => Promise<void>;
  onRotateUsername: () => Promise<void>;
  onUnblock: (blockedId: string) => Promise<void>;
  onOpenProfile: () => void;
  onOpenTerms: () => void;
  onSignOut: () => Promise<void>;
  onBack: () => void;
}

function getCooldownText(lastChangedAt: string | null): string | null {
  if (!lastChangedAt) return null;
  const lastMs = new Date(lastChangedAt).getTime();
  if (Number.isNaN(lastMs)) return null;
  const nextAllowedMs = lastMs + 24 * 60 * 60 * 1000;
  const diffMs = nextAllowedMs - Date.now();
  if (diffMs <= 0) return null;

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.ceil((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `Available again in ${hours}h ${minutes}m`;
  }
  return `Available again in ${minutes}m`;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  profile,
  blocks,
  themePreference,
  notificationSettings,
  browserNotifPermission,
  onChangeTheme,
  onUpdateNotificationSettings,
  onRequestBrowserPermission,
  onRotateUsername,
  onUnblock,
  onOpenProfile,
  onOpenTerms,
  onSignOut,
  onBack,
}) => {
  const [rotating, setRotating] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const cooldownText = useMemo(
    () => getCooldownText(profile.lastUsernameChangeAt),
    [profile.lastUsernameChangeAt],
  );

  const handleRotate = async () => {
    setFeedback(null);
    setRotating(true);
    try {
      await onRotateUsername();
      setFeedback({ type: 'success', text: 'Your anonymous handle has been updated.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to generate a new username right now.',
      });
    } finally {
      setRotating(false);
    }
  };

  const handleUnblock = async (blockedId: string) => {
    setUnblockingId(blockedId);
    try {
      await onUnblock(blockedId);
    } finally {
      setUnblockingId(null);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-20 bg-slate-50/90 dark:bg-[#0B0E14]/90 backdrop-blur-md border-b border-slate-200 dark:border-white/[0.08]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white min-h-[44px] px-2 -ml-2 rounded-lg transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to chats</span>
          </button>
          <span className="text-sm font-semibold tracking-tight">Settings</span>
          <div className="w-20" aria-hidden="true" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <section className="rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <Avatar
                username={profile.username}
                color={profile.color}
                avatarUrl={profile.avatarUrl}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Your anonymous handle
                </p>
                <h1 className="text-xl font-bold tracking-tight truncate">{profile.username}</h1>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenProfile}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <UserCircle2 className="w-4 h-4" />
              <span>Edit profile</span>
            </button>
          </div>

          {profile.banned && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-2.5 text-sm text-red-700 dark:text-red-300">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>This account has been restricted from sending messages or joining rooms.</span>
            </div>
          )}

          {feedback && (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-sm ${
                feedback.type === 'error'
                  ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-white/[0.08]">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Rotate identity</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {cooldownText ?? 'Allowed once every 24 hours'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRotate}
              disabled={rotating || cooldownText !== null || profile.banned}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${rotating ? 'animate-spin' : ''}`} />
              <span>{rotating ? 'Generating...' : 'New random username'}</span>
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Notifications & Typing</h2>
            {browserNotifPermission === 'default' && (
              <button
                type="button"
                disabled={requestingPerm}
                onClick={async () => {
                  setRequestingPerm(true);
                  try {
                    await onRequestBrowserPermission();
                  } finally {
                    setRequestingPerm(false);
                  }
                }}
                className="min-h-[36px] px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>{requestingPerm ? 'Requesting...' : 'Allow browser alerts'}</span>
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-200 dark:divide-white/[0.08]">
            <div className="pb-4 flex items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <Bell className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Browser notifications</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {browserNotifPermission === 'denied'
                      ? 'Blocked in browser settings. Allow notifications in site permissions to enable desktop alerts.'
                      : browserNotifPermission === 'unsupported'
                        ? 'Desktop notifications are not supported in this browser; in-app alerts remain active.'
                        : 'Alert when new messages or join requests arrive while away from a chat'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notificationSettings.browserNotifications}
                aria-label="Toggle browser notifications"
                onClick={() => {
                  const nextVal = !notificationSettings.browserNotifications;
                  onUpdateNotificationSettings({
                    ...notificationSettings,
                    browserNotifications: nextVal,
                  });
                  if (nextVal && browserNotifPermission === 'default') {
                    void onRequestBrowserPermission();
                  }
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  notificationSettings.browserNotifications
                    ? 'bg-indigo-600'
                    : 'bg-slate-300 dark:bg-white/[0.15]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    notificationSettings.browserNotifications ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="py-4 flex items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <Volume2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Notification sound</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Play a subtle chime when incoming messages or requests arrive
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notificationSettings.soundEnabled}
                aria-label="Toggle notification sound"
                onClick={() =>
                  onUpdateNotificationSettings({
                    ...notificationSettings,
                    soundEnabled: !notificationSettings.soundEnabled,
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  notificationSettings.soundEnabled
                    ? 'bg-indigo-600'
                    : 'bg-slate-300 dark:bg-white/[0.15]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    notificationSettings.soundEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="pt-4 flex items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <MessageSquareMore className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Typing effects</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Show live typing indicators in open conversations and broadcast when you type
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notificationSettings.typingIndicators}
                aria-label="Toggle typing effects"
                onClick={() =>
                  onUpdateNotificationSettings({
                    ...notificationSettings,
                    typingIndicators: !notificationSettings.typingIndicators,
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  notificationSettings.typingIndicators
                    ? 'bg-indigo-600'
                    : 'bg-slate-300 dark:bg-white/[0.15]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    notificationSettings.typingIndicators ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] p-6 space-y-5">
          <h2 className="text-sm font-semibold">Appearance & Legal</h2>

          <div className="space-y-2.5">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Follows your device theme by default
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#0B0E14]">
              {([
                { key: 'system', label: 'Device', Icon: Laptop },
                { key: 'light', label: 'Light', Icon: Sun },
                { key: 'dark', label: 'Dark', Icon: Moon },
              ] as const).map(({ key, label, Icon }) => {
                const active = themePreference === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onChangeTheme(key)}
                    className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-[#161C2C] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-white/[0.08] flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Terms and Privacy Policy</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                24-hour message auto-delete and anonymity commitments
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenTerms}
              className="min-h-[44px] px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
            >
              Read policy
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Blocked users</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {blocks.length} blocked
            </span>
          </div>

          {blocks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              You have not blocked anyone.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-white/[0.08]">
              {blocks.map((entry) => (
                <li
                  key={entry.blockedId}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      username={entry.blockedUsername}
                      color={entry.blockedColor}
                      size="sm"
                    />
                    <span className="text-sm font-medium truncate">
                      {entry.blockedUsername}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnblock(entry.blockedId)}
                    disabled={unblockingId === entry.blockedId}
                    className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>{unblockingId === entry.blockedId ? 'Unblocking...' : 'Unblock'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="pt-2">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full min-h-[48px] px-5 py-3 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
          </button>
        </div>
      </main>
    </div>
  );
};
