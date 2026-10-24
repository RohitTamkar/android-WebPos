import { verifyProfileQuickPin } from './quickPin.js';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
const inputSchema = z.object({ destinationOutletId: z.string().min(1).max(200), quickPin: z.string().regex(/^\d{4,6}$/) }).strict();
// Recheck the signed-in user's existing QuickPin. Reads only; no PIN or outlet records are changed.
export async function verifyTransferPreviewPin(db, sourceOutletId, profileId, assigned, raw) {
    if (!profileId)
        throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success)
        throw new ProductCreationError(400, 'Enter your 4 to 6 digit QuickPin and select a destination outlet.');
    const { destinationOutletId, quickPin } = parsed.data;
    if ([sourceOutletId, destinationOutletId].some(id => !id || id.includes('/') || id === '.' || id === '..') || sourceOutletId === destinationOutletId) {
        throw new ProductCreationError(400, 'Select a different valid destination outlet.');
    }
    const profile = (await db.collection('USER_PROFILE').doc(profileId).get()).data();
    requireProductOutlet(profileId, sourceOutletId, profile, assigned);
    requireProductOutlet(profileId, destinationOutletId, profile, assigned);
    verifyProfileQuickPin(profileId, profile, quickPin);
    const outlets = await Promise.all([sourceOutletId, destinationOutletId].map(id => db.collection('OUTLET').doc(id).get()));
    if (outlets.some(outlet => !outlet.exists))
        throw new ProductCreationError(404, 'An outlet is no longer available.');
    return { verified: true, destinationOutletId };
}
//# sourceMappingURL=transferPreviewPin.js.map