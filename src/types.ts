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

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderUsername: string;
  senderColor: string;
  body: string;
  attachment?: AttachmentMeta | null;
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

export type AppScreen = 'chat' | 'profile' | 'settings' | 'terms';
