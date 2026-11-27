import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  Archive,
  ArrowLeft,
  BellOff,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  CornerUpLeft,
  CornerUpRight,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  Flag,
  GripVertical,
  Hash,
  Image as ImageIcon,
  Lock,
  LogOut,
  MailOpen,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  ShieldBan,
  Star,
  Tag,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { ForwardModal } from './ForwardModal';
import { RichMessageText } from './RichMessageText';
import {
  MAX_ATTACHMENT_BYTES,
  approveJoinRequest,
  declineJoinRequest,
  deleteMessage,
  fetchAttachmentBlobUrl,
  fetchChatMembers,
  fetchChatMetadata,
  fetchOlderMessages,
  getDisplayName,
  hasViewedOnceMessage,
  openViewOncePhoto,
  sendMessage,
  setTypingStatus,
  subscribeToAdminJoinRequests,
  subscribeToLatestMessages,
  subscribeToReactions,
  subscribeToReadReceipts,
  subscribeToTyping,
  toggleMessageReaction,
} from '../lib/api';
import type {
  AttachmentKind,
  AttachmentMeta,
  ChatMessage,
  ChatReadReceipt,
  ChatSummary,
  GroupVisibility,
  JoinRequest,
  MessageReaction,
  Profile,
  ReplyMeta,
  TypingParticipant,
} from '../types';

interface ChatViewProps {
  chat: ChatSummary;
  allChats: ChatSummary[];
  currentUser: Profile;
  nicknames: Record<string, string>;
  favoriteUserIds: Set<string>;
  blockedUserIds: Set<string>;
  typingEnabled: boolean;
  onChatViewed?: (chatId: string) => void;
  onSelectChat?: (chatId: string) => void;
  onBackMobile: () => void;
  onLeaveGroup: (chatId: string) => Promise<void>;
  onRemoveChat: (chat: ChatSummary) => Promise<void>;
  onRemoveGroupMember?: (chatId: string, targetUserId: string) => Promise<void>;
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
  onStartDm: (targetUserId: string) => Promise<void>;
  onOpenProfile: (userId: string) => void;
  onSetNickname: (targetUserId: string, nickname: string) => Promise<void>;
  onRemoveNickname: (targetUserId: string) => Promise<void>;
  onRequestReport: (params: {
    userId: string | null;
    label: string;
    messageId?: string | null;
  }) => void;
  onRequestBlock: (target: { userId: string; username: string; color?: string }) => void;
  onToast: (message: string) => void;
}

const PRIMARY_REACTIONS = ['🔥', '🙌', '😭', '🙈', '🙏', '🤐', '✨'];
const EXTRA_REACTIONS = ['❤️', '😂', '👍', '🎉', '😮', '💯', '👀', '🫡'];

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

function buildMessageSnippet(msg: ChatMessage): string {
  const clean = msg.body.trim();
  if (clean) return clean.slice(0, 140);
  if (msg.attachment?.kind === 'view_once_photo') return 'View-once photo';
  if (msg.attachment?.kind === 'photo') return `Photo: ${msg.attachment.fileName}`;
  if (msg.attachment) return `File: ${msg.attachment.fileName}`;
  return 'Message';
}

const MAX_STAGED_ATTACHMENTS = 5;

interface StagedAttachment {
  id: string;
  file: File;
  isImage: boolean;
  viewOnce: boolean;
  previewUrl: string | null;
}

