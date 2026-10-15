import {randomUUID}        from 'node:crypto';
import fs                  from 'node:fs';
import os                  from 'node:os';
import path                from 'node:path';
import {isDeepStrictEqual} from 'node:util';

/**
 * @module harness/packageSlots
 * @summary The installer owns durable package-location protection for runtime retirement.
 * A completed transaction records its selected slots and any still-existing prior locations.
 * Missing, changed or unreadable evidence never establishes that a generation is unused.
 */
export const PACKAGE_SLOTS_RECORD = '.package-slots.json';
export const PACKAGE_RECEIPT_PATH = path.join('Contents', 'Resources', 'organism', 'organism-build-info.json');
export const DEFAULT_INSTALL_TRANSACTION_DIR = path.join(os.userInfo().homedir, 'Library', 'Application Support', 'neo-harness', 'installer');
const MAX_RECORD_BYTES = 262144, MAX_SLOTS = 64;

/** @summary Requires one canonical absolute path, including for absent slots. */
function absolute(value) {
    return typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value;
}

/**
 * @summary Serializes cooperating host package operations independently of selected CLI paths.
 * @param {Object} options
 * @param {Function} options.acquireLease The trusted Brain's existing holdFileLease primitive.
 * @param {String} [options.directory=DEFAULT_INSTALL_TRANSACTION_DIR] Isolated fixture seam.
 * @returns {Object} Package exclusion guard; the caller owns its observed release.
 */
