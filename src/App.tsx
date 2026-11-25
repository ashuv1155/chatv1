import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Clock,
  Lock,
  MessageSquare,
  Plus,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';
import { Avatar } from './components/Avatar';
import { BlockConfirmModal } from './components/BlockConfirmModal';
import { ChatView } from './components/ChatView';
import { CreateGroupModal } from './components/CreateGroupModal';
import { LoginScreen } from './components/LoginScreen';
import { ProfilePage } from './components/ProfilePage';
import { ReportModal } from './components/ReportModal';
import { SettingsScreen } from './components/SettingsScreen';
import { Sidebar } from './components/Sidebar';
import { TermsPrivacyScreen } from './components/TermsPrivacyScreen';
import {
  blockUser,
  createGroup,
  ensureUserProfile,
  fetchBlocks,
  fetchMyChats,
  joinGroup,
  leaveGroup,
  rotateUsername,
  startDm,
  submitReport,
  unblockUser,
} from './lib/api';
import { signInWithGoogle, signOutFirebase, subscribeToAuth } from './lib/firebase';
import type {
  AppScreen,
  BlockEntry,
  ChatSummary,
  GroupVisibility,
  Profile,
  ThemePreference,
} from './types';

const THEME_STORAGE_KEY = 'buddychat_theme';

