import type { User } from 'firebase/auth';
import {
  QueryDocumentSnapshot,
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { OperationType, getFirestoreDb, handleFirestoreError } from './firebase';
import type {
  AttachmentKind,
  AttachmentMeta,
  BlockEntry,
  ChatMessage,
  ChatSummary,
  GroupSearchResult,
  GroupVisibility,
  JoinRequest,
  JoinRequestStatus,
  Profile,
  UsernameHistoryEntry,
} from '../types';

const ADJECTIVES = [
  'Silent', 'Velvet', 'Cobalt', 'Amber', 'Lunar', 'Crisp', 'Hidden', 'Swift',
  'Hollow', 'Misty', 'Clever', 'Solar', 'Silver', 'Quiet', 'Brisk', 'Feral',
  'Echo', 'Dusk', 'Frost', 'Pine', 'Cipher', 'Vesper', 'Moss', 'Ashen',
  'Vivid', 'Boreal', 'Wandering', 'Lucent', 'Glacial', 'Obsidian',
];

const NOUNS = [
  'Fox', 'Owl', 'Lynx', 'Raven', 'Otter', 'Falcon', 'Badger', 'Heron',
  'Wolf', 'Crane', 'Moth', 'Finch', 'Viper', 'Wren', 'Stag', 'Puma',
  'Seal', 'Hare', 'Kestrel', 'Sparrow', 'Comet', 'Drift', 'Harbor', 'Lantern',
  'Canyon', 'Pebble', 'Spruce', 'Beacon', 'Signal', 'Ridge',
];

const COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#F43F5E', '#F97316',
  '#EAB308', '#22C55E', '#10B981', '#14B8A6', '#06B6D4',
  '#0EA5E9', '#3B82F6',
];

export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB
const CHUNK_CHAR_SIZE = 600_000;

function randomIndex(max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

function generateUsername(): string {
  const adj = ADJECTIVES[randomIndex(ADJECTIVES.length)];
  const noun = NOUNS[randomIndex(NOUNS.length)];
  const digits = String(randomIndex(10000)).padStart(4, '0');
  return `${adj}${noun}${digits}`;
}

function generateColor(): string {
  return COLORS[randomIndex(COLORS.length)];
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function toNullableIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function parseUsernameHistory(raw: unknown): UsernameHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: UsernameHistoryEntry[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && 'username' in item && 'changedAt' in item) {
      entries.push({
        username: String((item as { username: unknown }).username ?? ''),
        changedAt: toIso((item as { changedAt: unknown }).changedAt),
      });
    }
  }
  return entries.slice(0, 20);
}

function mapProfileData(uid: string, data: DocumentData): Profile {
  return {
    id: String(data.uid ?? uid),
    username: String(data.username ?? 'Anonymous'),
    color: String(data.color ?? '#6366F1'),
    bio: typeof data.bio === 'string' ? data.bio : '',
    avatarUrl: typeof data.avatarUrl === 'string' && data.avatarUrl.startsWith('data:image/') ? data.avatarUrl : null,
    usernameHistory: parseUsernameHistory(data.usernameHistory),
    banned: Boolean(data.banned),
    lastUsernameChangeAt: toNullableIso(data.lastUsernameChangeAt),
    createdAt: toIso(data.createdAt),
  };
}

function parseAttachmentMeta(raw: unknown): AttachmentMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!obj.id || !obj.kind || !obj.fileName || !obj.mimeType) return null;
  const kind =
    obj.kind === 'photo' || obj.kind === 'view_once_photo' || obj.kind === 'file'
      ? obj.kind
      : 'file';
  return {
    id: String(obj.id),
    kind,
    fileName: String(obj.fileName),
    mimeType: String(obj.mimeType),
    sizeBytes: typeof obj.sizeBytes === 'number' ? obj.sizeBytes : 0,
    chunkCount: typeof obj.chunkCount === 'number' ? obj.chunkCount : 1,
  };
}

