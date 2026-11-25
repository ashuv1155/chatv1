import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  Flag,
  History,
  MessageSquarePlus,
  Palette,
  Pencil,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldBan,
  Star,
  Tag,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  PROFILE_ACCENT_COLORS,
  fetchProfileById,
  resizeAvatarImage,
  updateOwnProfile,
} from '../lib/api';
import type { Profile } from '../types';

interface ProfilePageProps {
  targetUserId: string;
  currentUser: Profile;
  nicknames: Record<string, string>;
  isBlocked: boolean;
  isFavorite: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
  onProfileUpdated: (updated: Profile) => void;
  onSetUsername: (nextUsername: string) => Promise<void>;
  onRotateUsername: () => Promise<void>;
  onSetNickname: (targetUserId: string, nickname: string) => Promise<void>;
  onRemoveNickname: (targetUserId: string) => Promise<void>;
  onToggleFavorite: (target: { userId: string; username: string; color?: string }) => Promise<void>;
  onStartDm: (targetUserId: string) => Promise<void>;
  onRequestReport: (params: { userId: string; label: string }) => void;
  onRequestBlock: (target: { userId: string; username: string; color?: string }) => void;
  onUnblock: (blockedId: string) => Promise<void>;
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
  nicknames,
  isBlocked,
  isFavorite,
  onBack,
  onOpenSettings,
  onProfileUpdated,
  onSetUsername,
  onRotateUsername,
  onSetNickname,
  onRemoveNickname,
  onToggleFavorite,
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

  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(currentUser.username);
  const [savingUsername, setSavingUsername] = useState(false);

  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);

  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState(currentUser.bio ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [startingDm, setStartingDm] = useState(false);
  const [unblocking, setUnblocking] = useState(false);
  const [togglingFavorite, setTogglingFavorite] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeNickname = !isSelf && viewedProfile ? nicknames[viewedProfile.id] ?? '' : '';

  useEffect(() => {
    if (isSelf) {
      setViewedProfile(currentUser);
      setBioDraft(currentUser.bio ?? '');
      setUsernameDraft(currentUser.username);
      setLoading(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setFeedback(null);
    setEditingNickname(false);

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

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSelf) return;
    setFeedback(null);
    setSavingUsername(true);
    try {
      await onSetUsername(usernameDraft);
      setEditingUsername(false);
      setFeedback({
        type: 'success',
        text: 'Username updated. Your previous handle was recorded in username history.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to update username.',
      });
    } finally {
      setSavingUsername(false);
    }
  };

  const handleSaveNickname = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSelf || !viewedProfile) return;
    setFeedback(null);
    setSavingNickname(true);
    try {
      const trimmed = nicknameDraft.trim();
      if (!trimmed) {
        if (activeNickname) {
          await onRemoveNickname(viewedProfile.id);
          setFeedback({ type: 'success', text: 'Friend nickname removed.' });
        }
      } else {
        await onSetNickname(viewedProfile.id, trimmed);
        setFeedback({ type: 'success', text: `Nickname saved as "${trimmed}".` });
      }
      setEditingNickname(false);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save nickname.',
      });
    } finally {
      setSavingNickname(false);
    }
  };

  const handleClearNickname = async () => {
    if (isSelf || !viewedProfile) return;
    setFeedback(null);
    setSavingNickname(true);
    try {
      await onRemoveNickname(viewedProfile.id);
      setNicknameDraft('');
      setEditingNickname(false);
      setFeedback({ type: 'success', text: 'Nickname removed.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not remove nickname.',
      });
    } finally {
      setSavingNickname(false);
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
      setEditingUsername(false);
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

  const handleToggleFavorite = async () => {
    if (!viewedProfile || isSelf || togglingFavorite) return;
    setTogglingFavorite(true);
    setFeedback(null);
    try {
      await onToggleFavorite({
        userId: viewedProfile.id,
        username: viewedProfile.username,
        color: viewedProfile.color,
      });
      setFeedback({
        type: 'success',
        text: isFavorite
          ? `Removed ${primaryTitle} from favorites.`
          : `Added ${primaryTitle} to favorites.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update favorite.',
      });
    } finally {
      setTogglingFavorite(false);
    }
  };

  const handleSelectColor = async (nextColor: string) => {
    if (!isSelf || !viewedProfile || savingProfile || viewedProfile.color === nextColor) return;
    setFeedback(null);
    setSavingProfile(true);
    try {
      const saved = await updateOwnProfile(currentUser.id, {
        bio: viewedProfile.bio,
        avatarUrl: viewedProfile.avatarUrl,
        color: nextColor,
      });
      onProfileUpdated({ ...currentUser, ...saved });
      setFeedback({ type: 'success', text: 'Avatar accent color updated.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update avatar color.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const primaryTitle = isSelf
    ? viewedProfile?.username ?? currentUser.username
    : activeNickname || viewedProfile?.username || 'User Profile';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-neutral-100">
      <header className="sticky top-0 z-20 bg-slate-50/90 dark:bg-black/90 backdrop-blur-md border-b border-slate-200 dark:border-white/[0.1]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white min-h-[44px] px-2 -ml-2 rounded-lg transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <span className="text-sm font-semibold tracking-tight truncate">
            {isSelf ? 'Your Profile' : primaryTitle}
          </span>
          {isSelf ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white min-h-[44px] px-2 -mr-2 rounded-lg transition-colors whitespace-nowrap"
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
          <div className="rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] p-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 rounded-full bg-slate-200 dark:bg-white/[0.08] animate-pulse shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-5 w-44 rounded bg-slate-200 dark:bg-white/[0.08] animate-pulse" />
                <div className="h-3.5 w-28 rounded bg-slate-200 dark:bg-white/[0.08] animate-pulse" />
              </div>
            </div>
            <div className="h-16 rounded-xl bg-slate-100 dark:bg-white/[0.05] animate-pulse" />
          </div>
        ) : loadError || !viewedProfile ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-700 dark:text-red-300">
            {loadError ?? 'Profile could not be loaded.'}
          </div>
        ) : (
          <>
            <section className="rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="relative shrink-0">
                    <Avatar
                      username={primaryTitle}
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
                          className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] text-white border-2 border-white dark:border-[#141414] flex items-center justify-center transition-colors shadow-sm"
                        >
                          <Camera className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
                      {primaryTitle}
                    </h1>
                    {!isSelf && activeNickname && (
                      <p className="text-xs font-medium text-slate-500 dark:text-neutral-400 truncate">
                        @{viewedProfile.username}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                      <span>{isSelf ? 'Your anonymous identity' : 'Buddy Chat member'}</span>
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
                        className="min-h-[44px] px-4 py-2 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <MessageSquarePlus className="w-4 h-4" />
                        <span>{startingDm ? 'Opening chat...' : 'Direct Chat'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleUnblock}
                        disabled={unblocking}
                        className="min-h-[44px] px-4 py-2 rounded-full border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>{unblocking ? 'Unblocking...' : 'Unblock user'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleToggleFavorite}
                      disabled={togglingFavorite}
                      aria-pressed={isFavorite}
                      className={`min-h-[44px] px-3.5 py-2 rounded-full border text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        isFavorite
                          ? 'border-amber-500/40 bg-amber-500/12 text-amber-600 dark:text-amber-400'
                          : 'border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      <Star className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
                      <span>{isFavorite ? 'Favorited' : 'Favorite'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onRequestReport({
                          userId: viewedProfile.id,
                          label: primaryTitle,
                        })
                      }
                      className="min-h-[44px] px-3.5 py-2 rounded-full border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
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
                        className="min-h-[44px] px-3.5 py-2 rounded-full border border-red-500/30 hover:bg-red-500/10 text-sm font-medium text-red-600 dark:text-red-400 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
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
                    className="min-h-[38px] px-3.5 py-1.5 rounded-full border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium transition-colors"
                  >
                    Upload new image
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={savingProfile}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove image</span>
                  </button>
                </div>
              )}

              {isSelf && (
                <div className="pt-4 border-t border-slate-200 dark:border-white/[0.1] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-[#2B84F6]" />
                    <div>
                      <p className="text-sm font-semibold">Avatar color</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        Choose your anonymous avatar badge color
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {PROFILE_ACCENT_COLORS.map((hex) => {
                      const active = viewedProfile.color.toLowerCase() === hex.toLowerCase();
                      return (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => handleSelectColor(hex)}
                          disabled={savingProfile || viewedProfile.banned}
                          aria-label={`Select color ${hex}`}
                          aria-pressed={active}
                          style={{ backgroundColor: hex }}
                          className={`h-7 w-7 rounded-full transition-transform hover:scale-110 disabled:opacity-50 ${
                            active
                              ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-[#141414] scale-110'
                              : ''
                          }`}
                        />
                      );
                    })}
                  </div>
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

              {/* Friend Nickname (Private to current user) */}
              {!isSelf && (
                <div className="pt-4 border-t border-slate-200 dark:border-white/[0.1] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-[#2B84F6]" />
                      <h2 className="text-sm font-semibold">Friend nickname</h2>
                    </div>
                    {!editingNickname && (
                      <button
                        type="button"
                        onClick={() => {
                          setNicknameDraft(activeNickname);
                          setEditingNickname(true);
                        }}
                        className="min-h-[36px] px-3 py-1 rounded-full text-xs font-medium text-[#2B84F6] hover:bg-[#2B84F6]/10 inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>{activeNickname ? 'Edit nickname' : 'Set nickname'}</span>
                      </button>
                    )}
                  </div>

                  {editingNickname ? (
                    <form onSubmit={handleSaveNickname} className="space-y-2.5">
                      <input
                        type="text"
                        value={nicknameDraft}
                        onChange={(e) => setNicknameDraft(e.target.value)}
                        maxLength={32}
                        placeholder={`Nickname for ${viewedProfile.username}...`}
                        autoFocus
                        className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 dark:text-neutral-400">
                          Only visible to you across chats and search
                        </span>
                        <div className="flex items-center gap-2">
                          {activeNickname && (
                            <button
                              type="button"
                              onClick={handleClearNickname}
                              disabled={savingNickname}
                              className="min-h-[38px] px-3 py-1.5 rounded-full text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Clear</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditingNickname(false)}
                            className="min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={savingNickname}
                            className="min-h-[38px] px-4 py-1.5 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{savingNickname ? 'Saving...' : 'Save'}</span>
                          </button>
                        </div>
                      </div>
                    </form>
                  ) : (
                    <p className="text-sm text-slate-600 dark:text-neutral-300">
                      {activeNickname
                        ? `Saved as "${activeNickname}" (only visible to you).`
                        : 'Set a private nickname for this friend so it is easier to recognize them.'}
                    </p>
                  )}
                </div>
              )}

              {/* Bio */}
              <div className="pt-4 border-t border-slate-200 dark:border-white/[0.1] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Bio</h2>
                  {isSelf && !editingBio && (
                    <button
                      type="button"
                      onClick={() => {
                        setBioDraft(viewedProfile.bio ?? '');
                        setEditingBio(true);
                      }}
                      className="min-h-[36px] px-3 py-1 rounded-full text-xs font-medium text-[#2B84F6] hover:bg-[#2B84F6]/10 inline-flex items-center gap-1.5 transition-colors"
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
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6] resize-none"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-neutral-500">
                        {bioDraft.length}/240
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingBio(false)}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingProfile}
                          className="min-h-[40px] px-4 py-1.5 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{savingProfile ? 'Saving...' : 'Save bio'}</span>
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <p className="text-sm text-slate-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap break-words">
                    {viewedProfile.bio
                      ? viewedProfile.bio
                      : isSelf
                        ? 'No bio yet. Add a short intro while staying anonymous.'
                        : 'No bio added yet.'}
                  </p>
                )}
              </div>

              {/* Set Custom Username or Generate Random Handle */}
              {isSelf && (
                <div className="pt-4 border-t border-slate-200 dark:border-white/[0.1] space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold">Username</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        Set your own handle (3–32 letters, numbers, or _) or generate a random one. Past names appear in your history.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!editingUsername && (
                        <button
                          type="button"
                          onClick={() => {
                            setUsernameDraft(currentUser.username);
                            setEditingUsername(true);
                          }}
                          disabled={currentUser.banned}
                          className="min-h-[40px] px-4 py-2 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Set username</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleRotate}
                        disabled={rotating || currentUser.banned}
                        className="min-h-[40px] px-4 py-2 rounded-full bg-slate-900 dark:bg-[#242426] hover:bg-slate-800 dark:hover:bg-[#2E2E32] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${rotating ? 'animate-spin' : ''}`} />
                        <span>{rotating ? 'Updating...' : 'Randomize'}</span>
                      </button>
                    </div>
                  </div>

                  {editingUsername && (
                    <form onSubmit={handleSaveUsername} className="space-y-2.5">
                      <input
                        type="text"
                        value={usernameDraft}
                        onChange={(e) => setUsernameDraft(e.target.value)}
                        minLength={3}
                        maxLength={32}
                        placeholder="Enter username (e.g. cyber_fox)"
                        autoFocus
                        className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 dark:text-neutral-400">
                          3–32 characters: A-Z, 0-9, underscore (_)
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingUsername(false)}
                            className="min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={savingUsername || usernameDraft.trim().length < 3}
                            className="min-h-[38px] px-4 py-1.5 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{savingUsername ? 'Saving...' : 'Save username'}</span>
                          </button>
                        </div>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-slate-500 dark:text-neutral-400" />
                  <h2 className="text-sm font-semibold">Username history</h2>
                </div>
                <span className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                  {viewedProfile.usernameHistory.length}{' '}
                  {viewedProfile.usernameHistory.length === 1 ? 'change' : 'changes'}
                </span>
              </div>

              <div className="space-y-2">
                <div className="py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.08] flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[#2B84F6] truncate">
                    {viewedProfile.username}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-neutral-400 shrink-0">
                    Current handle
                  </span>
                </div>

                {viewedProfile.usernameHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-neutral-400 pt-1">
                    No previous username changes recorded.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-white/[0.08]">
                    {viewedProfile.usernameHistory.map((entry, idx) => (
                      <li
                        key={`${entry.username}-${entry.changedAt}-${idx}`}
                        className="py-3 flex items-center justify-between gap-3"
                      >
                        <span className="text-sm font-medium text-slate-700 dark:text-neutral-200 truncate">
                          {entry.username}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums shrink-0">
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
