import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  browserLocalPersistence,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { Firestore, doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { FIREBASE_CONFIG, isFirebaseConfigured } from './env';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestoreDb: Firestore | null = null;
let connectionTested = false;
let persistenceApplied = false;

function ensureInitialized(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase configuration is missing.');
  }

  if (!firebaseApp) {
    firebaseApp =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            apiKey: FIREBASE_CONFIG.apiKey,
            authDomain: FIREBASE_CONFIG.authDomain,
            projectId: FIREBASE_CONFIG.projectId,
            appId: FIREBASE_CONFIG.appId,
          });
  }

  if (!firebaseAuth) {
    firebaseAuth = getAuth(firebaseApp);
    if (!persistenceApplied) {
      persistenceApplied = true;
      void setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {
        // Fallback silently if browser blocks IndexedDB/localStorage in private browsing
      });
    }
  }

  if (!firestoreDb) {
    firestoreDb = getFirestore(firebaseApp, FIREBASE_CONFIG.firestoreDatabaseId);
  }

  return { app: firebaseApp, auth: firebaseAuth, db: firestoreDb };
}

export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseConfigured) return null;
  return ensureInitialized().auth;
}

export function getFirestoreDb(): Firestore {
  return ensureInitialized().db;
}

export async function testFirestoreConnection(): Promise<void> {
  if (connectionTested || !isFirebaseConfigured) return;
  connectionTested = true;
  try {
    const db = getFirestoreDb();
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const auth = getFirebaseAuth();
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function signInWithGoogle(): Promise<User> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase configuration is missing.');
  }

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // Continue even if storage persistence is restricted by private window settings
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

export async function signOutFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  await signOut(auth);
}

export async function deleteCurrentAuthUser(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) return;
  try {
    await deleteUser(user);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'auth/requires-recent-login') {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await reauthenticateWithPopup(user, provider);
      if (result.user.uid !== user.uid) {
        throw new Error('Please re-authenticate with the same Google account to delete this account.');
      }
      await deleteUser(user);
      return;
    }
    throw err;
  }
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => {};
  }
  void testFirestoreConnection();
  return onAuthStateChanged(auth, callback);
}
