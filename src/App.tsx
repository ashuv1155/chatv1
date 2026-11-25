import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Bell,
  Clock,
  Lock,
  MessageSquare,
  Plus,
  ShieldCheck,
  UserCircle2,
  X,
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
  fetchUnreadCountForChat,
  getDisplayName,
  joinGroup,
  leaveGroup,
  markChatRead,
  removeFriendNickname,
  rotateUsername,
  setCustomUsername,
  setFriendNickname,
  startDm,
  submitReport,
  subscribeToAdminJoinRequests,
  subscribeToGroupUpdates,
  subscribeToMyChats,
  subscribeToNicknames,
  unblockUser,
} from './lib/api';
import { signInWithGoogle, signOutFirebase, subscribeToAuth } from './lib/firebase';
import {
  type BrowserNotifPermission,
  getBrowserNotificationPermission,
  loadNotificationSettings,
  playNotificationChime,
  requestBrowserNotificationPermission,
  saveNotificationSettings,
  showBrowserNotification,
} from './lib/notifications';
import type {
  AppNotification,
  AppScreen,
  BlockEntry,
  ChatSummary,
  GroupVisibility,
  NotificationSettings,
  Profile,
  ThemePreference,
} from './types';

const THEME_STORAGE_KEY = 'buddychat_theme';
const BASE_TITLE = 'Buddy Chat — Anonymous Real-Time Chat';

function readStoredThemePreference(): ThemePreference {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') return val;
  } catch {
    // ignore storage errors
  }
  return 'system';
}

interface GroupMetaPatch {
  createdBy: string | null;
  visibility: GroupVisibility;
  memberCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastSenderId: string | null;
  lastSenderUsername: string | null;
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

