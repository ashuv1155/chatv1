import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  ArrowLeft,
  ChevronUp,
  Flag,
  Hash,
  LogOut,
  MessageSquarePlus,
  Send,
  ShieldBan,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  fetchChatMembers,
  fetchOlderMessages,
  sendMessage,
  subscribeToLatestMessages,
} from '../lib/api';
import type { ChatMessage, ChatSummary, Profile } from '../types';

interface ChatViewProps {
  chat: ChatSummary;
  currentUser: Profile;
  blockedUserIds: Set<string>;
  onBackMobile: () => void;
  onLeaveGroup: (chatId: string) => Promise<void>;
  onStartDm: (targetUserId: string) => Promise<void>;
  onRequestReport: (params: {
    userId: string | null;
    label: string;
    messageId?: string | null;
  }) => void;
  onRequestBlock: (target: { userId: string; username: string; color?: string }) => void;
}

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMessageDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const ChatView: React.FC<ChatViewProps> = ({
  chat,
  currentUser,
  blockedUserIds,
  onBackMobile,
  onLeaveGroup,
  onStartDm,
  onRequestReport,
  onRequestBlock,
}) => {
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [oldestLiveDoc, setOldestLiveDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(
    null,
  );
  const [oldestPagedDoc, setOldestPagedDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(
    null,
  );
  const [hasMore, setHasMore] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [members, setMembers] = useState<Profile[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [startingDmId, setStartingDmId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const recentSendTimesRef = useRef<number[]>([]);
  const isAtBottomRef = useRef(true);
  const hasScrolledInitialRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Load member list and subscribe ONLY to the currently open chat's latest 50 messages
  useEffect(() => {
    let cancelled = false;
    hasScrolledInitialRef.current = false;
    isAtBottomRef.current = true;

    setLiveMessages([]);
    setOlderMessages([]);
    setOldestLiveDoc(null);
    setOldestPagedDoc(null);
    setHasMore(false);
    setLoadingInitial(true);
    setLoadError(null);
    setSendError(null);

    fetchChatMembers(chat.id)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load members.');
        }
      });

    const unsubscribe = subscribeToLatestMessages(chat.id, (latest, oldestSnap, moreAvailable) => {
      if (cancelled) return;
      setLiveMessages(latest);
      setOldestLiveDoc(oldestSnap);
      setHasMore((prevMore) => (oldestPagedDoc ? prevMore : moreAvailable));
      setLoadingInitial(false);

      if (!hasScrolledInitialRef.current || isAtBottomRef.current) {
        hasScrolledInitialRef.current = true;
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [chat.id, scrollToBottom]);

  const handleLoadOlder = useCallback(async () => {
    const cursor = oldestPagedDoc ?? oldestLiveDoc;
    if (loadingOlder || !hasMore || !cursor) return;

    const el = scrollContainerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;

    setLoadingOlder(true);
    try {
      const page = await fetchOlderMessages(chat.id, cursor, 50);
      setOlderMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const nextOlder = page.messages.filter((m) => !seen.has(m.id));
        return [...nextOlder, ...prev];
      });
      setOldestPagedDoc(page.oldestDoc);
      setHasMore(page.hasMore);

      requestAnimationFrame(() => {
        if (el) {
          const delta = el.scrollHeight - prevScrollHeight;
          el.scrollTop = el.scrollTop + delta;
        }
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }, [chat.id, hasMore, loadingOlder, oldestLiveDoc, oldestPagedDoc]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (el.scrollTop < 72 && hasMore && !loadingOlder && !loadingInitial) {
      void handleLoadOlder();
    }
  };

  const visibleMessages = useMemo(() => {
    const liveIds = new Set(liveMessages.map((m) => m.id));
    const merged = [
      ...olderMessages.filter((m) => !liveIds.has(m.id)),
      ...liveMessages,
    ];
    return merged.filter((m) => !blockedUserIds.has(m.senderId));
  }, [olderMessages, liveMessages, blockedUserIds]);

  const dmPartner = useMemo(() => {
    if (chat.type !== 'dm') return null;
    return chat.partner ?? members.find((m) => m.id !== currentUser.id) ?? null;
  }, [chat.type, chat.partner, members, currentUser.id]);

  const isDmBlocked = dmPartner ? blockedUserIds.has(dmPartner.id) : false;

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    if (currentUser.banned) {
      setSendError('Your account is restricted from sending messages.');
      return;
    }

    if (isDmBlocked) {
      setSendError('You have blocked this user.');
      return;
    }

    if (trimmed.length > 1000) {
      setSendError('Messages cannot exceed 1000 characters.');
      return;
    }

    const now = Date.now();
    recentSendTimesRef.current = recentSendTimesRef.current.filter((t) => now - t < 10_000);
    if (recentSendTimesRef.current.length >= 5) {
      setSendError('Slow down: max 5 messages per 10 seconds.');
      return;
    }

    setSending(true);
    setSendError(null);
    const outgoingText = trimmed;
    setDraft('');

    try {
      await sendMessage(chat.id, currentUser, outgoingText);
      recentSendTimesRef.current.push(Date.now());
      requestAnimationFrame(() => scrollToBottom());
    } catch (err) {
      setDraft(outgoingText);
      const msg = err instanceof Error ? err.message : 'Failed to send message.';
      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('permission')) {
        setSendError('Message rejected (max 5 messages per 10 seconds or restricted).');
      } else {
        setSendError(msg);
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await onLeaveGroup(chat.id);
    } finally {
      setLeaving(false);
    }
  };

  const handleStartDm = async (targetUserId: string) => {
    setStartingDmId(targetUserId);
    try {
      await onStartDm(targetUserId);
      setMembersOpen(false);
    } finally {
      setStartingDmId(null);
    }
  };

  const headerTitle =
    chat.type === 'dm'
      ? dmPartner?.username ?? 'Direct Message'
      : chat.name ?? 'Group';

  return (
    <div className="h-full flex bg-slate-50 dark:bg-[#0B0E14] relative overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <header className="h-14 px-3 sm:px-5 border-b border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111622] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackMobile}
              aria-label="Back to chat list"
              className="lg:hidden min-h-[44px] min-w-[44px] -ml-1.5 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.05]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {chat.type === 'dm' && dmPartner ? (
              <Avatar username={dmPartner.username} color={dmPartner.color} size="sm" />
            ) : (
              <div className="h-8 w-8 shrink-0 rounded-xl bg-slate-200 dark:bg-[#1B2336] flex items-center justify-center text-slate-600 dark:text-slate-300">
                <Hash className="w-4 h-4" />
              </div>
            )}

            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-semibold tracking-tight truncate">
                {headerTitle}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate tabular-nums">
                {chat.type === 'dm'
                  ? 'Anonymous direct message'
                  : `${members.length} ${members.length === 1 ? 'member' : 'members'}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                onRequestReport({
                  userId: dmPartner?.id ?? null,
                  label: headerTitle,
                })
              }
              title="Report"
              className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-xs font-medium text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Flag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Report</span>
            </button>

            {chat.type === 'dm' && dmPartner && !isDmBlocked && (
              <button
                type="button"
                onClick={() =>
                  onRequestBlock({
                    userId: dmPartner.id,
                    username: dmPartner.username,
                    color: dmPartner.color,
                  })
                }
                title="Block user"
                className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-red-500/30 hover:bg-red-500/10 text-xs font-medium text-red-600 dark:text-red-400 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <ShieldBan className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Block</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setMembersOpen((prev) => !prev)}
              aria-expanded={membersOpen}
              className={`min-h-[40px] px-2.5 py-1.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap tabular-nums ${
                membersOpen
                  ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-300'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>{members.length}</span>
            </button>

            {chat.type === 'group' && (
              <button
                type="button"
                onClick={handleLeave}
                disabled={leaving}
                title="Leave group"
                className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.08] hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 text-xs font-medium text-slate-600 dark:text-slate-300 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{leaving ? 'Leaving...' : 'Leave'}</span>
              </button>
            )}
          </div>
        </header>

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto chat-scroll px-4 sm:px-6 py-4 space-y-4"
        >
          {hasMore && (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                onClick={handleLoadOlder}
                disabled={loadingOlder}
                className="min-h-[36px] px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111622] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-xs font-medium text-slate-600 dark:text-slate-300 inline-flex items-center gap-1.5 transition-colors"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                <span>{loadingOlder ? 'Loading older...' : 'Load older messages'}</span>
              </button>
            </div>
          )}

          {loadingInitial ? (
            <div className="space-y-4 py-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-xl bg-slate-200 dark:bg-white/[0.06] animate-pulse shrink-0" />
                  <div className="space-y-2 flex-1 max-w-md">
                    <div className="h-3 w-28 rounded bg-slate-200 dark:bg-white/[0.06] animate-pulse" />
                    <div className="h-10 w-full rounded-xl bg-slate-200 dark:bg-white/[0.06] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
              {loadError}
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                No messages yet
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                Say hello as {currentUser.username}.
              </p>
            </div>
          ) : (
            visibleMessages.map((msg, idx) => {
              const isOwn = msg.senderId === currentUser.id;
              const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
              const showDayDivider =
                !prevMsg || formatMessageDay(prevMsg.createdAt) !== formatMessageDay(msg.createdAt);

              return (
                <React.Fragment key={msg.id}>
                  {showDayDivider && (
                    <div className="flex items-center gap-3 py-2">
                      <div className="h-px flex-1 bg-slate-200 dark:bg-white/[0.08]" />
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500 tabular-nums">
                        {formatMessageDay(msg.createdAt)}
                      </span>
                      <div className="h-px flex-1 bg-slate-200 dark:bg-white/[0.08]" />
                    </div>
                  )}

                  <div className="group flex items-start gap-3">
                    <Avatar username={msg.senderUsername} color={msg.senderColor} size="sm" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`text-sm font-semibold truncate ${
                              isOwn
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {msg.senderUsername}
                          </span>
                          <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                            {formatMessageTime(msg.createdAt)}
                          </span>
                        </div>

                        {!isOwn && (
                          <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 flex items-center gap-1 transition-opacity">
                            {chat.type === 'group' && (
                              <button
                                type="button"
                                onClick={() => handleStartDm(msg.senderId)}
                                title={`Message ${msg.senderUsername}`}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-slate-200/70 dark:hover:bg-white/[0.06]"
                              >
                                <MessageSquarePlus className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onRequestReport({
                                  userId: msg.senderId,
                                  label: msg.senderUsername,
                                  messageId: msg.id,
                                })
                              }
                              title={`Report ${msg.senderUsername}`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-200/70 dark:hover:bg-white/[0.06]"
                            >
                              <Flag className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onRequestBlock({
                                  userId: msg.senderId,
                                  username: msg.senderUsername,
                                  color: msg.senderColor,
                                })
                              }
                              title={`Block ${msg.senderUsername}`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-200/70 dark:hover:bg-white/[0.06]"
                            >
                              <ShieldBan className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <p className="text-sm sm:text-[15px] text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                        {msg.body}
                      </p>
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111622] shrink-0 space-y-2">
          {sendError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 px-1">
              {sendError}
            </p>
          )}

          {currentUser.banned ? (
            <div className="min-h-[44px] px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-center">
              Your account is banned from sending messages.
            </div>
          ) : isDmBlocked ? (
            <div className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/[0.04] text-xs text-slate-600 dark:text-slate-400 flex items-center">
              You blocked this user. Unblock them in Settings to resume chatting.
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={1000}
                  rows={1}
                  placeholder={`Message ${headerTitle}...`}
                  className="w-full min-h-[44px] max-h-32 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#0B0E14] border border-slate-200 dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
                {draft.length >= 750 && (
                  <span className="absolute right-3 bottom-2 text-[11px] font-mono tabular-nums text-slate-400">
                    {draft.length}/1000
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || draft.trim().length === 0}
                aria-label="Send message"
                className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {membersOpen && (
        <aside className="fixed inset-0 z-30 lg:static lg:z-auto lg:w-72 bg-white dark:bg-[#111622] lg:border-l border-slate-200 dark:border-white/[0.08] flex flex-col shrink-0">
          <div className="h-14 px-4 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between">
            <h2 className="text-sm font-semibold tabular-nums">
              Members ({members.length})
            </h2>
            <button
              type="button"
              onClick={() => setMembersOpen(false)}
              aria-label="Close member list"
              className="min-h-[44px] min-w-[44px] -mr-2 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <ul className="flex-1 overflow-y-auto chat-scroll p-3 space-y-1.5">
            {members.map((member) => {
              const isSelf = member.id === currentUser.id;
              const isBlocked = blockedUserIds.has(member.id);

              return (
                <li
                  key={member.id}
                  className="p-2.5 rounded-xl border border-slate-200/80 dark:border-white/[0.06] bg-slate-50/70 dark:bg-[#0B0E14]/50 space-y-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar username={member.username} color={member.color} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {member.username}
                        {isSelf && (
                          <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">
                            (you)
                          </span>
                        )}
                      </p>
                      {isBlocked && (
                        <p className="text-xs text-red-500 dark:text-red-400">Blocked</p>
                      )}
                    </div>
                  </div>

                  {!isSelf && (
                    <div className="flex items-center gap-1.5 pt-1">
                      {!isBlocked && (
                        <button
                          type="button"
                          onClick={() => handleStartDm(member.id)}
                          disabled={startingDmId === member.id || currentUser.banned}
                          className="flex-1 min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-200/70 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.1] text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors"
                        >
                          <MessageSquarePlus className="w-3.5 h-3.5" />
                          <span>{startingDmId === member.id ? 'Opening...' : 'DM'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onRequestReport({
                            userId: member.id,
                            label: member.username,
                          })
                        }
                        className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        <span>Report</span>
                      </button>
                      {!isBlocked && (
                        <button
                          type="button"
                          onClick={() =>
                            onRequestBlock({
                              userId: member.id,
                              username: member.username,
                              color: member.color,
                            })
                          }
                          className="min-h-[34px] px-2.5 py-1 rounded-lg border border-red-500/30 hover:bg-red-500/10 text-xs font-medium text-red-600 dark:text-red-400 inline-flex items-center justify-center gap-1 transition-colors"
                        >
                          <ShieldBan className="w-3.5 h-3.5" />
                          <span>Block</span>
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      )}
    </div>
  );
};
