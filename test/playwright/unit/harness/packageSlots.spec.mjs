import {expect, test}  from '@playwright/test';
import fs              from 'node:fs';
import os              from 'node:os';
import path            from 'node:path';
import * as verifier   from 'neo-agent-brain/runtime-generation';
import * as references from 'neo-agent-brain/runtime-generation-lease';
import {holdFileLease} from 'neo-agent-brain/file-lease';
import {holdPackageTransaction, inspectPackageProtection, inspectPackageSlot, PACKAGE_RECEIPT_PATH,
    PACKAGE_SLOTS_RECORD, publishPackageSlots, readPackageSlotRecord} from '../../../../harness/packageSlots.mjs';

/** @summary Writes a complete deterministic package receipt in a disposable host layout. */
function bundle(target, revision) {
    const file = path.join(target, PACKAGE_RECEIPT_PATH);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({electronVersion: '43.5.0',
        owners: Object.fromEntries(['product', 'brain', 'engine'].map(name => [name, {revision: revision.repeat(40)}]))}));
    return inspectPackageSlot(target);
}

test.describe('harness/packageSlots — guarded package protection', () => {
    let root, directory, packageGuard, referenceGuard, slots;
    const options = () => ({directory, slots, packageGuard, referenceGuard, references, verifier});
    test.beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-slots-')));
        directory = path.join(root, 'runtime');
        fs.mkdirSync(directory, {mode: 0o700});
        packageGuard = holdPackageTransaction({directory: path.join(root, 'installer'), acquireLease: holdFileLease});
        referenceGuard = references.holdRuntimeGenerationReferences({directory});
        slots = [bundle(path.join(root, 'installed'), 'a'), bundle(path.join(root, 'rollback'), 'b'),
            inspectPackageSlot(path.join(root, 'parked'))];
    });
    test.afterEach(() => {
        referenceGuard.release();
        packageGuard.release();
        fs.rmSync(root, {recursive: true, force: true});
    });

    test('no record means unknown; a completed record protects both actual package identities', () => {
        expect(inspectPackageProtection(options()).state).toBe('unknown');
        const record = publishPackageSlots(options());
        expect(readPackageSlotRecord(options())).toEqual(record);
        expect(inspectPackageProtection(options())).toEqual({state: 'observed', reason: null,
            protectedIds: slots.filter(slot => slot.exists).map(slot => verifier.runtimeGenerationIdentity(slot.receipt).id)});
        expect(fs.statSync(path.join(directory, PACKAGE_SLOTS_RECORD)).mode & 0o777).toBe(0o600);
    });

    test('changing rollback location carries the previous live slot until it is observed absent', () => {
        publishPackageSlots(options());
        const old = slots[1];
        slots[1] = bundle(path.join(root, 'custom-rollback'), 'c');
        const moved = publishPackageSlots(options());
        expect(moved.slots).toContainEqual(old);
        expect(inspectPackageProtection(options()).protectedIds).toHaveLength(3);
        fs.rmSync(old.path, {recursive: true});
        expect(inspectPackageProtection(options()).state).toBe('unknown');
        const settled = publishPackageSlots(options());
        expect(settled.slots).toHaveLength(3);
        expect(inspectPackageProtection(options()).protectedIds).toHaveLength(2);
    });

    test('a changed former location refuses publication and keeps its last evidence', () => {
        const first = publishPackageSlots(options()), old = slots[1];
        slots[1] = bundle(path.join(root, 'custom-rollback'), 'c');
        bundle(old.path, 'd');
        expect(() => publishPackageSlots(options())).toThrow(/prior package slot changed/);
        expect(readPackageSlotRecord(options())).toEqual(first);
        expect(inspectPackageProtection(options()).state).toBe('unknown');
    });

    test('failed atomic publication leaves prior evidence and removes only its own temporary file', () => {
        const first = publishPackageSlots(options());
        slots[0] = bundle(slots[0].path, 'c');
        const fileSystem = {...fs, renameSync() { throw Error('fixture publication refused') }};
        expect(() => publishPackageSlots({...options(), fileSystem})).toThrow(/fixture publication refused/);
        expect(readPackageSlotRecord(options())).toEqual(first);
        expect(fs.readdirSync(directory).filter(name => name.startsWith(PACKAGE_SLOTS_RECORD))).toEqual([PACKAGE_SLOTS_RECORD]);
        expect(inspectPackageProtection(options()).state).toBe('unknown');
    });

    test('a changed slot during the durable write cannot publish the pre-write observation', () => {
        const first      = publishPackageSlots(options());
        const fileSystem = {...fs, fsyncSync(descriptor) { fs.fsyncSync(descriptor); bundle(slots[0].path, 'c') }};
        expect(() => publishPackageSlots({...options(), fileSystem})).toThrow(/slot changed before publication/);
        expect(readPackageSlotRecord(options())).toEqual(first);
    });

    test('failed data flush removes its temporary file and preserves the prior receipt', () => {
        const first      = publishPackageSlots(options());
        const fileSystem = {...fs, fsyncSync() { throw Error('fixture flush refused') }};
        expect(() => publishPackageSlots({...options(), fileSystem})).toThrow(/fixture flush refused/);
        expect(readPackageSlotRecord(options())).toEqual(first);
        expect(fs.readdirSync(directory).filter(name => name.startsWith(PACKAGE_SLOTS_RECORD))).toEqual([PACKAGE_SLOTS_RECORD]);
    });

    test('malformed or publicly writable evidence and redirected slots remain unknown', () => {
        publishPackageSlots(options());
        const file = path.join(directory, PACKAGE_SLOTS_RECORD);
        fs.chmodSync(file, 0o666);
        expect(inspectPackageProtection(options()).state).toBe('unknown');
        fs.chmodSync(file, 0o600);
        fs.renameSync(slots[1].path, slots[1].path + '-moved');
        fs.symlinkSync(slots[1].path + '-moved', slots[1].path);
        expect(inspectPackageProtection(options()).state).toBe('unknown');
        fs.writeFileSync(file, '{}');
        expect(() => publishPackageSlots(options())).toThrow(/record is invalid/);
    });

    test('publication refuses absent or released exclusion owners', () => {
        expect(() => publishPackageSlots({...options(), packageGuard: null})).toThrow(/package exclusion/);
        expect(() => publishPackageSlots({...options(), referenceGuard: {assertCurrent() {}}})).toThrow(/not guarded/);
        referenceGuard.release();
        expect(() => publishPackageSlots(options())).toThrow(/guard-closed/);
    });
});
