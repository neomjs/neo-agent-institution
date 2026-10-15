import {expect, test}                                                                                                                 from '@playwright/test';
import {execFile}                                                                                                                     from 'node:child_process';
import {cpSync}                                                                                                                       from 'node:fs';
import fs                                                                                                                             from 'node:fs/promises';
import {tmpdir}                                                                                                                       from 'node:os';
import path                                                                                                                           from 'node:path';
import {pathToFileURL}                                                                                                                from 'node:url';
import {promisify}                                                                                                                    from 'node:util';
import {createRequire}                                                                                                                from 'node:module';
import * as runtimeVerifier                                                                                                           from 'neo-agent-brain/runtime-generation';
import * as runtimeReferences                                                                                                         from 'neo-agent-brain/runtime-generation-lease';
import {inspectPackageProtection, readPackageSlotRecord}                                                                              from '../../../../harness/packageSlots.mjs';
import {resolveLauncherRuntime}                                                                                                       from '../../../../harness/brain.mjs';
import {executePlan as executePlanImpl, holdInstallTransaction, prepareInstallContinuity, planInstall, readSlot, runningHarnessPaths} from '../../../../harness/install.mjs';
import {
    loadRuntimeGenerationVerifier,
    inspectRuntimeSupport,
    inspectRuntimeGenerationProcesses,
    classifyRuntimeGenerationRetention,
    materializeRuntimeGeneration,
    probeRuntimeGeneration,
    probeRuntimeRecovery as probeRuntimeRecoveryImpl
} from '../../../../harness/runtimeGeneration.mjs';
import {
    readRuntimeGeneration,
    runtimeGenerationIdentity
} from 'neo-agent-brain/runtime-generation';
import {isAdmissionSnapshot, isRuntimeReferenceSnapshot, RUNTIME_REFERENCE_SNAPSHOT_VERSION} from 'neo-agent-brain/launch-admission-journal';

/** @summary Keeps disposable package fixtures independent of the host's running Fleet processes. */
const executePlan = (steps, options = {}) => executePlanImpl(steps, {
    runningFn    : () => [], continuityFn: async () => ({hold: () => null}),
    transactionFn: () => holdInstallTransaction({directory: path.join(steps[0].custodyDir, 'installer')}), ...options
});

/** @summary The fixture supplies the current trusted codec explicitly, just as the packaged owner must. */
const probeRuntimeRecovery = (candidate, snapshot) => probeRuntimeRecoveryImpl(candidate, snapshot, {validateSnapshot: isAdmissionSnapshot});

const
    verifierFile = createRequire(import.meta.url).resolve('neo-agent-brain/runtime-generation'),
    receipt      = () => ({
        electronVersion: '43.5.0',
        owners         : Object.fromEntries(['product', 'brain', 'engine'].map((name, index) =>
            [name, {revision: String(index + 1).repeat(40)}]))
    }),
    compatible = () => ({
        platform   : process.platform, arch: process.arch, electronVersion: '43.5.0',
        nodeVersion: '24.19.0', moduleAbi: '148', launchProtocol: runtimeVerifier.LAUNCH_ADMISSION_PROTOCOL
    });

/** @summary Creates a tiny complete execution layout; no real binary or live custody is touched. */
async function fixture(root, info = receipt()) {
    const bundlePath  = path.join(root, 'Neo Harness.app');
    const runtimeRoot = path.join(bundlePath, 'Contents', 'Resources', 'organism');
    const executable  = path.join(bundlePath, 'Contents', 'MacOS', 'Neo Harness');
    await fs.mkdir(path.join(runtimeRoot, 'ai', 'mcp', 'client'), {recursive: true});
    await fs.mkdir(path.join(runtimeRoot, 'ai', 'services', 'fleet'), {recursive: true});
    await fs.copyFile(verifierFile, path.join(runtimeRoot, 'ai', 'services', 'fleet', 'runtimeGeneration.mjs'));
    const brainPackage = path.join(runtimeRoot, 'node_modules', 'neo-agent-brain');
    await fs.mkdir(path.join(brainPackage, 'ai/services/fleet'), {recursive: true});
    await fs.copyFile(verifierFile, path.join(brainPackage, 'ai/services/fleet/runtimeGeneration.mjs'));
    for (const base of [runtimeRoot, brainPackage]) {
        await fs.copyFile(path.join(path.dirname(verifierFile), 'mcpLaunchAdmission.mjs'), path.join(base, 'ai/services/fleet/mcpLaunchAdmission.mjs'));
        await fs.mkdir(path.join(base, 'src/fleet/contract'), {recursive: true});
        await fs.copyFile(path.resolve(path.dirname(verifierFile), '../../../src/fleet/contract/launchAdmission.mjs'),
            path.join(base, 'src/fleet/contract/launchAdmission.mjs'));
    }
    await fs.writeFile(path.join(brainPackage, 'package.json'), JSON.stringify({
        name: 'neo-agent-brain', type: 'module', exports: {
            './runtime-generation'      : './ai/services/fleet/runtimeGeneration.mjs',
            './runtime-generation-lease': './references.mjs'
        }
    }));
    await fs.writeFile(path.join(brainPackage, 'references.mjs'), 'export * from ' + JSON.stringify(
        pathToFileURL(createRequire(import.meta.url).resolve('neo-agent-brain/runtime-generation-lease')).href) + ';\n');
    await fs.writeFile(path.join(runtimeRoot, 'package.json'), JSON.stringify({
        dependencies: {'neo-agent-brain': 'github:neomjs/neo-agent-brain#' + info.owners.brain.revision}
    }));
    await fs.mkdir(path.dirname(executable), {recursive: true});
    await fs.writeFile(path.join(runtimeRoot, 'organism-build-info.json'), JSON.stringify(info));
    await fs.writeFile(path.join(runtimeRoot, 'ai', 'mcp', 'client', 'fleetMcpLauncher.mjs'), 'export const launcher = true;\n');
    await fs.writeFile(executable, 'fixture executable\n', {mode: 0o755});
    await fs.symlink('Resources/organism', path.join(bundlePath, 'Contents', 'runtime-link'));
    return {bundlePath, runtimeRoot, executable, directory: path.join(root, 'runtime'), probe: compatible,
        verifier: runtimeVerifier, references: runtimeReferences}
}

/** @summary Unlocks only fixture directories, leaving symlinks untraversed during cleanup. */
async function cleanup(file) {
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat) return;
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
        await fs.chmod(file, 0o700);
        for (const name of await fs.readdir(file)) await cleanup(path.join(file, name));
    }
    await fs.rm(file, {recursive: true, force: true})
}

/** @summary Builds three real fixture slots and the installer's isolated custody root. */
async function installFixture(root) {
    const installed   = await fixture(path.join(root, 'installed'));
    const nextReceipt = receipt(), priorReceipt = receipt();
    nextReceipt.owners.brain.revision = 'a'.repeat(40);
    priorReceipt.owners.brain.revision = 'b'.repeat(40);
    const artifact   = await fixture(path.join(root, 'artifact'), nextReceipt);
    const rollback   = await fixture(path.join(root, 'rollback'), priorReceipt);
    const custodyDir = path.join(root, 'userData');
    await fs.mkdir(custodyDir);
    await fs.writeFile(path.join(custodyDir, 'plane.json'), '{"fixture":true}');
    return {
        artifact: readSlot(artifact.bundlePath), installed: readSlot(installed.bundlePath),
        rollback: readSlot(rollback.bundlePath), custodyDir,
        parked  : readSlot(installed.bundlePath + '.restoring')
    }
}

/** @summary Replaces only ditto with a fixture copy; any real quit or open is a test failure. */
function copyBundle(command, args) {
    expect(command).toBe('ditto');
    cpSync(args[0], args[1], {recursive: true, verbatimSymlinks: true})
}