function mapMessageDoc(
  chatId: string,
  docSnap: QueryDocumentSnapshot<DocumentData>,
): ChatMessage {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    chatId,
    senderId: String(data.senderId ?? ''),
    senderUsername: String(data.senderUsername ?? 'Anonymous'),
    senderColor: String(data.senderColor ?? '#6366F1'),
    body: String(data.body ?? ''),
    attachment: parseAttachmentMeta(data.attachment),
    createdAt: toIso(data.createdAt),
    expiresAt: toNullableIso(data.expiresAt),
    pending: docSnap.metadata.hasPendingWrites,
  };
}

export async function ensureUserProfile(user: User): Promise<Profile> {
  const db = getFirestoreDb();
  const path = `profiles/${user.uid}`;
  const profileRef = doc(db, 'profiles', user.uid);

  let snap;
  try {
    snap = await getDoc(profileRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (snap.exists()) {
    return mapProfileData(user.uid, snap.data());
  }

  const username = generateUsername();
  const color = generateColor();
  try {
    await setDoc(profileRef, {
      uid: user.uid,
      username,
      color,
      bio: '',
      avatarUrl: null,
      usernameHistory: [],
      banned: false,
      lastUsernameChangeAt: null,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: user.uid,
    username,
    color,
    bio: '',
    avatarUrl: null,
    usernameHistory: [],
    banned: false,
    lastUsernameChangeAt: null,
    createdAt: new Date().toISOString(),
  };
}

export async function fetchProfileById(uid: string): Promise<Profile | null> {
  const db = getFirestoreDb();
  const path = `profiles/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'profiles', uid));
    if (!snap.exists()) return null;
    return mapProfileData(uid, snap.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchProfilesMap(uids: string[]): Promise<Record<string, Profile>> {
  const unique = Array.from(new Set(uids.filter(Boolean)));
  if (unique.length === 0) return {};
  const entries = await Promise.all(
    unique.slice(0, 40).map(async (uid) => {
      try {
        const prof = await fetchProfileById(uid);
        return prof ? ([uid, prof] as const) : null;
      } catch {
        return null;
      }
    }),
  );
  const map: Record<string, Profile> = {};
  for (const entry of entries) {
    if (entry) map[entry[0]] = entry[1];
  }
  return map;
}

export async function resizeAvatarImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPEG, PNG, or WebP).');
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Image must be 5 MB or smaller.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode selected image.'));
      image.src = objectUrl;
    });

    const targetSize = 256;
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported in this browser.');

    const minSide = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - minSide) / 2;
    const sy = (img.naturalHeight - minSide) / 2;
    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);

    let quality = 0.84;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 210_000 && quality > 0.35) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    if (dataUrl.length > 218_000) {
      throw new Error('Profile image is still too large after compression.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function updateOwnProfile(
  uid: string,
  updates: { bio: string; avatarUrl: string | null },
): Promise<{ bio: string; avatarUrl: string | null }> {
  const db = getFirestoreDb();
  const path = `profiles/${uid}`;
  const cleanBio = updates.bio.trim().slice(0, 240);
  try {
    await updateDoc(doc(db, 'profiles', uid), {
      bio: cleanBio,
      avatarUrl: updates.avatarUrl,
    });
    return { bio: cleanBio, avatarUrl: updates.avatarUrl };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchMyChats(uid: string): Promise<ChatSummary[]> {
  const db = getFirestoreDb();
  const path = `profiles/${uid}/myChats`;
  try {
    const q = query(collection(db, 'profiles', uid, 'myChats'), orderBy('joinedAt', 'desc'));
    const snap = await getDocs(q);

    const baseChats: ChatSummary[] = snap.docs.map((docSnap) => {
      const data = docSnap.data();
      const type = data.type === 'dm' ? ('dm' as const) : ('group' as const);
      const visibility: GroupVisibility = data.visibility === 'private' ? 'private' : 'public';
      return {
        id: docSnap.id,
        type,
        visibility,
        name: data.name ? String(data.name) : null,
        description: data.description ? String(data.description) : null,
        createdAt: toIso(data.joinedAt),
        partner:
          type === 'dm' && data.partnerId
            ? {
                id: String(data.partnerId),
                username: String(data.partnerUsername ?? 'Anonymous'),
                color: String(data.partnerColor ?? '#6366F1'),
                bio: '',
                avatarUrl: null,
                usernameHistory: [],
                banned: false,
                lastUsernameChangeAt: null,
              }
            : null,
      };
    });

    const partnerIds = baseChats
      .map((c) => c.partner?.id)
      .filter((id): id is string => Boolean(id));
    if (partnerIds.length > 0) {
      const profileMap = await fetchProfilesMap(partnerIds);
      for (const chat of baseChats) {
        if (chat.partner && profileMap[chat.partner.id]) {
          chat.partner = profileMap[chat.partner.id];
        }
      }
    }

    return baseChats;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchChatMetadata(chatId: string): Promise<{
  createdBy: string | null;
  visibility: GroupVisibility;
  memberCount: number;
} | null> {
  const db = getFirestoreDb();
  const path = `chats/${chatId}`;
  try {
    const snap = await getDoc(doc(db, 'chats', chatId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      createdBy: data.createdBy ? String(data.createdBy) : null,
      visibility: data.visibility === 'private' ? 'private' : 'public',
      memberCount: typeof data.memberCount === 'number' ? data.memberCount : 1,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function searchGroups(
  queryText: string,
  memberChatIds: Set<string>,
): Promise<GroupSearchResult[]> {
  const db = getFirestoreDb();
  const path = 'chats';
  try {
    const q = query(collection(db, 'chats'), where('type', '==', 'group'), limit(50));
    const snap = await getDocs(q);
    const normalized = queryText.trim().toLowerCase();

    const groups: GroupSearchResult[] = snap.docs
      .map((docSnap) => {
        const data = docSnap.data();
        const visibility: GroupVisibility = data.visibility === 'private' ? 'private' : 'public';
        return {
          id: docSnap.id,
          name: String(data.name ?? 'Group'),
          description: data.description ? String(data.description) : null,
          visibility,
          createdBy: String(data.createdBy ?? ''),
          memberCount: typeof data.memberCount === 'number' ? data.memberCount : 1,
          isMember: memberChatIds.has(docSnap.id),
          createdAt: toIso(data.createdAt),
        };
      })
      .filter((g) => {
        if (!normalized) return true;
        return (
          g.name.toLowerCase().includes(normalized) ||
          (g.description ?? '').toLowerCase().includes(normalized)
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return groups;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchMyJoinRequestsMap(
  groupIds: string[],
  uid: string,
): Promise<Record<string, JoinRequestStatus>> {
  const db = getFirestoreDb();
  const entries = await Promise.all(
    groupIds.slice(0, 30).map(async (chatId) => {
      try {
        const snap = await getDoc(doc(db, 'chats', chatId, 'joinRequests', uid));
        if (!snap.exists()) return null;
        const status = snap.data().status;
        if (status === 'pending' || status === 'approved' || status === 'declined') {
          return [chatId, status] as const;
        }
        return null;
      } catch {
        return null;
      }
    }),
  );
  const map: Record<string, JoinRequestStatus> = {};
  for (const item of entries) {
    if (item) map[item[0]] = item[1];
  }
  return map;
}

export async function requestJoinPrivateGroup(profile: Profile, chatId: string): Promise<void> {
  const db = getFirestoreDb();
  const path = `chats/${chatId}/joinRequests/${profile.id}`;
  const reqRef = doc(db, 'chats', chatId, 'joinRequests', profile.id);

  let existingSnap;
  try {
    existingSnap = await getDoc(reqRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  try {
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData.status === 'pending') {
        return;
      }
      await updateDoc(reqRef, {
        status: 'pending',
        username: profile.username,
        color: profile.color,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(reqRef, {
        userId: profile.id,
        username: profile.username,
        color: profile.color,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchPendingJoinRequests(chatId: string): Promise<JoinRequest[]> {
  const db = getFirestoreDb();
  const path = `chats/${chatId}/joinRequests`;
  try {
    const q = query(
      collection(db, 'chats', chatId, 'joinRequests'),
      where('status', '==', 'pending'),
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((docSnap) => {
        const data = docSnap.data();
        return {
          userId: String(data.userId ?? docSnap.id),
          username: String(data.username ?? 'Anonymous'),
          color: String(data.color ?? '#6366F1'),
          status: 'pending' as JoinRequestStatus,
          createdAt: toIso(data.createdAt),
          updatedAt: toIso(data.updatedAt),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function approveJoinRequest(chatId: string, req: JoinRequest): Promise<void> {
  const db = getFirestoreDb();
  const chatPath = `chats/${chatId}`;

  let chatSnap;
  try {
    chatSnap = await getDoc(doc(db, 'chats', chatId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, chatPath);
  }
  if (!chatSnap.exists()) {
    throw new Error('Group no longer exists.');
  }
  const chatData = chatSnap.data();

  let memberSnap;
  try {
    memberSnap = await getDoc(doc(db, 'chats', chatId, 'members', req.userId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${chatPath}/members/${req.userId}`);
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'chats', chatId, 'joinRequests', req.userId), {
    status: 'approved',
    updatedAt: serverTimestamp(),
  });

  if (!memberSnap.exists()) {
    batch.set(doc(db, 'chats', chatId, 'members', req.userId), {
      userId: req.userId,
      username: req.username,
      color: req.color,
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'chats', chatId), {
      memberCount: (typeof chatData.memberCount === 'number' ? chatData.memberCount : 0) + 1,
    });
  }

  batch.set(doc(db, 'profiles', req.userId, 'myChats', chatId), {
    chatId,
    type: 'group',
    visibility: chatData.visibility === 'private' ? 'private' : 'public',
    name: String(chatData.name ?? 'Group'),
    description: chatData.description ? String(chatData.description) : null,
    partnerId: null,
    partnerUsername: null,
    partnerColor: null,
    joinedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${chatPath}/joinRequests/${req.userId}`);
  }
}

export async function declineJoinRequest(chatId: string, requesterId: string): Promise<void> {
  const db = getFirestoreDb();
  const path = `chats/${chatId}/joinRequests/${requesterId}`;
  try {
    await updateDoc(doc(db, 'chats', chatId, 'joinRequests', requesterId), {
      status: 'declined',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function searchUsers(
  queryText: string,
  currentUserId: string,
  blockedUserIds: Set<string>,
): Promise<Profile[]> {
  const db = getFirestoreDb();
  const path = 'profiles';
  try {
    const q = query(collection(db, 'profiles'), where('banned', '==', false), limit(100));
    const snap = await getDocs(q);
    const normalized = queryText.trim().toLowerCase();

    return snap.docs
      .map((docSnap) => mapProfileData(docSnap.id, docSnap.data()))
      .filter((p) => {
        if (p.id === currentUserId || blockedUserIds.has(p.id)) return false;
        if (!normalized) return true;
        return p.username.toLowerCase().includes(normalized);
      })
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, 30);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createGroup(
  profile: Profile,
  name: string,
  description: string,
  visibility: GroupVisibility = 'public',
): Promise<string> {
  const db = getFirestoreDb();
  const cleanName = name.trim();
  const cleanDesc = description.trim() || null;
  const chatRef = doc(collection(db, 'chats'));

  const batch = writeBatch(db);
  batch.set(chatRef, {
    type: 'group',
    visibility,
    name: cleanName,
    description: cleanDesc,
    dmKey: null,
    createdBy: profile.id,
    memberCount: 1,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'chats', chatRef.id, 'members', profile.id), {
    userId: profile.id,
    username: profile.username,
    color: profile.color,
    joinedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'profiles', profile.id, 'myChats', chatRef.id), {
    chatId: chatRef.id,
    type: 'group',
    visibility,
    name: cleanName,
    description: cleanDesc,
    partnerId: null,
    partnerUsername: null,
    partnerColor: null,
    joinedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return chatRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chats/${chatRef.id}`);
  }
}

export async function joinGroup(profile: Profile, chatId: string): Promise<void> {
  const db = getFirestoreDb();
  const chatPath = `chats/${chatId}`;

  let chatSnap;
  try {
    chatSnap = await getDoc(doc(db, 'chats', chatId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, chatPath);
  }

  if (!chatSnap.exists()) {
    throw new Error('Group not found.');
  }
  const chatData = chatSnap.data();
  if (chatData.visibility === 'private') {
    throw new Error('This is a private group. Request approval from the group admin.');
  }

  let memberSnap;
  try {
    memberSnap = await getDoc(doc(db, 'chats', chatId, 'members', profile.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${chatPath}/members/${profile.id}`);
  }

  const batch = writeBatch(db);
  if (!memberSnap.exists()) {
    batch.set(doc(db, 'chats', chatId, 'members', profile.id), {
      userId: profile.id,
      username: profile.username,
      color: profile.color,
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'chats', chatId), {
      memberCount: (typeof chatData.memberCount === 'number' ? chatData.memberCount : 0) + 1,
    });
  }

  batch.set(doc(db, 'profiles', profile.id, 'myChats', chatId), {
    chatId,
    type: 'group',
    visibility: 'public',
    name: String(chatData.name ?? 'Group'),
    description: chatData.description ? String(chatData.description) : null,
    partnerId: null,
    partnerUsername: null,
    partnerColor: null,
    joinedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, chatPath);
  }
}

export async function leaveGroup(uid: string, chatId: string): Promise<void> {
  const db = getFirestoreDb();
  const chatPath = `chats/${chatId}`;

  let chatSnap;
  try {
    chatSnap = await getDoc(doc(db, 'chats', chatId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, chatPath);
  }

  const currentCount =
    chatSnap.exists() && typeof chatSnap.data().memberCount === 'number'
      ? chatSnap.data().memberCount
      : 1;

  const batch = writeBatch(db);
  batch.delete(doc(db, 'chats', chatId, 'members', uid));
  if (chatSnap.exists()) {
    batch.update(doc(db, 'chats', chatId), {
      memberCount: Math.max(0, currentCount - 1),
    });
  }
  batch.delete(doc(db, 'profiles', uid, 'myChats', chatId));

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, chatPath);
  }
}

export async function startDm(profile: Profile, targetUserId: string): Promise<string> {
  if (!targetUserId || targetUserId === profile.id) {
    throw new Error('Cannot start a direct message with yourself.');
  }

  const db = getFirestoreDb();
  const sortedIds = [profile.id, targetUserId].sort();
  const dmKey = `${sortedIds[0]}_${sortedIds[1]}`;
  const dmChatId = `dm_${dmKey}`;

  try {
    const existingLink = await getDoc(doc(db, 'profiles', profile.id, 'myChats', dmChatId));
    if (existingLink.exists()) {
      return dmChatId;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `profiles/${profile.id}/myChats/${dmChatId}`);
  }

  let targetSnap;
  try {
    targetSnap = await getDoc(doc(db, 'profiles', targetUserId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `profiles/${targetUserId}`);
  }

  if (!targetSnap.exists()) {
    throw new Error('User not found.');
  }
  const targetData = targetSnap.data();
  const targetUsername = String(targetData.username ?? 'Anonymous');
  const targetColor = String(targetData.color ?? '#6366F1');

  const batch = writeBatch(db);
  batch.set(doc(db, 'chats', dmChatId), {
    type: 'dm',
    name: null,
    description: null,
    dmKey,
    createdBy: profile.id,
    memberCount: 2,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'chats', dmChatId, 'members', profile.id), {
    userId: profile.id,
    username: profile.username,
    color: profile.color,
    joinedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'chats', dmChatId, 'members', targetUserId), {
    userId: targetUserId,
    username: targetUsername,
    color: targetColor,
    joinedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'profiles', profile.id, 'myChats', dmChatId), {
    chatId: dmChatId,
    type: 'dm',
    name: null,
    description: null,
    partnerId: targetUserId,
    partnerUsername: targetUsername,
    partnerColor: targetColor,
    joinedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'profiles', targetUserId, 'myChats', dmChatId), {
    chatId: dmChatId,
    type: 'dm',
    name: null,
    description: null,
    partnerId: profile.id,
    partnerUsername: profile.username,
    partnerColor: profile.color,
    joinedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return dmChatId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chats/${dmChatId}`);
  }
}

export async function fetchChatMembers(chatId: string): Promise<Profile[]> {
  const db = getFirestoreDb();
  const path = `chats/${chatId}/members`;
  try {
    const snap = await getDocs(collection(db, 'chats', chatId, 'members'));
    const baseMembers = snap.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: String(data.userId ?? docSnap.id),
        username: String(data.username ?? 'Anonymous'),
        color: String(data.color ?? '#6366F1'),
        bio: '',
        avatarUrl: null,
        usernameHistory: [],
        banned: false,
        lastUsernameChangeAt: null,
      } satisfies Profile;
    });

    const profileMap = await fetchProfilesMap(baseMembers.map((m) => m.id));
    return baseMembers
      .map((m) => profileMap[m.id] ?? m)
      .sort((a, b) => a.username.localeCompare(b.username));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

function isMessageActive24h(msg: ChatMessage, nowMs: number): boolean {
  if (msg.expiresAt) {
    const expMs = new Date(msg.expiresAt).getTime();
    if (!Number.isNaN(expMs)) return expMs > nowMs;
  }
  const createdMs = new Date(msg.createdAt).getTime();
  return nowMs - createdMs <= TWENTY_FOUR_HOURS_MS;
}

export function subscribeToLatestMessages(
  chatId: string,
  onMessages: (
    latestMessages: ChatMessage[],
    oldestSnapshot: QueryDocumentSnapshot<DocumentData> | null,
    hasMore: boolean,
  ) => void,
): () => void {
  const db = getFirestoreDb();
  const path = `chats/${chatId}/messages`;
  const q = query(
    collection(db, 'chats', chatId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(50),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const nowMs = Date.now();
      const docs = snapshot.docs;
      const oldestSnapshot = docs.length > 0 ? docs[docs.length - 1] : null;
      const messages = [...docs]
        .reverse()
        .map((d) => mapMessageDoc(chatId, d))
        .filter((m) => isMessageActive24h(m, nowMs));

      onMessages(messages, oldestSnapshot, docs.length === 50);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    },
  );
}

export async function fetchOlderMessages(
  chatId: string,
  oldestDoc: QueryDocumentSnapshot<DocumentData>,
  pageSize = 50,
): Promise<{
  messages: ChatMessage[];
  oldestDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}> {
  const db = getFirestoreDb();
  const path = `chats/${chatId}/messages`;
  try {
    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'desc'),
      startAfter(oldestDoc),
      limit(pageSize),
    );
    const snap = await getDocs(q);
    const nowMs = Date.now();
    const docs = snap.docs;
    const nextOldest = docs.length > 0 ? docs[docs.length - 1] : null;
    const messages = [...docs]
      .reverse()
      .map((d) => mapMessageDoc(chatId, d))
      .filter((m) => isMessageActive24h(m, nowMs));

    return {
      messages,
      oldestDoc: nextOldest,
      hasMore: docs.length === pageSize,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) || 'file';
}

export async function sendMessage(
  chatId: string,
  profile: Profile,
  body: string,
  attachmentInput?: { file: File; kind: AttachmentKind },
): Promise<void> {
  const db = getFirestoreDb();
  const msgRef = doc(collection(db, 'chats', chatId, 'messages'));
  const rateLimitRef = doc(db, 'rateLimits', profile.id);
  const path = `chats/${chatId}/messages/${msgRef.id}`;

  if (attachmentInput) {
    if (attachmentInput.file.size <= 0) {
      throw new Error('Selected file is empty.');
    }
    if (attachmentInput.file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('File exceeds the 5 MB limit.');
    }
  }

  let rateSnap;
  try {
    rateSnap = await getDoc(rateLimitRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `rateLimits/${profile.id}`);
  }

  const nowMs = Date.now();
  let nextWindowStart: unknown = serverTimestamp();
  let nextCount = 1;

  if (rateSnap.exists()) {
    const data = rateSnap.data();
    const existingStart = data.windowStart as Timestamp | undefined;
    const existingCount = typeof data.count === 'number' ? data.count : 0;
    const startMs = existingStart ? existingStart.toMillis() : 0;

    if (startMs > 0 && nowMs - startMs < 10_000) {
      if (existingCount >= 5) {
        throw new Error('Slow down: max 5 messages per 10 seconds.');
      }
      nextWindowStart = existingStart;
      nextCount = existingCount + 1;
    }
  }

  let attachmentMeta: AttachmentMeta | null = null;
  if (attachmentInput) {
    const { file, kind } = attachmentInput;
    const buffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const chunks: string[] = [];
    for (let i = 0; i < base64.length; i += CHUNK_CHAR_SIZE) {
      chunks.push(base64.slice(i, i + CHUNK_CHAR_SIZE));
    }
    if (chunks.length > 16) {
      throw new Error('File exceeds the 5 MB limit.');
    }

    const attachmentId = doc(collection(db, 'chats', chatId, 'messages')).id;
    const isViewOnce = kind === 'view_once_photo';

    try {
      await Promise.all(
        chunks.map((chunkData, idx) =>
          setDoc(
            doc(db, 'chats', chatId, 'attachments', attachmentId, 'chunks', String(idx)),
            {
              messageId: msgRef.id,
              senderId: profile.id,
              index: idx,
              isViewOnce,
              data: chunkData,
              createdAt: serverTimestamp(),
            },
          ),
        ),
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `chats/${chatId}/attachments/${attachmentId}`);
    }

    attachmentMeta = {
      id: attachmentId,
      kind,
      fileName: sanitizeFileName(file.name),
      mimeType: (file.type || 'application/octet-stream').slice(0, 120),
      sizeBytes: file.size,
      chunkCount: chunks.length,
    };
  }

  const batch = writeBatch(db);
  batch.set(msgRef, {
    senderId: profile.id,
    senderUsername: profile.username,
    senderColor: profile.color,
    body,
    ...(attachmentMeta ? { attachment: attachmentMeta } : {}),
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(nowMs + TWENTY_FOUR_HOURS_MS),
  });
  batch.set(rateLimitRef, {
    uid: profile.id,
    windowStart: nextWindowStart,
    count: nextCount,
    lastMessageId: msgRef.id,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchAttachmentBlobUrl(
  chatId: string,
  attachment: AttachmentMeta,
): Promise<string> {
  const db = getFirestoreDb();
  const basePath = `chats/${chatId}/attachments/${attachment.id}/chunks`;

  try {
    const snaps = await Promise.all(
      Array.from({ length: attachment.chunkCount }, (_, idx) =>
        getDoc(doc(db, 'chats', chatId, 'attachments', attachment.id, 'chunks', String(idx))),
      ),
    );

    const parts: string[] = [];
    for (const snap of snaps) {
      if (!snap.exists()) {
        throw new Error('Attachment data is unavailable or has expired.');
      }
      parts.push(String(snap.data().data ?? ''));
    }

    const blob = base64ToBlob(parts.join(''), attachment.mimeType);
    return URL.createObjectURL(blob);
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, basePath);
  }
}

export async function hasViewedOnceMessage(
  chatId: string,
  messageId: string,
  viewerUid: string,
): Promise<boolean> {
  const db = getFirestoreDb();
  try {
    const snap = await getDoc(doc(db, 'chats', chatId, 'messages', messageId, 'views', viewerUid));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function openViewOncePhoto(
  chatId: string,
  messageId: string,
  attachment: AttachmentMeta,
  viewerUid: string,
): Promise<string> {
  const db = getFirestoreDb();
  const viewRef = doc(db, 'chats', chatId, 'messages', messageId, 'views', viewerUid);

  const alreadyViewed = await hasViewedOnceMessage(chatId, messageId, viewerUid);
  if (alreadyViewed) {
    throw new Error('This view-once photo was already opened.');
  }

  // Fetch chunks while view record doesn't exist yet, then lock future reads immediately
  const blobUrl = await fetchAttachmentBlobUrl(chatId, attachment);
  try {
    await setDoc(viewRef, {
      viewerId: viewerUid,
      viewedAt: serverTimestamp(),
    });
  } catch (error) {
    URL.revokeObjectURL(blobUrl);
    handleFirestoreError(error, OperationType.CREATE, `chats/${chatId}/messages/${messageId}/views/${viewerUid}`);
  }

  return blobUrl;
}

export async function rotateUsername(profile: Profile): Promise<{
  username: string;
  lastUsernameChangeAt: string;
  usernameHistory: UsernameHistoryEntry[];
}> {
  if (profile.lastUsernameChangeAt) {
    const lastMs = new Date(profile.lastUsernameChangeAt).getTime();
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < 24 * 60 * 60 * 1000) {
      throw new Error('You can only generate a new username once every 24 hours.');
    }
  }

  const db = getFirestoreDb();
  const path = `profiles/${profile.id}`;
  const newUsername = generateUsername();
  const nowIso = new Date().toISOString();
  const nextHistory: UsernameHistoryEntry[] = [
    { username: profile.username, changedAt: nowIso },
    ...(profile.usernameHistory ?? []),
  ].slice(0, 20);

  try {
    await updateDoc(doc(db, 'profiles', profile.id), {
      username: newUsername,
      lastUsernameChangeAt: serverTimestamp(),
      usernameHistory: nextHistory,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  return {
    username: newUsername,
    lastUsernameChangeAt: nowIso,
    usernameHistory: nextHistory,
  };
}

export async function fetchBlocks(uid: string): Promise<BlockEntry[]> {
  const db = getFirestoreDb();
  const path = `profiles/${uid}/blocks`;
  try {
    const q = query(collection(db, 'profiles', uid, 'blocks'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        blockedId: String(data.blockedId ?? docSnap.id),
        blockedUsername: String(data.blockedUsername ?? 'Anonymous'),
        blockedColor: String(data.blockedColor ?? '#64748B'),
        createdAt: toIso(data.createdAt),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function blockUser(
  blockerId: string,
  target: { userId: string; username: string; color?: string },
): Promise<void> {
  const db = getFirestoreDb();
  const path = `profiles/${blockerId}/blocks/${target.userId}`;
  try {
    await setDoc(doc(db, 'profiles', blockerId, 'blocks', target.userId), {
      blockerId,
      blockedId: target.userId,
      blockedUsername: target.username,
      blockedColor: target.color ?? '#64748B',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const db = getFirestoreDb();
  const path = `profiles/${blockerId}/blocks/${blockedId}`;
  try {
    await deleteDoc(doc(db, 'profiles', blockerId, 'blocks', blockedId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function submitReport(params: {
  reporterId: string;
  reportedUserId: string | null;
  chatId: string | null;
  messageId?: string | null;
  reason: string;
}): Promise<void> {
  const db = getFirestoreDb();
  const reportRef = doc(collection(db, 'reports'));
  const path = `reports/${reportRef.id}`;
  try {
    await setDoc(reportRef, {
      reporterId: params.reporterId,
      reportedUserId: params.reportedUserId ?? null,
      chatId: params.chatId ?? null,
      messageId: params.messageId ?? null,
      reason: params.reason.trim(),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