export function holdPackageTransaction({acquireLease, directory = DEFAULT_INSTALL_TRANSACTION_DIR}) {
    if (!absolute(directory) || typeof acquireLease !== 'function') throw Error('installer transaction binding is invalid');
    for (let ancestor = directory; ; ancestor = path.dirname(ancestor)) {
        try {
            if (!fs.lstatSync(ancestor).isDirectory() || fs.realpathSync(ancestor) !== ancestor) {
                throw Error('installer transaction directory is redirected');
            }
            break;
        } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    return acquireLease({directory, filename: 'package.lock', owner: 'neo-harness-installer'});
}

/** @summary Reads a real package slot; unreadable metadata or redirected ancestry refuses absence. */
export function inspectPackageSlot(bundlePath, {fileSystem = fs} = {}) {
    if (!absolute(bundlePath)) throw Error('package slot path is invalid');
    let target = bundlePath, absent = false;
    while (true) {
        try {
            if (!fileSystem.lstatSync(target).isDirectory() || fileSystem.realpathSync(target) !== target) {
                throw Error('package slot is redirected');
            }
            break;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            absent = true;
            target = path.dirname(target);
        }
    }
    if (absent) return {path: bundlePath, exists: false, receipt: null};
    const file = path.join(bundlePath, PACKAGE_RECEIPT_PATH);
    if (fileSystem.realpathSync(file) !== file || !fileSystem.lstatSync(file).isFile()) throw Error('package receipt is redirected');
    return {path: bundlePath, exists: true, receipt: JSON.parse(fileSystem.readFileSync(file, 'utf8'))};
}

/** @summary Validates bounded location metadata; generation identity stays owned by the trusted verifier. */
function validateRecord(record, directory, verifier) {
    if (!record || Object.keys(record).sort().join(',') !== 'completedAt,completionId,directory,selectedPaths,slots,version' ||
        record.version !== 1 || record.directory !== directory ||
        !/^[a-f0-9-]{36}$/.test(record.completionId) || !Number.isFinite(Date.parse(record.completedAt)) ||
        !Array.isArray(record.selectedPaths) || record.selectedPaths.length !== 3 ||
        !Array.isArray(record.slots) || record.slots.length < 3 || record.slots.length > MAX_SLOTS ||
        new Set(record.selectedPaths).size !== 3 || new Set(record.slots.map(slot => slot?.path)).size !== record.slots.length) {
        throw Error('package slot record is invalid');
    }
    for (const slot of record.slots) {
        if (!slot || Object.keys(slot).sort().join(',') !== 'exists,path,receipt' || !absolute(slot.path) ||
            typeof slot.exists !== 'boolean' || (!slot.exists && slot.receipt !== null)) throw Error('package slot binding is invalid');
        if (slot.exists) verifier.runtimeGenerationIdentity(slot.receipt);
    }
    if (record.selectedPaths.some(selected => !record.slots.some(slot => slot.path === selected))) throw Error('selected package slot is missing');
    return record;
}

/**
 * @summary Reads owner-only location evidence; null means unrecorded, never no protected packages.
 * @param {Object} options Canonical generation directory and current trusted runtime verifier.
 * @returns {Object|null} Verified record structure, still requiring fresh slot observation.
 */
export function readPackageSlotRecord({directory, verifier, fileSystem = fs}) {
    const file = path.join(directory, PACKAGE_SLOTS_RECORD);
    let before;
    try { before = fileSystem.lstatSync(file, {bigint: true}) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (!absolute(directory) || fileSystem.realpathSync(directory) !== directory || !before.isFile() ||
        before.uid !== BigInt(process.getuid()) || before.mode & 0o077n || before.nlink !== 1n ||
        before.size > BigInt(MAX_RECORD_BYTES)) throw Error('package slot record custody is invalid');
    const descriptor = fileSystem.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fileSystem.fstatSync(descriptor, {bigint: true});
        const source = fileSystem.readFileSync(descriptor, 'utf8');
        const after  = fileSystem.lstatSync(file, {bigint: true});
        if ([opened, after].some(stat => ['dev', 'ino', 'mode', 'uid', 'size', 'mtimeNs', 'ctimeNs'].some(key => stat[key] !== before[key]))) {
            throw Error('package slot record changed while reading');
        }
        return validateRecord(JSON.parse(source), directory, verifier);
    } finally { fileSystem.closeSync(descriptor) }
}

/**
 * @summary Publishes verified package protection before exclusion is released or the successor opens.
 * Still-existing prior locations are carried forward until observed absent. Unknown prior bindings
 * refuse publication, leaving the previous record to make maintenance retain all generations.
 * @param {Object} options Explicit slots plus the held package and reference guards.
 * @returns {Object} Durably published completion record; carries no seat or admission state.
 */
export function publishPackageSlots({directory, slots, packageGuard, referenceGuard, references, verifier, fileSystem = fs, now = () => new Date()}) {
    /** @summary Revalidates both owners in package-before-reference order. */
    function assertCurrent() {
        if (!packageGuard) throw Error('package slot publication requires package exclusion');
        packageGuard.assertCurrent();
        references.assertRuntimeGenerationReferences(referenceGuard, directory);
    }
    assertCurrent();
    const previous      = readPackageSlotRecord({directory, verifier, fileSystem});
    const selectedPaths = slots.map(slot => slot.path), retained = [...slots];
    for (const slot of previous?.slots ?? []) {
        if (selectedPaths.includes(slot.path)) continue;
        const observed = inspectPackageSlot(slot.path, {fileSystem});
        if (!observed.exists) continue;
        if (!isDeepStrictEqual(observed, slot)) throw Error('prior package slot changed outside the selected transaction');
        retained.push(slot);
    }
    const record = validateRecord({version: 1, directory, selectedPaths, slots: retained,
        completedAt: now().toISOString(), completionId: randomUUID()}, directory, verifier);
    const source = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(source) > MAX_RECORD_BYTES) throw Error('package slot record exceeds its bound');
    const file = path.join(directory, PACKAGE_SLOTS_RECORD), temporary = file + '.' + record.completionId;
    try {
        const descriptor = fileSystem.openSync(temporary, 'wx', 0o600);
        try {
            fileSystem.writeFileSync(descriptor, source);
            fileSystem.fsyncSync(descriptor);
        } finally { fileSystem.closeSync(descriptor) }
        assertCurrent();
        for (const slot of retained) {
            if (!isDeepStrictEqual(inspectPackageSlot(slot.path, {fileSystem}), slot)) throw Error('package slot changed before publication');
        }
        if (!isDeepStrictEqual(readPackageSlotRecord({directory, verifier, fileSystem}), previous)) throw Error('package slot record changed before publication');
        assertCurrent();
        fileSystem.renameSync(temporary, file);
        const parent = fileSystem.openSync(directory, 'r');
        try { fileSystem.fsyncSync(parent) } finally { fileSystem.closeSync(parent) }
        if (!isDeepStrictEqual(readPackageSlotRecord({directory, verifier, fileSystem}), record)) throw Error('package slot publication is unproved');
        return record;
    } finally { fileSystem.rmSync(temporary, {force: true}) }
}

/**
 * @summary Observes recorded packages freshly; uncertainty retains every generation.
 * @param {Object} options Canonical generation directory and current trusted verifier.
 * @returns {{state: String, protectedIds: String[], reason: (String|null)}} Package evidence only.
 */
export function inspectPackageProtection(options) {
    try {
        const record = readPackageSlotRecord(options);
        if (!record) throw Error('package slots have not been recorded');
        const protectedIds = [];
        for (const slot of record.slots) {
            if (!isDeepStrictEqual(inspectPackageSlot(slot.path, options), slot)) throw Error('recorded package slot changed');
            if (slot.exists) protectedIds.push(options.verifier.runtimeGenerationIdentity(slot.receipt).id);
        }
        return {state: 'observed', protectedIds: [...new Set(protectedIds)], reason: null};
    } catch (error) {
        return {state: 'unknown', protectedIds: [], reason: error.message};
    }
}
