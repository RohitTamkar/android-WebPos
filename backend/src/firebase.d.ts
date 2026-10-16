import type { App, AppOptions } from "firebase-admin/app";
export declare class FirebaseConfigurationError extends Error {
}
export declare function firebaseConfiguration(env?: NodeJS.ProcessEnv, readCredentials?: (path: string) => string): {
    options: AppOptions;
    isolated: boolean;
};
export declare function getFirebaseApp(): App;
export declare function getFirestoreDb(): FirebaseFirestore.Firestore;
export declare function verifyFirebaseConnection(): Promise<void>;
//# sourceMappingURL=firebase.d.ts.map