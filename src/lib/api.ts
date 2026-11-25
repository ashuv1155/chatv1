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
  BlockEntry,
  ChatMessage,
  ChatSummary,
  GroupSearchResult,
  Profile,
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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
    createdAt: toIso(data.createdAt),
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
    const data = snap.data();
    return {
      id: user.uid,
      username: String(data.username),
      color: String(data.color),
      banned: Boolean(data.banned),
      lastUsernameChangeAt: toNullableIso(data.lastUsernameChangeAt),
      createdAt: toIso(data.createdAt),
    };
  }

  const username = generateUsername();
  const color = generateColor();
  try {
    await setDoc(profileRef, {
      uid: user.uid,
      username,
      color,
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
    banned: false,
    lastUsernameChangeAt: null,
    createdAt: new Date().toISOString(),
  };
}

export async function fetchMyChats(uid: string): Promise<ChatSummary[]> {
  const db = getFirestoreDb();
  const path = `profiles/${uid}/myChats`;
  try {
    const q = query(collection(db, 'profiles', uid, 'myChats'), orderBy('joinedAt', 'desc'));
    const snap = await getDocs(q);

    return snap.docs.map((docSnap) => {
      const data = docSnap.data();
      const type = data.type === 'dm' ? 'dm' : 'group';
      return {
        id: docSnap.id,
        type,
        name: data.name ? String(data.name) : null,
        description: data.description ? String(data.description) : null,
        createdAt: toIso(data.joinedAt),
        partner:
          type === 'dm' && data.partnerId
            ? {
                id: String(data.partnerId),
                username: String(data.partnerUsername ?? 'Anonymous'),
                color: String(data.partnerColor ?? '#6366F1'),
                banned: false,
                lastUsernameChangeAt: null,
              }
            : null,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
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
        return {
          id: docSnap.id,
          name: String(data.name ?? 'Group'),
          description: data.description ? String(data.description) : null,
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
      .map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.uid ?? docSnap.id),
          username: String(data.username ?? 'Anonymous'),
          color: String(data.color ?? '#6366F1'),
          banned: false,
          lastUsernameChangeAt: toNullableIso(data.lastUsernameChangeAt),
          createdAt: toIso(data.createdAt),
        } as Profile;
      })
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
): Promise<string> {
  const db = getFirestoreDb();
  const cleanName = name.trim();
  const cleanDesc = description.trim() || null;
  const chatRef = doc(collection(db, 'chats'));

  const batch = writeBatch(db);
  batch.set(chatRef, {
    type: 'group',
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

  // Check if DM already exists in caller's own myChats subcollection
  try {
    const existingLink = await getDoc(doc(db, 'profiles', profile.id, 'myChats', dmChatId));
    if (existingLink.exists()) {
      return dmChatId;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `profiles/${profile.id}/myChats/${dmChatId}`);
  }

  // Load recipient's anonymous profile
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
    return snap.docs
      .map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.userId ?? docSnap.id),
          username: String(data.username ?? 'Anonymous'),
          color: String(data.color ?? '#6366F1'),
          banned: false,
          lastUsernameChangeAt: null,
        };
      })
      .sort((a, b) => a.username.localeCompare(b.username));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
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
      const cutoffMs = Date.now() - SEVEN_DAYS_MS;
      const docs = snapshot.docs;
      const oldestSnapshot = docs.length > 0 ? docs[docs.length - 1] : null;
      const messages = [...docs]
        .reverse()
        .map((d) => mapMessageDoc(chatId, d))
        .filter((m) => new Date(m.createdAt).getTime() >= cutoffMs);

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
    const cutoffMs = Date.now() - SEVEN_DAYS_MS;
    const docs = snap.docs;
    const nextOldest = docs.length > 0 ? docs[docs.length - 1] : null;
    const messages = [...docs]
      .reverse()
      .map((d) => mapMessageDoc(chatId, d))
      .filter((m) => new Date(m.createdAt).getTime() >= cutoffMs);

    return {
      messages,
      oldestDoc: nextOldest,
      hasMore: docs.length === pageSize,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function sendMessage(
  chatId: string,
  profile: Profile,
  body: string,
): Promise<void> {
  const db = getFirestoreDb();
  const msgRef = doc(collection(db, 'chats', chatId, 'messages'));
  const rateLimitRef = doc(db, 'rateLimits', profile.id);
  const path = `chats/${chatId}/messages/${msgRef.id}`;

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

  const batch = writeBatch(db);
  batch.set(msgRef, {
    senderId: profile.id,
    senderUsername: profile.username,
    senderColor: profile.color,
    body,
    createdAt: serverTimestamp(),
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

export async function rotateUsername(profile: Profile): Promise<{
  username: string;
  lastUsernameChangeAt: string;
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

  try {
    await updateDoc(doc(db, 'profiles', profile.id), {
      username: newUsername,
      lastUsernameChangeAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  return {
    username: newUsername,
    lastUsernameChangeAt: new Date().toISOString(),
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
