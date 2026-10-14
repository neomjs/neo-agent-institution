import {expect, test}                                            from '@playwright/test';
import {execFile}                                                from 'node:child_process';
import {cpSync}                                                  from 'node:fs';
import fs                                                        from 'node:fs/promises';
import {tmpdir}                                                  from 'node:os';
import path                                                      from 'node:path';
import {pathToFileURL}                                           from 'node:url';
import {promisify}                                               from 'node:util';
import {createRequire}                                           from 'node:module';
import * as runtimeVerifier                                      from 'neo-agent-brain/runtime-generation';
import {resolveLauncherRuntime}                                  from '../../../../harness/brain.mjs';
import {executePlan, planInstall, readSlot, runningHarnessPaths} from '../../../../harness/install.mjs';
import {
    loadRuntimeGenerationVerifier,
    materializeRuntimeGeneration,
    probeRuntimeGeneration
} from '../../../../harness/runtimeGeneration.mjs';
import {
    readRuntimeGeneration,
    runtimeGenerationIdentity
} from 'neo-agent-brain/runtime-generation';

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
        name: 'neo-agent-brain', type: 'module', exports: {'./runtime-generation': './ai/services/fleet/runtimeGeneration.mjs'}
    }));
    await fs.writeFile(path.join(runtimeRoot, 'package.json'), JSON.stringify({
        dependencies: {'neo-agent-brain': 'github:neomjs/neo-agent-brain#' + info.owners.brain.revision}
    }));
    await fs.mkdir(path.dirname(executable), {recursive: true});
    await fs.writeFile(path.join(runtimeRoot, 'organism-build-info.json'), JSON.stringify(info));
    await fs.writeFile(path.join(runtimeRoot, 'ai', 'mcp', 'client', 'fleetMcpLauncher.mjs'), 'export const launcher = true;\n');
    await fs.writeFile(executable, 'fixture executable\n', {mode: 0o755});
    await fs.symlink('Resources/organism', path.join(bundlePath, 'Contents', 'runtime-link'));
    return {bundlePath, runtimeRoot, executable, directory: path.join(root, 'runtime'), probe: compatible, verifier: runtimeVerifier}
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

test.describe('harness/runtimeGeneration — verified package copies', () => {
    let root;
    test.beforeEach(async () => { root = await fs.mkdtemp(path.join(tmpdir(), 'runtime-generation-')); });
    test.afterEach(async () => { await cleanup(root); });

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
                            'export async function loadRuntimeGenerationVerifier(){return {fixture:true,runtimeGenerationArguments:()=>[]};} export async function materializeRuntimeGeneration(input) {const state=globalThis.bootWitness; state.publication={input,profile:state.profile,scheme:state.scheme}; return state.generation;}';
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
        const input = await fixture(root);
        let   ready = 0, release;
        const gate  = new Promise(resolve => { release = resolve; });
        const probe = async () => {
            if (++ready === 2) release();
            await gate;
            return compatible()
        };
        const [first, second] = await Promise.all([
            materializeRuntimeGeneration({...input, probe}),
            materializeRuntimeGeneration({...input, probe})
        ]);
        expect(first).toEqual(second);
        expect(await fs.readdir(input.directory)).toEqual([first.id]);
    });

    test('concurrent different payloads with one identity retain one winner and refuse the other', async () => {
        const first = await fixture(root), second = await fixture(path.join(root, 'other'));
        second.directory = first.directory;
        await fs.writeFile(second.executable, 'another payload\n');
        let   ready = 0, release;
        const gate  = new Promise(resolve => { release = resolve; });
        const probe = async () => {
            if (++ready === 2) release();
            await gate;
            return compatible()
        };
        const results = await Promise.allSettled([
            materializeRuntimeGeneration({...first, probe}),
            materializeRuntimeGeneration({...second, probe})
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected').reason.code).toBe('non-reproducible-build');
        const winner = results.find(result => result.status === 'fulfilled').value;
        expect(await readRuntimeGeneration({directory: winner.directory})).toEqual(winner);
        expect(await fs.readdir(first.directory)).toEqual([winner.id]);
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
