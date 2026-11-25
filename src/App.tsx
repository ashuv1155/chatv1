import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { MessageSquare, Plus } from 'lucide-react';
import { BlockConfirmModal } from './components/BlockConfirmModal';
import { ChatView } from './components/ChatView';
import { CreateGroupModal } from './components/CreateGroupModal';
import { LoginScreen } from './components/LoginScreen';
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
import type { AppScreen, BlockEntry, ChatSummary, Profile } from './types';

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);

  const [screen, setScreen] = useState<AppScreen>('chat');
  const [showPublicTerms, setShowPublicTerms] = useState(false);
  const [isDark, setIsDark] = useState(true);

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

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

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

  const handleCreateGroup = async (name: string, description: string) => {
    if (!profile) return;
    const newChatId = await createGroup(profile, name, description);
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
          <p className="text-base font-semibold tracking-tight">VeilChat</p>
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
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
        onRotateUsername={handleRotateUsername}
        onUnblock={handleUnblock}
        onOpenTerms={() => setScreen('terms')}
        onSignOut={handleSignOut}
        onBack={() => setScreen('chat')}
      />
    );
  }

  return (
    <div className="h-dvh w-full bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 flex overflow-hidden">
      <div
        className={`${
          activeChat ? 'hidden lg:block' : 'block'
        } w-full lg:w-80 h-full shrink-0`}
      >
        <Sidebar
          profile={profile}
          chats={chats}
          blockedUserIds={blockedUserIds}
          activeChatId={activeChatId}
          loadingChats={loadingChats}
          onSelectChat={(id) => setActiveChatId(id)}
          onJoinGroup={handleJoinGroup}
          onStartDm={handleStartDm}
          onOpenCreateGroup={() => setCreateGroupOpen(true)}
          onOpenSettings={() => setScreen('settings')}
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
            onRequestReport={(params) => setReportTarget(params)}
            onRequestBlock={(target) => setBlockTarget(target)}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 max-w-sm">
              <h2 className="text-lg font-semibold tracking-tight">
                Signed in as {profile.username}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Select a conversation on the left, browse public groups, or create a new room to start chatting anonymously.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateGroupOpen(true)}
              disabled={profile.banned}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create group</span>
            </button>
          </div>
        )}
      </main>

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
