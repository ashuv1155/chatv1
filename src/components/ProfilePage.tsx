import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  Flag,
  History,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldBan,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { fetchProfileById, resizeAvatarImage, updateOwnProfile } from '../lib/api';
import type { Profile } from '../types';

interface ProfilePageProps {
  targetUserId: string;
  currentUser: Profile;
  isBlocked: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
  onProfileUpdated: (updated: Profile) => void;
  onRotateUsername: () => Promise<void>;
  onStartDm: (targetUserId: string) => Promise<void>;
  onRequestReport: (params: { userId: string; label: string }) => void;
  onRequestBlock: (target: { userId: string; username: string; color?: string }) => void;
  onUnblock: (blockedId: string) => Promise<void>;
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

function formatDate(iso?: string): string {
  if (!iso) return 'Recently';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Recently';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  targetUserId,
  currentUser,
  isBlocked,
  onBack,
  onOpenSettings,
  onProfileUpdated,
  onRotateUsername,
  onStartDm,
  onRequestReport,
  onRequestBlock,
  onUnblock,
}) => {
  const isSelf = targetUserId === currentUser.id;
  const [viewedProfile, setViewedProfile] = useState<Profile | null>(
    isSelf ? currentUser : null,
  );
  const [loading, setLoading] = useState(!isSelf);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState(currentUser.bio ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [startingDm, setStartingDm] = useState(false);
  const [unblocking, setUnblocking] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isSelf) {
      setViewedProfile(currentUser);
      setBioDraft(currentUser.bio ?? '');
      setLoading(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setFeedback(null);

    fetchProfileById(targetUserId)
      .then((prof) => {
        if (cancelled) return;
        if (!prof) {
          setLoadError('User profile not found.');
        } else {
          setViewedProfile(prof);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load profile.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [targetUserId, isSelf, currentUser]);

  const cooldownText = useMemo(
    () => (isSelf ? getCooldownText(currentUser.lastUsernameChangeAt) : null),
    [isSelf, currentUser.lastUsernameChangeAt],
  );

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !isSelf || !viewedProfile) return;

    setFeedback(null);
    setSavingProfile(true);
    try {
      const compressedDataUrl = await resizeAvatarImage(file);
      const saved = await updateOwnProfile(currentUser.id, {
        bio: viewedProfile.bio,
        avatarUrl: compressedDataUrl,
      });
      const next = { ...currentUser, ...saved };
      onProfileUpdated(next);
      setFeedback({ type: 'success', text: 'Profile image updated.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update profile image.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!isSelf || !viewedProfile) return;
    setFeedback(null);
    setSavingProfile(true);
    try {
      const saved = await updateOwnProfile(currentUser.id, {
        bio: viewedProfile.bio,
        avatarUrl: null,
      });
      onProfileUpdated({ ...currentUser, ...saved });
      setFeedback({ type: 'success', text: 'Profile image removed.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not remove profile image.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveBio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSelf || !viewedProfile) return;
    setFeedback(null);
    setSavingProfile(true);
    try {
      const saved = await updateOwnProfile(currentUser.id, {
        bio: bioDraft,
        avatarUrl: viewedProfile.avatarUrl,
      });
      onProfileUpdated({ ...currentUser, ...saved });
      setEditingBio(false);
      setFeedback({ type: 'success', text: 'Bio saved.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save bio.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRotate = async () => {
    setFeedback(null);
    setRotating(true);
    try {
      await onRotateUsername();
      setFeedback({
        type: 'success',
        text: 'Username changed. Your previous handle was added to your profile history.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to rotate username.',
      });
    } finally {
      setRotating(false);
    }
  };

  const handleDirectChat = async () => {
    if (!viewedProfile || isSelf) return;
    setStartingDm(true);
    setFeedback(null);
    try {
      await onStartDm(viewedProfile.id);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not open direct chat.',
      });
    } finally {
      setStartingDm(false);
    }
  };

  const handleUnblock = async () => {
    if (!viewedProfile) return;
    setUnblocking(true);
    try {
      await onUnblock(viewedProfile.id);
      setFeedback({ type: 'success', text: `Unblocked ${viewedProfile.username}.` });
    } finally {
      setUnblocking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-20 bg-slate-50/90 dark:bg-[#0B0E14]/90 backdrop-blur-md border-b border-slate-200 dark:border-white/[0.08]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white min-h-[44px] px-2 -ml-2 rounded-lg transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <span className="text-sm font-semibold tracking-tight truncate">
            {isSelf ? 'Your Profile' : viewedProfile?.username ?? 'User Profile'}
          </span>
          {isSelf ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white min-h-[44px] px-2 -mr-2 rounded-lg transition-colors whitespace-nowrap"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          ) : (
            <div className="w-12" aria-hidden="true" />
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {loading ? (
          <div className="rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] p-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 rounded-2xl bg-slate-200 dark:bg-white/[0.06] animate-pulse shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-5 w-44 rounded bg-slate-200 dark:bg-white/[0.06] animate-pulse" />
                <div className="h-3.5 w-28 rounded bg-slate-200 dark:bg-white/[0.06] animate-pulse" />
              </div>
            </div>
            <div className="h-16 rounded-xl bg-slate-100 dark:bg-white/[0.04] animate-pulse" />
          </div>
        ) : loadError || !viewedProfile ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-700 dark:text-red-300">
            {loadError ?? 'Profile could not be loaded.'}
          </div>
        ) : (
          <>
            <section className="rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="relative shrink-0">
                    <Avatar
                      username={viewedProfile.username}
                      color={viewedProfile.color}
                      avatarUrl={viewedProfile.avatarUrl}
                      size="xl"
                    />
                    {isSelf && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handleAvatarSelected}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={savingProfile}
                          title="Change profile image"
                          aria-label="Change profile image"
                          className="absolute -bottom-1.5 -right-1.5 h-9 w-9 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white border-2 border-white dark:border-[#111622] flex items-center justify-center transition-colors shadow-sm"
                        >
                          <Camera className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
                      {viewedProfile.username}
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{isSelf ? 'Your anonymous identity' : 'Anonymous member'}</span>
                      <span aria-hidden="true"> · </span>
                      <span>Joined {formatDate(viewedProfile.createdAt)}</span>
                      {viewedProfile.usernameHistory.length > 0 && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span>
                            {viewedProfile.usernameHistory.length}{' '}
                            {viewedProfile.usernameHistory.length === 1
                              ? 'past name'
                              : 'past names'}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                {!isSelf && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {!isBlocked ? (
                      <button
                        type="button"
                        onClick={handleDirectChat}
                        disabled={startingDm || currentUser.banned}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <MessageSquarePlus className="w-4 h-4" />
                        <span>{startingDm ? 'Opening chat...' : 'Direct Chat'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleUnblock}
                        disabled={unblocking}
                        className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>{unblocking ? 'Unblocking...' : 'Unblock user'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        onRequestReport({
                          userId: viewedProfile.id,
                          label: viewedProfile.username,
                        })
                      }
                      className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Flag className="w-4 h-4" />
                      <span>Report</span>
                    </button>

                    {!isBlocked && (
                      <button
                        type="button"
                        onClick={() =>
                          onRequestBlock({
                            userId: viewedProfile.id,
                            username: viewedProfile.username,
                            color: viewedProfile.color,
                          })
                        }
                        className="min-h-[44px] px-3.5 py-2 rounded-xl border border-red-500/30 hover:bg-red-500/10 text-sm font-medium text-red-600 dark:text-red-400 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <ShieldBan className="w-4 h-4" />
                        <span>Block</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isSelf && viewedProfile.avatarUrl && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={savingProfile}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-xs font-medium transition-colors"
                  >
                    Upload new image
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={savingProfile}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove image</span>
                  </button>
                </div>
              )}

              {viewedProfile.banned && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-2.5 text-sm text-red-700 dark:text-red-300">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>This account is currently restricted.</span>
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

              <div className="pt-4 border-t border-slate-200 dark:border-white/[0.08] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Bio</h2>
                  {isSelf && !editingBio && (
                    <button
                      type="button"
                      onClick={() => {
                        setBioDraft(viewedProfile.bio ?? '');
                        setEditingBio(true);
                      }}
                      className="min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>{viewedProfile.bio ? 'Edit bio' : 'Add bio'}</span>
                    </button>
                  )}
                </div>

                {isSelf && editingBio ? (
                  <form onSubmit={handleSaveBio} className="space-y-2.5">
                    <textarea
                      value={bioDraft}
                      onChange={(e) => setBioDraft(e.target.value)}
                      maxLength={240}
                      rows={3}
                      placeholder="Write a short anonymous bio (up to 240 characters)..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-white/[0.1] text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono tabular-nums text-slate-400">
                        {bioDraft.length}/240
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingBio(false)}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingProfile}
                          className="min-h-[40px] px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{savingProfile ? 'Saving...' : 'Save bio'}</span>
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
                    {viewedProfile.bio
                      ? viewedProfile.bio
                      : isSelf
                        ? 'No bio yet. Add a short intro while staying anonymous.'
                        : 'No bio added yet.'}
                  </p>
                )}
              </div>

              {isSelf && (
                <div className="pt-4 border-t border-slate-200 dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Change anonymous username</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {cooldownText ?? 'Allowed once every 24 hours · Past names stay visible on your profile'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRotate}
                    disabled={rotating || cooldownText !== null || currentUser.banned}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-white/[0.08] hover:bg-slate-800 dark:hover:bg-white/[0.14] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-4 h-4 ${rotating ? 'animate-spin' : ''}`} />
                    <span>{rotating ? 'Updating...' : 'New random username'}</span>
                  </button>
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <h2 className="text-sm font-semibold">Username history</h2>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {viewedProfile.usernameHistory.length}{' '}
                  {viewedProfile.usernameHistory.length === 1 ? 'change' : 'changes'}
                </span>
              </div>

              <div className="space-y-2">
                <div className="py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-[#0B0E14]/70 border border-slate-200/80 dark:border-white/[0.06] flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 truncate">
                    {viewedProfile.username}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    Current handle
                  </span>
                </div>

                {viewedProfile.usernameHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
                    No previous username changes recorded.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-white/[0.08]">
                    {viewedProfile.usernameHistory.map((entry, idx) => (
                      <li
                        key={`${entry.username}-${entry.changedAt}-${idx}`}
                        className="py-3 flex items-center justify-between gap-3"
                      >
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                          {entry.username}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                          Changed {formatDateTime(entry.changedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};
