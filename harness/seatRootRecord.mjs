import fs   from 'node:fs';
import path from 'node:path';

/**
 * @module harness/seatRootRecord
 * @summary The installed shell's record of where its agents' seats live. `seat-root.json` under Electron's
 * `userData` names the root and how it was chosen, and every launch passes the recorded root to the Brain
 * explicitly. Where a seat lives therefore never depends on a launch environment, or on what a folder holds.
 *
 * The first launch without a record answers once, and records the answer:
 * - an operator's `NEO_FLEET_AGENTS_ROOT` (origin `environment`);
 * - else the agents root an earlier version placed beneath the Brain data root, while it still holds a
 *   seat (origin `adopted`);
 * - else the root the Brain resolves for a fresh installation (origin `default`, written by the caller).
 *
 * A deliberate move rewrites the record (origin `moved`). Unlike the plane record, a disagreeing environment
 * never wins: a root that followed the launch environment is how an ordinary restart once gave a registered
 * seat a fresh, empty home.
 */

/**
 * @type {String}
 */
export const SEAT_ROOT_FILE = 'seat-root.json';

/**
 * @type {ReadonlyArray<String>}
 */
export const SEAT_ROOT_ORIGINS = Object.freeze(['adopted', 'default', 'environment', 'moved']);

/**
 * @summary Reads the recorded seat root. An absent record reads `null` (a first launch); a record that is
 * present but unreadable or malformed throws, because deciding again could move every seat to a new home.
 * @param {Object} options
 * @param {String} options.dir Directory holding the record (Electron `userData`).
 * @param {Object} [options.fsModule=fs]
 * @returns {{root: String, origin: String, recordedAt: String}|null}
 * @throws {Error} When the record exists but cannot be used.
 */
export function readSeatRootRecord({dir, fsModule = fs}) {
    const file = path.join(dir, SEAT_ROOT_FILE);
    let record;

    try {
        record = JSON.parse(fsModule.readFileSync(file, 'utf8'))
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null
        }

        throw new Error(`${file} cannot be read (${error.message}); restore it, or remove it to run the first-launch choice again`)
    }

    if (!path.isAbsolute(record?.root ?? '') || !SEAT_ROOT_ORIGINS.includes(record.origin)) {
        throw new Error(`${file} names no absolute root with a known origin; restore it, or remove it to run the first-launch choice again`)
    }

    return record
}

/**
 * @summary Writes the record atomically (a temp file renamed over it, owner-only), so an interrupted launch
 * never leaves half a record. The deliberate move of the seats is the only other writer (origin `moved`).
 * @param {Object} options
 * @param {String} options.dir
 * @param {String} options.root Absolute seat root.
 * @param {String} options.origin One of {@link SEAT_ROOT_ORIGINS}.
 * @param {Function} [options.now] `() => Date`, injectable for tests.
 * @param {Object} [options.fsModule=fs]
 * @returns {{root: String, origin: String, recordedAt: String}}
 */
export function writeSeatRootRecord({dir, root, origin, now = () => new Date(), fsModule = fs}) {
    if (!path.isAbsolute(root ?? '') || !SEAT_ROOT_ORIGINS.includes(origin)) {
        throw new TypeError('a seat root record needs an absolute root and a known origin')
    }

    const
        record = {origin, recordedAt: now().toISOString(), root},
        file   = path.join(dir, SEAT_ROOT_FILE),
        temp   = `${file}.${process.pid}.tmp`;

    fsModule.mkdirSync(dir, {recursive: true});
    fsModule.writeFileSync(temp, JSON.stringify(record, null, 4) + '\n', {mode: 0o600});
    fsModule.renameSync(temp, file);

    return record
}

/**
 * @summary Whether a root holds a seat: one visible subdirectory. A missing root holds none; a root that
 * cannot be read throws rather than letting the choice move away from it.
 * @param {String} root
 * @param {Object} fsModule
 * @returns {Boolean}
 * @private
 */
function holdsSeat(root, fsModule) {
    try {
        return fsModule.readdirSync(root, {withFileTypes: true}).some(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false
        }

        throw error
    }
}

/**
 * @summary The seat root for this launch. A present record answers without touching the filesystem; an
 * environment root that disagrees with it is returned as ignored, for the caller to report. Without a record,
 * this launch makes the one-time choice and records it. `record: null` means a fresh installation: the caller
 * records the root the Brain resolves, with origin `default`.
 * @param {Object} options
 * @param {String} options.dir Directory holding the record (Electron `userData`).
 * @param {String} [options.envRoot] The launch's `NEO_FLEET_AGENTS_ROOT`, if any.
 * @param {String} options.legacyRoot The agents root earlier versions placed beneath the Brain data root.
 * @param {Function} [options.now]
 * @param {Object} [options.fsModule=fs]
 * @returns {{record: Object|null, ignoredEnvRoot: String|null}}
 * @throws {TypeError} When the environment names a relative root.
 */
export function settleSeatRoot({dir, envRoot, legacyRoot, now, fsModule = fs}) {
    if (envRoot && !path.isAbsolute(envRoot)) {
        throw new TypeError(`NEO_FLEET_AGENTS_ROOT must be an absolute path, got '${envRoot}'`)
    }

    const record = readSeatRootRecord({dir, fsModule});

    if (record) {
        return {record, ignoredEnvRoot: envRoot && envRoot !== record.root ? envRoot : null}
    }

    if (envRoot) {
        return {record: writeSeatRootRecord({dir, root: envRoot, origin: 'environment', now, fsModule}), ignoredEnvRoot: null}
    }

    if (holdsSeat(legacyRoot, fsModule)) {
        return {record: writeSeatRootRecord({dir, root: legacyRoot, origin: 'adopted', now, fsModule}), ignoredEnvRoot: null}
    }

    return {record: null, ignoredEnvRoot: null}
}