test.describe('harness/runtimeGeneration — process census', () => {
    const directory = '/owned/runtime/' + 'a'.repeat(64), sibling = directory + '-foreign';
    const birth     = 'Thu Oct 15 09:00:00 2026';
    /** @summary Supplies a process table without command names, including the exact observation child. */
    const table = (probe, rows = [[10, birth], [20, birth]]) =>
        [...rows.map(([pid, start, state = 'S', uid = 501]) => `${pid} ${uid} ${state} ${start}`), `${probe} 501 R ${birth}`].join('\n');
    /** @summary Uses real lsof NUL field boundaries, preserving embedded newlines in filenames. */
    const mappings = rows => rows.map(([pid, files]) => `p${pid}\0\n` + files.map(name => `ftxt\0n${name}\0\n`).join('')).join('');
    /** @summary Replays the three observations while retaining each execFile promise's child identity. */
    async function inspect({before = table(91), after = table(93), mapped = mappings([[10, ['/usr/bin/node']],
        [20, [directory + '/host.runtime/node']]]), fail = null, platform = 'darwin', probeIdentity = true} = {}) {
        let   index  = 0;
        const calls  = [], responses = [before, mapped, after];
        const result = await inspectRuntimeGenerationProcesses({directories: [directory], uid: 501, platform,
            executeFn(command, args, options) {
                calls.push({command, args, options});
                const current = index++, pending = current === fail
                    ? Promise.reject(Object.assign(new Error('inspection failed'), {stdout: responses[current]}))
                    : Promise.resolve({stdout: responses[current], stderr: ''});
                if (probeIdentity) pending.child = {pid: 91 + current};
                return pending;
            }
        });
        return {result, calls};
    }

    test('loaded executable mapping finds a title-masked child without command-name filtering', async () => {
        const {result, calls} = await inspect();
        expect(result).toEqual({state: 'observed', reason: null,
            processes: [{pid: 20, startedAt: birth, directories: [directory]}]});
        expect(calls[0].args).toEqual(['-axo', 'pid=,uid=,stat=,lstart=']);
        expect(calls[1].args).toEqual(['-nP', '-a', '-u', '501', '-d', 'txt', '-F0pfn']);
        expect(calls.every(call => call.options.timeout > 0 && call.options.maxBuffer > 0)).toBe(true);
    });

    test('a surviving process omitted from loaded mappings makes absence unknown', async () => {
        const {result} = await inspect({mapped: mappings([[10, ['/usr/bin/node']]])});
        expect(result).toEqual({state: 'unknown', reason: 'process-census-incomplete', processes: []});
    });

    test('the explicit effective uid excludes privileged login processes owned by another account', async () => {
        const rows     = [[10, birth], [20, birth], [30, birth, 'S', 0]];
        const {result} = await inspect({before: table(91, rows), after: table(93, rows)});
        expect(result.state).toBe('observed');
        expect(result.processes).toHaveLength(1);
    });

    test('new and reused process identities during inspection make absence unknown', async () => {
        for (const after of [table(93, [[10, birth], [20, birth], [30, birth]]),
            table(93, [[10, birth], [20, 'Thu Oct 15 09:00:01 2026']])]) {
            const {result} = await inspect({after});
            expect(result.state).toBe('unknown');
            expect(result.processes).toHaveLength(1);
        }
    });

    test('a disappeared child does not prevent observing the remaining processes', async () => {
        const {result} = await inspect({after: table(93, [[10, birth]]), mapped: mappings([[10, ['/usr/bin/node']]])});
        expect(result).toEqual({state: 'observed', reason: null, processes: []});
    });

    test('inspection failure retains independently observed runtime mappings', async () => {
        for (const fail of [0, 1, 2]) {
            const {result} = await inspect({fail});
            expect(result.state).toBe('unknown');
            expect(result.reason).toBe('process-inspection-failed');
            expect(result.processes[0].directories).toEqual([directory]);
        }
    });

    test('malformed and truncated mapping output cannot erase an earlier positive observation', async () => {
        for (const tail of ['bad-field\0\n', 'p30\0\nftxt\0n/incomplete']) {
            const {result} = await inspect({mapped: mappings([[20, [directory + '/node']]]) + tail});
            expect(result.state).toBe('unknown');
            expect(result.reason).toBe('process-mappings-invalid');
            expect(result.processes[0].directories).toEqual([directory]);
        }
    });

    test('NUL parsing preserves filename newlines and directory containment rejects shared prefixes', async () => {
        const {result} = await inspect({mapped: mappings([[10, [sibling + '/node']],
            [20, ['/unrelated/file\np999\nftxt\nn' + directory + '/node']]])});
        expect(result).toEqual({state: 'observed', reason: null, processes: []});
    });

    test('a zombie needs no mapping but missing probe identity refuses completeness', async () => {
        const rows = [[10, birth], [20, birth, 'Z']];
        expect((await inspect({before: table(91, rows), after: table(93, rows),
            mapped: mappings([[10, ['/usr/bin/node']]])})).result.state).toBe('observed');
        expect((await inspect({probeIdentity: false})).result.state).toBe('unknown');
    });

    test('unsupported hosts and malformed process tables retain rather than infer vacancy', async () => {
        const unsupported = await inspect({platform: 'other'});
        expect(unsupported.result.state).toBe('unknown');
        expect(unsupported.calls).toHaveLength(0);
        const {result} = await inspect({after: 'not a process table'});
        expect(result.state).toBe('unknown');
        expect(result.processes[0].directories).toEqual([directory]);
    });
});

