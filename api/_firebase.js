import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let cachedDb;

export function firestore() {
  if (cachedDb) return cachedDb;
  if (!getApps().length) {
    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT;
    const serviceAccount = encoded
      ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
      : JSON.parse(readFileSync(fileURLToPath(new URL('../power-trail-firebase-adminsdk-fbsvc-f90507968c.json', import.meta.url)), 'utf8'));
    initializeApp({ credential: cert(serviceAccount) });
  }
  cachedDb = getFirestore();
  return cachedDb;
}

export function auth() {
  firestore();
  return getAuth();
}
