import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Hash,
  Lock,
  MessageSquarePlus,
  Plus,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  fetchMyJoinRequestsMap,
  requestJoinPrivateGroup,
  searchGroups,
  searchUsers,
} from '../lib/api';
import type {
  ChatSummary,
  GroupSearchResult,
  JoinRequestStatus,
  Profile,
} from '../types';

interface SidebarProps {
  profile: Profile;
  chats: ChatSummary[];
  blockedUserIds: Set<string>;
  activeChatId: string | null;
  loadingChats: boolean;
  onSelectChat: (chatId: string) => void;
  onJoinGroup: (chatId: string) => Promise<void>;
  onStartDm: (targetUserId: string) => Promise<void>;
  onOpenCreateGroup: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenSettings: () => void;
  onToast: (message: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  profile,
  chats,
  blockedUserIds,
  activeChatId,
  loadingChats,
  onSelectChat,
  onJoinGroup,
  onStartDm,
  onOpenCreateGroup,
  onOpenProfile,
  onOpenSettings,
  onToast,
}) => {
  const [tab, setTab] = useState<'chats' | 'browse'>('chats');
  const [myChatsQuery, setMyChatsQuery] = useState('');
  const [chatKindFilter, setChatKindFilter] = useState<'all' | 'groups' | 'dms'>('all');
  const [browseFilter, setBrowseFilter] = useState<'all' | 'people' | 'groups'>('all');
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<GroupSearchResult[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [joinRequestMap, setJoinRequestMap] = useState<Record<string, JoinRequestStatus>>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [startingDmId, setStartingDmId] = useState<string | null>(null);

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

  const filteredChats = useMemo(() => {
    const q = myChatsQuery.trim().toLowerCase();
    return chats.filter((chat) => {
      if (chatKindFilter === 'groups' && chat.type !== 'group') return false;
      if (chatKindFilter === 'dms' && chat.type !== 'dm') return false;
      if (!q) return true;
      const title =
        chat.type === 'dm'
          ? chat.partner?.username ?? 'Direct Message'
          : chat.name ?? 'Group';
      return title.toLowerCase().includes(q);
    });
  }, [chats, chatKindFilter, myChatsQuery]);

  const showPeopleSection = browseFilter !== 'groups';
  const showGroupsSection = browseFilter !== 'people';
  const hasAnyResults =
    (showPeopleSection && people.length > 0) || (showGroupsSection && groups.length > 0);

  return (
    <aside className="h-full flex flex-col bg-white dark:bg-[#111622] border-r border-slate-200 dark:border-white/[0.08]">
      <div className="px-4 h-14 flex items-center justify-between gap-3 border-b border-slate-200 dark:border-white/[0.08] shrink-0">
        <button
          type="button"
          onClick={() => onSelectChat('')}
          className="text-base font-bold tracking-tight whitespace-nowrap shrink-0 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          Buddy Chat
        </button>
        <button
          type="button"
          onClick={onOpenCreateGroup}
          disabled={profile.banned}
          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Create group</span>
        </button>
      </div>

      <div className="p-3 border-b border-slate-200 dark:border-white/[0.08] shrink-0">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0B0E14]">
          <button
            type="button"
            onClick={() => setTab('chats')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap tabular-nums ${
              tab === 'chats'
                ? 'bg-white dark:bg-[#161C2C] text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            My chats ({chats.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('browse')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'browse'
                ? 'bg-white dark:bg-[#161C2C] text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Discover
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto chat-scroll">
        {tab === 'chats' ? (
          loadingChats ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-slate-100 dark:bg-white/[0.04] animate-pulse"
                />
              ))}
            </div>
          ) : chats.length === 0 ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                No conversations yet
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Search for anonymous users to direct chat, browse public or private groups, or create a new room.
              </p>
              <button
                type="button"
                onClick={() => setTab('browse')}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 dark:border-white/[0.1] hover:bg-slate-50 dark:hover:bg-white/[0.04] text-xs font-semibold transition-colors"
              >
                Explore users & groups
              </button>
            </div>
          ) : (
            <div className="p-2.5 space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={myChatsQuery}
                  onChange={(e) => setMyChatsQuery(e.target.value)}
                  placeholder="Filter chats..."
                  className="w-full min-h-[38px] pl-9 pr-3 py-1.5 rounded-xl bg-slate-100 dark:bg-[#0B0E14] border border-slate-200 dark:border-white/[0.08] text-base sm:text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0B0E14]">
                {([
                  { key: 'all', label: 'All' },
                  { key: 'dms', label: 'DMs' },
                  { key: 'groups', label: 'Groups' },
                ] as const).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setChatKindFilter(item.key)}
                    className={`min-h-[32px] px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      chatKindFilter === item.key
                        ? 'bg-white dark:bg-[#161C2C] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {filteredChats.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No matching chats in this filter.
                </p>
              ) : (
                <ul className="space-y-1">
                  {filteredChats.map((chat) => {
                    const isActive = chat.id === activeChatId;
                    const isDm = chat.type === 'dm';
                    const isPrivate = chat.visibility === 'private';
                    const title = isDm
                      ? chat.partner?.username ?? 'Direct Message'
                      : chat.name ?? 'Group';

                    return (
                      <li key={chat.id}>
                        <button
                          type="button"
                          onClick={() => onSelectChat(chat.id)}
                          className={`w-full min-h-[58px] px-3 py-2.5 rounded-xl flex items-center gap-3 text-left transition-colors ${
                            isActive
                              ? 'bg-indigo-600/12 dark:bg-indigo-500/15 text-slate-900 dark:text-white'
                              : 'hover:bg-slate-100 dark:hover:bg-white/[0.04] text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {isDm ? (
                            <Avatar
                              username={chat.partner?.username ?? 'DM'}
                              color={chat.partner?.color ?? '#6366F1'}
                              avatarUrl={chat.partner?.avatarUrl}
                              size="md"
                            />
                          ) : (
                            <div
                              className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${
                                isPrivate
                                  ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                                  : 'bg-slate-200 dark:bg-[#1B2336] text-slate-600 dark:text-slate-300'
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
                            <p className="text-sm font-semibold truncate">{title}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {isDm
                                ? 'Direct chat · 24h'
                                : isPrivate
                                  ? 'Private group · 24h'
                                  : 'Public group · 24h'}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )
        ) : (
          <div className="p-3 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search usernames or groups..."
                className="w-full min-h-[42px] pl-10 pr-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#0B0E14] border border-slate-200 dark:border-white/[0.08] text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0B0E14]">
              {(['all', 'people', 'groups'] as const).map((filterKey) => (
                <button
                  key={filterKey}
                  type="button"
                  onClick={() => setBrowseFilter(filterKey)}
                  className={`min-h-[34px] px-2 py-1 rounded-lg text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                    browseFilter === filterKey
                      ? 'bg-white dark:bg-[#161C2C] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                    className="h-14 rounded-xl bg-slate-100 dark:bg-white/[0.04] animate-pulse"
                  />
                ))}
              </div>
            ) : !hasAnyResults ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  No matching results
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Try another username or group name.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {showPeopleSection && people.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1 tabular-nums">
                      People ({people.length})
                    </p>
                    <ul className="space-y-1.5">
                      {people.map((person) => {
                        const hasDm = existingDmByPartnerId.has(person.id);
                        return (
                          <li
                            key={person.id}
                            className="p-2.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50/70 dark:bg-[#0B0E14]/60 flex items-center justify-between gap-2.5"
                          >
                            <button
                              type="button"
                              onClick={() => onOpenProfile(person.id)}
                              className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-lg hover:opacity-80 transition-opacity"
                              title={`View ${person.username}'s profile`}
                            >
                              <Avatar
                                username={person.username}
                                color={person.color}
                                avatarUrl={person.avatarUrl}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">
                                  {person.username}
                                </p>
                                {person.bio && (
                                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                    {person.bio}
                                  </p>
                                )}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDm(person)}
                              disabled={startingDmId === person.id || profile.banned}
                              className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                                hasDm
                                  ? 'bg-slate-200 dark:bg-white/[0.08] text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-white/[0.14]'
                                  : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
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
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {showGroupsSection && groups.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1 tabular-nums">
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
                            className="p-3 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50/70 dark:bg-[#0B0E14]/60 space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  {isPrivate ? (
                                    <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  ) : (
                                    <Hash className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  )}
                                  <h3 className="text-sm font-semibold truncate">{group.name}</h3>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5 tabular-nums mt-0.5">
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
                                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                                  group.isMember
                                    ? 'bg-slate-200 dark:bg-white/[0.08] text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-white/[0.14]'
                                    : isPending
                                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 cursor-default'
                                      : isPrivate
                                        ? 'bg-slate-900 dark:bg-white/[0.12] hover:bg-slate-800 dark:hover:bg-white/[0.2] text-white disabled:opacity-50'
                                        : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
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
                              <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
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

      <div className="p-3 border-t border-slate-200 dark:border-white/[0.08] shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenProfile(profile.id)}
          className="flex-1 min-w-0 min-h-[48px] px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.04] flex items-center gap-3 text-left transition-colors"
          title="Open your profile"
        >
          <Avatar
            username={profile.username}
            color={profile.color}
            avatarUrl={profile.avatarUrl}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{profile.username}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              View profile
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Settings"
          className="min-h-[44px] min-w-[44px] rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors shrink-0"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
