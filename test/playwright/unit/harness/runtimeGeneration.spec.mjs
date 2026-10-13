import {expect, test}                    from '@playwright/test';
import {cpSync}                          from 'node:fs';
import fs                                 from 'node:fs/promises';
import {tmpdir}                           from 'node:os';
import path                               from 'node:path';
import {executePlan, planInstall, readSlot, runningHarnessPaths} from '../../../../harness/install.mjs';
import {
    materializeRuntimeGeneration,
    readRuntimeGeneration,
    runtimeGenerationIdentity
} from '../../../../harness/runtimeGeneration.mjs';

const
    receipt = () => ({
        electronVersion: '43.5.0',
        owners: Object.fromEntries(['product', 'brain', 'engine'].map((name, index) =>
            [name, {revision: String(index + 1).repeat(40)}]))
    }),
    compatible = () => ({
        platform: process.platform, arch: process.arch, electronVersion: '43.5.0',
        nodeVersion: '24.19.0', moduleAbi: '148'
    });

/** @summary Creates a tiny complete execution layout; no real binary or live custody is touched. */
async function fixture(root, info = receipt()) {
    const bundlePath = path.join(root, 'Neo Harness.app');
    const runtimeRoot = path.join(bundlePath, 'Contents', 'Resources', 'organism');
    const executable = path.join(bundlePath, 'Contents', 'MacOS', 'Neo Harness');
    await fs.mkdir(path.join(runtimeRoot, 'ai', 'mcp', 'client'), {recursive: true});
    await fs.mkdir(path.dirname(executable), {recursive: true});
    await fs.writeFile(path.join(runtimeRoot, 'organism-build-info.json'), JSON.stringify(info));
    await fs.writeFile(path.join(runtimeRoot, 'ai', 'mcp', 'client', 'fleetMcpLauncher.mjs'), 'export const launcher = true;\n');
    await fs.writeFile(executable, 'fixture executable\n', {mode: 0o755});
    await fs.symlink('Resources/organism', path.join(bundlePath, 'Contents', 'runtime-link'));
    return {bundlePath, runtimeRoot, executable, directory: path.join(root, 'runtime'), probe: compatible}
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
    const installed = await fixture(path.join(root, 'installed'));
    const nextReceipt = receipt(), priorReceipt = receipt();
    nextReceipt.owners.brain.revision = 'a'.repeat(40);
    priorReceipt.owners.brain.revision = 'b'.repeat(40);
    const artifact = await fixture(path.join(root, 'artifact'), nextReceipt);
    const rollback = await fixture(path.join(root, 'rollback'), priorReceipt);
    const custodyDir = path.join(root, 'userData');
    await fs.mkdir(custodyDir);
    await fs.writeFile(path.join(custodyDir, 'plane.json'), '{"fixture":true}');
    return {
        artifact: readSlot(artifact.bundlePath), installed: readSlot(installed.bundlePath),
        rollback: readSlot(rollback.bundlePath), custodyDir,
        parked: readSlot(installed.bundlePath + '.restoring')
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
        const input = await fixture(root), probes = [];
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
        expect(await readRuntimeGeneration({directory: result.directory})).toEqual(result);
    });

    test('reinstalling the exact payload does not copy or probe again', async () => {
        const input = await fixture(root), first = await materializeRuntimeGeneration(input);
        const before = await fs.stat(path.join(first.directory, 'generation.json'));
        const second = await materializeRuntimeGeneration({...input, probe: () => { throw Error('must not reprobe'); }});
        const after = await fs.stat(path.join(first.directory, 'generation.json'));
        expect(second).toEqual(first);
        expect(after.ino).toBe(before.ino);
        expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    test('the unchanged installer census excludes the published executable but retains bundle users', async () => {
        const input = await fixture(root), generation = await materializeRuntimeGeneration(input);
        const canonical = '/Applications/Neo Harness.app/Contents/MacOS/Neo Harness';
        expect(runningHarnessPaths([canonical, input.executable, generation.executable].join('\n')))
            .toEqual([canonical, input.executable]);
    });

    test('install waits for a verified runtime before changing either slot, then restore selects the old payload', async () => {
        const slots = await installFixture(root);
        let release, entered;
        const gate = new Promise(resolve => { release = resolve; });
        const probing = new Promise(resolve => { entered = resolve; });
        const operation = executePlan(planInstall(slots).steps, {
            runFn: copyBundle,
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
            runFn: (command, args) => { calls.push(command); copyBundle(command, args); },
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
        let probes = 0;
        const options = {
            runFn: () => { throw Error('no bundle operation expected'); },
            materializeFn: input => materializeRuntimeGeneration({...input, probe: () => { probes++; return compatible(); }})
        };
        const first = await executePlan(planInstall(slots).steps, options);
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
            runFn: () => { throw Error('no bundle operation expected'); },
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
        let ready = 0, release;
        const gate = new Promise(resolve => { release = resolve; });
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
        let ready = 0, release;
        const gate = new Promise(resolve => { release = resolve; });
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
        const file = path.join(result.directory, 'generation.json'), record = JSON.parse(await fs.readFile(file, 'utf8'));
        record.executableRelativePath = '../../outside';
        await fs.chmod(file, 0o600);
        await fs.writeFile(file, JSON.stringify(record));
        await fs.chmod(file, 0o400);
        await expect(readRuntimeGeneration({directory: result.directory})).rejects.toMatchObject({code: 'runtime-binding-invalid'});
    });
});
