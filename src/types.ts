export interface UsernameHistoryEntry {
  username: string;
  changedAt: string;
}

export interface Profile {
  id: string;
  username: string;
  color: string;
  bio: string;
  avatarUrl: string | null;
  usernameHistory: UsernameHistoryEntry[];
  banned: boolean;
  bannedReason?: string | null;
  bannedAt?: string | null;
  lastUsernameChangeAt: string | null;
  createdAt?: string;
}

export type ChatType = 'dm' | 'group';
export type GroupVisibility = 'public' | 'private';

export interface ChatSummary {
  id: string;
  type: ChatType;
  visibility?: GroupVisibility;
  name: string | null;
  description: string | null;
  createdBy?: string | null;
  createdAt: string;
  partner?: Profile | null;
  memberCount?: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastSenderId?: string | null;
  lastSenderUsername?: string | null;
  lastReadAt?: string | null;
  isFavorite?: boolean;
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
  markedUnread?: boolean;
}

export interface GroupSearchResult {
  id: string;
  name: string;
  description: string | null;
  visibility: GroupVisibility;
  createdBy: string;
  memberCount: number;
  isMember: boolean;
  createdAt: string;
}

export type JoinRequestStatus = 'pending' | 'approved' | 'declined';

export interface JoinRequest {
  userId: string;
  username: string;
  color: string;
  status: JoinRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TypingParticipant {
  userId: string;
  username: string;
  color: string;
  isTyping: boolean;
  updatedAt: string;
}

export type AttachmentKind = 'photo' | 'view_once_photo' | 'file';

export interface AttachmentMeta {
  id: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
}

export interface ReplyMeta {
  messageId: string;
  senderUsername: string;
  snippet: string;
}

export interface MessageReaction {
  id: string;
  messageId: string;
  userId: string;
  username: string;
  emoji: string;
  updatedAt: string;
}

export type DeliveryStatus = 'sent' | 'delivered' | 'seen';

export interface ChatReadReceipt {
  userId: string;
  lastDeliveredAt: string | null;
  lastReadAt: string | null;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderUsername: string;
  senderColor: string;
  body: string;
  attachment?: AttachmentMeta | null;
  replyTo?: ReplyMeta | null;
  forwarded?: boolean;
  createdAt: string;
  expiresAt?: string | null;
  pending?: boolean;
}

export interface BlockEntry {
  blockedId: string;
  blockedUsername: string;
  blockedColor: string;
  createdAt: string;
}

export interface FavoriteEntry {
  targetUserId: string;
  username: string;
  color: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  chatId: string;
  title: string;
  body: string;
  senderUsername?: string;
  senderColor?: string;
  kind: 'message' | 'join_request' | 'group_approved';
  createdAt: string;
  read: boolean;
}

export interface NotificationSettings {
  browserNotifications: boolean;
  soundEnabled: boolean;
  typingIndicators: boolean;
}

export type ThemePreference = 'system' | 'dark' | 'light';

export type AppScreen = 'chat' | 'profile' | 'settings' | 'terms' | 'admin';

export type PlatformRole = 'user' | 'moderator' | 'admin';

export interface StaffAccess {
  role: PlatformRole;
  isPrimaryOwner: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  isStaff: boolean;
  canBan: boolean;
  canManageReports: boolean;
  canManageRooms: boolean;
  canManageStaff: boolean;
  canDeleteUsers: boolean;
}

export interface AdminRecord {
  uid: string;
  username: string;
  color: string;
  addedBy: string;
  addedByUsername: string;
  note?: string | null;
  createdAt: string;
}

export interface ModeratorRecord {
  uid: string;
  username: string;
  color: string;
  canBan: boolean;
  canManageReports: boolean;
  canManageRooms: boolean;
  note?: string | null;
  addedBy: string;
  addedByUsername: string;
  createdAt: string;
}

export interface DeletedUserRecord {
  uid: string;
  username: string;
  reason?: string | null;
  deletedBy: string;
  deletedByUsername: string;
  deletedAt: string;
}

export interface UserActivity {
  uid: string;
  lastSeenAt: string;
  sessionCount: number;
  messagesSentCount: number;
  lastScreen: AppScreen;
}

export type ModerationActionType =
  | 'ban_user'
  | 'unban_user'
  | 'delete_user'
  | 'restore_user'
  | 'add_moderator'
  | 'update_moderator'
  | 'remove_moderator'
  | 'add_admin'
  | 'remove_admin'
  | 'resolve_report'
  | 'dismiss_report'
  | 'reset_profile'
  | 'reset_ratelimit'
  | 'delete_room';

export interface ModerationLog {
  id: string;
  actorId: string;
  actorUsername: string;
  actorRole: 'admin' | 'moderator';
  action: ModerationActionType;
  targetUserId?: string | null;
  targetUsername?: string | null;
  targetChatId?: string | null;
  details: string;
  createdAt: string;
}

export type ReportStatus = 'pending' | 'resolved' | 'dismissed';

export interface ReportEntry {
  id: string;
  reporterId: string;
  reportedUserId: string | null;
  chatId: string | null;
  messageId: string | null;
  reason: string;
  status: ReportStatus;
  resolvedBy?: string | null;
  resolvedByUsername?: string | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface AdminChatRoomSummary {
  id: string;
  type: ChatType;
  visibility: GroupVisibility;
  name: string | null;
  description: string | null;
  createdBy: string;
  memberCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastSenderId: string | null;
  lastSenderUsername: string | null;
  createdAt: string;
}

export interface UserTrackingDetails {
  activity: UserActivity | null;
  rateLimit: {
    windowStart: string;
    count: number;
    lastMessageId: string;
  } | null;
  joinedChats: ChatSummary[];
  blockCount: number;
}

