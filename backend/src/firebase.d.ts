import type { App, AppOptions } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
export type FirebaseConfigurationCheck = "missing_test_project_id" | "invalid_test_project_id" | "missing_production_project_id" | "invalid_production_project_id" | "shared_firebase_project" | "project_override_mismatch" | "emulator_override" | "missing_credentials" | "credential_file_unavailable" | "invalid_service_account_json" | "invalid_service_account_shape" | "service_account_project_mismatch" | "invalid_service_account_fields" | "invalid_private_key" | "unverified_existing_app" | "admin_initialization_failed" | "missing_storage_bucket";
export declare class FirebaseConfigurationError extends Error {
    readonly check: FirebaseConfigurationCheck;
    constructor(message: string, check: FirebaseConfigurationCheck);
}
export declare function logFirebaseConfigurationError(error: unknown, context: "login" | "startup" | "connection", writeLog?: (event: string, metadata: Record<string, string>) => void): void;
export declare function firebaseConfiguration(env?: NodeJS.ProcessEnv, readCredentials?: (path: string) => string): {
    options: AppOptions;
    isolated: boolean;
};
export declare function getFirebaseApp(): App;
export declare function getFirestoreDb(): FirebaseFirestore.Firestore;
export declare function getFirestoreRestContext(): {
    database: string;
    accessToken: () => Promise<string>;
};
export declare function getFirebaseStorageBucket(): ReturnType<ReturnType<typeof getStorage>['bucket']>;
export declare function verifyFirebaseConnection(): Promise<void>;
//# sourceMappingURL=firebase.d.ts.map