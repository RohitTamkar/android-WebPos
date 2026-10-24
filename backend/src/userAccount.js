import { z } from 'zod';
export class UserAccountError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const accountPatchSchema = z.object({
    name: z.string().trim().min(1, 'Name is required.').max(200).optional(),
    email: z.string().trim().email('Enter a valid email address.').max(320).toLowerCase().optional(),
}).strict();
function accountDetails(profile) {
    // Login currently verifies this retrievable field directly. Only expose values
    // matching its existing PIN format; never return hashes or arbitrary secrets.
    const storedPin = typeof profile.quickPin === 'string' || typeof profile.quickPin === 'number'
        ? String(profile.quickPin) : '';
    return {
        name: typeof profile.name === 'string' ? profile.name : null,
        email: typeof profile.email === 'string' ? profile.email : null,
        loginPin: /^\d{4,6}$/.test(storedPin) ? storedPin : null,
        hasLoginPin: profile.quickPin !== undefined && profile.quickPin !== null && profile.quickPin !== '',
    };
}
function requireAccount(profile) {
    if (!profile)
        throw new UserAccountError(404, 'Your account record is unavailable.');
    if (profile.active !== true)
        throw new UserAccountError(403, 'This user account is inactive.');
    return profile;
}
// The profile ID must come from readAccessToken, never a URL, query or request body.
export async function readUserAccount(db, profileDocId) {
    const snapshot = await db.collection('USER_PROFILE').doc(profileDocId).get();
    return accountDetails(requireAccount(snapshot.exists ? snapshot.data() : undefined));
}
export async function updateUserAccount(db, profileDocId, raw) {
    const parsed = accountPatchSchema.safeParse(raw);
    if (!parsed.success)
        throw new UserAccountError(400, 'Submit only a valid name and email address.');
    const ref = db.collection('USER_PROFILE').doc(profileDocId);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const profile = requireAccount(snapshot.exists ? snapshot.data() : undefined);
        const changes = {};
        for (const key of ['name', 'email']) {
            const value = parsed.data[key];
            if (value === undefined)
                continue;
            // Do not introduce a field missing from the existing profile schema.
            if (typeof profile[key] !== 'string')
                throw new UserAccountError(400, `The ${key} field is not editable on this account.`);
            if (value !== profile[key])
                changes[key] = value;
        }
        // Firestore update cannot create a record. The transaction also protects against
        // concurrent account deletion/deactivation and preserves every unrelated field.
        if (Object.keys(changes).length)
            transaction.update(ref, changes);
        return accountDetails({ ...profile, ...changes });
    });
}
//# sourceMappingURL=userAccount.js.map