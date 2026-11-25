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

export type ThemePreference = 'system' | 'dark' | 'light';

export type AppScreen = 'chat' | 'profile' | 'settings' | 'terms';
