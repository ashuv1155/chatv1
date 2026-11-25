import firebaseAppletConfig from '../../firebase-applet-config.json';

export const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseAppletConfig.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseAppletConfig.authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseAppletConfig.appId || '',
  firestoreDatabaseId:
    import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    firebaseAppletConfig.firestoreDatabaseId ||
    '(default)',
} as const;

export const isFirebaseConfigured = Boolean(
  FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.authDomain &&
    FIREBASE_CONFIG.projectId &&
    FIREBASE_CONFIG.appId,
);

export function getMissingEnvVars(): string[] {
  const missing: string[] = [];
  if (!FIREBASE_CONFIG.apiKey) missing.push('VITE_FIREBASE_API_KEY');
  if (!FIREBASE_CONFIG.authDomain) missing.push('VITE_FIREBASE_AUTH_DOMAIN');
  if (!FIREBASE_CONFIG.projectId) missing.push('VITE_FIREBASE_PROJECT_ID');
  if (!FIREBASE_CONFIG.appId) missing.push('VITE_FIREBASE_APP_ID');
  return missing;
}