function readStoredThemePreference(): ThemePreference {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') return val;
  } catch {
    // ignore storage errors
  }
  return 'system';
}

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);

  const [screen, setScreen] = useState<AppScreen>('chat');
  const [viewedProfileUserId, setViewedProfileUserId] = useState<string | null>(null);
  const [showPublicTerms, setShowPublicTerms] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readStoredThemePreference);

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<BlockEntry[]>([]);

  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    userId: string | null;
    label: string;
    messageId?: string | null;
  } | null>(null);
  const [blockTarget, setBlockTarget] = useState<{
    userId: string;
    username: string;
    color?: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Apply device-default theme ('system') or explicit 'light'/'dark' across browsers
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      // ignore storage errors
    }

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const systemDark = media ? media.matches : true;
      const useDark =
        themePreference === 'dark' || (themePreference === 'system' && systemDark);
      document.documentElement.classList.toggle('dark', useDark);
      document.documentElement.style.colorScheme = useDark ? 'dark' : 'light';
    };

    apply();
    if (!media) return;

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, [themePreference]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadWorkspaceData = useCallback(async (uid: string) => {
    setLoadingChats(true);
    try {
      const [chatRows, blockRows] = await Promise.all([
        fetchMyChats(uid),
        fetchBlocks(uid),
      ]);
      setChats(chatRows);
      setBlocks(blockRows);
    } finally {
      setLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuth(async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setProfile(null);
        setChats([]);
        setBlocks([]);
        setActiveChatId(null);
        setViewedProfileUserId(null);
        setScreen('chat');
        return;
      }

      setBootstrapping(true);
      setAuthError(null);
      try {
        const userProfile = await ensureUserProfile(user);
        setProfile(userProfile);
        await loadWorkspaceData(user.uid);
      } catch (err) {
        let message = err instanceof Error ? err.message : 'Unable to finish anonymous sign-in.';
        try {
          const parsed = JSON.parse(message) as { error?: string };
          if (parsed?.error) message = parsed.error;
        } catch {
          // keep message
        }
        setAuthError(message);
        await signOutFirebase();
      } finally {
        setBootstrapping(false);
      }
    });

    return () => unsubscribe();
  }, [loadWorkspaceData]);

  const handleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      if (!message.includes('popup-closed-by-user')) {
        setAuthError(message);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOutFirebase();
  };

  const handleCreateGroup = async (
    name: string,
    description: string,
    visibility: GroupVisibility,
  ) => {
    if (!profile) return;
    const newChatId = await createGroup(profile, name, description, visibility);
    await loadWorkspaceData(profile.id);
    setActiveChatId(newChatId);
    setScreen('chat');
  };

  const handleJoinGroup = async (chatId: string) => {
    if (!profile) return;
    await joinGroup(profile, chatId);
    await loadWorkspaceData(profile.id);
    setActiveChatId(chatId);
    setScreen('chat');
  };

  const handleLeaveGroup = async (chatId: string) => {
    if (!profile) return;
    await leaveGroup(profile.id, chatId);
    setActiveChatId((prev) => (prev === chatId ? null : prev));
    await loadWorkspaceData(profile.id);
  };

  const handleStartDm = async (targetUserId: string) => {
    if (!profile) return;
    const dmChatId = await startDm(profile, targetUserId);
    await loadWorkspaceData(profile.id);
    setActiveChatId(dmChatId);
    setScreen('chat');
  };

  const handleRotateUsername = async () => {
    if (!profile) return;
    const updated = await rotateUsername(profile);
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            username: updated.username,
            lastUsernameChangeAt: updated.lastUsernameChangeAt,
            usernameHistory: updated.usernameHistory,
          }
        : prev,
    );
  };

  const handleBlockConfirm = async () => {
    if (!profile || !blockTarget) return;
    await blockUser(profile.id, blockTarget);
    const nextBlocks = await fetchBlocks(profile.id);
    setBlocks(nextBlocks);
    setToast(`Blocked ${blockTarget.username}.`);
  };

  const handleUnblock = async (blockedId: string) => {
    if (!profile) return;
    await unblockUser(profile.id, blockedId);
    const nextBlocks = await fetchBlocks(profile.id);
    setBlocks(nextBlocks);
  };

  const handleSubmitReport = async (reason: string) => {
    if (!profile || !reportTarget) return;
    await submitReport({
      reporterId: profile.id,
      reportedUserId: reportTarget.userId,
      chatId: activeChatId,
      messageId: reportTarget.messageId ?? null,
      reason,
    });
    setToast('Report submitted. Thank you for helping keep rooms safe.');
  };

  const openProfilePage = (userId: string) => {
    setViewedProfileUserId(userId);
    setScreen('profile');
  };

  const blockedUserIds = useMemo(
    () => new Set(blocks.map((b) => b.blockedId)),
    [blocks],
  );

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId],
  );

  if (!authReady || (firebaseUser && bootstrapping && !profile)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-base font-semibold tracking-tight">Buddy Chat</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {bootstrapping ? 'Preparing your anonymous session...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    if (showPublicTerms) {
      return <TermsPrivacyScreen onBack={() => setShowPublicTerms(false)} />;
    }
    return (
      <LoginScreen
        onSignIn={handleSignIn}
        onOpenTerms={() => setShowPublicTerms(true)}
        authError={authError}
        isSigningIn={isSigningIn}
      />
    );
  }

  if (screen === 'terms') {
    return <TermsPrivacyScreen onBack={() => setScreen('settings')} />;
  }

  if (screen === 'settings') {
    return (
      <SettingsScreen
        profile={profile}
        blocks={blocks}
        themePreference={themePreference}
        onChangeTheme={setThemePreference}
        onRotateUsername={handleRotateUsername}
        onUnblock={handleUnblock}
        onOpenProfile={() => openProfilePage(profile.id)}
        onOpenTerms={() => setScreen('terms')}
        onSignOut={handleSignOut}
        onBack={() => setScreen('chat')}
      />
    );
  }

  return (
    <div className="h-dvh-safe w-full bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 flex overflow-hidden">
      {screen === 'profile' && viewedProfileUserId ? (
        <div className="flex-1 h-full overflow-y-auto chat-scroll">
          <ProfilePage
            targetUserId={viewedProfileUserId}
            currentUser={profile}
            isBlocked={blockedUserIds.has(viewedProfileUserId)}
            onBack={() => setScreen('chat')}
            onOpenSettings={() => setScreen('settings')}
            onProfileUpdated={(updated) => setProfile(updated)}
            onRotateUsername={handleRotateUsername}
            onStartDm={handleStartDm}
            onRequestReport={(params) => setReportTarget(params)}
            onRequestBlock={(target) => setBlockTarget(target)}
            onUnblock={handleUnblock}
          />
        </div>
      ) : (
        <>
          <div
            className={`${
              activeChat ? 'hidden lg:block' : 'block'
            } w-full lg:w-84 h-full shrink-0`}
          >
            <Sidebar
              profile={profile}
              chats={chats}
              blockedUserIds={blockedUserIds}
              activeChatId={activeChatId}
              loadingChats={loadingChats}
              onSelectChat={(id) => setActiveChatId(id || null)}
              onJoinGroup={handleJoinGroup}
              onStartDm={handleStartDm}
              onOpenCreateGroup={() => setCreateGroupOpen(true)}
              onOpenProfile={openProfilePage}
              onOpenSettings={() => setScreen('settings')}
              onToast={(msg) => setToast(msg)}
            />
          </div>

          <main
            className={`${
              activeChat ? 'block' : 'hidden lg:block'
            } flex-1 h-full min-w-0`}
          >
            {activeChat ? (
              <ChatView
                chat={activeChat}
                currentUser={profile}
                blockedUserIds={blockedUserIds}
                onBackMobile={() => setActiveChatId(null)}
                onLeaveGroup={handleLeaveGroup}
                onStartDm={handleStartDm}
                onOpenProfile={openProfilePage}
                onRequestReport={(params) => setReportTarget(params)}
                onRequestBlock={(target) => setBlockTarget(target)}
                onToast={(msg) => setToast(msg)}
              />
            ) : (
              <div className="h-full overflow-y-auto chat-scroll flex items-center justify-center p-8">
                <div className="w-full max-w-2xl space-y-8">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-white/[0.08]">
                    <div className="flex items-center gap-4">
                      <Avatar
                        username={profile.username}
                        color={profile.color}
                        avatarUrl={profile.avatarUrl}
                        size="lg"
                      />
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Welcome to Buddy Chat
                        </p>
                        <h1 className="text-2xl font-bold tracking-tight">
                          {profile.username}
                        </h1>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openProfilePage(profile.id)}
                        className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <UserCircle2 className="w-4 h-4" />
                        <span>Your profile</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreateGroupOpen(true)}
                        disabled={profile.banned}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Create group</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] space-y-1.5">
                      <Clock className="w-5 h-5 text-indigo-500" />
                      <h2 className="text-sm font-semibold">24-hour messages</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Messages and attachments automatically clear after 24 hours.
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] space-y-1.5">
                      <Lock className="w-5 h-5 text-amber-500" />
                      <h2 className="text-sm font-semibold">Private & public rooms</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Create open rooms or private rooms with admin join approvals.
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] space-y-1.5">
                      <ShieldCheck className="w-5 h-5 text-emerald-500" />
                      <h2 className="text-sm font-semibold">View-once & 5 MB files</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Share photos, single-view images, or files up to 5 MB in any chat.
                      </p>
                    </div>
                  </div>

                  {chats.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Jump back into a recent chat
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {chats.slice(0, 4).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setActiveChatId(c.id)}
                            className="p-3.5 rounded-xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/[0.08] hover:border-indigo-500/40 flex items-center gap-3 text-left transition-colors"
                          >
                            <MessageSquare className="w-4 h-4 text-indigo-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">
                                {c.type === 'dm'
                                  ? c.partner?.username ?? 'Direct chat'
                                  : c.name ?? 'Group'}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {c.type === 'dm'
                                  ? 'Direct chat'
                                  : c.visibility === 'private'
                                    ? 'Private group'
                                    : 'Public group'}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Use Discover on the left to search anonymous users or join groups.
                    </p>
                  )}
                </div>
              </div>
            )}
          </main>
        </>
      )}

      <CreateGroupModal
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        onCreate={handleCreateGroup}
      />

      <ReportModal
        isOpen={reportTarget !== null}
        targetLabel={reportTarget?.label ?? ''}
        onClose={() => setReportTarget(null)}
        onSubmit={handleSubmitReport}
      />

      <BlockConfirmModal
        isOpen={blockTarget !== null}
        username={blockTarget?.username ?? ''}
        onClose={() => setBlockTarget(null)}
        onConfirm={handleBlockConfirm}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl bg-slate-900 dark:bg-[#161C2C] text-white border border-white/[0.1] text-sm shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
