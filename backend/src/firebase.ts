import { applicationDefault, cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import type { App, AppOptions } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Each Cloud Storage download stacks node-fetch, teeny-request and Storage
// pipelines on one response body (11 error/close listeners). That is expected,
// not a leak, but trips Node's default limit of 10 on every logo read.
EventEmitter.defaultMaxListeners = 15;

let firebaseApp: App | undefined;

export type FirebaseConfigurationCheck =
  | "missing_test_project_id" | "invalid_test_project_id"
  | "missing_production_project_id" | "invalid_production_project_id"
  | "shared_firebase_project" | "project_override_mismatch" | "emulator_override"
  | "missing_credentials" | "credential_file_unavailable"
  | "invalid_service_account_json" | "invalid_service_account_shape"
  | "service_account_project_mismatch" | "invalid_service_account_fields"
  | "invalid_private_key" | "unverified_existing_app" | "admin_initialization_failed" | "missing_storage_bucket";

export class FirebaseConfigurationError extends Error {
  constructor(message: string, public readonly check: FirebaseConfigurationCheck) {
    super(message);
    this.name = "FirebaseConfigurationError";
  }
}

export function logFirebaseConfigurationError(
  error: unknown,
  context: "login" | "startup" | "connection",
  writeLog: (event: string, metadata: Record<string, string>) => void = console.error
): void {
  // Do not serialize the error, its stack/cause, environment values, or request data.
  writeLog("Firebase configuration check failed", {
    context, check: error instanceof FirebaseConfigurationError ? error.check : "unexpected_error"
  });
}

// Never include parser/SDK errors: they may contain credential material.
function configurationError(message: string, check: FirebaseConfigurationCheck): never {
  throw new FirebaseConfigurationError(message, check);
}

export function firebaseConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  readCredentials: (path: string) => string = path => readFileSync(path, "utf8")
): { options: AppOptions; isolated: boolean } {
  const jsonProvided = env.FIREBASE_SERVICE_ACCOUNT_JSON !== undefined;
  // Project IDs bind this client to the test database; they do not prove IAM permissions.
  // Before enabling this configuration, verify the test account has no production IAM grants.
  // The testing project's Production deployment also needs isolation; Preview alone is insufficient.
  const isolated = jsonProvided || env.FIREBASE_TEST_PROJECT_ID !== undefined
    || env.VERCEL_PROJECT_PRODUCTION_URL === "android-webpos-testing.vercel.app"
    || env.VERCEL_ENV === "preview";
  let testingProject: string | undefined;
  if (isolated) {
    testingProject = env.FIREBASE_TEST_PROJECT_ID?.trim();
    const productionProject = env.FIREBASE_PRODUCTION_PROJECT_ID?.trim();
    const projectId = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
    for (const [name, value] of [
      ["FIREBASE_TEST_PROJECT_ID", testingProject],
      ["FIREBASE_PRODUCTION_PROJECT_ID", productionProject]
    ] as const) {
      if (!value) {
        configurationError(`Testing Firebase is blocked: ${name} is missing. Set it in the Vercel deployment environment and redeploy.`,
          name === "FIREBASE_TEST_PROJECT_ID" ? "missing_test_project_id" : "missing_production_project_id");
      }
      if (!projectId.test(value)) {
        configurationError(`Testing Firebase is blocked: ${name} is not a valid Firebase project ID. Use the Project ID from Firebase project settings, without quotes or a URL.`,
          name === "FIREBASE_TEST_PROJECT_ID" ? "invalid_test_project_id" : "invalid_production_project_id");
      }
    }
    if (testingProject === productionProject) {
      configurationError("Testing Firebase is blocked: FIREBASE_TEST_PROJECT_ID and FIREBASE_PRODUCTION_PROJECT_ID are identical. Full testing requires a separate Firebase project to protect Android POS data.", "shared_firebase_project");
    }
    if (env.FIREBASE_PROJECT_ID !== undefined && env.FIREBASE_PROJECT_ID !== testingProject) {
      configurationError("Testing Firebase is blocked: FIREBASE_PROJECT_ID must match FIREBASE_TEST_PROJECT_ID.", "project_override_mismatch");
    }
    if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) {
      configurationError("Testing Firebase is blocked: emulator overrides are not supported by this isolation configuration.", "emulator_override");
    }
  }

  if (!jsonProvided && !env.GOOGLE_APPLICATION_CREDENTIALS) {
    configurationError("Firebase credentials are missing. Configure FIREBASE_SERVICE_ACCOUNT_JSON on Vercel or GOOGLE_APPLICATION_CREDENTIALS locally.", "missing_credentials");
  }
  const credentialPath = env.GOOGLE_APPLICATION_CREDENTIALS ? resolve(
    fileURLToPath(new URL("../", import.meta.url)),
    env.GOOGLE_APPLICATION_CREDENTIALS
  ) : undefined;
  let source: string;
  try {
    source = jsonProvided ? env.FIREBASE_SERVICE_ACCOUNT_JSON! : readCredentials(credentialPath!);
  } catch {
    configurationError("Firebase service-account file is unavailable. Check GOOGLE_APPLICATION_CREDENTIALS.", "credential_file_unavailable");
  }

  // Preserve local ADC behavior, including its existing optional project override.
  if (!isolated) {
    env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath!;
    return { isolated, options: { credential: applicationDefault(),
      ...(env.FIREBASE_PROJECT_ID ? { projectId: env.FIREBASE_PROJECT_ID } : {}) } };
  }

  let account: unknown;
  try { account = JSON.parse(source); } catch {
    configurationError("Firebase service-account JSON is invalid.", "invalid_service_account_json");
  }
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    configurationError("Firebase service-account JSON must be an object.", "invalid_service_account_shape");
  }
  const fields = account as Record<string, unknown>;
  if (fields.project_id !== testingProject) {
    configurationError("Testing Firebase credentials must belong to FIREBASE_TEST_PROJECT_ID.", "service_account_project_mismatch");
  }
  if (fields.type !== "service_account" || typeof fields.client_email !== "string"
    || !new RegExp(`^[a-zA-Z0-9_-]+@${testingProject}\\.iam\\.gserviceaccount\\.com$`).test(fields.client_email)
    || typeof fields.private_key !== "string") {
    configurationError("Testing Firebase credentials must belong to FIREBASE_TEST_PROJECT_ID and contain a service-account email and private key.", "invalid_service_account_fields");
  }
  const privateKey = fields.private_key.replace(/\\n/g, "\n");
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    return { isolated, options: { projectId: testingProject!, credential: cert({
      projectId: testingProject!, clientEmail: fields.client_email, privateKey
    }) } };
  } catch {
    configurationError("Firebase service-account private key is invalid.", "invalid_private_key");
  }
}

