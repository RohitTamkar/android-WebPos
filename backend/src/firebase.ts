import { applicationDefault, getApp, getApps, initializeApp } from "firebase-admin/app";
import type { App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

let firebaseApp: App | undefined;

export function getFirebaseApp(): App {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS in backend/.env to your Firebase service-account JSON file");
  }

  const credentialPath = resolve(
    fileURLToPath(new URL("../", import.meta.url)),
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
  if (!existsSync(credentialPath)) {
    throw new Error(`Firebase service-account file does not exist: ${credentialPath}. Update GOOGLE_APPLICATION_CREDENTIALS in backend/.env`);
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;

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
