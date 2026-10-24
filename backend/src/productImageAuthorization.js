"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyProductImagePin = verifyProductImagePin;
exports.requireProductImageAuthorization = requireProductImageAuthorization;
const node_crypto_1 = require("node:crypto");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const productCreation_js_1 = require("./productCreation.js");
const quickPin_js_1 = require("./quickPin.js");
const input = zod_1.z.object({ action: zod_1.z.enum(['bulk', 'shared', 'remove']), quickPin: zod_1.z.string().regex(/^\d{4}$/) }).strict();
const audience = 'product-image-management';
const sessionDigest = (session) => (0, node_crypto_1.createHash)('sha256').update(session).digest('hex');
function requireKey(secret) {
    if (secret.length < 32)
        throw new productCreation_js_1.ProductCreationError(503, 'Quick PIN authorization requires a configured signing key of at least 32 characters.');
}
async function verifyProductImagePin(db, outletId, profileId, assigned, secret, session, raw) {
    if (!profileId)
        throw new productCreation_js_1.ProductCreationError(401, 'Your session has expired. Please sign in again.');
    requireKey(secret);
    const parsed = input.safeParse(raw);
    if (!parsed.success)
        throw new productCreation_js_1.ProductCreationError(400, 'Enter your 4-digit login Quick PIN.');
    const profile = (await db.collection('USER_PROFILE').doc(profileId).get()).data();
    (0, productCreation_js_1.requireProductOutlet)(profileId, outletId, profile, assigned);
    (0, quickPin_js_1.verifyProfileQuickPin)(profileId, profile, parsed.data.quickPin);
    return { verified: true, action: parsed.data.action, imageToken: jsonwebtoken_1.default.sign({ outletId, action: parsed.data.action,
            session: sessionDigest(session) }, secret, { algorithm: 'HS256', subject: profileId, audience, jwtid: (0, node_crypto_1.randomUUID)(), expiresIn: '15m' }) };
}
// Grants live only for the selected workflow; normal session and outlet checks still run on every write.
function requireProductImageAuthorization(secret, grant, profileId, outletId, session, actions) {
    requireKey(secret);
    try {
        const data = jsonwebtoken_1.default.verify(grant ?? '', secret, { audience, algorithms: ['HS256'] });
        if (typeof data === 'string' || data.sub !== profileId || data.outletId !== outletId
            || data.session !== sessionDigest(session) || !actions.includes(data.action))
            throw new Error();
    }
    catch {
        throw new productCreation_js_1.ProductCreationError(403, 'Quick PIN authorization expired or is invalid. Close this action and verify your Quick PIN again.');
    }
}
//# sourceMappingURL=productImageAuthorization.js.map