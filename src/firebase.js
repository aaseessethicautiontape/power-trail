import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'firebase/auth';

// Firebase web configuration is public client metadata; the Admin credential stays server-only
// (Vercel env var FIREBASE_SERVICE_ACCOUNT, read only by the /api functions).
const app = initializeApp({
  apiKey: 'AIzaSyBNe67jlQmW1jKXnzMrBblX5akdbhjY8Ns',
  authDomain: 'power-trail.firebaseapp.com',
  projectId: 'power-trail',
  appId: '1:528269314203:web:7a9f0cd888c440d12f5e3e',
});

export const firebaseAuth = getAuth(app);

// Finishes a sign-in that used the redirect fallback (phones that block popups).
getRedirectResult(firebaseAuth).catch((error) => console.warn('Google redirect sign-in failed:', error?.code || 'unknown error'));

export function observeFirebaseAuth(callback) {
  return onAuthStateChanged(firebaseAuth, callback);
}

// "Continue with Google". A popup first; if the browser blocks popups, a full-page redirect.
// Closing the popup isn't an error, so it resolves to null.
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(firebaseAuth, provider);
  } catch (error) {
    const code = error?.code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(code)) {
      await signInWithRedirect(firebaseAuth, provider);
      return null;
    }
    throw error;
  }
}

export async function signOutGoogle() {
  return signOut(firebaseAuth);
}

// First name for the account pill ("Hi, Sam"). Never shows an email address on screen.
export function firstName(user) {
  const name = (user?.displayName ?? '').trim().split(/\s+/)[0];
  return name || 'Player';
}

// Calls /api/progress with the player's Google ID token. GET reads, POST saves a run.
export async function requestProgress(method, run) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Sign in with Google first');
  const token = await user.getIdToken();
  const response = await fetch('/api/progress', {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(run ? { 'Content-Type': 'application/json' } : {}) },
    ...(run ? { body: JSON.stringify({ starter: run.starter, runSeed: run.runSeed, history: run.history }) } : {}),
  });
  let data = null;
  try { data = await response.json(); } catch { /* an HTML error page from a dev server, say */ }
  if (!response.ok) throw new Error(data?.reason || `Progress sync failed (${response.status})`);
  return data;
}