export function getFirebaseApp(): App {
  if (firebaseApp) return firebaseApp;
  const { options, isolated } = firebaseConfiguration();
  // An unrelated existing Admin app may carry a different credential; never reuse it in testing.
  if (isolated && getApps().length > 0) {
    configurationError("Testing Firebase is blocked: an unverified Firebase Admin app is already initialized.", "unverified_existing_app");
  }
  try {
    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(options);
  } catch {
    configurationError("Firebase Admin initialization failed. Check the server credential configuration.", "admin_initialization_failed");
  }

  return firebaseApp;
}

export function getFirestoreDb() {
  return getFirestore(getFirebaseApp());
}

// Resolve the same project/credential used by this Admin app for typed REST writes.
export function getFirestoreRestContext() {
  const app = getFirebaseApp();
  const credential = app.options.credential;
  if (!credential) throw new Error('Firebase credential unavailable.');
  const source = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? readFileSync(resolve(
    fileURLToPath(new URL('../', import.meta.url)), process.env.GOOGLE_APPLICATION_CREDENTIALS ?? ''), 'utf8');
  const projectId = app.options.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
    || (JSON.parse(source) as { project_id?: string }).project_id;
  if (!projectId) throw new Error('Firebase project unavailable.');
  return { database: `projects/${projectId}/databases/${getFirestoreDb().databaseId}`,
    accessToken: async () => (await credential.getAccessToken()).access_token };
}

export function getFirebaseStorageBucket(): ReturnType<ReturnType<typeof getStorage>['bucket']> {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (!bucketName) configurationError("Firebase Storage is not configured. Set FIREBASE_STORAGE_BUCKET on the backend.", "missing_storage_bucket");
  return getStorage(getFirebaseApp()).bucket(bucketName);
}

export async function verifyFirebaseConnection(): Promise<void> {
  await getFirestoreDb().listCollections();
}
