export interface Profile {
  id: string;
  username: string;
  color: string;
  banned: boolean;
  lastUsernameChangeAt: string | null;
  createdAt?: string;
}

export type ChatType = 'dm' | 'group';

export interface ChatSummary {
  id: string;
  type: ChatType;
  name: string | null;
  description: string | null;
  createdAt: string;
  partner?: Profile | null;
  memberCount?: number;
}

export interface GroupSearchResult {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  isMember: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderUsername: string;
  senderColor: string;
  body: string;
  createdAt: string;
  pending?: boolean;
}

export interface BlockEntry {
  blockedId: string;
  blockedUsername: string;
  blockedColor: string;
  createdAt: string;
}

export type AppScreen = 'chat' | 'settings' | 'terms';
