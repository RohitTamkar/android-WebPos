import { applicationDefault, cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
let firebaseApp;
export class FirebaseConfigurationError extends Error {
}
// Never include parser/SDK errors: they may contain credential material.
function configurationError(message) {
    throw new FirebaseConfigurationError(message);
}
export function firebaseConfiguration(env = process.env, readCredentials = path => readFileSync(path, "utf8")) {
    const jsonProvided = env.FIREBASE_SERVICE_ACCOUNT_JSON !== undefined;
    // Project IDs bind this client to the test database; they do not prove IAM permissions.
    // Before enabling this configuration, verify the test account has no production IAM grants.
    // The testing project's Production deployment also needs isolation; Preview alone is insufficient.
    const isolated = jsonProvided || env.FIREBASE_TEST_PROJECT_ID !== undefined
        || env.VERCEL_PROJECT_PRODUCTION_URL === "android-webpos-testing.vercel.app"
        || env.VERCEL_ENV === "preview";
    let testingProject;
    if (isolated) {
        testingProject = env.FIREBASE_TEST_PROJECT_ID?.trim();
        const productionProject = env.FIREBASE_PRODUCTION_PROJECT_ID?.trim();
        const projectId = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
        if (!testingProject || !productionProject || !projectId.test(testingProject)
            || !projectId.test(productionProject) || testingProject === productionProject) {
            configurationError("Testing Firebase is blocked: configure distinct FIREBASE_TEST_PROJECT_ID and FIREBASE_PRODUCTION_PROJECT_ID values.");
        }
        if (env.FIREBASE_PROJECT_ID !== undefined && env.FIREBASE_PROJECT_ID !== testingProject) {
            configurationError("Testing Firebase is blocked: FIREBASE_PROJECT_ID must match FIREBASE_TEST_PROJECT_ID.");
        }
        if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) {
            configurationError("Testing Firebase is blocked: emulator overrides are not supported by this isolation configuration.");
        }
    }
    if (!jsonProvided && !env.GOOGLE_APPLICATION_CREDENTIALS) {
        configurationError("Firebase credentials are missing. Configure FIREBASE_SERVICE_ACCOUNT_JSON on Vercel or GOOGLE_APPLICATION_CREDENTIALS locally.");
    }
    const credentialPath = env.GOOGLE_APPLICATION_CREDENTIALS ? resolve(fileURLToPath(new URL("../", import.meta.url)), env.GOOGLE_APPLICATION_CREDENTIALS) : undefined;
    let source;
    try {
        source = jsonProvided ? env.FIREBASE_SERVICE_ACCOUNT_JSON : readCredentials(credentialPath);
    }
    catch {
        configurationError("Firebase service-account file is unavailable. Check GOOGLE_APPLICATION_CREDENTIALS.");
    }
    // Preserve local ADC behavior, including its existing optional project override.
    if (!isolated) {
        env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
        return { isolated, options: { credential: applicationDefault(),
                ...(env.FIREBASE_PROJECT_ID ? { projectId: env.FIREBASE_PROJECT_ID } : {}) } };
    }
    let account;
    try {
        account = JSON.parse(source);
    }
    catch {
        configurationError("Firebase service-account JSON is invalid.");
    }
    if (!account || typeof account !== "object" || Array.isArray(account)) {
        configurationError("Firebase service-account JSON must be an object.");
    }
    const fields = account;
    if (fields.type !== "service_account" || fields.project_id !== testingProject
        || typeof fields.client_email !== "string"
        || !new RegExp(`^[a-zA-Z0-9_-]+@${testingProject}\\.iam\\.gserviceaccount\\.com$`).test(fields.client_email)
        || typeof fields.private_key !== "string") {
        configurationError("Testing Firebase credentials must belong to FIREBASE_TEST_PROJECT_ID and contain a service-account email and private key.");
    }
    const privateKey = fields.private_key.replace(/\\n/g, "\n");
    try {
        const key = createPrivateKey(privateKey);
        if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
            throw new Error();
        return { isolated, options: { projectId: testingProject, credential: cert({
                    projectId: testingProject, clientEmail: fields.client_email, privateKey
                }) } };
    }
    catch {
        configurationError("Firebase service-account private key is invalid.");
    }
}
export function getFirebaseApp() {
    if (firebaseApp)
        return firebaseApp;
    const { options, isolated } = firebaseConfiguration();
    // An unrelated existing Admin app may carry a different credential; never reuse it in testing.
    if (isolated && getApps().length > 0) {
        configurationError("Testing Firebase is blocked: an unverified Firebase Admin app is already initialized.");
    }
    try {
        firebaseApp = getApps().length > 0 ? getApp() : initializeApp(options);
    }
    catch {
        configurationError("Firebase Admin initialization failed. Check the server credential configuration.");
    }
    return firebaseApp;
}
export function getFirestoreDb() {
    return getFirestore(getFirebaseApp());
}
export async function verifyFirebaseConnection() {
    await getFirestoreDb().listCollections();
}
//# sourceMappingURL=firebase.js.map