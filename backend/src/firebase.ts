import { applicationDefault, getApp, getApps, initializeApp } from "firebase-admin/app";
import type { App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let firebaseApp: App | undefined;

export function getFirebaseApp(): App {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not configured");
  }

  firebaseApp = getApps().length > 0
    ? getApp()
    : initializeApp({
        credential: applicationDefault(),
        ...(process.env.FIREBASE_PROJECT_ID
          ? { projectId: process.env.FIREBASE_PROJECT_ID }
          : {})
      });

  return firebaseApp;
}

export function getFirestoreDb() {
  return getFirestore(getFirebaseApp());
}

export async function verifyFirebaseConnection(): Promise<void> {
  await getFirestoreDb().listCollections();
}