test.describe('harness/runtimeGeneration — retention evidence', () => {
    const id = 'a'.repeat(64), other = 'b'.repeat(64);
    /** @summary Creates a complete pin in the actual persisted runtime format. */
    const pin = (identity = id) => ({id: identity, directory: '/runtime/' + identity,
        runtimeRoot: `/runtime/${identity}/host.runtime/organism`,
        executable : `/runtime/${identity}/host.runtime/node`, payloadDigest: 'c'.repeat(64)});
    /** @summary A real closed Start record exercises the production snapshot validator. */
    const seat = (state = 'running', changes = {}) => ({state, ownershipUnresolved: false, cleanupUnresolved: false,
        start: {version: 2, agentId: 'seat', identity: 'neo-gpt-sophie', harnessType: 'codex',
            pid            : 42, pidStartedAt: 'Thu Oct 15 09:00:00 2026', startedAt: '2026-10-15T09:00:00.000Z',
            cwd            : '/workspace', instanceHome: '/seat', launchCommand: '/harness', launchInterpreter: null,
            profileArg     : null, leaseRequired: false, runtime: pin(), planSha256: 'd'.repeat(64),
            profile        : null, admissionGeneration: null,
            bridgeAuthority: {version: 1, source: 'registry-file', registryRoot: '/registry', publicKeySha256: 'e'.repeat(64)},
            targets        : []}, ...changes});
    /** @summary Represents a reserved or terminal reference using the production journal's full shape. */
    const admission = (state = 'active', runtime = pin()) => ({id: 'grant-generation', agentId: 'seat',
        identity          : 'neo-gpt-sophie', state, reason: null, reservedAt: '2026-10-15T09:00:00.000Z',
        activatedAt       : null, revokedAt: null, definitionHash: 'f'.repeat(64), runtime,
        credentialBindings: {}, residentBindings: {}, servers: []});
    /** @summary Requires real codec acceptance before asking the host decision to classify a fixture. */
    const evaluate = ({seats = [], generations = [], ...overrides} = {}) => {
        const snapshot = {version: RUNTIME_REFERENCE_SNAPSHOT_VERSION, seats, generations};
        expect(isAdmissionSnapshot(snapshot)).toBe(true);
        return classifyRuntimeGenerationRetention({generation: pin(), protectedIds: [other], snapshot,
            census            : {state: 'observed', reason: null, processes: []}, verifier: runtimeVerifier,
            validateReferences: isRuntimeReferenceSnapshot, ...overrides});
    };

    test('zero children does not release an idle running seat pin', () => {
        expect(evaluate({seats: [seat()]})).toEqual({eligible: false,
            reasons: [{code: 'seat-pin-held', subject: 'seat'}]});
    });

    test('unknown ownership or cleanup retains even a terminal seat', () => {
        for (const flags of [{ownershipUnresolved: true}, {cleanupUnresolved: true}]) {
            expect(evaluate({seats: [seat('exited', flags)]})).toEqual({eligible: false,
                reasons: [{code: 'seat-pin-unknown', subject: 'seat'}]});
        }
    });

    test('only proved terminal seats and revoked admissions release their references', () => {
        expect(evaluate({seats: [seat('exited')], generations: [admission('revoked')]}))
            .toEqual({eligible: true, reasons: []});
        for (const state of ['reserved', 'active', 'stale']) {
            expect(evaluate({generations: [admission(state)]}).reasons)
                .toContainEqual({code: 'admission-reference-held', subject: 'seat'});
        }
    });

    test('installed, rollback and current-host protections prevent retirement', () => {
        expect(evaluate({protectedIds: [other, id]})).toEqual({eligible: false, reasons: [{code: 'package-protected'}]});
        for (const protectedIds of [null, [], [null], ['unknown']]) {
            expect(evaluate({protectedIds}).reasons).toContainEqual({code: 'package-protection-unknown'});
        }
    });

    test('a lingering child retains after the seat and admission ended', () => {
        const result = evaluate({seats: [seat('stopped')], generations: [admission('revoked')],
            census: {state: 'observed', reason: null, processes: [{pid: 42, directories: [pin().directory]}]}});
        expect(result).toEqual({eligible: false, reasons: [{code: 'runtime-process-held', subject: 42}]});
    });

    test('unknown observations preserve independent package, seat and process holders', () => {
        const result = evaluate({protectedIds: [id], seats: [seat()],
            census: {state: 'unknown', reason: 'process-census-incomplete', processes: [{pid: 42, directories: [pin().directory]}]}});
        expect(result.eligible).toBe(false);
        expect(result.reasons).toEqual([{code: 'package-protected'}, {code: 'seat-pin-held', subject: 'seat'},
            {code: 'process-census-unknown'}, {code: 'runtime-process-held', subject: 42}]);
    });

    test('missing or malformed reference evidence never turns into an empty census', () => {
        for (const snapshot of [null, {version: 5, seats: [], generations: []}]) {
            expect(evaluate({snapshot}).reasons).toContainEqual({code: 'runtime-references-unknown'});
        }
        expect(evaluate({generations: [admission('active', null)]}).reasons).toContainEqual({code: 'runtime-reference-invalid'});
        expect(evaluate({census: null}).eligible).toBe(false);
    });

    test('a recoverable legacy snapshot cannot attest that its writer excludes new references', () => {
        const legacy = {version: 6, seats: [], generations: []};
        expect(isAdmissionSnapshot(legacy)).toBe(true);
        expect(evaluate({snapshot: legacy})).toEqual({eligible: false, reasons: [{code: 'runtime-references-unknown'}]});
    });

    test('valid independent observations allow an unused generation while retaining other generations', () => {
        const holder = seat(); holder.start.runtime = pin(other);
        expect(evaluate({seats: [holder], generations: [admission('active', pin(other))]}))
            .toEqual({eligible: true, reasons: []});
    });
});

