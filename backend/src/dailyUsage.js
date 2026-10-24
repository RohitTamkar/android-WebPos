import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
// Stop charging abandoned clients at most 30 seconds after their last accepted renewal.
export const WEB_USAGE_LEASE_SECONDS = 30;
const limitSeconds = 1800;
export class DailyUsageError extends ProductCreationError {
    code;
    constructor(status, code, message) {
        super(status, message);
        this.code = code;
    }
}
const leaseSchema = z.object({ profileDocId: z.string().min(1).max(200), expiresAt: z.instanceof(Timestamp), lastSequence: z.number().int().nonnegative() }).strict();
const operationSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('start'), requestId: z.string().uuid() }).strict(),
    z.object({ action: z.literal('heartbeat'), sessionId: z.string().regex(/^[a-f0-9]{64}$/), generation: z.string().uuid(), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
    z.object({ action: z.enum(['check', 'stop']), sessionId: z.string().regex(/^[a-f0-9]{64}$/), generation: z.string().uuid(), sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
    z.object({ action: z.literal('status') }).strict(),
]);
const timestamp = z.instanceof(Timestamp);
const usageSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timeZone: z.string().min(1),
    limitSeconds: z.literal(limitSeconds), usedSeconds: z.number().finite().min(0).max(limitSeconds),
    settledAt: timestamp, updatedAt: timestamp, generation: z.string().min(1).max(200), version: z.literal(1),
    sessions: z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length <= 100),
}).passthrough();
function validTimeZone(value) {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_.+-]*(?:\/[A-Za-z0-9_.+-]+)*$/.test(value.trim()) || value.length > 100) {
        throw new ProductCreationError(422, 'Outlet country.timezone must contain a valid IANA timezone before Web POS usage can be initialized.');
    }
    try {
        // Validate using the server timezone database; preserve the outlet's configured spelling.
        new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format(0);
        return value.trim();
    }
    catch {
        throw new ProductCreationError(422, 'Outlet country.timezone is invalid. No usage data was changed.');
    }
}
export function resolveUsageTimeZone(country, serverZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone) {
    const configured = country && typeof country === 'object' && !Array.isArray(country)
        ? country.timezone : undefined;
    if (configured !== undefined && configured !== null && configured !== '') {
        return validTimeZone(configured);
    }
    // Approved server fallback only; never add or overwrite country.timezone in Firestore.
    try {
        return validTimeZone(serverZone());
    }
    catch {
        throw new ProductCreationError(503, 'The server timezone is unavailable or invalid. Configure a valid server timezone before using Web POS.');
    }
}
function localDate(now, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(now.toDate());
    const part = (type) => parts.find(value => value.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}
// Shared transaction engine: every calculation is rerun after a transaction conflict.
async function usageTransaction(db, outletId, profileId, assigned, raw = {}, clock = () => Timestamp.now(), operation) {
    if (!profileId)
        throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
    if (!outletId || outletId.length > 200 || outletId.includes('/') || outletId === '.' || outletId === '..') {
        throw new ProductCreationError(400, 'A valid outlet document ID is required.');
    }
    if (!z.object({}).strict().safeParse(raw).success) {
        throw new ProductCreationError(422, 'Usage initialization accepts no client fields, counters or timestamps.');
    }
    const outletRef = db.collection('OUTLET').doc(outletId);
    const outcome = await db.runTransaction(async (transaction) => {
        const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
        requireProductOutlet(profileId, outletId, profile, assigned);
        const outlet = (await transaction.get(outletRef)).data();
        if (!outlet)
            throw new ProductCreationError(404, 'Outlet not found.');
        if (outlet.active !== true)
            throw new ProductCreationError(403, 'This outlet is inactive.');
        const timeZone = resolveUsageTimeZone(outlet.country);
        const now = clock(); // Recalculate inside every retry, including retries across midnight.
        const date = localDate(now, timeZone);
        const stored = outlet.dailyUsage;
        let reset = false;
        if (stored !== undefined) {
            const parsed = usageSchema.safeParse(stored);
            // Never turn damaged/unsupported state into a fresh allowance.
            if (!parsed.success)
                throw new ProductCreationError(409, 'Existing daily usage is invalid or unsupported. It was preserved and requires review.');
            const current = parsed.data;
            if (new Intl.DateTimeFormat('en-US', { timeZone: validTimeZone(current.timeZone) }).resolvedOptions().timeZone
                !== new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone) {
                throw new ProductCreationError(409, 'The outlet timezone differs from its usage period. Review the timezone change before resetting usage.');
            }
            const validDate = new Date(`${current.date}T00:00:00Z`);
            if (!Number.isFinite(validDate.getTime()) || validDate.toISOString().slice(0, 10) !== current.date
                || current.date > date || current.settledAt.toMillis() > now.toMillis()) {
                throw new ProductCreationError(409, 'Existing daily usage has an invalid or future accounting date. It was preserved.');
            }
            if (current.date === date && !operation) {
                return { outletId, initialized: false, reset: false, date, timeZone,
                    limitSeconds, usedSeconds: current.usedSeconds };
            }
            reset = current.date !== date;
        }
        const dailyUsage = stored !== undefined && !reset ? { ...usageSchema.parse(stored) }
            : { date, timeZone, limitSeconds, usedSeconds: 0, settledAt: now,
                updatedAt: now, generation: randomUUID(), version: 1, sessions: {} };
        const initialized = stored === undefined || reset;
        const summary = () => ({ outletId, initialized, reset, date, timeZone, limitSeconds, usedSeconds: dailyUsage.usedSeconds });
        if (!operation) {
            transaction.update(outletRef, { dailyUsage: { ...dailyUsage, updatedAt: FieldValue.serverTimestamp() } });
            return summary();
        }
        const parsedSessions = z.record(z.string().regex(/^[a-f0-9]{64}$/), leaseSchema).safeParse(dailyUsage.sessions);
        if (!parsedSessions.success)
            throw new DailyUsageError(409, 'USAGE_INVALID_STATE', 'Existing Web POS sessions require review. Usage was preserved.');
        const sessions = { ...parsedSessions.data };
        const nowMs = now.toMillis();
        const through = Math.min(nowMs, Math.max(dailyUsage.settledAt.toMillis(), ...Object.values(sessions).map(session => session.expiresAt.toMillis())));
        dailyUsage.usedSeconds = Math.min(limitSeconds, (Math.round(dailyUsage.usedSeconds * 1000) + Math.max(0, through - dailyUsage.settledAt.toMillis())) / 1000);
        dailyUsage.settledAt = now;
        const persist = () => transaction.update(outletRef, { dailyUsage: { ...dailyUsage, sessions, updatedAt: FieldValue.serverTimestamp() } });
        const failure = (status, code, message) => {
            for (const [id, session] of Object.entries(sessions))
                if (session.expiresAt.toMillis() <= nowMs)
                    delete sessions[id];
            persist();
            return { ...summary(), failure: { status, code, message } };
        };
        if (dailyUsage.usedSeconds >= limitSeconds && operation.action !== 'status' && operation.action !== 'stop') {
            return failure(403, 'USAGE_LIMIT_REACHED', 'The daily 30-minute Web POS allowance for this outlet has been exhausted. Access resumes 24 Hrs later.');
        }
        if (operation.action !== 'status' && operation.action !== 'start') {
            const session = sessions[operation.sessionId];
            if (operation.generation !== dailyUsage.generation || !session || session.profileDocId !== profileId) {
                return failure(428, 'USAGE_SESSION_REQUIRED', 'Enter this outlet again to start a valid Web POS usage session.');
            }
            if (operation.action === 'stop') {
                // A delayed pagehide from before refresh must not release the renewed session.
                if (operation.sequence !== session.lastSequence)
                    return failure(409, 'USAGE_STALE_HEARTBEAT', 'This stop request belongs to an older session renewal.');
                delete sessions[operation.sessionId];
                persist();
                return summary();
            }
            if (session.expiresAt.toMillis() <= nowMs) {
                return failure(428, 'USAGE_SESSION_EXPIRED', 'Web POS usage paused. Resume to continue.');
            }
            if (operation.action === 'heartbeat' && operation.sequence <= session.lastSequence) {
                return failure(409, 'USAGE_STALE_HEARTBEAT', 'This heartbeat is stale. It did not renew the session.');
            }
        }
        for (const [id, session] of Object.entries(sessions))
            if (session.expiresAt.toMillis() <= nowMs)
                delete sessions[id];
        let sessionId;
        if (operation.action === 'start') {
            sessionId = createHash('sha256').update(JSON.stringify([profileId, outletId, dailyUsage.generation, operation.requestId])).digest('hex');
            if (!sessions[sessionId] && Object.keys(sessions).length >= 100) {
                return failure(429, 'USAGE_SESSION_CAPACITY', 'Too many active Web POS sessions. Wait for unused sessions to expire.');
            }
            sessions[sessionId] = { profileDocId: profileId, expiresAt: Timestamp.fromMillis(Math.min(nowMs + WEB_USAGE_LEASE_SECONDS * 1000, nowMs + Math.round((limitSeconds - dailyUsage.usedSeconds) * 1000))), lastSequence: sessions[sessionId] ? sessions[sessionId].lastSequence + 1 : 0 };
        }
        else if (operation.action === 'heartbeat') {
            sessionId = operation.sessionId;
            sessions[sessionId] = { profileDocId: profileId, expiresAt: Timestamp.fromMillis(Math.min(nowMs + WEB_USAGE_LEASE_SECONDS * 1000, nowMs + Math.round((limitSeconds - dailyUsage.usedSeconds) * 1000))), lastSequence: operation.sequence };
        }
        persist();
        return { ...summary(), remainingSeconds: Math.max(0, limitSeconds - dailyUsage.usedSeconds), generation: dailyUsage.generation,
            ...(sessionId ? { sessionId, expiresAt: sessions[sessionId].expiresAt.toMillis(), sequence: sessions[sessionId].lastSequence } : {}) };
    });
    const failure = outcome.failure;
    if (failure)
        throw new DailyUsageError(failure.status, failure.code, failure.message);
    return outcome;
}
// Kept for existing clients: initialization alone does not grant outlet access.
export async function initializeOutletDailyUsage(db, outletId, profileId, assigned, raw = {}, clock = () => Timestamp.now()) {
    return usageTransaction(db, outletId, profileId, assigned, raw, clock);
}
export async function operateOutletDailyUsage(db, outletId, profileId, assigned, raw, clock = () => Timestamp.now()) {
    const parsed = operationSchema.safeParse(raw);
    if (!parsed.success)
        throw new DailyUsageError(422, 'USAGE_INVALID_REQUEST', 'Invalid usage action. Client counters and timestamps are not accepted.');
    return usageTransaction(db, outletId, profileId, assigned, {}, clock, parsed.data);
}
//# sourceMappingURL=dailyUsage.js.map