export const ChatView: React.FC<ChatViewProps> = ({
  chat,
  allChats,
  currentUser,
  nicknames,
  favoriteUserIds,
  blockedUserIds,
  typingEnabled,
  onChatViewed,
  onSelectChat,
  onBackMobile,
  onLeaveGroup,
  onRemoveChat,
  onRemoveGroupMember,
  onToggleFavoriteUser,
  onUpdateChatPrefs,
  onStartDm,
  onOpenProfile,
  onSetNickname,
  onRemoveNickname,
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
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [chatMeta, setChatMeta] = useState<{
    createdBy: string | null;
    visibility: GroupVisibility;
    memberCount: number;
  } | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [processingReqId, setProcessingReqId] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<ReplyMeta | null>(null);
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [startingDmId, setStartingDmId] = useState<string | null>(null);

  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [readReceipts, setReadReceipts] = useState<ChatReadReceipt[]>([]);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [showMoreEmojis, setShowMoreEmojis] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  const [nicknameTarget, setNicknameTarget] = useState<{
    userId: string;
    username: string;
    color?: string;
  } | null>(null);
  const [nicknameInput, setNicknameInput] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);

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

  const [rawTypingUsers, setRawTypingUsers] = useState<TypingParticipant[]>([]);
  const [typingClockMs, setTypingClockMs] = useState(() => Date.now());

  // Drag-and-drop file/photo options & message drag/swipe states
  const [fileDragActive, setFileDragActive] = useState(false);
  const [fileDropHoverZone, setFileDropHoverZone] = useState<'photo' | 'view_once' | 'file' | null>(null);
  const [draggingMessage, setDraggingMessage] = useState<ChatMessage | null>(null);
  const [msgDropHoverZone, setMsgDropHoverZone] = useState<'reply' | 'copy' | 'forward' | 'delete' | null>(null);
  const [swipeState, setSwipeState] = useState<{ messageId: string; offsetX: number } | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const recentSendTimesRef = useRef<number[]>([]);
  const isAtBottomRef = useRef(true);
  const needsInitialBottomScrollRef = useRef(true);
  const oldestPagedDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const photoUrlsRef = useRef<Record<string, string>>({});
  const lastTypingSentRef = useRef<number>(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const isTypingSentRef = useRef<boolean>(false);
  const currentUserRef = useRef<Profile>(currentUser);
  const touchSwipeRef = useRef<{
    messageId: string;
    startX: number;
    startY: number;
    locked: 'x' | 'y' | null;
  } | null>(null);
  const lastMarkedIncomingIdRef = useRef<string | null>(null);

  const stagedAttachmentsRef = useRef<StagedAttachment[]>([]);

  useEffect(() => {
    stagedAttachmentsRef.current = stagedAttachments;
  }, [stagedAttachments]);

  const swipeOffsetRef = useRef<{ messageId: string; offsetX: number } | null>(null);

  useEffect(() => {
    photoUrlsRef.current = photoUrls;
  }, [photoUrls]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (smooth && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    isAtBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  useEffect(() => {
    return () => {
      stagedAttachmentsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(photoUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [chat.id]);

  // Load member list, chat metadata, messages, typing, reactions, and read receipts
  useEffect(() => {
    let cancelled = false;
    needsInitialBottomScrollRef.current = true;
    isAtBottomRef.current = true;
    oldestPagedDocRef.current = null;
    setShowScrollToBottom(false);

    setLiveMessages([]);
    setOlderMessages([]);
    setOldestLiveDoc(null);
    setOldestPagedDoc(null);
    setHasMore(false);
    setLoadingInitial(true);
    setLoadError(null);
    setSendError(null);
    setJoinRequests([]);
    setReactions([]);
    setReadReceipts([]);
    setReplyingTo(null);
    setStagedAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setActionMessage(null);
    setShowMoreEmojis(false);
    setHeaderMenuOpen(false);
    setSearchOpen(false);
    setSearchQuery('');
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
      .then((meta) => {
        if (!cancelled) setChatMeta(meta);
      })
      .catch(() => {
        if (!cancelled) setChatMeta(null);
      });

    lastMarkedIncomingIdRef.current = null;
    const unsubscribe = subscribeToLatestMessages(chat.id, (latest, oldestSnap, moreAvailable) => {
      if (cancelled) return;
      setLiveMessages(latest);
      setOldestLiveDoc(oldestSnap);
      setHasMore((prevMore) => (oldestPagedDocRef.current ? prevMore : moreAvailable));
      setLoadingInitial(false);

      if (!document.hidden && latest.length > 0) {
        const latestIncoming = [...latest]
          .reverse()
          .find((m) => m.senderId !== currentUser.id);
        if (latestIncoming && lastMarkedIncomingIdRef.current !== latestIncoming.id) {
          lastMarkedIncomingIdRef.current = latestIncoming.id;
          onChatViewed?.(chat.id);
        }
      }
    });

    const unsubTyping = subscribeToTyping(chat.id, (participants) => {
      if (!cancelled) {
        setRawTypingUsers(participants);
        setTypingClockMs(Date.now());
      }
    });

    const unsubReactions = subscribeToReactions(chat.id, (list) => {
      if (!cancelled) setReactions(list);
    });

    const unsubReceipts = subscribeToReadReceipts(chat.id, (list) => {
      if (!cancelled) setReadReceipts(list);
    });

    const activeChatIdForCleanup = chat.id;
    return () => {
      cancelled = true;
      unsubscribe();
      unsubTyping();
      unsubReactions();
      unsubReceipts();
      if (typingIdleTimerRef.current) {
        window.clearTimeout(typingIdleTimerRef.current);
        typingIdleTimerRef.current = null;
      }
      if (isTypingSentRef.current) {
        isTypingSentRef.current = false;
        lastTypingSentRef.current = 0;
        void setTypingStatus(activeChatIdForCleanup, currentUserRef.current, false);
      }
      setRawTypingUsers([]);
    };
  }, [chat.id, chat.type, currentUser.id, onChatViewed]);

  // Live join requests subscription for private group admins
  useEffect(() => {
    if (
      chat.type !== 'group' ||
      !chatMeta ||
      chatMeta.createdBy !== currentUser.id ||
      chatMeta.visibility !== 'private'
    ) {
      return;
    }

    return subscribeToAdminJoinRequests([chat.id], (_chatId, reqs) => {
      setJoinRequests(reqs);
    });
  }, [chat.id, chat.type, chatMeta, currentUser.id]);

  useEffect(() => {
    if (rawTypingUsers.length === 0) return;
    const timer = window.setInterval(() => {
      setTypingClockMs(Date.now());
    }, 2000);
    return () => window.clearInterval(timer);
  }, [rawTypingUsers.length]);

  const activeTypists = useMemo(() => {
    if (!typingEnabled) return [];
    return rawTypingUsers.filter((p) => {
      if (!p.isTyping || p.userId === currentUser.id || blockedUserIds.has(p.userId)) {
        return false;
      }
      const updatedMs = new Date(p.updatedAt).getTime();
      if (Number.isNaN(updatedMs)) return true;
      return typingClockMs - updatedMs <= 6500;
    });
  }, [rawTypingUsers, typingEnabled, currentUser.id, blockedUserIds, typingClockMs]);

  const clearTypingIndicator = useCallback(() => {
    if (typingIdleTimerRef.current) {
      window.clearTimeout(typingIdleTimerRef.current);
      typingIdleTimerRef.current = null;
    }
    if (isTypingSentRef.current) {
      isTypingSentRef.current = false;
      lastTypingSentRef.current = 0;
      void setTypingStatus(chat.id, currentUserRef.current, false);
    }
  }, [chat.id]);

  useEffect(() => {
    if (!typingEnabled) {
      clearTypingIndicator();
    }
  }, [typingEnabled, clearTypingIndicator]);

  // Close action sheet & header menu on outside click / Escape
  useEffect(() => {
    if (!actionMessage && !headerMenuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (headerMenuOpen && headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActionMessage(null);
        setShowMoreEmojis(false);
        setHeaderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [actionMessage, headerMenuOpen]);

  const visibleMessages = useMemo(() => {
    const liveIds = new Set(liveMessages.map((m) => m.id));
    const merged = [
      ...olderMessages.filter((m) => !liveIds.has(m.id)),
      ...liveMessages,
    ];
    return merged.filter((m) => !blockedUserIds.has(m.senderId));
  }, [olderMessages, liveMessages, blockedUserIds]);

  const displayedMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!searchOpen || !q) return visibleMessages;
    return visibleMessages.filter((msg) => {
      const senderName = getDisplayName(msg.senderId, msg.senderUsername, nicknames).toLowerCase();
      const body = msg.body.toLowerCase();
      const fileName = msg.attachment?.fileName.toLowerCase() ?? '';
      return body.includes(q) || senderName.includes(q) || fileName.includes(q);
    });
  }, [visibleMessages, searchOpen, searchQuery, nicknames]);

  // Group reactions by messageId -> aggregated emoji counts + user's own reaction
  const reactionsByMessage = useMemo(() => {
    const map = new Map<
      string,
      {
        myEmoji: string | null;
        groups: Array<{ emoji: string; count: number; mine: boolean }>;
      }
    >();

    for (const r of reactions) {
      if (!r.messageId || blockedUserIds.has(r.userId)) continue;
      let entry = map.get(r.messageId);
      if (!entry) {
        entry = { myEmoji: null, groups: [] };
        map.set(r.messageId, entry);
      }
      if (r.userId === currentUser.id) {
        entry.myEmoji = r.emoji;
      }
      const existingGroup = entry.groups.find((g) => g.emoji === r.emoji);
      if (existingGroup) {
        existingGroup.count += 1;
        if (r.userId === currentUser.id) existingGroup.mine = true;
      } else {
        entry.groups.push({
          emoji: r.emoji,
          count: 1,
          mine: r.userId === currentUser.id,
        });
      }
    }

    return map;
  }, [reactions, currentUser.id, blockedUserIds]);

  // Latest delivered and read timestamps by any member other than currentUser
  const { maxPeerDeliveredMs, maxPeerReadMs } = useMemo(() => {
    let deliveredMs = 0;
    let readMs = 0;
    for (const receipt of readReceipts) {
      if (receipt.userId === currentUser.id) continue;
      if (receipt.lastDeliveredAt) {
        const dMs = new Date(receipt.lastDeliveredAt).getTime();
        if (!Number.isNaN(dMs) && dMs > deliveredMs) {
          deliveredMs = dMs;
        }
      }
      if (receipt.lastReadAt) {
        const rMs = new Date(receipt.lastReadAt).getTime();
        if (!Number.isNaN(rMs) && rMs > readMs) {
          readMs = rMs;
        }
      }
    }
    return {
      maxPeerDeliveredMs: Math.max(deliveredMs, readMs),
      maxPeerReadMs: readMs,
    };
  }, [readReceipts, currentUser.id]);

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

  // Ensure chat opens directly at the latest messages (bottom) before browser paint
  useLayoutEffect(() => {
    if (loadingInitial) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    if (needsInitialBottomScrollRef.current) {
      el.scrollTop = el.scrollHeight;
      isAtBottomRef.current = true;
      setShowScrollToBottom(false);
      if (displayedMessages.length > 0) {
        needsInitialBottomScrollRef.current = false;
      }
      return;
    }

    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowScrollToBottom(false);
    }
  }, [chat.id, loadingInitial, displayedMessages.length]);

  // Keep pinned to bottom when async photos/attachments finish rendering
  useEffect(() => {
    const contentEl = messagesContentRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!contentEl || !scrollEl || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (needsInitialBottomScrollRef.current || isAtBottomRef.current) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
        setShowScrollToBottom(false);
      }
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [chat.id, loadingInitial, displayedMessages.length]);

  // Prevent browser tab navigation on accidental drops anywhere and reset stuck drag states
  useEffect(() => {
    const preventWindowFileDrop = (e: DragEvent) => {
      const types = Array.from(e.dataTransfer?.types ?? []);
      if (types.includes('Files')) {
        e.preventDefault();
      }
    };
    const clearDragStates = () => {
      setFileDragActive(false);
      setFileDropHoverZone(null);
      setDraggingMessage(null);
      setMsgDropHoverZone(null);
    };
    const onKeyEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearDragStates();
      }
    };
    window.addEventListener('dragover', preventWindowFileDrop);
    window.addEventListener('drop', preventWindowFileDrop);
    window.addEventListener('dragend', clearDragStates);
    window.addEventListener('keydown', onKeyEsc);
    return () => {
      window.removeEventListener('dragover', preventWindowFileDrop);
      window.removeEventListener('drop', preventWindowFileDrop);
      window.removeEventListener('dragend', clearDragStates);
      window.removeEventListener('keydown', onKeyEsc);
    };
  }, []);

  const handleLoadOlder = useCallback(async () => {
    const cursor = oldestPagedDocRef.current ?? oldestLiveDoc;
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
      oldestPagedDocRef.current = page.oldestDoc;
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
  }, [chat.id, hasMore, loadingOlder, oldestLiveDoc]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el || loadingInitial || needsInitialBottomScrollRef.current) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 64;
    isAtBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom && displayedMessages.length > 0);
    if (el.scrollTop < 72 && hasMore && !loadingOlder) {
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

  const stageSelectedFiles = useCallback(
    (incoming: FileList | File[], mode: 'auto' | 'photo' | 'view_once' | 'file') => {
      setSendError(null);
      if (currentUser.banned || isDmBlocked) {
        setSendError('Attachments cannot be added in this conversation right now.');
        return;
      }

      const files = Array.from(incoming);
      if (files.length === 0) return;

      const availableSlots = MAX_STAGED_ATTACHMENTS - stagedAttachmentsRef.current.length;
      if (availableSlots <= 0) {
        setSendError(`You can stage up to ${MAX_STAGED_ATTACHMENTS} attachments at once.`);
        return;
      }

      const nextItems: StagedAttachment[] = [];
      let skippedEmpty = 0;
      let skippedTooLarge = 0;
      let fellBackToFile = false;
      const overflowCount = Math.max(0, files.length - availableSlots);

      for (const file of files.slice(0, availableSlots)) {
        if (file.size <= 0) {
          skippedEmpty += 1;
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          skippedTooLarge += 1;
          continue;
        }

        const fileIsImg = file.type.startsWith('image/');
        if ((mode === 'photo' || mode === 'view_once') && !fileIsImg) {
          fellBackToFile = true;
        }

        const isImage = mode === 'file' ? false : fileIsImg;
        const viewOnce = mode === 'view_once' && isImage;
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        nextItems.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          isImage,
          viewOnce,
          previewUrl,
        });
      }

      if (nextItems.length > 0) {
        setStagedAttachments((prev) => [...prev, ...nextItems]);
        requestAnimationFrame(() => composerInputRef.current?.focus());
      }

      if (skippedTooLarge > 0 && skippedEmpty > 0) {
        setSendError('Some files were skipped (empty or over 5 MB limit).');
      } else if (skippedTooLarge > 0) {
        setSendError(
          skippedTooLarge === 1
            ? 'Attachment skipped: exceeds 5 MB limit.'
            : `${skippedTooLarge} attachments skipped: each file must be 5 MB or less.`,
        );
      } else if (skippedEmpty > 0) {
        setSendError('Empty files cannot be attached.');
      } else if (overflowCount > 0) {
        onToast(`Added ${nextItems.length} files (max ${MAX_STAGED_ATTACHMENTS} queued at once).`);
      } else if (fellBackToFile && nextItems.length > 0) {
        onToast('Non-image files were attached as regular files.');
      }
    },
    [currentUser.banned, isDmBlocked, onToast],
  );

  const removeStagedAttachment = useCallback((id: string) => {
    setStagedAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clearAllStagedAttachments = useCallback(() => {
    setStagedAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
  }, []);

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>, asPhoto: boolean) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    stageSelectedFiles(files, asPhoto ? 'photo' : 'file');
  };

  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        e.preventDefault();
        stageSelectedFiles(imageFiles, 'photo');
      }
    }
  };

  const isExternalFileDrag = (e: React.DragEvent): boolean => {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes('Files') && !types.includes('application/x-buddychat-msg');
  };

  const isInternalMessageDrag = (e: React.DragEvent): boolean => {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes('application/x-buddychat-msg');
  };

  const resolveDraggedMessage = (e: React.DragEvent): ChatMessage | null => {
    if (draggingMessage) return draggingMessage;
    const msgId = e.dataTransfer?.getData('application/x-buddychat-msg');
    if (!msgId) return null;
    return visibleMessages.find((m) => m.id === msgId) ?? null;
  };

  const handleChatDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragActive(true);
  };

  const handleChatDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!fileDragActive) {
      setFileDragActive(true);
    }
  };

  const handleChatDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setFileDragActive(false);
      setFileDropHoverZone(null);
    }
  };

  const handleChatDrop = (
    e: React.DragEvent<HTMLDivElement>,
    mode: 'auto' | 'photo' | 'view_once' | 'file' = 'auto',
  ) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragActive(false);
    setFileDropHoverZone(null);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      stageSelectedFiles(files, mode);
    }
  };

  const handleSend = async () => {
    const trimmed = draft.trim();
    if ((!trimmed && stagedAttachments.length === 0) || sending) return;

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

    const neededSends = Math.max(1, stagedAttachments.length);
    const now = Date.now();
    recentSendTimesRef.current = recentSendTimesRef.current.filter((t) => now - t < 10_000);
    if (recentSendTimesRef.current.length + neededSends > 5) {
      const remaining = Math.max(0, 5 - recentSendTimesRef.current.length);
      setSendError(
        stagedAttachments.length > 1
          ? `Rate limit: max 5 messages per 10 seconds (${remaining} slots available right now).`
          : 'Slow down: max 5 messages per 10 seconds.',
      );
      return;
    }

    clearTypingIndicator();
    setSending(true);
    setSendError(null);
    const outgoingText = trimmed;
    const outgoingAttachments = [...stagedAttachments];
    const outgoingReply = replyingTo;
    setDraft('');
    setStagedAttachments([]);
    setReplyingTo(null);

    let sentCount = 0;
    try {
      if (outgoingAttachments.length === 0) {
        await sendMessage(
          chat.id,
          currentUser,
          outgoingText,
          undefined,
          dmPartner?.id ?? null,
          outgoingReply ? { replyTo: outgoingReply } : undefined,
        );
        recentSendTimesRef.current.push(Date.now());
      } else {
        for (let i = 0; i < outgoingAttachments.length; i++) {
          const item = outgoingAttachments[i];
          const attachmentKind: AttachmentKind = item.isImage
            ? item.viewOnce
              ? 'view_once_photo'
              : 'photo'
            : 'file';

          await sendMessage(
            chat.id,
            currentUser,
            i === 0 ? outgoingText : '',
            { file: item.file, kind: attachmentKind },
            dmPartner?.id ?? null,
            i === 0 && outgoingReply ? { replyTo: outgoingReply } : undefined,
          );
          sentCount += 1;
          recentSendTimesRef.current.push(Date.now());
          if (item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl);
          }
        }
      }
      requestAnimationFrame(() => scrollToBottom());
    } catch (err) {
      const unsent = outgoingAttachments.slice(sentCount);
      if (sentCount === 0) {
        setDraft(outgoingText);
        if (outgoingReply) {
          setReplyingTo(outgoingReply);
        }
      }
      if (unsent.length > 0) {
        setStagedAttachments((prev) => [...unsent, ...prev]);
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

  const handleDraftChange = (nextValue: string) => {
    setDraft(nextValue);

    if (!typingEnabled || currentUser.banned || isDmBlocked) {
      clearTypingIndicator();
      return;
    }

    if (nextValue.trim().length === 0) {
      clearTypingIndicator();
      return;
    }

    if (typingIdleTimerRef.current) {
      window.clearTimeout(typingIdleTimerRef.current);
    }
    typingIdleTimerRef.current = window.setTimeout(() => {
      clearTypingIndicator();
    }, 3000);

    const now = Date.now();
    if (!isTypingSentRef.current || now - lastTypingSentRef.current >= 2400) {
      isTypingSentRef.current = true;
      lastTypingSentRef.current = now;
      void setTypingStatus(chat.id, currentUser, true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleReact = async (msg: ChatMessage, emoji: string) => {
    if (currentUser.banned) return;
    const currentEmoji = reactionsByMessage.get(msg.id)?.myEmoji ?? null;
    setActionMessage(null);
    setShowMoreEmojis(false);
    try {
      await toggleMessageReaction(chat.id, msg.id, currentUser, emoji, currentEmoji);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save reaction.');
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    const text = buildMessageSnippet(msg);
    setActionMessage(null);
    try {
      await navigator.clipboard.writeText(msg.body || text);
      onToast('Copied to clipboard.');
    } catch {
      onToast('Copy failed in this browser.');
    }
  };

  const handleReplyMessage = (msg: ChatMessage) => {
    setReplyingTo({
      messageId: msg.id,
      senderUsername: msg.senderUsername,
      snippet: buildMessageSnippet(msg),
    });
    setActionMessage(null);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const handleDeleteMessage = async (msg: ChatMessage) => {
    if (msg.senderId !== currentUser.id || deletingMessageId) return;
    setDeletingMessageId(msg.id);
    setActionMessage(null);
    try {
      await deleteMessage(chat.id, msg.id);
      onToast('Message deleted.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not delete message.');
    } finally {
      setDeletingMessageId(null);
    }
  };

  const scrollToMessageById = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  const handleExportTranscript = () => {
    setHeaderMenuOpen(false);
    const title = chat.type === 'dm' ? dmDisplayName : chat.name ?? 'Group';
    const lines = visibleMessages.map((m) => {
      const sender = getDisplayName(m.senderId, m.senderUsername, nicknames);
      const time = new Date(m.createdAt).toLocaleString();
      const text = buildMessageSnippet(m);
      return `[${time}] ${sender}: ${text}`;
    });
    const content = `Buddy Chat Transcript — ${title}\nExported ${new Date().toLocaleString()}\n\n${
      lines.length > 0 ? lines.join('\n') : '(No active messages)'
    }\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'chat'}_transcript.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    onToast('Chat transcript exported.');
  };

  const handleKickMember = async (member: Profile) => {
    if (!onRemoveGroupMember || removingMemberId) return;
    setRemovingMemberId(member.id);
    try {
      await onRemoveGroupMember(chat.id, member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      const label = getDisplayName(member.id, member.username, nicknames);
      onToast(`Removed ${label} from the group.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not remove member.');
    } finally {
      setRemovingMemberId(null);
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

  const openNicknameModal = (userId: string, username: string, color?: string) => {
    setNicknameTarget({ userId, username, color });
    setNicknameInput(nicknames[userId] ?? '');
    setNicknameError(null);
  };

  const handleSaveNicknameModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nicknameTarget || savingNickname) return;
    setSavingNickname(true);
    setNicknameError(null);
    try {
      await onSetNickname(nicknameTarget.userId, nicknameInput);
      onToast(`Nickname updated for @${nicknameTarget.username}.`);
      setNicknameTarget(null);
    } catch (err) {
      setNicknameError(err instanceof Error ? err.message : 'Could not save nickname.');
    } finally {
      setSavingNickname(false);
    }
  };

  const handleClearNicknameModal = async () => {
    if (!nicknameTarget || savingNickname) return;
    setSavingNickname(true);
    setNicknameError(null);
    try {
      await onRemoveNickname(nicknameTarget.userId);
      onToast(`Nickname cleared for @${nicknameTarget.username}.`);
      setNicknameTarget(null);
    } catch (err) {
      setNicknameError(err instanceof Error ? err.message : 'Could not remove nickname.');
    } finally {
      setSavingNickname(false);
    }
  };

  const dmDisplayName = dmPartner
    ? getDisplayName(dmPartner.id, dmPartner.username, nicknames)
    : 'Direct Message';
  const dmHasNickname = Boolean(dmPartner && nicknames[dmPartner.id]?.trim());

  const headerTitle =
    chat.type === 'dm' ? dmDisplayName : chat.name ?? 'Group';

  const firstTypistName =
    activeTypists.length > 0
      ? getDisplayName(activeTypists[0].userId, activeTypists[0].username, nicknames)
      : '';

  const headerSubtitle =
    activeTypists.length > 0
      ? activeTypists.length === 1
        ? `${firstTypistName} is typing...`
        : `${activeTypists.length} people typing...`
      : chat.type === 'dm'
        ? dmHasNickname && dmPartner
          ? `@${dmPartner.username} · 24h auto-delete`
          : 'Direct chat · 24h auto-delete'
        : `${members.length} ${members.length === 1 ? 'member' : 'members'} · ${
            isPrivateGroup ? 'Private' : 'Public'
          } · 24h`;

  const lastOwnMessageId = useMemo(() => {
    for (let i = displayedMessages.length - 1; i >= 0; i--) {
      if (displayedMessages[i].senderId === currentUser.id) {
        return displayedMessages[i].id;
      }
    }
    return null;
  }, [displayedMessages, currentUser.id]);

  return (
    <div className="h-full flex bg-white dark:bg-black relative overflow-hidden">
      <div
        className="flex-1 flex flex-col min-w-0 h-full relative"
        onDragEnter={handleChatDragEnter}
        onDragOver={handleChatDragOver}
        onDragLeave={handleChatDragLeave}
        onDrop={(e) => handleChatDrop(e, 'auto')}
      >
        {/* Clean Modern Top Header */}
        <header className="h-15 px-3 sm:px-5 border-b border-slate-200/80 dark:border-white/[0.08] bg-white/90 dark:bg-[#121212]/90 backdrop-blur-md flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackMobile}
              aria-label="Back to chat list"
              className="lg:hidden min-h-[44px] min-w-[44px] -ml-1.5 rounded-full flex items-center justify-center text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {chat.type === 'dm' && dmPartner ? (
              <button
                type="button"
                onClick={() => onOpenProfile(dmPartner.id)}
                className="flex items-center gap-3 min-w-0 text-left hover:opacity-80 transition-opacity"
                title={`View ${dmDisplayName}'s profile`}
              >
                <Avatar
                  username={dmPartner.username}
                  color={dmPartner.color}
                  avatarUrl={dmPartner.avatarUrl}
                  size="sm"
                />
                <div className="min-w-0">
                  <h1 className="text-sm sm:text-base font-bold tracking-tight truncate">
                    {headerTitle}
                  </h1>
                  <p
                    className={`text-xs truncate tabular-nums ${
                      activeTypists.length > 0
                        ? 'text-[#2B84F6] font-medium'
                        : 'text-slate-500 dark:text-neutral-400'
                    }`}
                  >
                    {headerSubtitle}
                  </p>
                </div>
              </button>
            ) : (
              <>
                <div
                  className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${
                    isPrivateGroup
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-slate-100 dark:bg-[#242426] text-slate-600 dark:text-neutral-300'
                  }`}
                >
                  {isPrivateGroup ? <Lock className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm sm:text-base font-bold tracking-tight truncate">
                    {headerTitle}
                  </h1>
                  <p
                    className={`text-xs truncate tabular-nums ${
                      activeTypists.length > 0
                        ? 'text-[#2B84F6] font-medium'
                        : 'text-slate-500 dark:text-neutral-400'
                    }`}
                  >
                    {headerSubtitle}
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
                className="min-h-[38px] px-3 py-1.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap tabular-nums"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Requests ({joinRequests.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setSearchOpen((prev) => {
                  if (prev) setSearchQuery('');
                  return !prev;
                });
              }}
              title="Search messages"
              aria-label="Search messages"
              aria-expanded={searchOpen}
              className={`min-h-[38px] min-w-[38px] rounded-full border flex items-center justify-center transition-colors ${
                searchOpen
                  ? 'border-[#2B84F6]/40 bg-[#2B84F6]/10 text-[#2B84F6]'
                  : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-neutral-300'
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            {chat.type === 'dm' && dmPartner && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    void onToggleFavoriteUser({
                      userId: dmPartner.id,
                      username: dmPartner.username,
                      color: dmPartner.color,
                    })
                  }
                  title={
                    favoriteUserIds.has(dmPartner.id)
                      ? 'Remove from favorites'
                      : 'Add to favorites'
                  }
                  aria-label={
                    favoriteUserIds.has(dmPartner.id)
                      ? 'Remove from favorites'
                      : 'Add to favorites'
                  }
                  className={`min-h-[38px] min-w-[38px] rounded-full border flex items-center justify-center transition-colors ${
                    favoriteUserIds.has(dmPartner.id)
                      ? 'border-amber-500/40 bg-amber-500/12 text-amber-500'
                      : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-600 dark:text-neutral-300'
                  }`}
                >
                  <Star
                    className={`w-4 h-4 ${
                      favoriteUserIds.has(dmPartner.id) ? 'fill-current' : ''
                    }`}
                  />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openNicknameModal(dmPartner.id, dmPartner.username, dmPartner.color)
                  }
                  title={dmHasNickname ? 'Edit friend nickname' : 'Set friend nickname'}
                  aria-label={dmHasNickname ? 'Edit friend nickname' : 'Set friend nickname'}
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    dmHasNickname
                      ? 'border-[#2B84F6]/40 bg-[#2B84F6]/10 text-[#2B84F6]'
                      : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-neutral-300'
                  }`}
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Nickname</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setMembersOpen((prev) => !prev)}
              aria-expanded={membersOpen}
              title="Members"
              className={`min-h-[38px] px-3 py-1.5 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap tabular-nums ${
                membersOpen
                  ? 'border-[#2B84F6]/40 bg-[#2B84F6]/10 text-[#2B84F6]'
                  : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-neutral-300'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>{members.length}</span>
            </button>

            <div className="relative" ref={headerMenuRef}>
              <button
                type="button"
                onClick={() => setHeaderMenuOpen((prev) => !prev)}
                aria-label="More chat options"
                aria-expanded={headerMenuOpen}
                title="More options"
                className={`min-h-[38px] min-w-[38px] rounded-full border flex items-center justify-center transition-colors ${
                  headerMenuOpen
                    ? 'border-[#2B84F6]/40 bg-[#2B84F6]/10 text-[#2B84F6]'
                    : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-neutral-300'
                }`}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {headerMenuOpen && (
                <div className="absolute right-0 top-11 z-40 w-56 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] shadow-xl p-1.5 space-y-0.5 message-enter">
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      void onUpdateChatPrefs(chat.id, { pinned: !chat.pinned });
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                  >
                    <Pin className="w-3.5 h-3.5 text-[#2B84F6]" />
                    <span>{chat.pinned ? 'Unpin chat' : 'Pin chat to top'}</span>
                  </button>

                  {chat.type === 'group' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        void onUpdateChatPrefs(chat.id, { isFavorite: !chat.isFavorite });
                      }}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          chat.isFavorite ? 'text-amber-500 fill-current' : 'text-amber-500'
                        }`}
                      />
                      <span>{chat.isFavorite ? 'Remove favorite' : 'Favorite group'}</span>
                    </button>
                  ) : (
                    dmPartner && (
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          void onToggleFavoriteUser({
                            userId: dmPartner.id,
                            username: dmPartner.username,
                            color: dmPartner.color,
                          });
                        }}
                        className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            favoriteUserIds.has(dmPartner.id)
                              ? 'text-amber-500 fill-current'
                              : 'text-amber-500'
                          }`}
                        />
                        <span>
                          {favoriteUserIds.has(dmPartner.id)
                            ? 'Remove from favorites'
                            : 'Add buddy to favorites'}
                        </span>
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
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
                      setHeaderMenuOpen(false);
                      void onUpdateChatPrefs(chat.id, { markedUnread: true });
                      onBackMobile();
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                  >
                    <MailOpen className="w-3.5 h-3.5 text-slate-500 dark:text-neutral-400" />
                    <span>Mark as unread</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      void onUpdateChatPrefs(chat.id, { archived: !chat.archived });
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                  >
                    <Archive className="w-3.5 h-3.5 text-slate-500 dark:text-neutral-400" />
                    <span>{chat.archived ? 'Unarchive chat' : 'Archive chat'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportTranscript}
                    className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                  >
                    <FileDown className="w-3.5 h-3.5 text-slate-500 dark:text-neutral-400" />
                    <span>Export transcript (.txt)</span>
                  </button>

                  <div className="my-1 border-t border-slate-100 dark:border-white/[0.08]" />

                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      onRequestReport({
                        userId: dmPartner?.id ?? null,
                        label: headerTitle,
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                  >
                    <Flag className="w-3.5 h-3.5 text-slate-500 dark:text-neutral-400" />
                    <span>Report {chat.type === 'dm' ? 'user' : 'group'}</span>
                  </button>

                  {chat.type === 'dm' && dmPartner && !isDmBlocked && (
                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        onRequestBlock({
                          userId: dmPartner.id,
                          username: dmPartner.username,
                          color: dmPartner.color,
                        });
                      }}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      <ShieldBan className="w-3.5 h-3.5" />
                      <span>Block user</span>
                    </button>
                  )}

                  {chat.type === 'group' ? (
                    <button
                      type="button"
                      disabled={leaving}
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        void handleLeave();
                      }}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{leaving ? 'Leaving...' : 'Leave group'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        void onRemoveChat(chat);
                      }}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove chat from list</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {searchOpen && (
          <div className="px-3 sm:px-5 py-2.5 border-b border-slate-200/80 dark:border-white/[0.08] bg-slate-50/90 dark:bg-[#121212] flex items-center gap-2 shrink-0">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages, usernames, or files..."
                autoFocus
                className="w-full min-h-[38px] pl-9 pr-3 py-1 rounded-xl bg-white dark:bg-black border border-slate-200 dark:border-white/[0.1] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
              />
            </div>
            {searchQuery.trim() && (
              <span className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                {displayedMessages.length} {displayedMessages.length === 1 ? 'match' : 'matches'}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchOpen(false);
              }}
              aria-label="Close message search"
              className="min-h-[36px] min-w-[36px] rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/[0.08]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scrollable Message Thread */}
        <div className="flex-1 min-h-0 relative flex flex-col">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overflow-x-hidden chat-scroll px-3 sm:px-6 py-4"
          >
            <div ref={messagesContentRef} className="space-y-3 min-h-full flex flex-col">
              {hasMore && (
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={handleLoadOlder}
                    disabled={loadingOlder}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-full border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#121212] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-xs font-medium text-slate-600 dark:text-neutral-300 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span>{loadingOlder ? 'Loading older...' : 'Load older messages'}</span>
                  </button>
                </div>
              )}

              {loadingInitial ? (
                <div className="space-y-4 py-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`flex ${i % 2 === 1 ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className="h-14 w-64 rounded-2xl bg-slate-100 dark:bg-white/[0.06] animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : loadError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                  {loadError}
                </div>
              ) : displayedMessages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-12 space-y-2">
                  <p className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
                    {searchOpen && searchQuery.trim() ? 'No matching messages' : 'No active messages'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400 max-w-xs leading-relaxed">
                    {searchOpen && searchQuery.trim()
                      ? `Nothing matched "${searchQuery.trim()}" in the last 24 hours.`
                      : `Say hello as ${currentUser.username}, or drag & drop photos/files here. Messages auto-delete after 24 hours.`}
                  </p>
                </div>
              ) : (
                <div className="mt-auto space-y-3">
                  {displayedMessages.map((msg, idx) => {
              const isOwn = msg.senderId === currentUser.id;
              const senderProfile = memberById.get(msg.senderId);
              const senderDisplayName = getDisplayName(
                msg.senderId,
                senderProfile?.username ?? msg.senderUsername,
                nicknames,
              );
              const prevMsg = idx > 0 ? displayedMessages[idx - 1] : null;
              const showDayDivider =
                !prevMsg || formatMessageDay(prevMsg.createdAt) !== formatMessageDay(msg.createdAt);
              const att = msg.attachment ?? null;
              const msgReactions = reactionsByMessage.get(msg.id);
              const msgCreatedMs = new Date(msg.createdAt).getTime();
              const isReadByPeer = isOwn && !msg.pending && maxPeerReadMs >= msgCreatedMs;
              const isDeliveredToPeer =
                isOwn && !msg.pending && !isReadByPeer && maxPeerDeliveredMs >= msgCreatedMs;
              const isLastOwnMsg = isOwn && msg.id === lastOwnMessageId;
              const showGroupSenderName = !isOwn && chat.type === 'group';
              const repliedSource = msg.replyTo
                ? visibleMessages.find((m) => m.id === msg.replyTo!.messageId)
                : null;
              const replyAuthorName = msg.replyTo
                ? repliedSource
                  ? getDisplayName(
                      repliedSource.senderId,
                      msg.replyTo.senderUsername,
                      nicknames,
                    )
                  : msg.replyTo.senderUsername
                : '';
              const swipeOffset = swipeState?.messageId === msg.id ? swipeState.offsetX : 0;

              return (
                <React.Fragment key={msg.id}>
                  {showDayDivider && (
                    <div className="flex items-center justify-center py-2">
                      <span className="text-xs font-medium text-slate-400 dark:text-neutral-500 tabular-nums">
                        {formatMessageDay(msg.createdAt)}
                      </span>
                    </div>
                  )}

                  <div
                    id={`msg-${msg.id}`}
                    className={`group message-enter flex items-end gap-2 min-w-0 ${
                      isOwn ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {!isOwn && chat.type === 'group' && (
                      <button
                        type="button"
                        onClick={() => onOpenProfile(msg.senderId)}
                        title={`View ${senderDisplayName}'s profile`}
                        className="shrink-0 rounded-full hover:opacity-85 transition-opacity mb-5"
                      >
                        <Avatar
                          username={senderProfile?.username ?? msg.senderUsername}
                          color={senderProfile?.color ?? msg.senderColor}
                          avatarUrl={senderProfile?.avatarUrl}
                          size="xs"
                        />
                      </button>
                    )}

                    <div
                      className={`min-w-0 max-w-[84%] sm:max-w-[70%] flex flex-col ${
                        isOwn ? 'items-end' : 'items-start'
                      }`}
                    >
                      {showGroupSenderName && (
                        <button
                          type="button"
                          onClick={() => onOpenProfile(msg.senderId)}
                          className="text-xs font-semibold text-slate-600 dark:text-neutral-400 hover:underline px-1 mb-1 max-w-full truncate"
                        >
                          {senderDisplayName}
                        </button>
                      )}

                        {swipeOffset !== 0 && (
                          <div
                            aria-hidden="true"
                            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                              isOwn ? '-right-14' : '-left-14'
                            } ${
                              Math.abs(swipeOffset) >= 42
                                ? 'bg-[#2B84F6] text-white shadow-sm'
                                : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-neutral-300'
                            }`}
                          >
                            <CornerUpLeft className="w-3.5 h-3.5" />
                            <span>Reply</span>
                          </div>
                        )}

                        <div
                          className={`min-w-0 max-w-full flex items-center gap-1.5 relative ${
                            isOwn ? 'flex-row-reverse' : 'flex-row'
                          } ${draggingMessage?.id === msg.id ? 'opacity-55 scale-[0.98] transition-transform' : ''}`}
                          style={
                            swipeOffset !== 0
                              ? { transform: `translateX(${swipeOffset}px)`, transition: 'none' }
                              : undefined
                          }
                          onTouchStart={(e) => {
                            const touch = e.touches[0];
                            if (!touch) return;
                            touchSwipeRef.current = {
                              messageId: msg.id,
                              startX: touch.clientX,
                              startY: touch.clientY,
                              locked: null,
                            };
                            swipeOffsetRef.current = null;
                          }}
                          onTouchMove={(e) => {
                            const state = touchSwipeRef.current;
                            const touch = e.touches[0];
                            if (!state || state.messageId !== msg.id || !touch) return;
                            const dx = touch.clientX - state.startX;
                            const dy = touch.clientY - state.startY;
                            if (!state.locked) {
                              if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                                state.locked = 'x';
                              } else if (Math.abs(dy) > 10) {
                                state.locked = 'y';
                                return;
                              } else {
                                return;
                              }
                            }
                            if (state.locked === 'x') {
                              const clamped = isOwn
                                ? Math.max(-64, Math.min(0, dx))
                                : Math.min(64, Math.max(0, dx));
                              const nextSwipe = { messageId: msg.id, offsetX: clamped };
                              swipeOffsetRef.current = nextSwipe;
                              setSwipeState(nextSwipe);
                            }
                          }}
                          onTouchEnd={() => {
                            const currentOffset =
                              swipeOffsetRef.current?.messageId === msg.id
                                ? Math.abs(swipeOffsetRef.current.offsetX)
                                : swipeState?.messageId === msg.id
                                  ? Math.abs(swipeState.offsetX)
                                  : 0;
                            touchSwipeRef.current = null;
                            swipeOffsetRef.current = null;
                            setSwipeState(null);
                            if (currentOffset >= 42) {
                              handleReplyMessage(msg);
                            }
                          }}
                          onTouchCancel={() => {
                            touchSwipeRef.current = null;
                            swipeOffsetRef.current = null;
                            setSwipeState(null);
                          }}
                        >
                        <div
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('a, button')) return;
                            const selection = window.getSelection()?.toString().trim();
                            if (selection) return;
                            setActionMessage(msg);
                            setShowMoreEmojis(false);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if ((e.target as HTMLElement).closest('a, button')) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setActionMessage(msg);
                              setShowMoreEmojis(false);
                            }
                          }}
                          title="Click for reactions, reply, copy, forward, or delete"
                          className={`min-w-0 max-w-full overflow-hidden cursor-pointer select-text px-4 py-2.5 transition-opacity ${
                            isOwn
                              ? 'bg-[#2B84F6] text-white rounded-2xl rounded-tr-sm'
                              : 'bg-[#F3F4F6] dark:bg-[#242426] text-slate-900 dark:text-neutral-100 rounded-2xl rounded-tl-sm'
                          }`}
                        >
                          {msg.forwarded && (
                            <p
                              className={`text-[11px] font-medium inline-flex items-center gap-1 mb-1 ${
                                isOwn ? 'text-white/80' : 'text-slate-500 dark:text-neutral-400'
                              }`}
                            >
                              <CornerUpRight className="w-3 h-3 shrink-0" />
                              <span>Forwarded</span>
                            </p>
                          )}

                          {msg.replyTo && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                scrollToMessageById(msg.replyTo!.messageId);
                              }}
                              className={`w-full min-w-0 text-left rounded-xl px-2.5 py-1.5 mb-2 text-xs transition-colors ${
                                isOwn
                                  ? 'bg-white/15 hover:bg-white/20 text-white'
                                  : 'bg-black/[0.05] dark:bg-white/[0.07] hover:bg-black/[0.08] text-slate-700 dark:text-neutral-200'
                              }`}
                            >
                              <p className="font-semibold truncate">{replyAuthorName}</p>
                              <p className="opacity-85 line-clamp-1 break-words [overflow-wrap:anywhere]">
                                {msg.replyTo.snippet}
                              </p>
                            </button>
                          )}

                          {msg.body && <RichMessageText text={msg.body} isOwn={isOwn} />}

                          {att && att.kind === 'photo' && (
                            <div
                              className={msg.body ? 'pt-2' : ''}
                              onClick={(e) => e.stopPropagation()}
                            >
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
                                  className="block max-w-xs sm:max-w-sm rounded-xl overflow-hidden border border-black/10 dark:border-white/[0.1] hover:opacity-95 transition-opacity"
                                >
                                  <img
                                    src={photoUrls[att.id]}
                                    alt={att.fileName}
                                    onLoad={() => {
                                      if (isAtBottomRef.current) {
                                        scrollToBottom();
                                      }
                                    }}
                                    className="max-h-72 w-auto object-cover"
                                  />
                                </button>
                              ) : photoErrors[att.id] ? (
                                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black/10 text-xs">
                                  <ImageIcon className="w-4 h-4" />
                                  <span>{photoErrors[att.id]}</span>
                                </div>
                              ) : (
                                <div className="h-40 w-56 rounded-xl bg-black/10 dark:bg-white/[0.08] animate-pulse" />
                              )}
                            </div>
                          )}

                          {att && att.kind === 'view_once_photo' && (
                            <div
                              className={msg.body ? 'pt-2' : ''}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isOwn ? (
                                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/15 text-xs text-white">
                                  <EyeOff className="w-4 h-4 shrink-0" />
                                  <span>View-once photo · {formatBytes(att.sizeBytes)}</span>
                                </div>
                              ) : viewedOnceMap[msg.id] ? (
                                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black/[0.06] dark:bg-white/[0.06] text-xs text-slate-500 dark:text-neutral-400">
                                  <EyeOff className="w-4 h-4 shrink-0" />
                                  <span>View-once photo · Opened</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpenViewOnce(msg, att)}
                                  disabled={Boolean(photoLoading[att.id])}
                                  className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#2B84F6]/12 hover:bg-[#2B84F6]/20 text-[#2B84F6] text-xs font-semibold inline-flex items-center gap-2 transition-colors"
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
                            <div
                              className={msg.body ? 'pt-2' : ''}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div
                                className={`inline-flex items-center gap-3 px-3 py-2 rounded-xl max-w-full ${
                                  isOwn
                                    ? 'bg-white/15 text-white'
                                    : 'bg-white dark:bg-[#121212] border border-slate-200 dark:border-white/[0.08]'
                                }`}
                              >
                                <FileText className="w-5 h-5 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs sm:text-sm font-medium truncate max-w-[180px] sm:max-w-xs">
                                    {att.fileName}
                                  </p>
                                  <p
                                    className={`text-xs tabular-nums ${
                                      isOwn ? 'text-white/75' : 'text-slate-500 dark:text-neutral-400'
                                    }`}
                                  >
                                    {formatBytes(att.sizeBytes)}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadFile(att)}
                                  disabled={downloadingId === att.id}
                                  className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                                    isOwn
                                      ? 'bg-white/20 hover:bg-white/30 text-white'
                                      : 'bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14]'
                                  }`}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>{downloadingId === att.id ? 'Saving...' : 'Download'}</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="opacity-65 sm:opacity-45 group-hover:opacity-100 focus-within:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0">
                          <div
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/x-buddychat-msg', msg.id);
                              e.dataTransfer.setData('text/plain', buildMessageSnippet(msg));
                              e.dataTransfer.effectAllowed = 'move';
                              setDraggingMessage(msg);
                            }}
                            onDragEnd={() => {
                              setDraggingMessage(null);
                              setMsgDropHoverZone(null);
                            }}
                            title="Drag message to Reply, Copy, Forward, Delete, or Composer"
                            aria-label="Drag message to options"
                            className="flex min-h-[30px] min-w-[28px] rounded-full items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-grab active:cursor-grabbing"
                          >
                            <GripVertical className="w-3.5 h-3.5" />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleReplyMessage(msg)}
                            title="Reply"
                            aria-label="Reply to message"
                            className="hidden sm:flex min-h-[30px] min-w-[30px] rounded-full items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                          >
                            <CornerUpLeft className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setActionMessage(msg);
                              setShowMoreEmojis(false);
                            }}
                            aria-label="Message actions"
                            title="Message options"
                            className="min-h-[30px] min-w-[30px] rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Reactions Row */}
                      {msgReactions && msgReactions.groups.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-1 px-1">
                          {msgReactions.groups.map((grp) => (
                            <button
                              key={grp.emoji}
                              type="button"
                              onClick={() => handleReact(msg, grp.emoji)}
                              className={`min-h-[26px] px-2 py-0.5 rounded-full text-xs inline-flex items-center gap-1 border transition-colors tabular-nums ${
                                grp.mine
                                  ? 'bg-[#2B84F6]/12 border-[#2B84F6]/40 text-[#2B84F6] font-semibold'
                                  : 'bg-white dark:bg-[#1C1C1E] border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-white/[0.06]'
                              }`}
                            >
                              <span>{grp.emoji}</span>
                              {grp.count > 1 && <span>{grp.count}</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Timestamp & 3-State Delivery / Seen Indicator */}
                      <div className="flex items-center gap-1 mt-1 px-1 text-[11px] text-slate-400 dark:text-neutral-500 tabular-nums">
                        <span>{formatMessageTime(msg.createdAt)}</span>
                        {isOwn && (
                          msg.pending ? (
                            <>
                              <Clock
                                className="w-3 h-3 text-slate-400 dark:text-neutral-500"
                                aria-label="Sending"
                              />
                              {isLastOwnMsg && <span>Sending</span>}
                            </>
                          ) : isReadByPeer ? (
                            <>
                              <CheckCheck
                                className="w-3.5 h-3.5 text-[#2B84F6]"
                                aria-label="Seen"
                              />
                              {isLastOwnMsg && (
                                <span className="text-[#2B84F6] font-medium">Seen</span>
                              )}
                            </>
                          ) : isDeliveredToPeer ? (
                            <>
                              <CheckCheck
                                className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-500"
                                aria-label="Delivered"
                              />
                              {isLastOwnMsg && <span>Delivered</span>}
                            </>
                          ) : (
                            <>
                              <Check
                                className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-500"
                                aria-label="Sent"
                              />
                              {isLastOwnMsg && <span>Sent</span>}
                            </>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
                </div>
              )}
            </div>
          </div>

          {showScrollToBottom && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              aria-label="Jump to latest messages"
              title="Jump to latest"
              className="absolute bottom-3 right-4 z-20 h-10 w-10 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.12] shadow-lg text-slate-700 dark:text-neutral-200 hover:text-[#2B84F6] flex items-center justify-center transition-colors"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Composer Dock (also supports dropping a dragged message to reply) */}
        <div
          onDragEnter={(e) => {
            if (isInternalMessageDrag(e) || draggingMessage) {
              e.preventDefault();
              e.stopPropagation();
              setMsgDropHoverZone('reply');
            }
          }}
          onDragOver={(e) => {
            if (isInternalMessageDrag(e) || draggingMessage) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              setMsgDropHoverZone('reply');
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setMsgDropHoverZone((z) => (z === 'reply' ? null : z));
            }
          }}
          onDrop={(e) => {
            if (isInternalMessageDrag(e) || draggingMessage) {
              e.preventDefault();
              e.stopPropagation();
              const target = resolveDraggedMessage(e);
              setDraggingMessage(null);
              setMsgDropHoverZone(null);
              if (target) {
                handleReplyMessage(target);
              }
            }
          }}
          className={`p-3 sm:p-4 border-t border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#121212] shrink-0 space-y-2.5 transition-colors ${
            draggingMessage
              ? msgDropHoverZone === 'reply'
                ? 'ring-2 ring-inset ring-[#2B84F6] bg-[#2B84F6]/[0.06]'
                : 'ring-2 ring-inset ring-dashed ring-[#2B84F6]/45'
              : ''
          }`}
        >
          {draggingMessage && (
            <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[#2B84F6] py-0.5">
              <CornerUpLeft className="w-3.5 h-3.5" />
              <span>Drop message onto composer or dock below to act</span>
            </div>
          )}

          {activeTypists.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2.5 px-1 text-xs text-slate-600 dark:text-neutral-300 message-enter"
            >
              <div className="flex -space-x-1.5 shrink-0">
                {activeTypists.slice(0, 3).map((typist) => {
                  const typistName = getDisplayName(typist.userId, typist.username, nicknames);
                  return (
                    <div
                      key={typist.userId}
                      className="h-5 w-5 rounded-full ring-2 ring-white dark:ring-[#121212] flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: typist.color }}
                    >
                      {typistName.slice(0, 1).toUpperCase()}
                    </div>
                  );
                })}
              </div>

              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-white/[0.06]">
                <span
                  className="typing-dot w-1.5 h-1.5 rounded-full bg-[#2B84F6]"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="typing-dot w-1.5 h-1.5 rounded-full bg-[#2B84F6]"
                  style={{ animationDelay: '160ms' }}
                />
                <span
                  className="typing-dot w-1.5 h-1.5 rounded-full bg-[#2B84F6]"
                  style={{ animationDelay: '320ms' }}
                />
              </div>

              <span className="truncate font-medium text-slate-500 dark:text-neutral-400">
                {activeTypists.length === 1
                  ? `${getDisplayName(activeTypists[0].userId, activeTypists[0].username, nicknames)} is typing`
                  : activeTypists.length === 2
                    ? `${getDisplayName(activeTypists[0].userId, activeTypists[0].username, nicknames)} and ${getDisplayName(activeTypists[1].userId, activeTypists[1].username, nicknames)} are typing`
                    : `${getDisplayName(activeTypists[0].userId, activeTypists[0].username, nicknames)} and ${activeTypists.length - 1} others are typing`}
              </span>
            </div>
          )}

          {replyingTo && (
            <div className="px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-black flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#2B84F6] inline-flex items-center gap-1">
                  <CornerUpLeft className="w-3 h-3" />
                  <span>Replying to {replyingTo.senderUsername}</span>
                </p>
                <p className="text-xs text-slate-600 dark:text-neutral-400 truncate mt-0.5">
                  {replyingTo.snippet}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                aria-label="Cancel reply"
                className="min-h-[32px] min-w-[32px] rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/[0.08] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {sendError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 px-1">
              {sendError}
            </p>
          )}

          {stagedAttachments.length > 0 && (
            <div className="space-y-2">
              {stagedAttachments.length > 1 && (
                <div className="flex items-center justify-between px-1 text-xs text-slate-500 dark:text-neutral-400">
                  <span className="font-medium tabular-nums">
                    Queued attachments ({stagedAttachments.length}/{MAX_STAGED_ATTACHMENTS}) · Sends in sequence
                  </span>
                  <button
                    type="button"
                    onClick={clearAllStagedAttachments}
                    className="font-semibold text-red-600 dark:text-red-400 hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              )}

              <div className="max-h-44 overflow-y-auto chat-scroll space-y-1.5 pr-0.5">
                {stagedAttachments.map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-black flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt={`Preview of ${item.file.name}`}
                          className="h-11 w-11 rounded-xl object-cover shrink-0 border border-slate-200 dark:border-white/[0.1]"
                        />
                      ) : (
                        <div className="h-11 w-11 rounded-xl bg-[#2B84F6]/10 text-[#2B84F6] flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{item.file.name}</p>
                        <p className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                          {formatBytes(item.file.size)} · Max 5 MB
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.isImage && (
                        <button
                          type="button"
                          onClick={() =>
                            setStagedAttachments((prev) =>
                              prev.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, viewOnce: !entry.viewOnce }
                                  : entry,
                              ),
                            )
                          }
                          className={`min-h-[34px] px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                            item.viewOnce
                              ? 'bg-[#2B84F6] text-white'
                              : 'border border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-neutral-300 hover:bg-slate-200/70 dark:hover:bg-white/[0.06]'
                          }`}
                        >
                          {item.viewOnce ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                          <span>{item.viewOnce ? 'View once' : 'Standard'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => removeStagedAttachment(item.id)}
                        aria-label={`Remove ${item.file.name}`}
                        className="min-h-[34px] min-w-[34px] rounded-full flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-slate-200/70 dark:hover:bg-white/[0.06]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentUser.banned ? (
            <div className="min-h-[44px] px-4 py-2.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-center">
              Your account is banned from sending messages.
            </div>
          ) : isDmBlocked ? (
            <div className="min-h-[44px] px-4 py-2.5 rounded-2xl bg-slate-100 dark:bg-white/[0.04] text-xs text-slate-600 dark:text-neutral-400 flex items-center">
              You blocked this user. Unblock them in Settings or their Profile to resume chatting.
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <input
                ref={photoInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => handlePickFile(e, true)}
                className="hidden"
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => handlePickFile(e, false)}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={sending}
                title="Share photos or view-once photos (up to 5 files, max 5 MB each)"
                aria-label="Share photos"
                className="min-h-[44px] min-w-[44px] rounded-full border border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-600 dark:text-neutral-300 flex items-center justify-center transition-colors shrink-0"
              >
                <ImageIcon className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                title="Attach files (up to 5 files, max 5 MB each)"
                aria-label="Attach files"
                className="min-h-[44px] min-w-[44px] rounded-full border border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-600 dark:text-neutral-300 flex items-center justify-center transition-colors shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <div className="flex-1 relative min-w-0">
                <textarea
                  ref={composerInputRef}
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handleComposerPaste}
                  maxLength={1000}
                  rows={1}
                  placeholder={`Message ${headerTitle}...`}
                  className="w-full min-h-[44px] max-h-32 px-4 py-2.5 rounded-3xl bg-slate-100 dark:bg-black border border-transparent focus:border-[#2B84F6]/40 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6] resize-none"
                />
                {draft.length >= 750 && (
                  <span className="absolute right-3.5 bottom-2 text-[11px] font-mono tabular-nums text-slate-400 dark:text-neutral-500">
                    {draft.length}/1000
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleSend}
                disabled={sending || (draft.trim().length === 0 && stagedAttachments.length === 0)}
                aria-label="Send message"
                className="min-h-[44px] min-w-[44px] rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Drag-and-Drop File & Photo Options Overlay */}
        {fileDragActive && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => handleChatDrop(e, 'auto')}
            className="absolute inset-0 z-40 bg-slate-900/55 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
          >
            <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.12] shadow-2xl p-5 sm:p-6 space-y-4 relative">
              <button
                type="button"
                onClick={() => {
                  setFileDragActive(false);
                  setFileDropHoverZone(null);
                }}
                aria-label="Close drop overlay"
                className="absolute right-3.5 top-3.5 min-h-[32px] min-w-[32px] rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08]"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="text-center space-y-1">
                <p className="text-base font-bold tracking-tight">Drop files or photos to attach</p>
                <p className="text-xs text-slate-500 dark:text-neutral-400">
                  Up to 5 files at once (max 5 MB each, auto-deletes after 24h). Drop anywhere or pick a mode:
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFileDropHoverZone('photo');
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                    setFileDropHoverZone('photo');
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setFileDropHoverZone((z) => (z === 'photo' ? null : z));
                    }
                  }}
                  onDrop={(e) => handleChatDrop(e, 'photo')}
                  className={`rounded-2xl border-2 border-dashed p-4 flex flex-col items-center justify-center text-center gap-2 transition-all ${
                    fileDropHoverZone === 'photo'
                      ? 'scale-[1.03] shadow-md border-[#2B84F6] bg-[#2B84F6]/12 text-[#2B84F6]'
                      : 'border-slate-300 dark:border-white/[0.16] text-slate-700 dark:text-neutral-200'
                  }`}
                >
                  <ImageIcon className="w-6 h-6 text-[#2B84F6]" />
                  <span className="text-xs font-semibold">Photo</span>
                  <span className="text-[11px] text-slate-500 dark:text-neutral-400">
                    Visible in chat
                  </span>
                </div>

                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFileDropHoverZone('view_once');
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                    setFileDropHoverZone('view_once');
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setFileDropHoverZone((z) => (z === 'view_once' ? null : z));
                    }
                  }}
                  onDrop={(e) => handleChatDrop(e, 'view_once')}
                  className={`rounded-2xl border-2 border-dashed p-4 flex flex-col items-center justify-center text-center gap-2 transition-all ${
                    fileDropHoverZone === 'view_once'
                      ? 'scale-[1.03] shadow-md border-amber-500 bg-amber-500/12 text-amber-500'
                      : 'border-slate-300 dark:border-white/[0.16] text-slate-700 dark:text-neutral-200'
                  }`}
                >
                  <EyeOff className="w-6 h-6 text-amber-500" />
                  <span className="text-xs font-semibold">View-once</span>
                  <span className="text-[11px] text-slate-500 dark:text-neutral-400">
                    Opens once only
                  </span>
                </div>

                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFileDropHoverZone('file');
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                    setFileDropHoverZone('file');
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setFileDropHoverZone((z) => (z === 'file' ? null : z));
                    }
                  }}
                  onDrop={(e) => handleChatDrop(e, 'file')}
                  className={`rounded-2xl border-2 border-dashed p-4 flex flex-col items-center justify-center text-center gap-2 transition-all ${
                    fileDropHoverZone === 'file'
                      ? 'scale-[1.03] shadow-md border-emerald-500 bg-emerald-500/12 text-emerald-500'
                      : 'border-slate-300 dark:border-white/[0.16] text-slate-700 dark:text-neutral-200'
                  }`}
                >
                  <Paperclip className="w-6 h-6 text-emerald-500" />
                  <span className="text-xs font-semibold">File</span>
                  <span className="text-[11px] text-slate-500 dark:text-neutral-400">
                    Any file up to 5 MB
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Drag-and-Drop Message Options Dock */}
        {draggingMessage && (
          <div className="pointer-events-auto absolute bottom-24 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-md border border-slate-200 dark:border-white/[0.12] shadow-2xl p-2 flex items-center gap-1.5 message-enter">
            {(
              [
                {
                  key: 'reply',
                  label: 'Reply',
                  icon: CornerUpLeft,
                  danger: false,
                  show: true,
                },
                {
                  key: 'copy',
                  label: 'Copy',
                  icon: Copy,
                  danger: false,
                  show: true,
                },
                {
                  key: 'forward',
                  label: 'Forward',
                  icon: CornerUpRight,
                  danger: false,
                  show: true,
                },
                {
                  key: 'delete',
                  label: 'Delete',
                  icon: Trash2,
                  danger: true,
                  show: draggingMessage.senderId === currentUser.id,
                },
              ] as const
            )
              .filter((opt) => opt.show)
              .map((opt) => {
                const Icon = opt.icon;
                const isHover = msgDropHoverZone === opt.key;
                return (
                  <div
                    key={opt.key}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMsgDropHoverZone(opt.key);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                      setMsgDropHoverZone(opt.key);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setMsgDropHoverZone((z) => (z === opt.key ? null : z));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const target = resolveDraggedMessage(e);
                      setDraggingMessage(null);
                      setMsgDropHoverZone(null);
                      if (!target) return;
                      if (opt.key === 'reply') {
                        handleReplyMessage(target);
                      } else if (opt.key === 'copy') {
                        void handleCopyMessage(target);
                      } else if (opt.key === 'forward') {
                        setForwardingMessage(target);
                      } else if (opt.key === 'delete') {
                        void handleDeleteMessage(target);
                      }
                    }}
                    className={`flex-1 py-2.5 px-2 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-all ${
                      opt.danger
                        ? isHover
                          ? 'scale-[1.03] border-red-500 bg-red-500/15 text-red-600 dark:text-red-400'
                          : 'border-red-500/30 text-red-600 dark:text-red-400'
                        : isHover
                          ? 'scale-[1.03] border-[#2B84F6] bg-[#2B84F6]/15 text-[#2B84F6]'
                          : 'border-slate-300 dark:border-white/[0.15] text-slate-700 dark:text-neutral-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{opt.label}</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Members & Requests Drawer */}
      {membersOpen && (
        <aside className="fixed inset-0 z-30 lg:static lg:z-auto lg:w-76 bg-white dark:bg-[#121212] lg:border-l border-slate-200 dark:border-white/[0.08] flex flex-col shrink-0">
          <div className="h-15 px-4 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between">
            <h2 className="text-sm font-semibold tabular-nums">
              Members ({members.length})
            </h2>
            <button
              type="button"
              onClick={() => setMembersOpen(false)}
              aria-label="Close member list"
              className="min-h-[44px] min-w-[44px] -mr-2 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white"
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
                  <p className="text-xs text-slate-500 dark:text-neutral-400 px-1">
                    No pending requests.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {joinRequests.map((req) => {
                      const reqDisplay = getDisplayName(req.userId, req.username, nicknames);
                      return (
                        <li
                          key={req.userId}
                          className="p-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/5 space-y-2"
                        >
                          <button
                            type="button"
                            onClick={() => onOpenProfile(req.userId)}
                            className="flex items-center gap-2.5 min-w-0 w-full text-left hover:opacity-80"
                          >
                            <Avatar username={req.username} color={req.color} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{reqDisplay}</p>
                              <p className="text-xs text-slate-500 dark:text-neutral-400">
                                Tap to view profile
                              </p>
                            </div>
                          </button>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleApproveRequest(req)}
                              disabled={processingReqId === req.userId}
                              className="min-h-[36px] px-2.5 py-1 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeclineRequest(req)}
                              disabled={processingReqId === req.userId}
                              className="min-h-[36px] px-2.5 py-1 rounded-full border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium inline-flex items-center justify-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Decline</span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <ul className="space-y-1.5">
              {members.map((member) => {
                const isSelf = member.id === currentUser.id;
                const isBlocked = blockedUserIds.has(member.id);
                const memberDisplay = getDisplayName(member.id, member.username, nicknames);
                const hasNick = Boolean(nicknames[member.id]?.trim());

                return (
                  <li
                    key={member.id}
                    className="p-2.5 rounded-2xl border border-slate-200/80 dark:border-white/[0.06] bg-slate-50/70 dark:bg-[#1C1C1E]/60 space-y-2"
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
                          {memberDisplay}
                          {isSelf && (
                            <span className="ml-1.5 text-xs text-slate-400 dark:text-neutral-500">
                              (you)
                            </span>
                          )}
                          {chatMeta?.createdBy === member.id && chat.type === 'group' && (
                            <span className="ml-1.5 text-xs text-[#2B84F6]">· Admin</span>
                          )}
                        </p>
                        {hasNick && (
                          <p className="text-xs text-slate-500 dark:text-neutral-400 truncate">
                            @{member.username}
                          </p>
                        )}
                        {isBlocked && (
                          <p className="text-xs text-red-500 dark:text-red-400">Blocked</p>
                        )}
                      </div>
                    </button>

                    {!isSelf && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {!isBlocked && (
                          <button
                            type="button"
                            onClick={() => handleStartDm(member.id)}
                            disabled={startingDmId === member.id || currentUser.banned}
                            className="flex-1 min-h-[34px] px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.1] text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors"
                          >
                            <MessageSquarePlus className="w-3.5 h-3.5" />
                            <span>{startingDmId === member.id ? 'Opening...' : 'DM'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void onToggleFavoriteUser({
                              userId: member.id,
                              username: member.username,
                              color: member.color,
                            })
                          }
                          title={
                            favoriteUserIds.has(member.id)
                              ? 'Remove from favorites'
                              : 'Add to favorites'
                          }
                          className={`min-h-[34px] px-2.5 py-1 rounded-full border text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors ${
                            favoriteUserIds.has(member.id)
                              ? 'border-amber-500/40 bg-amber-500/12 text-amber-500'
                              : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                          }`}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              favoriteUserIds.has(member.id) ? 'fill-current' : ''
                            }`}
                          />
                          <span>{favoriteUserIds.has(member.id) ? 'Starred' : 'Star'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            openNicknameModal(member.id, member.username, member.color)
                          }
                          title={hasNick ? 'Edit nickname' : 'Set nickname'}
                          className={`min-h-[34px] px-2.5 py-1 rounded-full border text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors ${
                            hasNick
                              ? 'border-[#2B84F6]/40 bg-[#2B84F6]/10 text-[#2B84F6]'
                              : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                          }`}
                        >
                          <Tag className="w-3.5 h-3.5" />
                          <span>Nick</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onRequestReport({
                              userId: member.id,
                              label: memberDisplay,
                            })
                          }
                          className="min-h-[34px] px-2.5 py-1 rounded-full border border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors"
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
                            className="min-h-[34px] px-2.5 py-1 rounded-full border border-red-500/30 hover:bg-red-500/10 text-xs font-medium text-red-600 dark:text-red-400 inline-flex items-center justify-center gap-1 transition-colors"
                          >
                            <ShieldBan className="w-3.5 h-3.5" />
                            <span>Block</span>
                          </button>
                        )}
                        {isGroupAdmin &&
                          chat.type === 'group' &&
                          chatMeta?.createdBy !== member.id &&
                          onRemoveGroupMember && (
                            <button
                              type="button"
                              onClick={() => void handleKickMember(member)}
                              disabled={removingMemberId === member.id}
                              className="min-h-[34px] px-2.5 py-1 rounded-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-xs font-medium text-red-600 dark:text-red-400 inline-flex items-center justify-center gap-1 transition-colors"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                              <span>
                                {removingMemberId === member.id ? 'Removing...' : 'Remove'}
                              </span>
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

      {/* Interactive Message Action Sheet */}
      {actionMessage && (
        <div
          className="fixed inset-0 z-50 bg-black/30 dark:bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4"
          onClick={() => {
            setActionMessage(null);
            setShowMoreEmojis(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Message actions"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] shadow-2xl overflow-hidden message-enter"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Message Preview Card */}
            <div className="p-4 pb-2">
              <div className="p-3.5 rounded-2xl bg-slate-100/90 dark:bg-black text-sm text-slate-800 dark:text-neutral-200 min-w-0 overflow-hidden">
                <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400 mb-1 truncate">
                  {getDisplayName(
                    actionMessage.senderId,
                    actionMessage.senderUsername,
                    nicknames,
                  )}
                </p>
                <div className="line-clamp-3 leading-relaxed break-words [overflow-wrap:anywhere]">
                  {actionMessage.body ? (
                    <RichMessageText text={actionMessage.body} />
                  ) : (
                    <p>{buildMessageSnippet(actionMessage)}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Emoji React Strip */}
            <div className="px-4 py-3 space-y-2.5 border-b border-slate-100 dark:border-white/[0.08]">
              <p className="text-xs font-medium text-slate-500 dark:text-neutral-400">React</p>
              <div className="flex items-center justify-between gap-1">
                {PRIMARY_REACTIONS.map((emoji) => {
                  const selected =
                    reactionsByMessage.get(actionMessage.id)?.myEmoji === emoji;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      disabled={currentUser.banned}
                      onClick={() => handleReact(actionMessage, emoji)}
                      className={`h-9 w-9 rounded-full text-lg flex items-center justify-center transition-transform hover:scale-110 active:scale-95 ${
                        selected ? 'bg-[#2B84F6]/15 ring-2 ring-[#2B84F6]' : 'hover:bg-slate-100 dark:hover:bg-white/[0.08]'
                      }`}
                    >
                      {emoji}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowMoreEmojis((prev) => !prev)}
                  aria-label="More reactions"
                  className="h-9 w-9 rounded-full bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14] text-slate-600 dark:text-neutral-200 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {showMoreEmojis && (
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  {EXTRA_REACTIONS.map((emoji) => {
                    const selected =
                      reactionsByMessage.get(actionMessage.id)?.myEmoji === emoji;
                    return (
                      <button
                        key={emoji}
                        type="button"
                        disabled={currentUser.banned}
                        onClick={() => handleReact(actionMessage, emoji)}
                        className={`h-9 w-9 rounded-full text-lg flex items-center justify-center transition-transform hover:scale-110 ${
                          selected ? 'bg-[#2B84F6]/15 ring-2 ring-[#2B84F6]' : 'hover:bg-slate-100 dark:hover:bg-white/[0.08]'
                        }`}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action Menu Rows */}
            <div className="divide-y divide-slate-100 dark:divide-white/[0.07]">
              <button
                type="button"
                onClick={() => handleCopyMessage(actionMessage)}
                className="w-full min-h-[48px] px-5 py-3 flex items-center justify-between text-sm font-medium text-slate-800 dark:text-neutral-100 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
              >
                <span>Copy</span>
                <Copy className="w-4 h-4 text-slate-500 dark:text-neutral-400" />
              </button>

              <button
                type="button"
                onClick={() => handleReplyMessage(actionMessage)}
                className="w-full min-h-[48px] px-5 py-3 flex items-center justify-between text-sm font-medium text-slate-800 dark:text-neutral-100 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
              >
                <span>Reply</span>
                <CornerUpLeft className="w-4 h-4 text-slate-500 dark:text-neutral-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  const target = actionMessage;
                  setActionMessage(null);
                  setForwardingMessage(target);
                }}
                className="w-full min-h-[48px] px-5 py-3 flex items-center justify-between text-sm font-medium text-slate-800 dark:text-neutral-100 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
              >
                <span>Forward</span>
                <CornerUpRight className="w-4 h-4 text-slate-500 dark:text-neutral-400" />
              </button>

              {actionMessage.senderId === currentUser.id ? (
                <button
                  type="button"
                  onClick={() => handleDeleteMessage(actionMessage)}
                  className="w-full min-h-[48px] px-5 py-3 flex items-center justify-between text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/[0.06] transition-colors"
                >
                  <span>Delete</span>
                  <Trash2 className="w-4 h-4" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const target = actionMessage;
                      setActionMessage(null);
                      openNicknameModal(
                        target.senderId,
                        target.senderUsername,
                        target.senderColor,
                      );
                    }}
                    className="w-full min-h-[48px] px-5 py-3 flex items-center justify-between text-sm font-medium text-slate-800 dark:text-neutral-100 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                  >
                    <span>
                      {nicknames[actionMessage.senderId]
                        ? 'Edit friend nickname'
                        : 'Set friend nickname'}
                    </span>
                    <Tag className="w-4 h-4 text-slate-500 dark:text-neutral-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = actionMessage;
                      setActionMessage(null);
                      onRequestReport({
                        userId: target.senderId,
                        label: getDisplayName(
                          target.senderId,
                          target.senderUsername,
                          nicknames,
                        ),
                        messageId: target.id,
                      });
                    }}
                    className="w-full min-h-[48px] px-5 py-3 flex items-center justify-between text-sm font-medium text-slate-800 dark:text-neutral-100 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                  >
                    <span>Report message</span>
                    <Flag className="w-4 h-4 text-slate-500 dark:text-neutral-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = actionMessage;
                      setActionMessage(null);
                      onRequestBlock({
                        userId: target.senderId,
                        username: target.senderUsername,
                        color: target.senderColor,
                      });
                    }}
                    className="w-full min-h-[48px] px-5 py-3 flex items-center justify-between text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/[0.06] transition-colors"
                  >
                    <span>
                      Block{' '}
                      {getDisplayName(
                        actionMessage.senderId,
                        actionMessage.senderUsername,
                        nicknames,
                      )}
                    </span>
                    <ShieldBan className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Friend Nickname Modal */}
      {nicknameTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/45 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setNicknameTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="nickname-modal-title"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#141414] border border-slate-200 dark:border-white/[0.1] shadow-2xl p-5 space-y-4 message-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="nickname-modal-title" className="text-base font-bold tracking-tight">
                  Friend nickname
                </h2>
                <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
                  Private label for @{nicknameTarget.username} — only visible to you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNicknameTarget(null)}
                aria-label="Close"
                className="min-h-[36px] min-w-[36px] -mr-1 -mt-1 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNicknameModal} className="space-y-3">
              <input
                type="text"
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                maxLength={32}
                placeholder="Enter a nickname (1-32 chars)"
                autoFocus
                className="w-full min-h-[44px] px-3.5 py-2 rounded-2xl border border-slate-200 dark:border-white/[0.12] bg-slate-50 dark:bg-black text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
              />

              {nicknameError && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {nicknameError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                {nicknames[nicknameTarget.userId] && (
                  <button
                    type="button"
                    onClick={handleClearNicknameModal}
                    disabled={savingNickname}
                    className="mr-auto min-h-[40px] px-3.5 py-1.5 rounded-full border border-red-500/30 hover:bg-red-500/10 text-xs font-semibold text-red-600 dark:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNicknameTarget(null)}
                  className="min-h-[40px] px-4 py-1.5 rounded-full border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNickname || !nicknameInput.trim()}
                  className="min-h-[40px] px-4 py-1.5 rounded-full bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-xs font-semibold"
                >
                  {savingNickname ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Forward Message Modal */}
      <ForwardModal
        message={forwardingMessage}
        chats={allChats}
        currentUser={currentUser}
        nicknames={nicknames}
        onClose={() => setForwardingMessage(null)}
        onForwarded={(targetChatId, label) => {
          onToast(`Forwarded to ${label}.`);
          onSelectChat?.(targetChatId);
        }}
      />

      {/* Image Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4"
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
                  className="min-h-[40px] px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </a>
              )}
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Close image"
                className="min-h-[40px] min-w-[40px] rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <img
            src={lightbox.url}
            alt={lightbox.fileName}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] max-w-full rounded-2xl object-contain select-none"
          />
        </div>
      )}
    </div>
  );
};
