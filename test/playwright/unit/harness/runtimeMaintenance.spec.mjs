import {expect, test}                                                    from '@playwright/test';
import fs                                                                from 'node:fs/promises';
import path                                                              from 'node:path';
import os                                                                from 'node:os';
import * as verifier                                                     from 'neo-agent-brain/runtime-generation';
import * as references                                                   from 'neo-agent-brain/runtime-generation-lease';
import * as journal                                                      from 'neo-agent-brain/launch-admission-journal';
import * as leases                                                       from 'neo-agent-brain/file-lease';
import {materializeRuntimeGeneration, removeOwnedRuntimeTree}            from '../../../../harness/runtimeGeneration.mjs';
import {holdPackageTransaction, inspectPackageSlot, publishPackageSlots} from '../../../../harness/packageSlots.mjs';
import {retireRuntimeGenerations, startRuntimeMaintenance}               from '../../../../harness/runtimeMaintenance.mjs';

/** @summary Builds a real sealed generation using the production publisher and a fixture binary probe. */
async function generation(root, directory, revision) {
    const bundlePath  = path.join(root, 'build-' + revision, 'Neo Harness.app');
    const runtimeRoot = path.join(bundlePath, 'Contents/Resources/organism');
    const executable  = path.join(bundlePath, 'Contents/MacOS/Neo Harness');
    const receipt     = {electronVersion: '43.5.0', owners: Object.fromEntries(['product', 'brain', 'engine'].map(name =>
        [name, {revision: revision.repeat(40)}]))};
    await fs.mkdir(runtimeRoot, {recursive: true});
    await fs.mkdir(path.dirname(executable), {recursive: true});
    await fs.writeFile(path.join(runtimeRoot, 'organism-build-info.json'), JSON.stringify(receipt));
    await fs.writeFile(executable, 'fixture executable\n', {mode: 0o755});
    const options = {bundlePath, runtimeRoot, executable, directory, verifier, references,
        probe: () => ({platform: process.platform, arch: process.arch, electronVersion: '43.5.0',
            nodeVersion: process.versions.node, moduleAbi: process.versions.modules, launchProtocol: verifier.LAUNCH_ADMISSION_PROTOCOL})};
    return {bundlePath, options, value: await materializeRuntimeGeneration(options)};
}

/** @summary Supplies the real journal codec with one original surviving or terminal Start. */
function seat(runtime, state = 'running', flags = {}) {
    return {state, ownershipUnresolved: false, cleanupUnresolved: false, ...flags,
        start: {version: 2, agentId: 'seat', identity: 'neo-gpt-sophie', harnessType: 'codex',
            pid            : 42, pidStartedAt: 'Thu Oct 15 09:00:00 2026', startedAt: '2026-10-15T09:00:00.000Z',
            cwd            : '/workspace', instanceHome: '/seat', launchCommand: '/harness', launchInterpreter: null,
            profileArg     : null, leaseRequired: false, runtime: verifier.runtimeGenerationPin(runtime), planSha256: 'd'.repeat(64),
            profile        : null, admissionGeneration: null,
            bridgeAuthority: {version: 1, source: 'registry-file', registryRoot: '/registry', publicKeySha256: 'e'.repeat(64)}, targets: []}};
}

