import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProductImportQuota } from './productImportQuota.js';
function missing(error) {
    return error.code === 'ENOENT';
}
/** Local backend storage only. No Firebase access or product/customer data. */
export function createFileProductImportQuota(filename, now = Date.now) {
    const read = () => {
        let source;
        try {
            source = readFileSync(filename, 'utf8');
        }
        catch (error) {
            if (missing(error))
                return new Map();
            throw error;
        }
        // A damaged/unreadable file must never silently grant another two attempts.
        const stored = JSON.parse(source);
        if (!stored || stored.version !== 1 || !Array.isArray(stored.outlets))
            throw new Error('Invalid upload quota file.');
        const outlets = new Map();
        for (const entry of stored.outlets) {
            if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0]
                || outlets.has(entry[0]) || !Array.isArray(entry[1])
                || entry[1].some((at) => typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0)) {
                throw new Error('Invalid upload quota file.');
            }
            outlets.set(entry[0], entry[1]);
        }
        return outlets;
    };
    const write = (outlets) => {
        const temporary = `${filename}.${randomUUID()}.tmp`;
        try {
            const descriptor = openSync(temporary, 'wx', 0o600);
            try {
                writeFileSync(descriptor, JSON.stringify({ version: 1, outlets: [...outlets] }));
                fsyncSync(descriptor);
            }
            finally {
                closeSync(descriptor);
            }
            // Readers see either the previous complete file or the new complete file.
            renameSync(temporary, filename);
            const directory = openSync(dirname(filename), 'r');
            try {
                fsyncSync(directory);
            }
            finally {
                closeSync(directory);
            }
        }
        finally {
            try {
                unlinkSync(temporary);
            }
            catch (error) {
                if (!missing(error))
                    throw error;
            }
        }
    };
    return createProductImportQuota({
        read, write,
        exclusive(operation) {
            mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
            // Prevent two backend processes using this file from accepting the same slot.
            // A crash during reservation can leave this lock behind: fail closed rather
            // than automatically remove a lock which another process may still own.
            const lock = `${filename}.lock`;
            const descriptor = openSync(lock, 'wx', 0o600);
            try {
                return operation();
            }
            finally {
                closeSync(descriptor);
                unlinkSync(lock);
            }
        },
    }, now);
}
//# sourceMappingURL=productImportQuotaFile.js.map