  const [myChatLinks, setMyChatLinks] = useState<ChatSummary[]>([]);
  const [groupMetaMap, setGroupMetaMap] = useState<Record<string, GroupMetaPatch>>({});
  const [loadingChats, setLoadingChats] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<BlockEntry[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationToast, setNotificationToast] = useState<AppNotification | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(
    loadNotificationSettings,
  );
  const [browserNotifPermission, setBrowserNotifPermission] = useState<BrowserNotifPermission>(
    getBrowserNotificationPermission,
  );
  const [tabHidden, setTabHidden] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.hidden : false,
  );

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

  const blockedUserIds = useMemo(
    () => new Set(blocks.map((b) => b.blockedId)),
    [blocks],
  );

  const chats = useMemo(() => {
    const merged = myChatLinks.map((c) => {
      if (c.type !== 'group') return c;
      const meta = groupMetaMap[c.id];
      if (!meta) return c;
      const linkTime = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
      const metaTime = meta.lastMessageAt ? new Date(meta.lastMessageAt).getTime() : 0;
      const useMetaMsg = metaTime >= linkTime && Boolean(meta.lastMessageAt);
      return {
        ...c,
        createdBy: meta.createdBy ?? c.createdBy,
        visibility: meta.visibility,
        memberCount: meta.memberCount,
        lastMessageAt: useMetaMsg ? meta.lastMessageAt : c.lastMessageAt,
        lastMessagePreview: useMetaMsg ? meta.lastMessagePreview : c.lastMessagePreview,
        lastSenderId: useMetaMsg ? meta.lastSenderId : c.lastSenderId,
        lastSenderUsername: useMetaMsg ? meta.lastSenderUsername : c.lastSenderUsername,
      };
    });

    return merged.sort((a, b) => {
      const aTime = new Date(a.lastMessageAt ?? a.createdAt).getTime();
      const bTime = new Date(b.lastMessageAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [myChatLinks, groupMetaMap]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId],
  );

  // Refs for real-time callbacks so listeners don't churn when UI selection changes
  const activeChatIdRef = useRef<string | null>(activeChatId);
  const screenRef = useRef<AppScreen>(screen);
  const blockedIdsRef = useRef<Set<string>>(blockedUserIds);
  const notifSettingsRef = useRef<NotificationSettings>(notificationSettings);
  const chatsRef = useRef<ChatSummary[]>(chats);
  const nicknamesRef = useRef<Record<string, string>>(nicknames);

  const myChatsInitializedRef = useRef(false);
  const knownChatIdsRef = useRef<Set<string>>(new Set());
  const lastMsgTimestampByChatRef = useRef<Map<string, string>>(new Map());
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const seenJoinReqKeysRef = useRef<Set<string>>(new Set());
  const lastCountedKeyRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    blockedIdsRef.current = blockedUserIds;
  }, [blockedUserIds]);

  useEffect(() => {
    notifSettingsRef.current = notificationSettings;
  }, [notificationSettings]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    nicknamesRef.current = nicknames;
  }, [nicknames]);

  // Track tab visibility / focus for smart browser notifications and read marking
  useEffect(() => {
    const syncVisibility = () => {
      setTabHidden(document.hidden);
      setBrowserNotifPermission(getBrowserNotificationPermission());
    };
    document.addEventListener('visibilitychange', syncVisibility);
    window.addEventListener('focus', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('focus', syncVisibility);
    };
  }, []);

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

  useEffect(() => {
    if (!notificationToast) return;
    const timer = window.setTimeout(() => setNotificationToast(null), 4800);
    return () => window.clearTimeout(timer);
  }, [notificationToast]);

  const handleUpdateNotificationSettings = useCallback((next: NotificationSettings) => {
    setNotificationSettings(next);
    saveNotificationSettings(next);
  }, []);

  const handleRequestBrowserPermission = useCallback(async () => {
    const perm = await requestBrowserNotificationPermission();
    setBrowserNotifPermission(perm);
    if (perm === 'granted') {
      setToast('Browser notifications enabled.');
    } else if (perm === 'denied') {
      setToast('Browser notifications were blocked in browser settings.');
    }
  }, []);

  const triggerNotification = useCallback(
    (input: Omit<AppNotification, 'id' | 'read'>) => {
      const isLookingAtChat =
        input.kind === 'message' &&
        input.chatId === activeChatIdRef.current &&
        screenRef.current === 'chat' &&
        !document.hidden;

      if (isLookingAtChat) return;

      const dedupeKey = `${input.kind}:${input.chatId}:${input.createdAt}:${input.title}`;
      if (notifiedKeysRef.current.has(dedupeKey)) return;
      notifiedKeysRef.current.add(dedupeKey);

      const notif: AppNotification = {
        ...input,
        id: dedupeKey,
        read: false,
      };

      setNotifications((prev) => [notif, ...prev].slice(0, 30));

      if (notifSettingsRef.current.soundEnabled) {
        playNotificationChime();
      }

      if (!document.hidden) {
        setNotificationToast(notif);
      }

      if (notifSettingsRef.current.browserNotifications) {
        showBrowserNotification(notif.title, notif.body, () => {
          setActiveChatId(notif.chatId);
          setScreen('chat');
        });
      }
    },
    [],
  );

  const handleChatViewed = useCallback(
    (chatId: string) => {
      if (!profile || !chatId) return;
      const nowIso = new Date().toISOString();
      setMyChatLinks((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, lastReadAt: nowIso } : c)),
      );
      setUnreadCounts((prev) => {
        if (!(chatId in prev)) return prev;
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
      lastCountedKeyRef.current.delete(chatId);
      setNotifications((prev) =>
        prev.map((n) => (n.chatId === chatId && !n.read ? { ...n, read: true } : n)),
      );
      void markChatRead(profile.id, chatId);
    },
    [profile],
  );

  // Mark active chat as read on chat open or when returning to tab
  useEffect(() => {
    if (!profile || !activeChatId || screen !== 'chat' || tabHidden) return;
    handleChatViewed(activeChatId);
  }, [profile, activeChatId, screen, tabHidden, handleChatViewed]);

  // Auth listener
  useEffect(() => {
    const unsubscribe = subscribeToAuth(async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setProfile(null);
        setMyChatLinks([]);
        setGroupMetaMap({});
        setBlocks([]);
        setNicknames({});
        setUnreadCounts({});
        setNotifications([]);
        setNotificationToast(null);
        setActiveChatId(null);
        setViewedProfileUserId(null);
        setScreen('chat');
        myChatsInitializedRef.current = false;
        knownChatIdsRef.current.clear();
        lastMsgTimestampByChatRef.current.clear();
        notifiedKeysRef.current.clear();
        seenJoinReqKeysRef.current.clear();
        lastCountedKeyRef.current.clear();
        return;
      }

      setBootstrapping(true);
      setAuthError(null);
      try {
        const userProfile = await ensureUserProfile(user);
        setProfile(userProfile);
        const blockRows = await fetchBlocks(user.uid);
        setBlocks(blockRows);
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
  }, []);

  // Real-time listener on private friend nicknames
  useEffect(() => {
    if (!profile) return;
    return subscribeToNicknames(profile.id, (map) => {
      setNicknames(map);
    });
  }, [profile]);

  // Real-time listener on user's myChats (DMs + joined groups)
  useEffect(() => {
    if (!profile) return;
    setLoadingChats(true);
    myChatsInitializedRef.current = false;
    knownChatIdsRef.current.clear();

    const unsub = subscribeToMyChats(profile.id, (incoming) => {
      setMyChatLinks(incoming);
      setLoadingChats(false);

      if (!myChatsInitializedRef.current) {
        myChatsInitializedRef.current = true;
        for (const c of incoming) {
          knownChatIdsRef.current.add(c.id);
          if (c.lastMessageAt) {
            lastMsgTimestampByChatRef.current.set(c.id, c.lastMessageAt);
          }
        }
        return;
      }

      for (const c of incoming) {
        const isNewlyAdded = !knownChatIdsRef.current.has(c.id);
        knownChatIdsRef.current.add(c.id);

        if (isNewlyAdded && c.type === 'group' && c.visibility === 'private') {
          triggerNotification({
            chatId: c.id,
            kind: 'group_approved',
            title: c.name ?? 'Private group',
            body: 'Your request was approved — you can now chat here.',
            createdAt: c.createdAt,
          });
        }

        if (
          c.type === 'dm' &&
          c.lastMessageAt &&
          c.lastSenderId &&
          c.lastSenderId !== profile.id &&
          !blockedIdsRef.current.has(c.lastSenderId)
        ) {
          const prevTs = lastMsgTimestampByChatRef.current.get(c.id);
          if (c.lastMessageAt !== prevTs) {
            lastMsgTimestampByChatRef.current.set(c.id, c.lastMessageAt);
            const senderDisplay = getDisplayName(
              c.partner?.id ?? c.lastSenderId,
              c.partner?.username ?? c.lastSenderUsername ?? 'Direct chat',
              nicknamesRef.current,
            );
            triggerNotification({
              chatId: c.id,
              kind: 'message',
              title: senderDisplay,
              body: c.lastMessagePreview ?? 'Sent a message',
              senderUsername: c.partner?.username ?? c.lastSenderUsername ?? undefined,
              senderColor: c.partner?.color,
              createdAt: c.lastMessageAt,
            });
          }
        }
      }
    });

    return () => unsub();
  }, [profile, triggerNotification]);

  // Real-time listener on joined groups for latest messages, member counts, and admin info
  const joinedGroupIdsKey = useMemo(
    () =>
      myChatLinks
        .filter((c) => c.type === 'group')
        .map((c) => c.id)
        .sort()
        .join(','),
    [myChatLinks],
  );

  useEffect(() => {
    if (!profile || !joinedGroupIdsKey) return;
    const groupIds = joinedGroupIdsKey.split(',').filter(Boolean);

    const unsub = subscribeToGroupUpdates(groupIds, (chatId, update, isInitial) => {
      setGroupMetaMap((prev) => ({
        ...prev,
        [chatId]: update,
      }));

      if (isInitial) {
        if (update.lastMessageAt) {
          lastMsgTimestampByChatRef.current.set(chatId, update.lastMessageAt);
        }
        return;
      }

      if (
        update.lastMessageAt &&
        update.lastSenderId &&
        update.lastSenderId !== profile.id &&
        !blockedIdsRef.current.has(update.lastSenderId)
      ) {
        const prevTs = lastMsgTimestampByChatRef.current.get(chatId);
        if (update.lastMessageAt !== prevTs) {
          lastMsgTimestampByChatRef.current.set(chatId, update.lastMessageAt);
          const groupTitle = chatsRef.current.find((c) => c.id === chatId)?.name ?? 'Group';
          const senderDisplay = update.lastSenderUsername
            ? getDisplayName(update.lastSenderId, update.lastSenderUsername, nicknamesRef.current)
            : null;
          const senderPrefix = senderDisplay ? `${senderDisplay}: ` : '';
          triggerNotification({
            chatId,
            kind: 'message',
            title: groupTitle,
            body: `${senderPrefix}${update.lastMessagePreview ?? 'New message'}`,
            senderUsername: update.lastSenderUsername ?? undefined,
            createdAt: update.lastMessageAt,
          });
        }
      }
    });

    return () => unsub();
  }, [profile, joinedGroupIdsKey, triggerNotification]);

  // Real-time listener for pending join requests on private groups owned by current user
  const ownedPrivateGroupIdsKey = useMemo(
    () =>
      chats
        .filter(
          (c) =>
            c.type === 'group' &&
            c.visibility === 'private' &&
            c.createdBy === profile?.id,
        )
        .map((c) => c.id)
        .sort()
        .join(','),
    [chats, profile?.id],
  );

  useEffect(() => {
    if (!profile || !ownedPrivateGroupIdsKey) return;
    const groupIds = ownedPrivateGroupIdsKey.split(',').filter(Boolean);

    const unsub = subscribeToAdminJoinRequests(groupIds, (chatId, requests, isInitial) => {
      if (isInitial) {
        for (const req of requests) {
          seenJoinReqKeysRef.current.add(`${chatId}:${req.userId}:${req.createdAt}`);
        }
        return;
      }

      const groupName = chatsRef.current.find((c) => c.id === chatId)?.name ?? 'Private group';
      for (const req of requests) {
        const reqKey = `${chatId}:${req.userId}:${req.createdAt}`;
        if (!seenJoinReqKeysRef.current.has(reqKey) && !blockedIdsRef.current.has(req.userId)) {
          seenJoinReqKeysRef.current.add(reqKey);
          triggerNotification({
            chatId,
            kind: 'join_request',
            title: `Join request · ${groupName}`,
            body: `${req.username} wants to join this private group.`,
            senderUsername: req.username,
            senderColor: req.color,
            createdAt: req.createdAt,
          });
        }
      }
    });

    return () => unsub();
  }, [profile, ownedPrivateGroupIdsKey, triggerNotification]);

  const unreadChatIds = useMemo(() => {
    const set = new Set<string>();
    if (!profile) return set;

    for (const chat of chats) {
      if (!chat.lastMessageAt) continue;
      if (!chat.lastSenderId || chat.lastSenderId === profile.id) continue;
      if (blockedUserIds.has(chat.lastSenderId)) continue;
      if (chat.id === activeChatId && screen === 'chat' && !tabHidden) continue;

      const msgMs = new Date(chat.lastMessageAt).getTime();
      const readMs = chat.lastReadAt ? new Date(chat.lastReadAt).getTime() : 0;
      if (msgMs > readMs) {
        set.add(chat.id);
      }
    }
    return set;
  }, [chats, profile, blockedUserIds, activeChatId, screen, tabHidden]);

  // Fetch accurate unread counts for chats with unread messages
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    setUnreadCounts((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, count] of Object.entries(prev)) {
        if (unreadChatIds.has(id)) {
          next[id] = count;
        } else {
          changed = true;
          lastCountedKeyRef.current.delete(id);
        }
      }
      return changed ? next : prev;
    });

    for (const chatId of unreadChatIds) {
      const chat = chats.find((c) => c.id === chatId);
      if (!chat) continue;
      const key = `${chatId}:${chat.lastMessageAt ?? ''}:${chat.lastReadAt ?? ''}`;
      if (lastCountedKeyRef.current.get(chatId) === key) continue;
      lastCountedKeyRef.current.set(chatId, key);

      void fetchUnreadCountForChat(chatId, chat.lastReadAt).then((count) => {
        if (cancelled) return;
        setUnreadCounts((prev) => ({
          ...prev,
          [chatId]: Math.max(1, count),
        }));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [profile, unreadChatIds, chats]);

  // Reflect unread badge in browser tab title
  useEffect(() => {
    const unreadNotifs = notifications.filter((n) => !n.read).length;
    const count = Math.max(unreadChatIds.size, unreadNotifs);
    document.title = count > 0 ? `(${count}) Buddy Chat` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [unreadChatIds.size, notifications]);

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
    setActiveChatId(newChatId);
    setScreen('chat');
  };

  const handleJoinGroup = async (chatId: string) => {
    if (!profile) return;
    await joinGroup(profile, chatId);
    setActiveChatId(chatId);
    setScreen('chat');
  };

  const handleLeaveGroup = async (chatId: string) => {
    if (!profile) return;
    await leaveGroup(profile.id, chatId);
    setActiveChatId((prev) => (prev === chatId ? null : prev));
  };

  const handleStartDm = async (targetUserId: string) => {
    if (!profile) return;
    const dmChatId = await startDm(profile, targetUserId);
    setActiveChatId(dmChatId);
    setScreen('chat');
  };

  const handleSetUsername = async (nextUsername: string) => {
    if (!profile) return;
    const updated = await setCustomUsername(profile, nextUsername);
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

  const handleSetNickname = async (targetUserId: string, nickname: string) => {
    if (!profile) return;
    const clean = await setFriendNickname(profile.id, targetUserId, nickname);
    setNicknames((prev) => ({ ...prev, [targetUserId]: clean }));
  };

  const handleRemoveNickname = async (targetUserId: string) => {
    if (!profile) return;
    await removeFriendNickname(profile.id, targetUserId);
    setNicknames((prev) => {
      const next = { ...prev };
      delete next[targetUserId];
      return next;
    });
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

  const handleOpenNotification = (notif: AppNotification) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)),
    );
    setNotificationToast(null);
    setActiveChatId(notif.chatId);
    setScreen('chat');
  };

  const openProfilePage = (userId: string) => {
    setViewedProfileUserId(userId);
    setScreen('profile');
  };

  if (!authReady || (firebaseUser && bootstrapping && !profile)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-neutral-100 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-base font-semibold tracking-tight">Buddy Chat</p>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
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
        notificationSettings={notificationSettings}
        browserNotifPermission={browserNotifPermission}
        onChangeTheme={setThemePreference}
        onUpdateNotificationSettings={handleUpdateNotificationSettings}
        onRequestBrowserPermission={handleRequestBrowserPermission}
        onSetUsername={handleSetUsername}
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
    <div className="h-dvh-safe w-full bg-slate-50 dark:bg-black text-slate-900 dark:text-neutral-100 flex overflow-hidden">
      {screen === 'profile' && viewedProfileUserId ? (
        <div className="flex-1 h-full overflow-y-auto chat-scroll">
          <ProfilePage
            targetUserId={viewedProfileUserId}
            currentUser={profile}
            nicknames={nicknames}
            isBlocked={blockedUserIds.has(viewedProfileUserId)}
            onBack={() => setScreen('chat')}
            onOpenSettings={() => setScreen('settings')}
            onProfileUpdated={(updated) => setProfile(updated)}
            onSetUsername={handleSetUsername}
            onRotateUsername={handleRotateUsername}
            onSetNickname={handleSetNickname}
            onRemoveNickname={handleRemoveNickname}
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
            } w-full lg:w-92 h-full shrink-0`}
          >
            <Sidebar
              profile={profile}
              chats={chats}
              nicknames={nicknames}
              unreadChatIds={unreadChatIds}
              unreadCounts={unreadCounts}
              notifications={notifications}
              blockedUserIds={blockedUserIds}
              activeChatId={activeChatId}
              loadingChats={loadingChats}
              onSelectChat={(id) => setActiveChatId(id || null)}
              onOpenNotification={handleOpenNotification}
              onMarkAllNotificationsRead={() =>
                setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
              }
              onClearNotifications={() => setNotifications([])}
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
                allChats={chats}
                currentUser={profile}
                nicknames={nicknames}
                blockedUserIds={blockedUserIds}
                typingEnabled={notificationSettings.typingIndicators}
                onChatViewed={handleChatViewed}
                onSelectChat={(id) => setActiveChatId(id || null)}
                onBackMobile={() => setActiveChatId(null)}
                onLeaveGroup={handleLeaveGroup}
                onStartDm={handleStartDm}
                onOpenProfile={openProfilePage}
                onSetNickname={handleSetNickname}
                onRemoveNickname={handleRemoveNickname}
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
                        <p className="text-xs font-medium text-slate-500 dark:text-neutral-400">
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
                        className="min-h-[44px] px-4 py-2 rounded-full border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <UserCircle2 className="w-4 h-4" />
                        <span>Your profile</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreateGroupOpen(true)}
                        disabled={profile.banned}
                        className="min-h-[44px] px-4 py-2 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Create group</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.08] space-y-1.5">
                      <Clock className="w-5 h-5 text-[#2B84F6]" />
                      <h2 className="text-sm font-semibold">24-hour messages</h2>
                      <p className="text-xs text-slate-500 dark:text-neutral-400 leading-relaxed">
                        Messages and attachments automatically clear after 24 hours.
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.08] space-y-1.5">
                      <Lock className="w-5 h-5 text-amber-500" />
                      <h2 className="text-sm font-semibold">Private & public rooms</h2>
                      <p className="text-xs text-slate-500 dark:text-neutral-400 leading-relaxed">
                        Create open rooms or private rooms with admin join approvals.
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.08] space-y-1.5">
                      <ShieldCheck className="w-5 h-5 text-emerald-500" />
                      <h2 className="text-sm font-semibold">View-once & 5 MB files</h2>
                      <p className="text-xs text-slate-500 dark:text-neutral-400 leading-relaxed">
                        Share photos, single-view images, or files up to 5 MB in any chat.
                      </p>
                    </div>
                  </div>

                  {chats.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                        Jump back into a recent chat
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {chats.slice(0, 4).map((c) => {
                          const hasUnread = unreadChatIds.has(c.id);
                          const unreadCount = unreadCounts[c.id] ?? (hasUnread ? 1 : 0);
                          const title =
                            c.type === 'dm'
                              ? getDisplayName(
                                  c.partner?.id,
                                  c.partner?.username ?? 'Direct chat',
                                  nicknames,
                                )
                              : c.name ?? 'Group';
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setActiveChatId(c.id)}
                              className="p-3.5 rounded-2xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.08] hover:border-[#2B84F6]/45 flex items-center gap-3 text-left transition-colors"
                            >
                              <MessageSquare className="w-4 h-4 text-[#2B84F6] shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-semibold truncate">{title}</p>
                                  {hasUnread && (
                                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#2B84F6] text-white text-[11px] font-bold leading-none flex items-center justify-center tabular-nums shrink-0">
                                      {unreadCount > 99 ? '99+' : unreadCount}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-neutral-400 truncate">
                                  {c.lastMessagePreview
                                    ? c.lastMessagePreview
                                    : c.type === 'dm'
                                      ? 'Direct chat'
                                      : c.visibility === 'private'
                                        ? 'Private group'
                                        : 'Public group'}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-neutral-400">
                      Use + New Chat on the left to search anonymous users or join groups.
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

      {notificationToast && (
        <div
          role="status"
          className="fixed top-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-white dark:bg-[#1C1C1E] text-slate-900 dark:text-neutral-100 border border-slate-200 dark:border-white/[0.12] shadow-xl p-3 flex items-start gap-3 message-enter"
        >
          <div className="h-9 w-9 rounded-full bg-[#2B84F6]/15 text-[#2B84F6] flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <button
            type="button"
            onClick={() => handleOpenNotification(notificationToast)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="text-xs font-semibold truncate">{notificationToast.title}</p>
            <p className="text-xs text-slate-500 dark:text-neutral-400 line-clamp-2 mt-0.5">
              {notificationToast.body}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setNotificationToast(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl bg-neutral-900 dark:bg-[#1C1C1E] text-white border border-white/[0.1] text-sm shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
