import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  Hash,
  Home,
  Lock,
  MailOpen,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  fetchMyJoinRequestsMap,
  fetchQuickContacts,
  getDisplayName,
  requestJoinPrivateGroup,
  searchGroups,
  searchUsers,
} from '../lib/api';
import type {
  AppNotification,
  ChatSummary,
  DeliveryStatus,
  GroupSearchResult,
  JoinRequestStatus,
  Profile,
} from '../types';

interface SidebarProps {
  profile: Profile;
  chats: ChatSummary[];
  nicknames: Record<string, string>;
  favoriteUserIds: Set<string>;
  unreadChatIds: Set<string>;
  unreadCounts: Record<string, number>;
  chatDeliveryStatus: Record<string, DeliveryStatus>;
  notifications: AppNotification[];
  blockedUserIds: Set<string>;
  activeChatId: string | null;
  loadingChats: boolean;
  onSelectChat: (chatId: string) => void;
  onMarkChatRead: (chatId: string) => void;
  onOpenNotification: (notif: AppNotification) => void;
  onMarkAllNotificationsRead: () => void;
  onClearNotifications: () => void;
  onJoinGroup: (chatId: string) => Promise<void>;
  onStartDm: (targetUserId: string) => Promise<void>;
  onToggleFavoriteUser: (target: { userId: string; username: string; color?: string }) => Promise<void>;
  onUpdateChatPrefs: (
    chatId: string,
    prefs: {
      isFavorite?: boolean;
      pinned?: boolean;
      muted?: boolean;
      archived?: boolean;
      markedUnread?: boolean;
    },
  ) => Promise<void>;
  onRemoveChat: (chat: ChatSummary) => Promise<void>;
  onOpenCreateGroup: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenSettings: () => void;
  onToast: (message: string) => void;
}

function formatShortTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'now';
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const Sidebar: React.FC<SidebarProps> = ({
  profile,
  chats,
  nicknames,
  favoriteUserIds,
  unreadChatIds,
  unreadCounts,
  chatDeliveryStatus,
  notifications,
  blockedUserIds,
  activeChatId,
  loadingChats,
  onSelectChat,
  onMarkChatRead,
  onOpenNotification,
  onMarkAllNotificationsRead,
  onClearNotifications,
  onJoinGroup,
  onStartDm,
  onToggleFavoriteUser,
  onUpdateChatPrefs,
  onRemoveChat,
  onOpenCreateGroup,
  onOpenProfile,
  onOpenSettings,
  onToast,
}) => {
  const [tab, setTab] = useState<'chats' | 'browse'>('chats');
  const [notifOpen, setNotifOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [rowMenuChatId, setRowMenuChatId] = useState<string | null>(null);
  const [searchBarOpen, setSearchBarOpen] = useState(false);
  const notifPanelRef = useRef<HTMLDivElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);

  const [myChatsQuery, setMyChatsQuery] = useState('');
  const [chatKindFilter, setChatKindFilter] = useState<
    'all' | 'favorites' | 'unread' | 'dms' | 'groups' | 'archived'
  >('all');
  const [browseFilter, setBrowseFilter] = useState<'all' | 'people' | 'groups'>('all');
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<GroupSearchResult[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [quickContacts, setQuickContacts] = useState<Profile[]>([]);
  const [joinRequestMap, setJoinRequestMap] = useState<Record<string, JoinRequestStatus>>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [startingDmId, setStartingDmId] = useState<string | null>(null);

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  useEffect(() => {
    let cancelled = false;
    fetchQuickContacts(profile.id, blockedUserIds).then((list) => {
      if (!cancelled) setQuickContacts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [profile.id, blockedUserIds]);

  useEffect(() => {
    if (!notifOpen && !filterOpen && !rowMenuChatId) return;
    const handleOutside = (e: MouseEvent) => {
      if (notifOpen && notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (filterOpen && filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
      if (rowMenuChatId && rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) {
        setRowMenuChatId(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setFilterOpen(false);
        setRowMenuChatId(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [notifOpen, filterOpen, rowMenuChatId]);

  const memberChatIds = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);

  const existingDmByPartnerId = useMemo(() => {
    const map = new Map<string, string>();
    for (const chat of chats) {
      if (chat.type === 'dm' && chat.partner?.id) {
        map.set(chat.partner.id, chat.id);
      }
    }
    return map;
  }, [chats]);

  // Combine favorite buddies first, then DM partners, then discovered quick contacts without duplicates
  const storyStripUsers = useMemo(() => {
    const seen = new Set<string>();
    const favList: Profile[] = [];
    const regularList: Profile[] = [];

    const pushCandidate = (p: Profile) => {
      if (seen.has(p.id) || blockedUserIds.has(p.id)) return;
      seen.add(p.id);
      if (favoriteUserIds.has(p.id)) {
        favList.push(p);
      } else {
        regularList.push(p);
      }
    };

    for (const chat of chats) {
      if (chat.type === 'dm' && chat.partner) {
        pushCandidate(chat.partner);
      }
    }

    for (const contact of quickContacts) {
      pushCandidate(contact);
    }

    return [...favList, ...regularList].slice(0, 14);
  }, [chats, quickContacts, blockedUserIds, favoriteUserIds]);

  useEffect(() => {
    if (tab !== 'browse') return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const [groupResults, userResults] = await Promise.all([
          browseFilter === 'people'
            ? Promise.resolve([] as GroupSearchResult[])
            : searchGroups(query, memberChatIds),
          browseFilter === 'groups'
            ? Promise.resolve([] as Profile[])
            : searchUsers(query, profile.id, blockedUserIds),
        ]);

        if (cancelled) return;
        setGroups(groupResults);
        setPeople(userResults);

        const privateGroupIds = groupResults
          .filter((g) => g.visibility === 'private' && !g.isMember)
          .map((g) => g.id);

        if (privateGroupIds.length > 0) {
          const reqMap = await fetchMyJoinRequestsMap(privateGroupIds, profile.id);
          if (!cancelled) {
            setJoinRequestMap(reqMap);
          }
        } else if (!cancelled) {
          setJoinRequestMap({});
        }
      } catch (err) {
        if (!cancelled) {
          let message = err instanceof Error ? err.message : 'Search failed.';
          try {
            const parsed = JSON.parse(message) as { error?: string };
            if (parsed?.error) message = parsed.error;
          } catch {
            // keep message
          }
          setSearchError(message);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, browseFilter, query, memberChatIds, profile.id, blockedUserIds]);

  const handleJoinOrRequest = async (group: GroupSearchResult) => {
    if (group.isMember) {
      onSelectChat(group.id);
      return;
    }

    if (group.visibility === 'private') {
      setRequestingId(group.id);
      setSearchError(null);
      try {
        await requestJoinPrivateGroup(profile, group.id);
        setJoinRequestMap((prev) => ({ ...prev, [group.id]: 'pending' }));
        onToast(`Join request sent to ${group.name} admin.`);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Could not send join request.');
      } finally {
        setRequestingId(null);
      }
      return;
    }

    setJoiningId(group.id);
    setSearchError(null);
    try {
      await onJoinGroup(group.id);
      setTab('chats');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Could not join group.');
    } finally {
      setJoiningId(null);
    }
  };

  const handleDm = async (targetUser: Profile) => {
    const existingId = existingDmByPartnerId.get(targetUser.id);
    if (existingId) {
      onSelectChat(existingId);
      setTab('chats');
      return;
    }

    setStartingDmId(targetUser.id);
    setSearchError(null);
    try {
      await onStartDm(targetUser.id);
      setTab('chats');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Could not start direct message.');
    } finally {
      setStartingDmId(null);
    }
  };

  const activeChatCount = useMemo(
    () => chats.filter((c) => !c.archived).length,
    [chats],
  );
  const archivedChatCount = useMemo(
    () => chats.filter((c) => c.archived).length,
    [chats],
  );
  const favoriteChatCount = useMemo(
    () =>
      chats.filter(
        (c) =>
          !c.archived &&
          (Boolean(c.isFavorite) || Boolean(c.partner && favoriteUserIds.has(c.partner.id))),
      ).length,
    [chats, favoriteUserIds],
  );

  const filteredChats = useMemo(() => {
    const q = myChatsQuery.trim().toLowerCase();
    return chats.filter((chat) => {
      if (chatKindFilter === 'archived') {
        if (!chat.archived) return false;
      } else if (chat.archived) {
        return false;
      }

      if (chatKindFilter === 'favorites') {
        const isFav =
          Boolean(chat.isFavorite) ||
          Boolean(chat.partner && favoriteUserIds.has(chat.partner.id));
        if (!isFav) return false;
      }
      if (chatKindFilter === 'unread' && !unreadChatIds.has(chat.id)) return false;
      if (chatKindFilter === 'groups' && chat.type !== 'group') return false;
      if (chatKindFilter === 'dms' && chat.type !== 'dm') return false;
      if (!q) return true;
      if (chat.type === 'dm') {
        const displayName = getDisplayName(
          chat.partner?.id,
          chat.partner?.username ?? 'Direct Message',
          nicknames,
        );
        const handle = chat.partner?.username ?? '';
        return (
          displayName.toLowerCase().includes(q) || handle.toLowerCase().includes(q)
        );
      }
      return (chat.name ?? 'Group').toLowerCase().includes(q);
    });
  }, [chats, chatKindFilter, myChatsQuery, nicknames, favoriteUserIds, unreadChatIds]);

  const showPeopleSection = browseFilter !== 'groups';
  const showGroupsSection = browseFilter !== 'people';
  const hasAnyResults =
    (showPeopleSection && people.length > 0) || (showGroupsSection && groups.length > 0);

  return (
    <aside className="h-full flex flex-col bg-white dark:bg-[#121212] border-r border-slate-200/80 dark:border-white/[0.08] relative">
      {/* Top Bar */}
      <div className="px-4 sm:px-5 h-15 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            setTab('chats');
            onSelectChat('');
          }}
          className="text-xl font-bold tracking-tight whitespace-nowrap shrink-0 text-slate-900 dark:text-white hover:text-[#2B84F6] transition-colors"
        >
          Buddy Chat
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (tab === 'browse') {
                setTab('chats');
                setSearchBarOpen(true);
              } else {
                setSearchBarOpen((prev) => !prev);
              }
            }}
            aria-label="Search chats"
            title="Search chats"
            className={`min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center transition-colors ${
              searchBarOpen
                ? 'bg-[#2B84F6]/12 text-[#2B84F6]'
                : 'text-slate-700 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
            }`}
          >
            <Search className="w-5 h-5" />
          </button>

          <div className="relative" ref={notifPanelRef}>
            <button
              type="button"
              onClick={() => setNotifOpen((prev) => !prev)}
              aria-label={`Notifications${unreadNotifCount > 0 ? ` (${unreadNotifCount} unread)` : ''}`}
              aria-expanded={notifOpen}
              title="Notifications"
              className={`relative min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center transition-colors ${
                notifOpen
                  ? 'bg-[#2B84F6]/12 text-[#2B84F6]'
                  : 'text-slate-700 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
              }`}
            >
              <Bell className="w-5 h-5" />
              {unreadNotifCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-[#2B84F6] text-white text-[10px] font-bold leading-none flex items-center justify-center tabular-nums ring-2 ring-white dark:ring-[#121212]">
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 z-40 w-76 sm:w-80 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] shadow-xl overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tabular-nums">
                    Notifications {unreadNotifCount > 0 ? `(${unreadNotifCount})` : ''}
                  </span>
                  <div className="flex items-center gap-1">
                    {unreadNotifCount > 0 && (
                      <button
                        type="button"
                        onClick={onMarkAllNotificationsRead}
                        title="Mark all read"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#2B84F6] hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={onClearNotifications}
                        title="Clear notifications"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      aria-label="Close notifications"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center space-y-1">
                    <p className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                      You're all caught up
                    </p>
                    <p className="text-xs text-slate-400 dark:text-neutral-500">
                      New messages and private group requests will appear here.
                    </p>
                  </div>
                ) : (
                  <ul className="max-h-80 overflow-y-auto chat-scroll divide-y divide-slate-100 dark:divide-white/[0.06]">
                    {notifications.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onOpenNotification(item);
                            setNotifOpen(false);
                          }}
                          className={`w-full px-3.5 py-2.5 text-left flex items-start gap-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04] ${
                            !item.read ? 'bg-[#2B84F6]/[0.06]' : ''
                          }`}
                        >
                          {item.kind === 'join_request' ? (
                            <div className="h-8 w-8 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                              <UserPlus className="w-4 h-4" />
                            </div>
                          ) : item.senderUsername ? (
                            <div className="shrink-0 mt-0.5">
                              <Avatar
                                username={item.senderUsername}
                                color={item.senderColor ?? '#2B84F6'}
                                size="sm"
                              />
                            </div>
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-[#2B84F6]/15 text-[#2B84F6] flex items-center justify-center shrink-0 mt-0.5">
                              <Bell className="w-4 h-4" />
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p
                                className={`text-xs truncate ${
                                  !item.read
                                    ? 'font-semibold text-slate-900 dark:text-white'
                                    : 'font-medium text-slate-700 dark:text-neutral-200'
                                }`}
                              >
                                {item.title}
                              </p>
                              <span className="text-[11px] text-slate-400 dark:text-neutral-500 tabular-nums shrink-0">
                                {formatShortTime(item.createdAt)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-neutral-400 line-clamp-2 break-words [overflow-wrap:anywhere] mt-0.5">
                              {item.body}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              {item.read ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#2B84F6]">
                                  <CheckCheck className="w-3.5 h-3.5 text-[#2B84F6]" aria-hidden="true" />
                                  <span>Seen</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-neutral-300">
                                  <CheckCheck className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-400" aria-hidden="true" />
                                  <span>Delivered · New</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {!item.read && (
                            <span className="w-2 h-2 rounded-full bg-[#2B84F6] shrink-0 mt-2" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open settings"
            title="Settings"
            className="min-h-[40px] min-w-[40px] rounded-full text-slate-700 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Expandable Search Bar when toggled in Chats tab */}
      {tab === 'chats' && searchBarOpen && (
        <div className="px-4 pb-3 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 dark:text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={myChatsQuery}
              onChange={(e) => setMyChatsQuery(e.target.value)}
              placeholder="Filter your conversations..."
              autoFocus
              className="w-full min-h-[40px] pl-10 pr-4 py-1.5 rounded-2xl bg-slate-100 dark:bg-black border border-transparent focus:border-[#2B84F6]/40 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
            />
          </div>
        </div>
      )}

      {/* Main Scrollable Content (with extra bottom padding for floating dock) */}
      <div className="flex-1 overflow-y-auto chat-scroll pb-24">
        {tab === 'chats' ? (
          <>
            {/* Quick Buddies / Story-Style Horizontal Strip */}
            <div className="px-4 sm:px-5 pt-1 pb-4">
              <div className="flex items-start gap-3.5 overflow-x-auto chat-scroll pb-1">
                <button
                  type="button"
                  onClick={() => setTab('browse')}
                  className="flex flex-col items-center gap-1.5 shrink-0 group"
                  title="Find people or groups"
                >
                  <span className="h-13 w-13 rounded-full border-2 border-dashed border-slate-300 dark:border-white/[0.22] group-hover:border-[#2B84F6] text-slate-500 dark:text-neutral-400 group-hover:text-[#2B84F6] flex items-center justify-center transition-colors">
                    <Plus className="w-5 h-5" />
                  </span>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-neutral-400 max-w-[56px] truncate">
                    Find
                  </span>
                </button>

                {storyStripUsers.map((person) => {
                  const customNick = nicknames[person.id]?.trim();
                  const shortLabel = customNick || person.username.replace(/\d+$/, '');
                  const fullLabel = getDisplayName(person.id, person.username, nicknames);
                  const isFav = favoriteUserIds.has(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      disabled={startingDmId === person.id || profile.banned}
                      onClick={() => handleDm(person)}
                      title={`Chat with ${fullLabel}`}
                      className="flex flex-col items-center gap-1.5 shrink-0 group disabled:opacity-50"
                    >
                      <span className="relative rounded-full p-0.5 ring-2 ring-transparent group-hover:ring-[#2B84F6]/60 transition-all">
                        <Avatar
                          username={person.username}
                          color={person.color}
                          avatarUrl={person.avatarUrl}
                          size="lg"
                        />
                        {isFav && (
                          <span
                            title="Favorite buddy"
                            className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-amber-500 text-white ring-2 ring-white dark:ring-[#121212] flex items-center justify-center"
                          >
                            <Star className="w-2.5 h-2.5 fill-current" />
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] font-medium text-slate-600 dark:text-neutral-300 max-w-[58px] truncate">
                        {shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section Header: Chats + Overflow/Filter */}
            <div className="px-4 sm:px-5 pb-2 flex items-center justify-between gap-2 relative" ref={filterMenuRef}>
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                  {chatKindFilter === 'archived'
                    ? 'Archived'
                    : chatKindFilter === 'favorites'
                      ? 'Favorites'
                      : 'Chats'}
                </h2>
                {chatKindFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setChatKindFilter('all')}
                    className="text-xs font-medium text-[#2B84F6] hover:underline truncate"
                  >
                    {chatKindFilter === 'dms'
                      ? 'DMs only'
                      : chatKindFilter === 'groups'
                        ? 'Groups only'
                        : chatKindFilter === 'unread'
                          ? 'Unread'
                          : chatKindFilter === 'favorites'
                            ? 'Starred'
                            : 'Archived'}{' '}
                    · Clear
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onOpenCreateGroup}
                  disabled={profile.banned}
                  title="Create group"
                  className="min-h-[34px] px-2.5 py-1 rounded-full text-xs font-semibold text-[#2B84F6] hover:bg-[#2B84F6]/10 inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Group</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterOpen((prev) => !prev)}
                  aria-label="Filter conversations"
                  aria-expanded={filterOpen}
                  className="min-h-[34px] min-w-[34px] rounded-full flex items-center justify-center text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>

              {filterOpen && (
                <div className="absolute right-4 top-9 z-30 w-48 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] shadow-xl p-1.5 space-y-0.5">
                  {([
                    { key: 'all', label: `All active (${activeChatCount})` },
                    { key: 'favorites', label: `Favorites (${favoriteChatCount})` },
                    { key: 'unread', label: `Unread (${unreadChatIds.size})` },
                    { key: 'dms', label: 'Direct chats' },
                    { key: 'groups', label: 'Groups only' },
                    { key: 'archived', label: `Archived (${archivedChatCount})` },
                  ] as const).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        setChatKindFilter(opt.key);
                        setFilterOpen(false);
                      }}
                      className={`w-full px-3 py-2 rounded-xl text-xs font-medium text-left transition-colors ${
                        chatKindFilter === opt.key
                          ? 'bg-[#2B84F6]/12 text-[#2B84F6] font-semibold'
                          : 'text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.05]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loadingChats ? (
              <div className="px-4 space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-2xl bg-slate-100 dark:bg-white/[0.04] animate-pulse"
                  />
                ))}
              </div>
            ) : chats.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
                  No conversations yet
                </p>
                <p className="text-xs text-slate-500 dark:text-neutral-400 leading-relaxed">
                  Tap a buddy above or press + New Chat below to start a direct chat or join a group.
                </p>
              </div>
            ) : filteredChats.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-neutral-400">
                No matching chats.
              </p>
            ) : (
              <ul className="px-2.5 sm:px-3 space-y-0.5">
                {filteredChats.map((chat) => {
                  const isActive = chat.id === activeChatId;
                  const isUnread = unreadChatIds.has(chat.id);
                  const unreadCount = unreadCounts[chat.id] ?? (isUnread ? 1 : 0);
                  const isDm = chat.type === 'dm';
                  const isPrivate = chat.visibility === 'private';
                  const title = isDm
                    ? getDisplayName(
                        chat.partner?.id,
                        chat.partner?.username ?? 'Direct Message',
                        nicknames,
                      )
                    : chat.name ?? 'Group';

                  const sentByMe = chat.lastSenderId === profile.id;
                  const senderDisplayName = chat.lastSenderUsername
                    ? getDisplayName(chat.lastSenderId, chat.lastSenderUsername, nicknames)
                    : null;

                  const previewText = chat.lastMessagePreview
                    ? sentByMe
                      ? chat.lastMessagePreview
                      : !isDm && senderDisplayName
                        ? `${senderDisplayName}: ${chat.lastMessagePreview}`
                        : chat.lastMessagePreview
                    : isDm
                      ? 'Direct chat · 24h'
                      : isPrivate
                        ? 'Private group · 24h'
                        : 'Public group · 24h';

                  const timeLabel = formatShortTime(chat.lastMessageAt);
                  const isFav =
                    Boolean(chat.isFavorite) ||
                    Boolean(chat.partner && favoriteUserIds.has(chat.partner.id));
                  const isRowMenuOpen = rowMenuChatId === chat.id;

                  return (
                    <li key={chat.id} className="relative group/row">
                      <div
                        className={`w-full min-h-[68px] px-3 py-2.5 rounded-2xl flex items-center gap-3 transition-colors ${
                          isActive
                            ? 'bg-[#2B84F6]/10 dark:bg-[#2B84F6]/15 text-slate-900 dark:text-white'
                            : 'hover:bg-slate-50 dark:hover:bg-white/[0.04] text-slate-800 dark:text-neutral-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectChat(chat.id)}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left"
                        >
                          {isDm ? (
                            <Avatar
                              username={chat.partner?.username ?? 'DM'}
                              color={chat.partner?.color ?? '#2B84F6'}
                              avatarUrl={chat.partner?.avatarUrl}
                              size="md"
                            />
                          ) : (
                            <div
                              className={`h-11 w-11 shrink-0 rounded-full flex items-center justify-center ${
                                isPrivate
                                  ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                                  : 'bg-slate-100 dark:bg-[#242426] text-slate-600 dark:text-neutral-300'
                              }`}
                            >
                              {isPrivate ? (
                                <Lock className="w-4 h-4" />
                              ) : (
                                <Hash className="w-4 h-4" />
                              )}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <p
                                  className={`text-[15px] truncate ${
                                    isUnread ? 'font-bold text-slate-900 dark:text-white' : 'font-semibold'
                                  }`}
                                >
                                  {title}
                                </p>
                                {chat.pinned && (
                                  <Pin className="w-3 h-3 text-[#2B84F6] shrink-0" aria-label="Pinned" />
                                )}
                                {isFav && (
                                  <Star className="w-3 h-3 text-amber-500 fill-current shrink-0" aria-label="Favorite" />
                                )}
                                {chat.muted && (
                                  <BellOff className="w-3 h-3 text-slate-400 dark:text-neutral-500 shrink-0" aria-label="Muted" />
                                )}
                              </div>
                              {timeLabel && (
                                <span
                                  className={`text-xs tabular-nums shrink-0 ${
                                    isUnread
                                      ? 'font-semibold text-[#2B84F6]'
                                      : 'text-slate-400 dark:text-neutral-500'
                                  }`}
                                >
                                  {timeLabel}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <p
                                className={`text-xs truncate flex items-center gap-1 min-w-0 ${
                                  isUnread
                                    ? 'font-medium text-slate-800 dark:text-neutral-200'
                                    : 'text-slate-500 dark:text-neutral-400'
                                }`}
                              >
                                {sentByMe && chat.lastMessagePreview && (
                                  chatDeliveryStatus[chat.id] === 'seen' ? (
                                    <CheckCheck
                                      className="w-3.5 h-3.5 text-[#2B84F6] shrink-0"
                                      aria-label="Seen"
                                    />
                                  ) : chatDeliveryStatus[chat.id] === 'delivered' ? (
                                    <CheckCheck
                                      className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-500 shrink-0"
                                      aria-label="Delivered"
                                    />
                                  ) : (
                                    <Check
                                      className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-500 shrink-0"
                                      aria-label="Sent"
                                    />
                                  )
                                )}
                                <span className="truncate">{previewText}</span>
                              </p>

                              {isUnread && (
                                <span
                                  aria-label={`${unreadCount} unread messages`}
                                  className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#2B84F6] text-white text-[11px] font-bold leading-none flex items-center justify-center tabular-nums shrink-0"
                                >
                                  {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRowMenuChatId((prev) => (prev === chat.id ? null : chat.id));
                          }}
                          aria-label={`Options for ${title}`}
                          aria-expanded={isRowMenuOpen}
                          className={`min-h-[34px] min-w-[34px] rounded-full flex items-center justify-center text-slate-400 dark:text-neutral-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/[0.08] transition-all shrink-0 ${
                            isRowMenuOpen
                              ? 'opacity-100 bg-slate-200/70 dark:bg-white/[0.08]'
                              : 'opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100'
                          }`}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>

                      {isRowMenuOpen && (
                        <div
                          ref={rowMenuRef}
                          className="absolute right-3 top-14 z-30 w-52 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] shadow-xl p-1.5 space-y-0.5 message-enter"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setRowMenuChatId(null);
                              void onUpdateChatPrefs(chat.id, { pinned: !chat.pinned });
                            }}
                            className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                          >
                            <Pin className="w-3.5 h-3.5 text-[#2B84F6]" />
                            <span>{chat.pinned ? 'Unpin chat' : 'Pin to top'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setRowMenuChatId(null);
                              if (isDm && chat.partner) {
                                void onToggleFavoriteUser({
                                  userId: chat.partner.id,
                                  username: chat.partner.username,
                                  color: chat.partner.color,
                                });
                              } else {
                                void onUpdateChatPrefs(chat.id, { isFavorite: !chat.isFavorite });
                              }
                            }}
                            className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                isFav ? 'text-amber-500 fill-current' : 'text-amber-500'
                              }`}
                            />
                            <span>{isFav ? 'Remove favorite' : 'Add to favorites'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setRowMenuChatId(null);
                              void onUpdateChatPrefs(chat.id, { muted: !chat.muted });
                            }}
                            className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                          >
                            <BellOff className="w-3.5 h-3.5 text-slate-500 dark:text-neutral-400" />
                            <span>{chat.muted ? 'Unmute alerts' : 'Mute alerts'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setRowMenuChatId(null);
                              if (isUnread) {
                                onMarkChatRead(chat.id);
                              } else {
                                void onUpdateChatPrefs(chat.id, { markedUnread: true });
                              }
                            }}
                            className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                          >
                            <MailOpen className="w-3.5 h-3.5 text-slate-500 dark:text-neutral-400" />
                            <span>{isUnread ? 'Mark as read' : 'Mark as unread'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setRowMenuChatId(null);
                              void onUpdateChatPrefs(chat.id, { archived: !chat.archived });
                            }}
                            className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                          >
                            <Archive className="w-3.5 h-3.5 text-slate-500 dark:text-neutral-400" />
                            <span>{chat.archived ? 'Unarchive chat' : 'Archive chat'}</span>
                          </button>

                          <div className="my-1 border-t border-slate-100 dark:border-white/[0.08]" />

                          <button
                            type="button"
                            onClick={() => {
                              setRowMenuChatId(null);
                              void onRemoveChat(chat);
                            }}
                            className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{chat.type === 'group' ? 'Leave group' : 'Remove chat'}</span>
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <div className="p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold tracking-tight">New Chat & Discover</h2>
              <button
                type="button"
                onClick={onOpenCreateGroup}
                disabled={profile.banned}
                className="min-h-[34px] px-3 py-1 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create group</span>
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 dark:text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search anonymous usernames or groups..."
                className="w-full min-h-[42px] pl-10 pr-4 py-2 rounded-2xl bg-slate-100 dark:bg-black border border-transparent focus:border-[#2B84F6]/40 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
              />
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-black">
              {(['all', 'people', 'groups'] as const).map((filterKey) => (
                <button
                  key={filterKey}
                  type="button"
                  onClick={() => setBrowseFilter(filterKey)}
                  className={`min-h-[34px] px-2 py-1 rounded-xl text-xs font-semibold capitalize transition-colors whitespace-nowrap ${
                    browseFilter === filterKey
                      ? 'bg-white dark:bg-[#1C1C1E] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-200'
                  }`}
                >
                  {filterKey}
                </button>
              ))}
            </div>

            {searchError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400 px-1">
                {searchError}
              </p>
            )}

            {searching ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-14 rounded-2xl bg-slate-100 dark:bg-white/[0.04] animate-pulse"
                  />
                ))}
              </div>
            ) : !hasAnyResults ? (
              <div className="py-8 text-center space-y-1.5">
                <p className="text-sm font-semibold text-slate-600 dark:text-neutral-300">
                  No matching results
                </p>
                <p className="text-xs text-slate-500 dark:text-neutral-400">
                  Try another anonymous handle or group name.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {showPeopleSection && people.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400 px-1 tabular-nums">
                      People ({people.length})
                    </p>
                    <ul className="space-y-1.5">
                      {people.map((person) => {
                        const hasDm = existingDmByPartnerId.has(person.id);
                        const displayName = getDisplayName(person.id, person.username, nicknames);
                        const hasNick = Boolean(nicknames[person.id]?.trim());
                        return (
                          <li
                            key={person.id}
                            className="p-2.5 rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/60 dark:bg-[#1C1C1E]/60 flex items-center justify-between gap-2.5"
                          >
                            <button
                              type="button"
                              onClick={() => onOpenProfile(person.id)}
                              className="flex items-center gap-2.5 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
                              title={`View ${person.username}'s profile`}
                            >
                              <Avatar
                                username={person.username}
                                color={person.color}
                                avatarUrl={person.avatarUrl}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">{displayName}</p>
                                {(hasNick || person.bio) && (
                                  <p className="text-xs text-slate-500 dark:text-neutral-400 truncate">
                                    {hasNick
                                      ? `@${person.username}${person.bio ? ` · ${person.bio}` : ''}`
                                      : person.bio}
                                  </p>
                                )}
                              </div>
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  void onToggleFavoriteUser({
                                    userId: person.id,
                                    username: person.username,
                                    color: person.color,
                                  })
                                }
                                aria-label={
                                  favoriteUserIds.has(person.id)
                                    ? `Remove ${displayName} from favorites`
                                    : `Add ${displayName} to favorites`
                                }
                                title={
                                  favoriteUserIds.has(person.id)
                                    ? 'Remove from favorites'
                                    : 'Add to favorites'
                                }
                                className={`min-h-[36px] min-w-[36px] rounded-full border flex items-center justify-center transition-colors ${
                                  favoriteUserIds.has(person.id)
                                    ? 'border-amber-500/40 bg-amber-500/12 text-amber-500'
                                    : 'border-slate-200 dark:border-white/[0.1] text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                                }`}
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${
                                    favoriteUserIds.has(person.id) ? 'fill-current' : ''
                                  }`}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDm(person)}
                                disabled={startingDmId === person.id || profile.banned}
                                className={`min-h-[36px] px-3.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                                  hasDm
                                    ? 'bg-slate-200 dark:bg-white/[0.08] text-slate-800 dark:text-neutral-100 hover:bg-slate-300 dark:hover:bg-white/[0.14]'
                                    : 'bg-[#2B84F6] hover:bg-[#1D74E8] text-white disabled:opacity-50'
                                }`}
                              >
                                <MessageSquarePlus className="w-3.5 h-3.5" />
                                <span>
                                  {startingDmId === person.id
                                    ? 'Opening...'
                                    : hasDm
                                      ? 'Open'
                                      : 'Chat'}
                                </span>
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {showGroupsSection && groups.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400 px-1 tabular-nums">
                      Groups ({groups.length})
                    </p>
                    <ul className="space-y-2">
                      {groups.map((group) => {
                        const reqStatus = joinRequestMap[group.id];
                        const isPrivate = group.visibility === 'private';
                        const isPending = isPrivate && !group.isMember && reqStatus === 'pending';

                        return (
                          <li
                            key={group.id}
                            className="p-3 rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/60 dark:bg-[#1C1C1E]/60 space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  {isPrivate ? (
                                    <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  ) : (
                                    <Hash className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-500 shrink-0" />
                                  )}
                                  <h3 className="text-sm font-semibold truncate">{group.name}</h3>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-neutral-400 inline-flex items-center gap-1.5 tabular-nums mt-0.5">
                                  <Users className="w-3 h-3" />
                                  <span>
                                    {group.memberCount}{' '}
                                    {group.memberCount === 1 ? 'member' : 'members'}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{isPrivate ? 'Private' : 'Public'}</span>
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleJoinOrRequest(group)}
                                disabled={
                                  joiningId === group.id ||
                                  requestingId === group.id ||
                                  isPending ||
                                  (!group.isMember && profile.banned)
                                }
                                className={`min-h-[36px] px-3.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                                  group.isMember
                                    ? 'bg-slate-200 dark:bg-white/[0.08] text-slate-800 dark:text-neutral-100 hover:bg-slate-300 dark:hover:bg-white/[0.14]'
                                    : isPending
                                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 cursor-default'
                                      : isPrivate
                                        ? 'bg-slate-900 dark:bg-white/[0.12] hover:bg-slate-800 dark:hover:bg-white/[0.2] text-white disabled:opacity-50'
                                        : 'bg-[#2B84F6] hover:bg-[#1D74E8] text-white disabled:opacity-50'
                                }`}
                              >
                                {isPending && <Clock className="w-3.5 h-3.5" />}
                                <span>
                                  {joiningId === group.id
                                    ? 'Joining...'
                                    : requestingId === group.id
                                      ? 'Sending...'
                                      : group.isMember
                                        ? 'Open'
                                        : isPending
                                          ? 'Requested'
                                          : isPrivate
                                            ? 'Request'
                                            : 'Join'}
                                </span>
                              </button>
                            </div>
                            {group.description && (
                              <p className="text-xs text-slate-600 dark:text-neutral-400 line-clamp-2">
                                {group.description}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Capsule Bottom Navigation Dock (matching mockup) */}
      <div className="pointer-events-none absolute bottom-3.5 left-4 right-4 z-20 flex justify-center">
        <nav
          aria-label="Primary navigation"
          className="pointer-events-auto w-full max-w-[300px] rounded-full bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-md border border-slate-200/90 dark:border-white/[0.1] shadow-lg shadow-slate-900/[0.08] px-2.5 py-1.5 flex items-center justify-between gap-2"
        >
          <button
            type="button"
            onClick={() => {
              setTab('chats');
              onSelectChat('');
            }}
            aria-label="Chats home"
            title="Chats"
            className={`min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center transition-colors ${
              tab === 'chats'
                ? 'text-slate-900 dark:text-white bg-slate-100 dark:bg-white/[0.08]'
                : 'text-slate-500 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Home className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setTab((prev) => (prev === 'browse' ? 'chats' : 'browse'))}
            className="min-h-[44px] px-5 rounded-full bg-slate-900 dark:bg-[#2B84F6] hover:bg-slate-800 dark:hover:bg-[#1D74E8] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>{tab === 'browse' ? 'Back to Chats' : 'New Chat'}</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenProfile(profile.id)}
            aria-label="Your profile"
            title={`${profile.username} profile`}
            className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors"
          >
            {profile.avatarUrl ? (
              <Avatar
                username={profile.username}
                color={profile.color}
                avatarUrl={profile.avatarUrl}
                size="xs"
              />
            ) : (
              <User className="w-5 h-5" />
            )}
          </button>
        </nav>
      </div>
    </aside>
  );
};
