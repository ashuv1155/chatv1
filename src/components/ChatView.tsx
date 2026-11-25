import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  ArrowLeft,
  Check,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Hash,
  Image as ImageIcon,
  Lock,
  LogOut,
  MessageSquarePlus,
  Paperclip,
  Send,
  ShieldBan,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  MAX_ATTACHMENT_BYTES,
  approveJoinRequest,
  declineJoinRequest,
  fetchAttachmentBlobUrl,
  fetchChatMembers,
  fetchChatMetadata,
  fetchOlderMessages,
  fetchPendingJoinRequests,
  hasViewedOnceMessage,
  openViewOncePhoto,
  sendMessage,
  subscribeToLatestMessages,
} from '../lib/api';
import type {
  AttachmentKind,
  AttachmentMeta,
  ChatMessage,
  ChatSummary,
  GroupVisibility,
  JoinRequest,
  Profile,
} from '../types';

interface ChatViewProps {
  chat: ChatSummary;
  currentUser: Profile;
  blockedUserIds: Set<string>;
  onBackMobile: () => void;
  onLeaveGroup: (chatId: string) => Promise<void>;
  onStartDm: (targetUserId: string) => Promise<void>;
  onOpenProfile: (userId: string) => void;
  onRequestReport: (params: {
    userId: string | null;
    label: string;
    messageId?: string | null;
  }) => void;
  onRequestBlock: (target: { userId: string; username: string; color?: string }) => void;
  onToast: (message: string) => void;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface StagedAttachment {
  file: File;
  isImage: boolean;
  viewOnce: boolean;
  previewUrl: string | null;
}

export const ChatView: React.FC<ChatViewProps> = ({
  chat,
  currentUser,
  blockedUserIds,
  onBackMobile,
  onLeaveGroup,
  onStartDm,
  onOpenProfile,
  onRequestReport,
  onRequestBlock,
  onToast,
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
  const [chatMeta, setChatMeta] = useState<{
    createdBy: string | null;
    visibility: GroupVisibility;
    memberCount: number;
  } | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [processingReqId, setProcessingReqId] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [stagedAttachment, setStagedAttachment] = useState<StagedAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [startingDmId, setStartingDmId] = useState<string | null>(null);

  // Attachment Blob URL caches and lightbox states
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoLoading, setPhotoLoading] = useState<Record<string, boolean>>({});
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  const [viewedOnceMap, setViewedOnceMap] = useState<Record<string, boolean>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    url: string;
    fileName: string;
    viewOnce: boolean;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recentSendTimesRef = useRef<number[]>([]);
  const isAtBottomRef = useRef(true);
  const hasScrolledInitialRef = useRef(false);
  const photoUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    photoUrlsRef.current = photoUrls;
  }, [photoUrls]);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Revoke staged preview URL on change/unmount
  useEffect(() => {
    return () => {
      if (stagedAttachment?.previewUrl) {
        URL.revokeObjectURL(stagedAttachment.previewUrl);
      }
    };
  }, [stagedAttachment]);

  // Revoke cached photo object URLs on chat switch/unmount
  useEffect(() => {
    return () => {
      Object.values(photoUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [chat.id]);

  // Load member list, chat metadata, pending join requests (if admin), and subscribe ONLY to open chat
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
    setJoinRequests([]);
    setPhotoUrls({});
    setPhotoLoading({});
    setPhotoErrors({});
    setViewedOnceMap({});

    fetchChatMembers(chat.id)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load members.');
        }
      });

    fetchChatMetadata(chat.id)
      .then(async (meta) => {
        if (cancelled) return;
        setChatMeta(meta);
        if (
          chat.type === 'group' &&
          meta &&
          meta.createdBy === currentUser.id &&
          meta.visibility === 'private'
        ) {
          try {
            const reqs = await fetchPendingJoinRequests(chat.id);
            if (!cancelled) setJoinRequests(reqs);
          } catch {
            // ignore if unable to fetch requests
          }
        }
      })
      .catch(() => {
        if (!cancelled) setChatMeta(null);
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
  }, [chat.id, chat.type, currentUser.id, scrollToBottom]);

  const visibleMessages = useMemo(() => {
    const liveIds = new Set(liveMessages.map((m) => m.id));
    const merged = [
      ...olderMessages.filter((m) => !liveIds.has(m.id)),
      ...liveMessages,
    ];
    return merged.filter((m) => !blockedUserIds.has(m.senderId));
  }, [olderMessages, liveMessages, blockedUserIds]);

  // Auto-load standard photos & check view-once status for visible messages
  useEffect(() => {
    let cancelled = false;

    for (const msg of visibleMessages) {
      const att = msg.attachment;
      if (!att) continue;

      if (att.kind === 'photo') {
        if (!photoUrls[att.id] && !photoLoading[att.id] && !photoErrors[att.id]) {
          setPhotoLoading((prev) => ({ ...prev, [att.id]: true }));
          fetchAttachmentBlobUrl(chat.id, att)
            .then((url) => {
              if (cancelled) {
                URL.revokeObjectURL(url);
                return;
              }
              setPhotoUrls((prev) => ({ ...prev, [att.id]: url }));
            })
            .catch((err) => {
              if (!cancelled) {
                setPhotoErrors((prev) => ({
                  ...prev,
                  [att.id]: err instanceof Error ? err.message : 'Unable to load image.',
                }));
              }
            })
            .finally(() => {
              if (!cancelled) {
                setPhotoLoading((prev) => ({ ...prev, [att.id]: false }));
              }
            });
        }
      } else if (att.kind === 'view_once_photo' && msg.senderId !== currentUser.id) {
        if (viewedOnceMap[msg.id] === undefined) {
          hasViewedOnceMessage(chat.id, msg.id, currentUser.id).then((viewed) => {
            if (!cancelled) {
              setViewedOnceMap((prev) => ({ ...prev, [msg.id]: viewed }));
            }
          });
        }
      }
    }

    return () => {
      cancelled = true;
    };
  }, [visibleMessages, chat.id, currentUser.id, photoUrls, photoLoading, photoErrors, viewedOnceMap]);

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

  const memberById = useMemo(() => {
    const map = new Map<string, Profile>();
    map.set(currentUser.id, currentUser);
    for (const m of members) {
      map.set(m.id, m);
    }
    return map;
  }, [members, currentUser]);

  const dmPartner = useMemo(() => {
    if (chat.type !== 'dm') return null;
    const fromMember = members.find((m) => m.id !== currentUser.id);
    return fromMember ?? chat.partner ?? null;
  }, [chat.type, chat.partner, members, currentUser.id]);

  const isDmBlocked = dmPartner ? blockedUserIds.has(dmPartner.id) : false;
  const isGroupAdmin =
    chat.type === 'group' && chatMeta?.createdBy === currentUser.id;
  const isPrivateGroup =
    chat.type === 'group' && (chatMeta?.visibility ?? chat.visibility) === 'private';

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>, asPhoto: boolean) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setSendError(null);
    if (file.size <= 0) {
      setSendError('Selected file is empty.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setSendError('Attachments cannot exceed 5 MB.');
      return;
    }

    const isImage = asPhoto || file.type.startsWith('image/');
    if (asPhoto && !file.type.startsWith('image/')) {
      setSendError('Please select a valid image file (PNG, JPG, WebP, GIF).');
      return;
    }

    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    setStagedAttachment({
      file,
      isImage,
      viewOnce: false,
      previewUrl,
    });
  };

  const handleSend = async () => {
    const trimmed = draft.trim();
    if ((!trimmed && !stagedAttachment) || sending) return;

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
    const outgoingAttachment = stagedAttachment;
    setDraft('');
    setStagedAttachment(null);

    const attachmentKind: AttachmentKind | undefined = outgoingAttachment
      ? outgoingAttachment.isImage
        ? outgoingAttachment.viewOnce
          ? 'view_once_photo'
          : 'photo'
        : 'file'
      : undefined;

    try {
      await sendMessage(
        chat.id,
        currentUser,
        outgoingText,
        outgoingAttachment && attachmentKind
          ? { file: outgoingAttachment.file, kind: attachmentKind }
          : undefined,
      );
      recentSendTimesRef.current.push(Date.now());
      requestAnimationFrame(() => scrollToBottom());
    } catch (err) {
      setDraft(outgoingText);
      if (outgoingAttachment) {
        setStagedAttachment(outgoingAttachment);
      }
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

  const handleOpenViewOnce = async (msg: ChatMessage, att: AttachmentMeta) => {
    setPhotoLoading((prev) => ({ ...prev, [att.id]: true }));
    try {
      const url = await openViewOncePhoto(chat.id, msg.id, att, currentUser.id);
      setViewedOnceMap((prev) => ({ ...prev, [msg.id]: true }));
      setLightbox({ url, fileName: att.fileName, viewOnce: true });
    } catch (err) {
      setViewedOnceMap((prev) => ({ ...prev, [msg.id]: true }));
      onToast(err instanceof Error ? err.message : 'Photo already opened.');
    } finally {
      setPhotoLoading((prev) => ({ ...prev, [att.id]: false }));
    }
  };

  const handleDownloadFile = async (att: AttachmentMeta) => {
    setDownloadingId(att.id);
    try {
      const existingUrl = photoUrls[att.id];
      const url = existingUrl ?? (await fetchAttachmentBlobUrl(chat.id, att));
      const a = document.createElement('a');
      a.href = url;
      a.download = att.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (!existingUrl) {
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };

  const closeLightbox = () => {
    if (lightbox?.viewOnce && lightbox.url) {
      URL.revokeObjectURL(lightbox.url);
    }
    setLightbox(null);
  };

  const handleApproveRequest = async (req: JoinRequest) => {
    setProcessingReqId(req.userId);
    try {
      await approveJoinRequest(chat.id, req);
      setJoinRequests((prev) => prev.filter((r) => r.userId !== req.userId));
      const updatedMembers = await fetchChatMembers(chat.id);
      setMembers(updatedMembers);
      onToast(`${req.username} approved and added to the group.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not approve request.');
    } finally {
      setProcessingReqId(null);
    }
  };

  const handleDeclineRequest = async (req: JoinRequest) => {
    setProcessingReqId(req.userId);
    try {
      await declineJoinRequest(chat.id, req.userId);
      setJoinRequests((prev) => prev.filter((r) => r.userId !== req.userId));
      onToast(`Declined request from ${req.username}.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not decline request.');
    } finally {
      setProcessingReqId(null);
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
              <button
                type="button"
                onClick={() => onOpenProfile(dmPartner.id)}
                className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-80 transition-opacity"
                title={`View ${dmPartner.username}'s profile`}
              >
                <Avatar
                  username={dmPartner.username}
                  color={dmPartner.color}
                  avatarUrl={dmPartner.avatarUrl}
                  size="sm"
                />
                <div className="min-w-0">
                  <h1 className="text-sm sm:text-base font-semibold tracking-tight truncate">
                    {headerTitle}
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate tabular-nums">
                    Direct chat · 24h auto-delete
                  </p>
                </div>
              </button>
            ) : (
              <>
                <div
                  className={`h-8 w-8 shrink-0 rounded-xl flex items-center justify-center ${
                    isPrivateGroup
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-slate-200 dark:bg-[#1B2336] text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {isPrivateGroup ? <Lock className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm sm:text-base font-semibold tracking-tight truncate">
                    {headerTitle}
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate tabular-nums">
                    {members.length} {members.length === 1 ? 'member' : 'members'} ·{' '}
                    {isPrivateGroup ? 'Private' : 'Public'} · 24h messages
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isGroupAdmin && isPrivateGroup && joinRequests.length > 0 && (
              <button
                type="button"
                onClick={() => setMembersOpen(true)}
                className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap tabular-nums"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Requests ({joinRequests.length})</span>
              </button>
            )}

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
                No active messages
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs leading-relaxed">
                Say hello as {currentUser.username}. Messages in this room auto-delete after 24 hours.
              </p>
            </div>
          ) : (
            visibleMessages.map((msg, idx) => {
              const isOwn = msg.senderId === currentUser.id;
              const senderProfile = memberById.get(msg.senderId);
              const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
              const showDayDivider =
                !prevMsg || formatMessageDay(prevMsg.createdAt) !== formatMessageDay(msg.createdAt);
              const att = msg.attachment ?? null;

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
                    <button
                      type="button"
                      onClick={() => onOpenProfile(msg.senderId)}
                      title={`View ${msg.senderUsername}'s profile`}
                      className="shrink-0 rounded-xl hover:opacity-85 transition-opacity"
                    >
                      <Avatar
                        username={senderProfile?.username ?? msg.senderUsername}
                        color={senderProfile?.color ?? msg.senderColor}
                        avatarUrl={senderProfile?.avatarUrl}
                        size="sm"
                      />
                    </button>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => onOpenProfile(msg.senderId)}
                            className={`text-sm font-semibold truncate hover:underline ${
                              isOwn
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {msg.senderUsername}
                          </button>
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

                      {msg.body && (
                        <p className="text-sm sm:text-[15px] text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                          {msg.body}
                        </p>
                      )}

                      {att && att.kind === 'photo' && (
                        <div className="pt-1">
                          {photoUrls[att.id] ? (
                            <button
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  url: photoUrls[att.id],
                                  fileName: att.fileName,
                                  viewOnce: false,
                                })
                              }
                              className="block max-w-xs sm:max-w-sm rounded-xl overflow-hidden border border-slate-200 dark:border-white/[0.1] bg-slate-200/40 dark:bg-white/[0.03] hover:opacity-95 transition-opacity"
                            >
                              <img
                                src={photoUrls[att.id]}
                                alt={att.fileName}
                                className="max-h-72 w-auto object-cover"
                              />
                            </button>
                          ) : photoErrors[att.id] ? (
                            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/[0.08] text-xs text-slate-500 dark:text-slate-400">
                              <ImageIcon className="w-4 h-4" />
                              <span>{photoErrors[att.id]}</span>
                            </div>
                          ) : (
                            <div className="h-40 w-56 rounded-xl bg-slate-200 dark:bg-white/[0.06] animate-pulse" />
                          )}
                        </div>
                      )}

                      {att && att.kind === 'view_once_photo' && (
                        <div className="pt-1">
                          {isOwn ? (
                            <div className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111622] text-xs text-slate-600 dark:text-slate-300">
                              <EyeOff className="w-4 h-4 text-indigo-500 shrink-0" />
                              <span>
                                View-once photo sent · {formatBytes(att.sizeBytes)}
                              </span>
                            </div>
                          ) : viewedOnceMap[msg.id] ? (
                            <div className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-100/70 dark:bg-white/[0.03] text-xs text-slate-500 dark:text-slate-400">
                              <EyeOff className="w-4 h-4 shrink-0" />
                              <span>View-once photo · Opened</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenViewOnce(msg, att)}
                              disabled={Boolean(photoLoading[att.id])}
                              className="min-h-[42px] px-4 py-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
                            >
                              <Eye className="w-4 h-4 shrink-0" />
                              <span>
                                {photoLoading[att.id]
                                  ? 'Opening photo...'
                                  : `View photo once · ${formatBytes(att.sizeBytes)}`}
                              </span>
                            </button>
                          )}
                        </div>
                      )}

                      {att && att.kind === 'file' && (
                        <div className="pt-1">
                          <div className="inline-flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111622] max-w-full">
                            <FileText className="w-5 h-5 text-indigo-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-medium truncate max-w-[200px] sm:max-w-xs">
                                {att.fileName}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                {formatBytes(att.sizeBytes)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDownloadFile(att)}
                              disabled={downloadingId === att.id}
                              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>{downloadingId === att.id ? 'Saving...' : 'Download'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111622] shrink-0 space-y-2.5">
          {sendError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 px-1">
              {sendError}
            </p>
          )}

          {stagedAttachment && (
            <div className="p-2.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#0B0E14] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {stagedAttachment.previewUrl ? (
                  <img
                    src={stagedAttachment.previewUrl}
                    alt="Selected preview"
                    className="h-12 w-12 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-white/[0.1]"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{stagedAttachment.file.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatBytes(stagedAttachment.file.size)} · Max 5 MB
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {stagedAttachment.isImage && (
                  <button
                    type="button"
                    onClick={() =>
                      setStagedAttachment((prev) =>
                        prev ? { ...prev, viewOnce: !prev.viewOnce } : prev,
                      )
                    }
                    className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      stagedAttachment.viewOnce
                        ? 'bg-indigo-600 text-white'
                        : 'border border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    {stagedAttachment.viewOnce ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    <span>{stagedAttachment.viewOnce ? 'View once' : 'Standard'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setStagedAttachment(null)}
                  aria-label="Remove attachment"
                  className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-slate-200/70 dark:hover:bg-white/[0.06]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {currentUser.banned ? (
            <div className="min-h-[44px] px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-center">
              Your account is banned from sending messages.
            </div>
          ) : isDmBlocked ? (
            <div className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/[0.04] text-xs text-slate-600 dark:text-slate-400 flex items-center">
              You blocked this user. Unblock them in Settings or their Profile to resume chatting.
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => handlePickFile(e, true)}
                className="hidden"
              />
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => handlePickFile(e, false)}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={sending}
                title="Share photo or view-once photo (max 5 MB)"
                aria-label="Share photo"
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors shrink-0"
              >
                <ImageIcon className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                title="Attach file (max 5 MB)"
                aria-label="Attach file"
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <div className="flex-1 relative">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={1000}
                  rows={1}
                  placeholder={`Message ${headerTitle}...`}
                  className="w-full min-h-[44px] max-h-32 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#0B0E14] border border-slate-200 dark:border-white/[0.08] text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
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
                disabled={sending || (draft.trim().length === 0 && !stagedAttachment)}
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
        <aside className="fixed inset-0 z-30 lg:static lg:z-auto lg:w-76 bg-white dark:bg-[#111622] lg:border-l border-slate-200 dark:border-white/[0.08] flex flex-col shrink-0">
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

          <div className="flex-1 overflow-y-auto chat-scroll p-3 space-y-4">
            {isGroupAdmin && isPrivateGroup && (
              <div className="space-y-2 pb-3 border-b border-slate-200 dark:border-white/[0.08]">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                    Join requests ({joinRequests.length})
                  </h3>
                </div>
                {joinRequests.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
                    No pending requests.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {joinRequests.map((req) => (
                      <li
                        key={req.userId}
                        className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenProfile(req.userId)}
                          className="flex items-center gap-2.5 min-w-0 w-full text-left hover:opacity-80"
                        >
                          <Avatar username={req.username} color={req.color} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{req.username}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Tap to view profile
                            </p>
                          </div>
                        </button>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleApproveRequest(req)}
                            disabled={processingReqId === req.userId}
                            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeclineRequest(req)}
                            disabled={processingReqId === req.userId}
                            className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium inline-flex items-center justify-center gap-1"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Decline</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <ul className="space-y-1.5">
              {members.map((member) => {
                const isSelf = member.id === currentUser.id;
                const isBlocked = blockedUserIds.has(member.id);

                return (
                  <li
                    key={member.id}
                    className="p-2.5 rounded-xl border border-slate-200/80 dark:border-white/[0.06] bg-slate-50/70 dark:bg-[#0B0E14]/50 space-y-2"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenProfile(member.id)}
                      className="flex items-center gap-2.5 min-w-0 w-full text-left hover:opacity-80 transition-opacity"
                    >
                      <Avatar
                        username={member.username}
                        color={member.color}
                        avatarUrl={member.avatarUrl}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {member.username}
                          {isSelf && (
                            <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">
                              (you)
                            </span>
                          )}
                          {chatMeta?.createdBy === member.id && chat.type === 'group' && (
                            <span className="ml-1.5 text-xs text-indigo-500 dark:text-indigo-400">
                              · Admin
                            </span>
                          )}
                        </p>
                        {isBlocked && (
                          <p className="text-xs text-red-500 dark:text-red-400">Blocked</p>
                        )}
                      </div>
                    </button>

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
          </div>
        </aside>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-3xl flex items-center justify-between text-white pb-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium truncate pr-4">
              {lightbox.viewOnce ? 'View-once photo (closes permanently)' : lightbox.fileName}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!lightbox.viewOnce && (
                <a
                  href={lightbox.url}
                  download={lightbox.fileName}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </a>
              )}
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Close image"
                className="min-h-[40px] min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <img
            src={lightbox.url}
            alt={lightbox.fileName}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] max-w-full rounded-xl object-contain select-none"
          />
        </div>
      )}
    </div>
  );
};