test.describe('harness/runtimeMaintenance — actual guarded retirement', () => {
    let root, directory, current, rollback, unused, owner, journalDirectory;
    const snapshot      = (seats = [], generations = []) => ({version: journal.RUNTIME_REFERENCE_SNAPSHOT_VERSION, seats, generations});
    const transactionFn = () => holdPackageTransaction({directory: path.join(root, 'installer'), acquireLease: leases.holdFileLease});
    const options       = () => ({directory, currentGeneration: current.value, journalDirectory, verifier, references, journal, leases});
    const emptyCensus   = async () => ({state: 'observed', reason: null, processes: []});
    const maintain      = overrides => retireRuntimeGenerations(options(), {transactionFn, inspectProcesses: emptyCensus, ...overrides});
    test.beforeEach(async () => {
        root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-maintenance-')));
        directory = path.join(root, 'runtime');
        current = await generation(root, directory, '1');
        rollback = await generation(root, directory, '2');
        unused = await generation(root, directory, '3');
        journalDirectory = path.join(root, 'fleet/launch-admission');
        owner = journal.openLaunchAdmissionJournal({directory: journalDirectory,
            validateSnapshot: journal.isAdmissionSnapshot, emptySnapshot: snapshot()});
        const packageGuard = transactionFn(), referenceGuard = references.holdRuntimeGenerationReferences({directory});
        try {
            publishPackageSlots({directory, verifier, references, packageGuard, referenceGuard,
                slots: [inspectPackageSlot(current.bundlePath), inspectPackageSlot(rollback.bundlePath), inspectPackageSlot(current.bundlePath + '.restoring')]});
        } finally { referenceGuard.release(); packageGuard.release() }
    });
    test.afterEach(async () => { owner.close(); await removeOwnedRuntimeTree(root) });

    test('normal maintenance removes only a verified unused generation and protects installed, rollback and host', async () => {
        const result = await maintain({inspectProcesses: async input => {
            expect(transactionFn).toThrow(/held/);
            expect(() => references.holdRuntimeGenerationReferences({directory})).toThrow(/held/);
            expect(input.directories).toHaveLength(1);
            return emptyCensus();
        }});
        expect(result.state).toBe('observed');
        expect(result.generations.find(row => row.id === unused.value.id), JSON.stringify(result)).toMatchObject({state: 'removed'});
        await expect(fs.stat(unused.value.directory)).rejects.toMatchObject({code: 'ENOENT'});
        expect(await verifier.readRuntimeGeneration({directory: current.value.directory})).toEqual(current.value);
        expect(await verifier.readRuntimeGeneration({directory: rollback.value.directory})).toEqual(rollback.value);
        expect((await fs.readdir(directory)).filter(name => name.startsWith('.retiring-'))).toEqual([]);
        expect(transactionFn().release()).toBe(true);
        expect(references.holdRuntimeGenerationReferences({directory}).release()).toBe(true);
    });

    for (const [state, flags] of [['running', {}], ['exited', {ownershipUnresolved: true}], ['stopped', {cleanupUnresolved: true}]]) {
        test(`zero children retains a ${state} original Start with ${JSON.stringify(flags)}`, async () => {
            owner.write(snapshot([seat(unused.value, state, flags)]));
            const result = await maintain();
            expect(result.generations.find(row => row.id === unused.value.id).state).toBe('retained');
            expect(await verifier.readRuntimeGeneration({directory: unused.value.directory})).toEqual(unused.value);
        });
    }

    test('an unrevoked admission protects the original runtime even without a roster seat', async () => {
        owner.write(snapshot([], [{id: 'orphan', agentId: 'seat', identity: 'neo-gpt-sophie', state: 'active', reason: null,
            reservedAt: '2026-10-15T09:00:00Z', activatedAt: null, revokedAt: null, definitionHash: 'f'.repeat(64),
            runtime   : verifier.runtimeGenerationPin(unused.value), credentialBindings: {}, residentBindings: {}, servers: []}]));
        const result = await maintain();
        expect(result.generations.find(row => row.id === unused.value.id).reasons).toContainEqual({code: 'admission-reference-held', subject: 'seat'});
    });

    test('unknown census or a lingering child retains a terminal generation', async () => {
        owner.write(snapshot([seat(unused.value, 'exited')]));
        for (const census of [{state: 'unknown', processes: []}, {state: 'observed', processes: [{pid: 42, directories: [unused.value.directory]}]}]) {
            const result = await maintain({inspectProcesses: async () => census});
            expect(result.generations.find(row => row.id === unused.value.id).state).toBe('retained');
            expect(await verifier.readRuntimeGeneration({directory: unused.value.directory})).toEqual(unused.value);
        }
        expect((await maintain()).generations.find(row => row.id === unused.value.id).state).toBe('removed');
    });

    test('missing package evidence and legacy-writer snapshots cannot authorize removal', async () => {
        owner.write({...snapshot(), version: 6});
        expect((await maintain()).generations.find(row => row.id === unused.value.id).reasons).toContainEqual({code: 'runtime-references-unknown'});
        owner.write(snapshot());
        await fs.unlink(path.join(directory, '.package-slots.json'));
        expect((await maintain()).generations.find(row => row.id === unused.value.id).reasons).toContainEqual({code: 'package-protection-unknown'});
        expect(await verifier.readRuntimeGeneration({directory: unused.value.directory})).toEqual(unused.value);
    });

    test('fresh journal evidence after the process await prevents a stale absence decision', async () => {
        const result = await maintain({inspectProcesses: async () => {
            owner.write(snapshot([seat(unused.value)]));
            return emptyCensus();
        }});
        expect(result.generations.find(row => row.id === unused.value.id).reasons).toContainEqual({code: 'seat-pin-held', subject: 'seat'});
        expect(await fs.stat(unused.value.directory)).toBeTruthy();
    });

    test('a modified payload never reaches quarantine or the removal callback', async () => {
        await fs.chmod(unused.value.executable, 0o755);
        await fs.writeFile(unused.value.executable, 'changed');
        await fs.chmod(unused.value.executable, 0o555);
        let   removals = 0;
        const result   = await maintain({removeTree: async () => { removals++ }});
        expect(removals).toBe(0);
        expect(result.generations.find(row => row.id === unused.value.id).reasons).toContainEqual({code: 'runtime-integrity-failed'});
    });

    test('an interrupted removal resumes from its inode-bound receipt after the manifest is gone', async () => {
        let interrupted;
        await maintain({removeTree: async target => {
            interrupted = target;
            await fs.chmod(target, 0o700);
            await fs.unlink(path.join(target, verifier.RUNTIME_GENERATION_RECORD));
            throw Error('fixture interrupted removal');
        }});
        expect(interrupted).toContain('/.retiring-');
        await expect(fs.stat(unused.value.directory)).rejects.toMatchObject({code: 'ENOENT'});
        const result = await maintain();
        expect(result.generations.find(row => row.id === unused.value.id).state).toBe('removed');
        await expect(fs.stat(interrupted)).rejects.toMatchObject({code: 'ENOENT'});
        expect((await fs.readdir(directory)).filter(name => name.startsWith('.retiring-'))).toEqual([]);
    });

    test('a failure before rename leaves the published seal intact and clears only the orphan receipt', async () => {
        await maintain({renameTree() { throw Error('fixture interrupted before rename') }});
        expect(await verifier.readRuntimeGeneration({directory: unused.value.directory})).toEqual(unused.value);
        owner.write(snapshot([seat(unused.value)]));
        const result = await maintain();
        expect(result.generations.some(row => row.state === 'receipt-cleared')).toBe(true);
        expect(result.generations.some(row => row.state === 'removed')).toBe(false);
        expect((await fs.readdir(directory)).filter(name => name.startsWith('.retiring-'))).toEqual([]);
    });

    test('a held file in quarantine prevents cleanup after interrupted removal', async () => {
        let interrupted;
        await maintain({removeTree: async target => { interrupted = target; throw Error('fixture stop') }});
        const result = await maintain({inspectProcesses: async () => ({state: 'observed', processes: [{pid: 42, directories: [interrupted]}]})});
        expect(result.generations.find(row => row.id === unused.value.id).reasons).toContainEqual({code: 'runtime-process-held', subject: 42});
        expect(await fs.stat(interrupted)).toBeTruthy();
    });

    test('a substituted quarantine inode is retained and never adopted as the removal target', async () => {
        let interrupted;
        await maintain({removeTree: async target => { interrupted = target; throw Error('fixture stop') }});
        await fs.rename(interrupted, interrupted + '-original');
        await fs.mkdir(interrupted, {mode: 0o700});
        await fs.writeFile(path.join(interrupted, 'keep'), 'foreign');
        let   removals = 0;
        const result   = await maintain({removeTree: async () => { removals++ }});
        expect(removals).toBe(0);
        expect(result.generations.some(row => row.state === 'retained')).toBe(true);
        expect(await fs.readFile(path.join(interrupted, 'keep'), 'utf8')).toBe('foreign');
    });

    test('a concurrent reference owner defers maintenance without creating retirement state', async () => {
        const held = references.holdRuntimeGenerationReferences({directory});
        try {
            expect((await maintain()).state).toBe('deferred');
            expect((await fs.readdir(directory)).filter(name => name.startsWith('.retiring-'))).toEqual([]);
        } finally { held.release() }
        expect(transactionFn().release()).toBe(true);
    });
});

test('maintenance cadence coalesces overlap and teardown joins the active pass', async () => {
    let tick, release, entered, calls = 0, cleared = false, closed = false;
    const started     = new Promise(resolve => { entered = resolve });
    const gate        = new Promise(resolve => { release = resolve });
    const maintenance = startRuntimeMaintenance(async () => { calls++; entered(); await gate }, {
        setIntervalFn(callback) { tick = callback; return {unref() {}} },
        clearIntervalFn() { cleared = true }
    });
    await started;
    tick(); tick();
    expect(calls).toBe(1);
    const closing = maintenance.close().then(() => { closed = true });
    await Promise.resolve();
    expect(cleared).toBe(true);
    expect(closed).toBe(false);
    release(); await closing;
    tick(); await Promise.resolve();
    expect(calls).toBe(1);
});