test.describe('harness/runtimeGeneration — verified package copies', () => {
    let root;
    test.beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'runtime-generation-'))); });
    test.afterEach(async () => { await cleanup(root); });

    test('publication holds reference exclusion through its probe and releases before returning', async () => {
        const input     = await fixture(root);
        let   probed    = false;
        const published = await materializeRuntimeGeneration({...input, probe: () => {
            probed = true;
            expect(() => runtimeReferences.holdRuntimeGenerationReferences({directory: input.directory})).toThrow(/held/);
            return compatible();
        }});
        expect(probed).toBe(true);
        expect(published.id).toBe(runtimeGenerationIdentity(receipt()).id);
        expect(runtimeReferences.holdRuntimeGenerationReferences({directory: input.directory}).release()).toBe(true);
    });

    test('a caller-owned guard survives publication and unguarded owners refuse before copying', async () => {
        const input = await fixture(root);
        await fs.mkdir(input.directory, {mode: 0o700});
        await expect(materializeRuntimeGeneration({...input, references: undefined})).rejects.toThrow(/reference owner/);
        await expect(materializeRuntimeGeneration({...input, referenceGuard: {assertCurrent() {}}})).rejects.toThrow(/not guarded/);
        const referenceGuard = runtimeReferences.holdRuntimeGenerationReferences({directory: input.directory});
        try {
            await materializeRuntimeGeneration({...input, referenceGuard});
            runtimeReferences.assertRuntimeGenerationReferences(referenceGuard, input.directory);
        } finally { expect(referenceGuard.release()).toBe(true) }
    });

    test('a canceled publication never probes or creates a generation while another actor holds the parent', async () => {
        const input = await fixture(root), controller = new AbortController();
        await fs.mkdir(input.directory, {mode: 0o700});
        const held    = runtimeReferences.holdRuntimeGenerationReferences({directory: input.directory});
        let   probes  = 0;
        const pending = materializeRuntimeGeneration({...input, signal: controller.signal, probe: () => { probes++; return compatible() }});
        controller.abort();
        try {
            await expect(pending).rejects.toThrow(/abort/i);
            expect(probes).toBe(0);
            expect((await fs.readdir(input.directory)).filter(name => /^[a-f0-9]{64}$/.test(name))).toEqual([]);
        } finally { held.release() }
    });

    test('first-run boot publishes in the selected profile and reuses the verified executable', async () => {
        const input   = await fixture(root), userData = path.join(root, 'diagnostic', 'userData');
        let   probes  = 0;
        const options = {
            packaged   : true, brainMode: true, env: {NEO_HARNESS_NODE_BIN: '/unverified/node'},
            bundlePath : input.bundlePath, packagedOrganismRoot: input.runtimeRoot,
            executable : input.executable, userData,
            materialize: selected => materializeRuntimeGeneration({...selected, probe: () => { probes++; return compatible(); }})
        };
        const first = await resolveLauncherRuntime(options), second = await resolveLauncherRuntime(options);
        expect(first.generation.directory).toBe(path.join(await fs.realpath(userData), 'brain', 'runtime', runtimeGenerationIdentity(receipt()).id));
        expect(first.runtimeRoot).toBe(first.generation.runtimeRoot);
        expect(first.executable).toBe(first.generation.executable);
        expect(first.launchArgs).toEqual([`--neo-runtime-generation=${first.generation.directory}`]);
        await expect(runtimeVerifier.bindCurrentRuntime({
            args: first.launchArgs, runtimeRoot: first.runtimeRoot, executable: first.executable
        })).resolves.toEqual({runtimeRoot: first.runtimeRoot, executable: first.executable, generation: first.generation});
        expect(first.executable.startsWith(await fs.realpath(input.bundlePath))).toBe(false);
        expect(second).toEqual(first);
        expect(probes).toBe(1);
        await expect(fs.stat(path.join(root, 'installed-userData'))).rejects.toMatchObject({code: 'ENOENT'});
    });

    test('the verifier comes from the assembled source package, never an external checkout or escaping source link', async () => {
        const input = await fixture(root), outside = await fixture(path.join(root, 'outside'));
        await expect(loadRuntimeGenerationVerifier({bundlePath: input.bundlePath, runtimeRoot: outside.runtimeRoot}))
            .rejects.toMatchObject({code: 'runtime-verifier-invalid'});
        const file = path.join(input.runtimeRoot, 'node_modules/neo-agent-brain/ai/services/fleet/runtimeGeneration.mjs');
        await fs.unlink(file);
        await fs.symlink(verifierFile, file);
        await expect(loadRuntimeGenerationVerifier(input)).rejects.toMatchObject({code: 'runtime-verifier-invalid'});
        await expect(materializeRuntimeGeneration(input)).rejects.toMatchObject({code: 'runtime-payload-invalid'});
    });

    test('an older package with no verifier is still copied and checked by the current trusted host', async () => {
        const input = await fixture(root);
        await fs.unlink(path.join(input.runtimeRoot, 'ai/services/fleet/runtimeGeneration.mjs'));
        await fs.rm(path.join(input.runtimeRoot, 'node_modules/neo-agent-brain'), {recursive: true});
        const result = await materializeRuntimeGeneration(input);
        expect(await readRuntimeGeneration({directory: result.directory})).toEqual(result);
        await expect(materializeRuntimeGeneration({...input, verifier: undefined}))
            .rejects.toMatchObject({code: 'runtime-verifier-invalid'});
    });

    test('a current source package whose Brain dependency disagrees with its receipt is refused', async () => {
        const input = await fixture(root);
        await fs.writeFile(path.join(input.runtimeRoot, 'package.json'), JSON.stringify({
            dependencies: {'neo-agent-brain': 'github:neomjs/neo-agent-brain#' + 'f'.repeat(40)}
        }));
        await expect(loadRuntimeGenerationVerifier(input)).rejects.toMatchObject({code: 'runtime-verifier-invalid'});
    });

    test('a retained always-pass verifier cannot hide a changed executable from the trusted source verifier', async () => {
        const input = await fixture(root), first = await materializeRuntimeGeneration(input);
        const file  = path.join(first.runtimeRoot, 'node_modules/neo-agent-brain/ai/services/fleet/runtimeGeneration.mjs');
        await fs.chmod(file, 0o644);
        await fs.writeFile(file, 'globalThis.badRetainedVerifier=true;export async function readRuntimeGeneration(){return {approved:true}}');
        await fs.chmod(file, 0o444);
        await fs.chmod(first.executable, 0o755);
        await fs.writeFile(first.executable, 'changed executable');
        await fs.chmod(first.executable, 0o555);
        await expect(materializeRuntimeGeneration(input)).rejects.toMatchObject({code: 'runtime-integrity-failed'});
        expect(globalThis.badRetainedVerifier).toBeUndefined();
    });

    test('packaged boot refuses a missing profile or a failed publication without returning bundle bindings', async () => {
        const input   = await fixture(root), calls = [];
        const options = {
            packaged            : true, brainMode: true, bundlePath: input.bundlePath,
            packagedOrganismRoot: input.runtimeRoot, executable: input.executable,
            materialize         : selected => { calls.push(selected); throw Error('runtime-integrity-failed'); }
        };
        await expect(resolveLauncherRuntime(options)).rejects.toThrow(/absolute userData/);
        expect(calls).toEqual([]);
        await expect(resolveLauncherRuntime({...options, userData: path.join(root, 'userData')}))
            .rejects.toThrow('runtime-integrity-failed');
        expect(calls).toHaveLength(1);
    });

    test('actual packaged main selects diagnostic custody before publication and imports private contracts from that generation', async () => {
        const main   = new URL('../../../../harness/main.mjs', import.meta.url).href;
        const script = `
            import {registerHooks} from 'node:module';
            import path from 'node:path';
            const root = process.argv[1];
            process.resourcesPath ??= path.join(root, 'Neo Harness.app', 'Contents', 'Resources');
            Object.assign(process.env, {
                NEO_HARNESS_SMOKE: '1', NEO_HARNESS_BRAIN: '1', NEO_HARNESS_SMOKE_PLANE: '0',
                NEO_HARNESS_SMOKE_HOLD: '0', NEO_HARNESS_BRAIN_ROOT: path.join(root, 'diagnostic')
            });
            const state = globalThis.bootWitness = {
                profile: path.join(root, 'installed-userData'), resourcesPath: process.resourcesPath, imports: [], scheme: false,
                generation: {id: 'verified-fixture', runtimeRoot: path.join(root, 'generation', 'organism'), executable: path.join(root, 'generation', 'host')}
            };
            const privateIdentity = '/ai/graph/normalizeAgentIdentityNodeId.mjs';
            const privateLaunch = '/ai/services/fleet/fleetLaunchContract.mjs';
            const publicWire = '/node_modules/neo-agent-brain/src/fleet/contract/index.mjs';
            const leaf = url => [privateIdentity, privateLaunch, publicWire].find(suffix => url.endsWith(suffix));
            registerHooks({
                resolve(specifier, context, next) {
                    if (specifier === 'electron') return {url: 'boot-witness:electron', shortCircuit: true};
                    if (leaf(specifier)) return {url: specifier, shortCircuit: true};
                    return next(specifier, context);
                },
                load(url, context, next) {
                    let source;
                    if (url === 'boot-witness:electron') source =
                        'const state = globalThis.bootWitness; export const app = {isPackaged:true, getPath: name => name === "userData" ? state.profile : "/tmp", setPath:(name,value) => {if(name === "userData") state.profile=value;}, setAppLogsPath:() => {} };' +
                        'export const protocol = {registerSchemesAsPrivileged:() => {state.scheme=true;}}; export const BrowserWindow={},ipcMain={},Menu={},nativeImage={},safeStorage={},session={},shell={},Tray={};';
                        else if (url.endsWith('/runtimeGeneration.mjs')) source =
                                'export async function loadRuntimeGenerationReferences(){return {fixture:true};} export async function loadRuntimeGenerationVerifier(){return {fixture:true,runtimeGenerationArguments:()=>[]};} export async function materializeRuntimeGeneration(input) {const state=globalThis.bootWitness; state.publication={input,profile:state.profile,scheme:state.scheme}; return state.generation;}';
                    else if (url.endsWith('/mainLog.mjs')) source = 'export const carriesSecret=()=>false, createMainLog=()=>({install(){}});';
                    else if (leaf(url)) {
                        state.imports.push(url);
                        if (url.endsWith(privateIdentity)) source = 'export const normalizeAgentIdentityNodeId=()=>{};';
                        else if (url.endsWith(privateLaunch)) source = 'export const FLEET_CREDENTIAL_METHODS=[],probeExistingFleetServer=()=>{},resolveFleetBearer=()=>{throw Error("boot-witness-complete")};';
                        else source = 'export const FLEET_WIRE_METHODS=[],FLEET_WIRE_RESPONSE_STATES=[],createFleetWireOffer=()=>{},createFleetWireRequest=()=>{},createFleetWireResponse=()=>{},inspectFleetWireResponse=()=>{};';
                    }
                    return source === undefined ? next(url, context) : {format:'module',source,shortCircuit:true};
                }
            });
            try { await import(${JSON.stringify(main)}); throw Error('boot witness did not stop'); }
            catch (error) { if (error.message !== 'boot-witness-complete') throw error; }
            console.log(JSON.stringify(state));
        `;
        const {stdout} = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, root], {timeout: 10000});
        const witness  = JSON.parse(stdout.trim());
        const profile  = path.join(root, 'diagnostic', 'userData');
        expect(witness.publication).toMatchObject({
            profile, scheme: true,
            input: {directory: path.join(profile, 'brain', 'runtime'), bundlePath: path.resolve(witness.resourcesPath, '..', '..')}
        });
        expect(witness.imports.filter(url => !url.includes('/node_modules/'))).toEqual(expect.arrayContaining([
            pathToFileURL(path.join(root, 'generation/organism/ai/graph/normalizeAgentIdentityNodeId.mjs')).href,
            pathToFileURL(path.join(root, 'generation/organism/ai/services/fleet/fleetLaunchContract.mjs')).href
        ]));
        expect(witness.imports.find(url => url.includes('/node_modules/')))
            .toContain('/Neo%20Harness.app/Contents/Resources/organism/node_modules/');
    });

    test('full receipt identity separates packages sharing the product revision', () => {
        const first = receipt(), changed = receipt();
        changed.owners.brain.revision = 'a'.repeat(40);
        expect(runtimeGenerationIdentity(first).id).not.toBe(runtimeGenerationIdentity(changed).id);
        changed.owners.brain.revision = first.owners.brain.revision;
        changed.electronVersion = '43.6.0';
        expect(runtimeGenerationIdentity(first).id).not.toBe(runtimeGenerationIdentity(changed).id);
        expect(runtimeGenerationIdentity({...first, stagedAt: 'a different time'}).id).toBe(runtimeGenerationIdentity(first).id);
        expect(() => runtimeGenerationIdentity({owners: first.owners})).toThrow(/runtime-receipt-invalid/);
        expect(() => runtimeGenerationIdentity({...first, owners: {product: {revision: '1234'}}})).toThrow(/runtime-receipt-invalid/);
    });

    test('publication returns sealed paths outside the bundle and preserves relative links', async () => {
        const input  = await fixture(root), probes = [];
        const result = await materializeRuntimeGeneration({...input, probe: candidate => {
            probes.push(candidate);
            expect(candidate.runtimeRoot.startsWith(input.bundlePath)).toBe(false);
            expect(candidate.executable.startsWith(input.bundlePath)).toBe(false);
            return compatible()
        }});
        expect(probes).toHaveLength(1);
        expect(result.directory).toBe(path.join(await fs.realpath(input.directory), result.id));
        expect(result.runtimeRoot).toContain('host.runtime' + path.sep);
        expect(result.executable).not.toContain('.app' + path.sep);
        expect((await fs.stat(result.executable)).mode & 0o777).toBe(0o555);
        expect((await fs.stat(result.directory)).mode & 0o777).toBe(0o500);
        expect(await fs.readlink(path.join(result.directory, 'host.runtime', 'Contents', 'runtime-link'))).toBe('Resources/organism');
        expect(await fs.readdir(input.directory)).toEqual([result.id]);
        expect(result.compatibility).not.toHaveProperty('runtimeRoot');
        expect(result.compatibility.launchProtocol).toBe(runtimeVerifier.LAUNCH_ADMISSION_PROTOCOL);
        expect(await readRuntimeGeneration({directory: result.directory})).toEqual(result);
    });

    test('reinstalling the exact payload does not copy or probe again', async () => {
        const input  = await fixture(root), first = await materializeRuntimeGeneration(input);
        const before = await fs.stat(path.join(first.directory, 'generation.json'));
        const second = await materializeRuntimeGeneration({...input, probe: () => { throw Error('must not reprobe'); }});
        const after  = await fs.stat(path.join(first.directory, 'generation.json'));
        expect(second).toEqual(first);
        expect(after.ino).toBe(before.ino);
        expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    test('the unchanged installer census excludes the published executable but retains bundle users', async () => {
        const input     = await fixture(root), generation = await materializeRuntimeGeneration(input);
        const canonical = '/Applications/Neo Harness.app/Contents/MacOS/Neo Harness';
        expect(runningHarnessPaths([canonical, input.executable, generation.executable].join('\n')))
            .toEqual([canonical, input.executable]);
    });

    test('install waits for a verified runtime before changing either slot, then restore selects the old payload', async () => {
        const slots = await installFixture(root);
        let release, entered;
        const gate      = new Promise(resolve => { release = resolve; });
        const probing   = new Promise(resolve => { entered = resolve; });
        const operation = executePlan(planInstall(slots).steps, {
            runFn        : copyBundle,
            materializeFn: input => materializeRuntimeGeneration({...input, probe: async () => {
                entered();
                await gate;
                return compatible()
            }})
        });
        await probing;
        try {
            expect(readSlot(slots.installed.path).receipt).toEqual(slots.installed.receipt);
            expect(readSlot(slots.rollback.path).receipt).toEqual(slots.rollback.receipt);
        } finally { release(); }
        const installed = await operation;
        expect(installed.custody.before).toBe(installed.custody.after);
        expect(installed.generation.id).toBe(runtimeGenerationIdentity(slots.artifact.receipt).id);
        expect(await readRuntimeGeneration({directory: installed.generation.directory})).toEqual(installed.generation);
        expect(readSlot(slots.installed.path).receipt).toEqual(slots.artifact.receipt);
        expect(readSlot(slots.rollback.path).receipt).toEqual(slots.installed.receipt);

        const restored = await executePlan(planInstall({
            ...slots, mode: 'restore', installed: readSlot(slots.installed.path), rollback: readSlot(slots.rollback.path)
        }).steps, {runFn: copyBundle, materializeFn: input => materializeRuntimeGeneration({...input, probe: compatible})});
        expect(restored.generation.id).toBe(runtimeGenerationIdentity(slots.installed.receipt).id);
        expect(readSlot(slots.installed.path).receipt).toEqual(slots.installed.receipt);
        expect(readSlot(slots.rollback.path).receipt).toEqual(slots.artifact.receipt);
        expect(await readRuntimeGeneration({directory: installed.generation.directory})).toEqual(installed.generation);
        expect(inspectPackageProtection({directory: path.dirname(restored.generation.directory), verifier: runtimeVerifier})).toEqual({
            state       : 'observed', reason: null,
            protectedIds: [runtimeGenerationIdentity(slots.installed.receipt).id, runtimeGenerationIdentity(slots.artifact.receipt).id]
        });
    });

    test('the successor opens only after durable package protection and observed exclusion release', async () => {
        const slots  = await installFixture(root), directory = path.join(slots.custodyDir, 'brain/runtime');
        let   opened = false;
        await executePlan(planInstall({...slots, flags: {open: true}}).steps, {
            materializeFn: input => materializeRuntimeGeneration({...input, probe: compatible}),
            runFn(command, args) {
                if (command !== 'open') return copyBundle(command, args);
                opened = true;
                const protection = inspectPackageProtection({directory, verifier: runtimeVerifier});
                expect(protection.state).toBe('observed');
                expect(protection.protectedIds).toContain(runtimeGenerationIdentity(slots.artifact.receipt).id);
                expect(holdInstallTransaction({directory: path.join(slots.custodyDir, 'installer')}).release()).toBe(true);
                expect(runtimeReferences.holdRuntimeGenerationReferences({directory}).release()).toBe(true);
            }
        });
        expect(opened).toBe(true);
    });

    for (const failure of ['interrupted-before-publication', 'publication-failed']) {
        test(`${failure} retains prior evidence and never opens the successor`, async () => {
            const slots   = await installFixture(root), directory = path.join(slots.custodyDir, 'brain/runtime');
            const options = {runFn: copyBundle, materializeFn: input => materializeRuntimeGeneration({...input, probe: compatible})};
            await executePlan(planInstall({...slots, artifact: slots.installed}).steps, options);
            const prior = readPackageSlotRecord({directory, verifier: runtimeVerifier});
            const plan  = planInstall({...slots, flags: {open: true}}), publication = plan.steps.findIndex(step => step.type === 'publish-protection');
            if (failure === 'interrupted-before-publication') {
                await executePlan(plan.steps.slice(0, publication), options);
            } else {
                await expect(executePlan(plan.steps, {...options, publishSlotsFn() { throw Error('fixture publication failed') }}))
                    .rejects.toThrow(/fixture publication failed/);
            }
            expect(readPackageSlotRecord({directory, verifier: runtimeVerifier})).toEqual(prior);
            expect(inspectPackageProtection({directory, verifier: runtimeVerifier}).state).toBe('unknown');
            expect(readSlot(slots.installed.path).receipt).toEqual(slots.artifact.receipt);
            await executePlan(planInstall({...slots, installed: readSlot(slots.installed.path), rollback: readSlot(slots.rollback.path)}).steps, options);
            expect(inspectPackageProtection({directory, verifier: runtimeVerifier}).state).toBe('observed');
        });
    }

    test('a published runtime left by a failed first install is retained recovery state on retry', async () => {
        root = await fs.realpath(root);
        const artifact  = await fixture(path.join(root, 'artifact'));
        const installed = path.join(root, 'Applications/Neo Harness.app');
        const slots     = {artifact: readSlot(artifact.bundlePath), installed: readSlot(installed),
            rollback: readSlot(path.join(root, 'rollback/Neo Harness.rollback')), custodyDir: path.join(root, 'userData')};
        const continuityFn  = step => prepareInstallContinuity(step, {inspectSupport: async () => ({kind: 'generation'})});
        const transactionFn = () => holdInstallTransaction({directory: path.join(root, 'installer')});
        let published;
        await expect(executePlan(planInstall(slots).steps, {continuityFn, transactionFn, runFn: copyBundle,
            materializeFn: async input => {
                published = await materializeRuntimeGeneration({...input, probe: compatible});
                await fs.writeFile(path.join(artifact.runtimeRoot, 'organism-build-info.json'), JSON.stringify({...receipt(), changed: true}));
                return published;
            }
        })).rejects.toThrow(/planned package slot changed/);
        expect(readSlot(installed).exists).toBe(false);
        expect(await readRuntimeGeneration({directory: published.directory})).toEqual(published);
        const calls = [];
        await expect(executePlan(planInstall({...slots, artifact: readSlot(artifact.bundlePath)}).steps,
            {continuityFn, transactionFn, runFn: command => calls.push(command)})).rejects.toThrow(/managed custody remains/);
        expect(calls).toEqual([]);
        expect(await readRuntimeGeneration({directory: published.directory})).toEqual(published);
        expect(await fs.readdir(path.join(slots.custodyDir, 'brain/fleet/launch-admission'))).toEqual([]);
    });

    test('runtime failure preserves installed and rollback slots and never opens the app', async () => {
        const slots = await installFixture(root), calls = [];
        await expect(executePlan(planInstall({...slots, flags: {open: true}}).steps, {
            runFn        : (command, args) => { calls.push(command); copyBundle(command, args); },
            materializeFn: input => materializeRuntimeGeneration({...input, probe: () => { throw Error('incompatible'); }})
        })).rejects.toThrow(/runtime-compatibility-failed/);
        expect(readSlot(slots.installed.path).receipt).toEqual(slots.installed.receipt);
        expect(readSlot(slots.rollback.path).receipt).toEqual(slots.rollback.receipt);
        expect(calls).toEqual(['ditto']);
        expect(await fs.readdir(path.join(slots.custodyDir, 'brain', 'runtime'))).toEqual([]);
    });

    test('an equal-receipt install creates the missing runtime once without rotating slots', async () => {
        const slots = await installFixture(root);
        await fs.rm(slots.artifact.path, {recursive: true});
        await fs.cp(slots.installed.path, slots.artifact.path, {recursive: true, verbatimSymlinks: true});
        slots.artifact = readSlot(slots.artifact.path);
        let   probes  = 0;
        const options = {
            runFn        : () => { throw Error('no bundle operation expected'); },
            materializeFn: input => materializeRuntimeGeneration({...input, probe: () => { probes++; return compatible(); }})
        };
        const first  = await executePlan(planInstall(slots).steps, options);
        const second = await executePlan(planInstall(slots).steps, options);
        expect(second.generation).toEqual(first.generation);
        expect(probes).toBe(1);
        expect(readSlot(slots.installed.path).receipt).toEqual(slots.installed.receipt);
        expect(readSlot(slots.rollback.path).receipt).toEqual(slots.rollback.receipt);
    });

    test('equal receipts cannot hide an artifact payload mismatch', async () => {
        const slots = await installFixture(root);
        await fs.rm(slots.artifact.path, {recursive: true});
        await fs.cp(slots.installed.path, slots.artifact.path, {recursive: true, verbatimSymlinks: true});
        slots.artifact = readSlot(slots.artifact.path);
        await fs.writeFile(path.join(slots.artifact.path, 'Contents', 'MacOS', 'Neo Harness'), 'changed bytes');
        await expect(executePlan(planInstall(slots).steps, {
            runFn        : () => { throw Error('no bundle operation expected'); },
            materializeFn: input => materializeRuntimeGeneration({...input, probe: compatible})
        })).rejects.toThrow(/non-reproducible-build/);
        expect(readSlot(slots.installed.path).receipt).toEqual(slots.installed.receipt);
        expect(readSlot(slots.rollback.path).receipt).toEqual(slots.rollback.receipt);
    });

    test('same identity with different bytes refuses without replacing its published generation', async () => {
        const input = await fixture(root), first = await materializeRuntimeGeneration(input);
        await fs.writeFile(input.executable, 'different fixture executable\n');
        await expect(materializeRuntimeGeneration(input)).rejects.toMatchObject({code: 'non-reproducible-build'});
        expect(await readRuntimeGeneration({directory: first.directory})).toEqual(first);
    });

    test('a changed executable permission is payload drift, not an identity change', async () => {
        const input = await fixture(root), first = await materializeRuntimeGeneration(input);
        await fs.chmod(input.executable, 0o744);
        await expect(materializeRuntimeGeneration(input)).rejects.toMatchObject({code: 'non-reproducible-build'});
        expect(await readRuntimeGeneration({directory: first.directory})).toEqual(first);
    });

    test('corrupted published bytes refuse rather than being repaired from the bundle', async () => {
        const input = await fixture(root), first = await materializeRuntimeGeneration(input);
        await fs.chmod(first.executable, 0o755);
        await fs.writeFile(first.executable, 'tampered\n');
        await fs.chmod(first.executable, 0o555);
        await expect(materializeRuntimeGeneration(input)).rejects.toMatchObject({code: 'runtime-integrity-failed'});
        expect(await fs.readFile(first.executable, 'utf8')).toBe('tampered\n');
    });

    test('an incomplete final directory is refused, while abandoned stages are never selected', async () => {
        const input = await fixture(root), {id} = runtimeGenerationIdentity(receipt());
        await fs.mkdir(path.join(input.directory, '.' + id + '-abandoned'), {recursive: true});
        await fs.mkdir(path.join(input.directory, id), {mode: 0o500});
        await expect(materializeRuntimeGeneration(input)).rejects.toMatchObject({code: 'runtime-record-invalid'});
    });

    for (const kind of ['outside', 'absolute-inside', 'dangling']) {
        test(kind + ' source link is refused before any runtime is selected', async () => {
            const input = await fixture(root);
            await fs.symlink(kind === 'outside' ? '../../../' : kind === 'absolute-inside' ? input.executable : 'missing',
                path.join(input.bundlePath, 'Contents', 'invalid-link'));
            await expect(materializeRuntimeGeneration(input)).rejects.toMatchObject({code: 'runtime-payload-invalid'});
            expect(await fs.readdir(input.directory)).toEqual([]);
        });
    }

    test('failed compatibility probe removes only its own sealed staging tree', async () => {
        const input = await fixture(root);
        await expect(materializeRuntimeGeneration({...input, probe: () => { throw Error('native failure'); }}))
            .rejects.toMatchObject({code: 'runtime-compatibility-failed'});
        expect(await fs.readdir(input.directory)).toEqual([]);
        expect(await fs.readFile(input.executable, 'utf8')).toBe('fixture executable\n');
    });

    test('a destination ancestor link cannot redirect publication into the source package', async () => {
        const input = await fixture(root), alias = path.join(root, 'package-alias');
        await fs.symlink(input.bundlePath, alias);
        await expect(materializeRuntimeGeneration({...input, directory: path.join(alias, 'runtime')}))
            .rejects.toMatchObject({code: 'runtime-binding-invalid'});
        expect(await fs.readdir(path.join(input.bundlePath, 'runtime'))).toEqual([]);
    });

    test('another platform or architecture is not admitted', async () => {
        const input = await fixture(root);
        await expect(materializeRuntimeGeneration({...input, probe: () => ({...compatible(), arch: 'other'})}))
            .rejects.toMatchObject({code: 'runtime-compatibility-failed'});
        expect(await fs.readdir(input.directory)).toEqual([]);
    });

    test('another launch protocol cannot be published', async () => {
        const input = await fixture(root);
        await expect(materializeRuntimeGeneration({...input, probe: () => ({...compatible(), launchProtocol: 'unsupported'})}))
            .rejects.toMatchObject({code: 'runtime-compatibility-failed'});
        expect(await fs.readdir(input.directory)).toEqual([]);
    });

    test('the executable probe reads the copied protocol, not the host format constant', async () => {
        const input = await fixture(root), protocol = path.join(input.runtimeRoot, 'ai/services/fleet/mcpLaunchAdmission.mjs');
        // Host Node isolates the copied protocol carrier; this does not claim copied-binary/native-addon compatibility.
        const addon = path.join(input.runtimeRoot, 'node_modules/better-sqlite3');
        await fs.mkdir(addon, {recursive: true});
        await fs.writeFile(path.join(addon, 'index.js'), 'module.exports = class { prepare() { return {get: () => ({value: 42})}; } close() {} };');
        await fs.writeFile(protocol, "export const LAUNCH_ADMISSION_PROTOCOL = 'fixture-copied-protocol';");
        const observed = await probeRuntimeGeneration({runtimeRoot: input.runtimeRoot, executable: process.execPath});
        expect(observed.launchProtocol).toBe('fixture-copied-protocol');
        expect(observed.protocolModule).toBe(await fs.realpath(protocol));
    });

    test('probe-side payload mutation cannot publish a valid generation', async () => {
        const input = await fixture(root);
        await expect(materializeRuntimeGeneration({...input, probe: async candidate => {
            await fs.chmod(candidate.executable, 0o755);
            await fs.writeFile(candidate.executable, 'modified by probe\n');
            await fs.chmod(candidate.executable, 0o555);
            return compatible()
        }})).rejects.toMatchObject({code: 'runtime-integrity-failed'});
        expect(await fs.readdir(input.directory)).toEqual([]);
    });

    test('concurrent identical publishers converge without overwriting one another', async () => {
        const input           = await fixture(root);
        let   probes          = 0;
        const probe           = () => { probes++; return compatible() };
        const [first, second] = await Promise.all([
            materializeRuntimeGeneration({...input, probe}),
            materializeRuntimeGeneration({...input, probe})
        ]);
        expect(first).toEqual(second);
        expect(probes).toBe(1);
        expect(await fs.readdir(input.directory)).toEqual([first.id]);
    });

    test('concurrent different payloads with one identity retain one winner and refuse the other', async () => {
        const first = await fixture(root), second = await fixture(path.join(root, 'other'));
        second.directory = first.directory;
        await fs.writeFile(second.executable, 'another payload\n');
        let   probes  = 0;
        const probe   = () => { probes++; return compatible() };
        const results = await Promise.allSettled([
            materializeRuntimeGeneration({...first, probe}),
            materializeRuntimeGeneration({...second, probe})
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(probes).toBe(1);
        expect(results.find(result => result.status === 'rejected').reason.code).toBe('non-reproducible-build');
        const winner = results.find(result => result.status === 'fulfilled').value;
        expect(await readRuntimeGeneration({directory: winner.directory})).toEqual(winner);
        expect(await fs.readdir(first.directory)).toEqual([winner.id]);
    });

    test('package support is bound to an explicit loadable export contract, not to journal absence', async () => {
        const input         = await fixture(root), brain = path.join(input.runtimeRoot, 'node_modules/neo-agent-brain');
        const manifestFile  = path.join(brain, 'package.json');
        const manifest      = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        const runtimeExport = manifest.exports['./runtime-generation'];
        manifest.exports = {'./fleet-contract': './src/fleet/contract/index.mjs', './package.json': './package.json'};
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        await fs.writeFile(path.join(brain, 'src/fleet/contract/index.mjs'),
            'export const FLEET_WIRE_PROTOCOL_VERSIONS=[1]; export const createFleetWireOffer=()=>({}); export const selectFleetWireContract=()=>({});');
        await expect(inspectRuntimeSupport(input)).resolves.toEqual({kind: 'legacy', packageIdentity: runtimeGenerationIdentity(receipt())});

        manifest.exports['./unclassified'] = './unknown.mjs';
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        await expect(inspectRuntimeSupport(input)).rejects.toMatchObject({code: 'runtime-capability-unknown'});
        delete manifest.exports['./unclassified'];

        manifest.exports['./runtime-generation'] = runtimeExport;
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        await expect(inspectRuntimeSupport(input)).rejects.toMatchObject({code: 'runtime-capability-unknown'});

        manifest.exports['./launch-admission-journal'] = './ai/services/fleet/launchAdmissionJournal.mjs';
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        const journal = path.join(brain, 'ai/services/fleet/launchAdmissionJournal.mjs');
        await fs.writeFile(journal, 'export const readLaunchAdmissionJournal=()=>null, holdLaunchAdmissionHandoff=()=>null, isAdmissionSnapshot=()=>false;');
        await expect(inspectRuntimeSupport(input)).resolves.toMatchObject({kind: 'generation'});
        await fs.rm(journal);
        await expect(inspectRuntimeSupport(input)).rejects.toMatchObject({code: 'runtime-capability-unknown'});
    });

    test('failed contract imports and mismatched package receipts remain unknown', async () => {
        const input        = await fixture(root), brain = path.join(input.runtimeRoot, 'node_modules/neo-agent-brain');
        const manifestFile = path.join(brain, 'package.json'), manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        manifest.exports = {'./fleet-contract': './src/fleet/contract/index.mjs', './package.json': './package.json'};
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        const contract = path.join(brain, 'src/fleet/contract/index.mjs');
        await fs.writeFile(contract, "throw Error('fixture import failure');");
        await expect(inspectRuntimeSupport(input)).rejects.toMatchObject({code: 'runtime-capability-unknown'});
        await fs.writeFile(contract, 'export const FLEET_WIRE_PROTOCOL_VERSIONS=[1]; export const createFleetWireOffer=()=>({}); export const selectFleetWireContract=()=>({});');
        const owner = path.join(input.runtimeRoot, 'package.json');
        await fs.writeFile(owner, JSON.stringify({dependencies: {'neo-agent-brain': 'github:neomjs/neo-agent-brain#' + 'f'.repeat(40)}}));
        await expect(inspectRuntimeSupport(input)).rejects.toMatchObject({code: 'runtime-capability-unknown'});
    });

    test('contract inspection denies a package attempting a write', async () => {
        const input        = await fixture(root), brain = path.join(input.runtimeRoot, 'node_modules/neo-agent-brain');
        const manifestFile = path.join(brain, 'package.json'), manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        manifest.exports = {'./fleet-contract': './src/fleet/contract/index.mjs', './package.json': './package.json'};
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        const marker = path.join(input.runtimeRoot, 'unexpected-write');
        await fs.writeFile(path.join(brain, 'src/fleet/contract/index.mjs'),
            `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected'); export const FLEET_WIRE_PROTOCOL_VERSIONS=[1]; export const createFleetWireOffer=()=>({}); export const selectFleetWireContract=()=>({});`);
        await expect(inspectRuntimeSupport(input)).rejects.toMatchObject({code: 'runtime-capability-unknown'});
        expect(await fs.stat(marker).then(() => true, () => false)).toBe(false);
    });

    test('the packaged runtime owner imports without a checkout-level Brain dependency', async () => {
        const shell = path.join(root, 'isolated-shell'), file = path.join(shell, 'runtimeGeneration.mjs');
        await fs.mkdir(shell);
        await fs.copyFile(new URL('../../../../harness/runtimeGeneration.mjs', import.meta.url), file);
        const {stdout} = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
            `const owner=await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(typeof owner.probeRuntimeRecovery);`
        ], {cwd: shell, env: {}});
        expect(stdout.trim()).toBe('function');
    });

    test('the destination parser receives the complete snapshot and incompatible readers refuse', async () => {
        const input        = await fixture(root), brain = path.join(input.runtimeRoot, 'node_modules/neo-agent-brain');
        const manifestFile = path.join(brain, 'package.json'), manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        manifest.exports['./launch-admission-journal'] = './ai/services/fleet/launchAdmissionJournal.mjs';
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        const codec    = path.join(brain, 'ai/services/fleet/launchAdmissionJournal.mjs');
        const snapshot = {version: 6, seats: [], generations: [{
            id                : 'original-generation', agentId: 'original-seat', identity: 'original-seat', state: 'revoked', reason: null,
            reservedAt        : null, activatedAt: null, revokedAt: null, definitionHash: 'a'.repeat(64), runtime: null,
            credentialBindings: {}, residentBindings: {}, servers: [{
                key: 'github-workflow', grantId: 'original-grant', state: 'revoked', reason: null, capabilityHash: 'b'.repeat(64)
            }]
        }]};
        await fs.writeFile(codec, `export function isAdmissionSnapshot(value) {
            return value.version === 6 && value.generations[0].agentId === 'original-seat' &&
                value.generations[0].servers[0].capabilityHash === '${'b'.repeat(64)}';
        }`);
        // Host Node isolates the copied parser/stdio contract; the materializer owns native execution closure.
        const candidate = {runtimeRoot: input.runtimeRoot, executable: process.execPath};
        await expect(probeRuntimeRecoveryImpl(candidate, snapshot)).rejects.toThrow(/trusted source snapshot codec is required/);
        await expect(probeRuntimeRecovery(candidate, snapshot)).resolves.toBe(true);
        await expect(probeRuntimeRecovery(candidate, {...snapshot, version: RUNTIME_REFERENCE_SNAPSHOT_VERSION}))
            .rejects.toMatchObject({code: 'runtime-recovery-incompatible'});
        await fs.writeFile(codec, 'export function isAdmissionSnapshot(value) { return value.version === 999; }');
        await expect(probeRuntimeRecovery(candidate, snapshot)).rejects.toMatchObject({code: 'runtime-recovery-incompatible'});
        await fs.writeFile(codec, 'export const unknownFormat = true;');
        await expect(probeRuntimeRecovery(candidate, snapshot)).rejects.toMatchObject({code: 'runtime-recovery-incompatible'});
    });

    test('a newer native-profile binding cannot pass an older destination codec', async () => {
        const source                                                                                                          = name => import(pathToFileURL(path.join(path.dirname(verifierFile), name)).href);
        const [{createAntigravityLaunchBinding}, {generateAntigravityMcpFiles}, {createSeatRuntimeRecord}, {mintLaunchGrant}] = await Promise.all([
            source('launchProfileCustody.mjs'), source('generateAntigravityMcpFiles.mjs'), source('seatRuntimeRecord.mjs'), source('mcpLaunchAdmission.mjs')
        ]);
        const input        = await fixture(root), brain = path.join(input.runtimeRoot, 'node_modules/neo-agent-brain');
        const manifestFile = path.join(brain, 'package.json'), manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        manifest.exports['./launch-admission-journal'] = './ai/services/fleet/launchAdmissionJournal.mjs';
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        const codec  = path.join(brain, 'ai/services/fleet/launchAdmissionJournal.mjs');
        const id     = 'a'.repeat(64), directory = `/runtime/${id}`, grant = mintLaunchGrant(), issuer = 'http://127.0.0.1:47123';
        const record = {id: 'seat', harnessType: 'antigravity', pid: 42, pidStartedAt: 'Thu Oct 1 09:00:00 2026',
            startedAt        : '2026-10-14T08:00:00Z', cwd: '/managed/seat/repo', instanceHome: '/managed/seat/profile',
            launchCommand    : '/apps/antigravity', admissionGeneration: 'original-admission',
            runtimeGeneration: {id, directory, runtimeRoot: `${directory}/host.runtime/organism`, executable: `${directory}/host.runtime/node`, payloadDigest: 'b'.repeat(64)},
            bridgeAuthority  : {version: 1, source: 'registry-file', registryRoot: '/registry', publicKeySha256: 'c'.repeat(64)}};
        const generated = generateAntigravityMcpFiles({profileHome: record.instanceHome, processEnvironment: {}, rows: {
            'neo-mjs-memory-core': {command: record.runtimeGeneration.executable,
                args: [path.join(record.runtimeGeneration.runtimeRoot, 'ai/mcp/client/fleetMcpLauncher.mjs'), '--server', 'memory-core'],
                env : {NEO_AGENT_IDENTITY: 'seat-login', NEO_FLEET_LAUNCH_ISSUER: issuer, NEO_FLEET_LAUNCH_GRANT: grant.capability}}
        }});
        const profile  = createAntigravityLaunchBinding({identity: 'seat-login', issuer, instanceHome: record.instanceHome, workspaceRoot: record.cwd, files: generated.files});
        const start    = createSeatRuntimeRecord({record, identity: 'seat-login', plan: [], leaseRequired: true, profile});
        const snapshot = {version: 6, generations: [], seats: [{start, state: 'stopped', ownershipUnresolved: false, cleanupUnresolved: false}]};
        expect(isAdmissionSnapshot(snapshot)).toBe(true);
        const candidate = {runtimeRoot: input.runtimeRoot, executable: process.execPath};
        // This fixture tests format compatibility, not recovery authority or the copied native closure.
        await fs.writeFile(codec, 'export const isAdmissionSnapshot = value => value.seats.every(row => row.start.profile.version === 1);');
        await expect(probeRuntimeRecovery(candidate, snapshot)).rejects.toMatchObject({code: 'runtime-recovery-incompatible'});
        await fs.writeFile(codec, `export const isAdmissionSnapshot = value => {
            const profile=value.seats[0].start.profile;
            return profile.kind==='antigravity' && profile.workspaceRoot==='/managed/seat/repo' &&
                profile.invokerSha256['memory-core']===${JSON.stringify(profile.invokerSha256['memory-core'])} &&
                profile.grants['memory-core'].sha256===${JSON.stringify(profile.grants['memory-core'].sha256)};
        };`);
        await expect(probeRuntimeRecovery(candidate, snapshot)).resolves.toBe(true);
    });

    test('a destination parser escaping its assembled Brain package is never imported', async () => {
        const input        = await fixture(root), brain = path.join(input.runtimeRoot, 'node_modules/neo-agent-brain');
        const manifestFile = path.join(brain, 'package.json'), manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        manifest.exports['./launch-admission-journal'] = './ai/services/fleet/launchAdmissionJournal.mjs';
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        const outside = path.join(root, 'outside.mjs'), marker = path.join(root, 'unexpected-import');
        await fs.writeFile(outside, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected'); export const isAdmissionSnapshot=()=>true;`);
        await fs.symlink(outside, path.join(brain, 'ai/services/fleet/launchAdmissionJournal.mjs'));
        await expect(probeRuntimeRecovery({runtimeRoot: input.runtimeRoot, executable: process.execPath},
            {version: 6, generations: [], seats: []})).rejects.toMatchObject({code: 'runtime-recovery-incompatible'});
        expect(await fs.stat(marker).then(() => true, () => false)).toBe(false);
    });

    test('a changed binding in a complete record cannot escape the payload', async () => {
        const input = await fixture(root), result = await materializeRuntimeGeneration(input);
        const file  = path.join(result.directory, 'generation.json'), record = JSON.parse(await fs.readFile(file, 'utf8'));
        record.executableRelativePath = '../../outside';
        await fs.chmod(file, 0o600);
        await fs.writeFile(file, JSON.stringify(record));
        await fs.chmod(file, 0o400);
        await expect(readRuntimeGeneration({directory: result.directory})).rejects.toMatchObject({code: 'runtime-binding-invalid'});
    });
});
