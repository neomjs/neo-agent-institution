import {expect, test} from '@playwright/test';
import fs             from 'node:fs';
import os             from 'node:os';
import path           from 'node:path';
import * as seats     from '../../../../node_modules/neo-agent-brain/ai/mcp/server/shared/helpers/seatToken.mjs';
import {FIXTURE_IDENTITY, FIXTURE_PLANE_ID, FIXTURE_REMAP_IDENTITY} from '../../../../harness/fixturePlane.mjs';
import {
    assertWalkTarget,
    cleanupHeldRun,
    readWalkManifest,
    remapFixtureToken,
    requestPlane,
    resolveSmokeHold,
    revokeFixtureToken,
    runWalkControl,
    walkPaths,
    watchPlaneControl,
    writeWalkManifest
} from '../../../../harness/walkControl.mjs';

/**
 * @summary A walker's handle on a held smoke run, on real temp roots and real seat-token registries: hold
 * acts only in the fixture-plane arm, the control script acts only on the smoke's own plane, a token
 * revoke or remap is what the plane's verifier reads next, plane stop/start reach the held run and come
 * back answered, and cleanup removes the root only once the run and its plane are gone.
 */
test.describe('harness walk control', () => {
    let smokeRoot, registryPath, token;

    const manifestFor = (overrides = {}) => writeWalkManifest({smokeRoot, manifest: {
        identities  : [FIXTURE_IDENTITY, FIXTURE_REMAP_IDENTITY],
        planeId     : FIXTURE_PLANE_ID,
        registryPath,
        runtimeRoot : '/brain',
        ...overrides
    }});

    const verify = () => seats.verifySeatToken({planeId: FIXTURE_PLANE_ID, registry: seats.readSeatTokenRegistry(registryPath), token});

    test.beforeEach(() => {
        smokeRoot    = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-control-'));
        registryPath = path.join(smokeRoot, 'plane', 'auth', 'seat-tokens.json');

        const minted = seats.mintSeatToken({agentIdentityNodeId: `AGENT_IDENTITY:${FIXTURE_IDENTITY}`});

        token = minted.token;
        fs.mkdirSync(path.dirname(registryPath), {recursive: true});
        seats.writeSeatTokenRegistry(registryPath, seats.buildSeatTokenRegistry({generation: 1, planeId: FIXTURE_PLANE_ID, rows: [minted.row]}))
    });

    test.afterEach(() => {
        fs.rmSync(smokeRoot, {force: true, recursive: true})
    });

    test('hold acts only in the fixture-plane arm; set anywhere else it refuses with its reason', () => {
        expect(resolveSmokeHold({env: {}, smokePlaneMode: true}), 'unset').toEqual({hold: false, refusal: null});
        expect(resolveSmokeHold({env: {NEO_HARNESS_SMOKE_HOLD: '1'}, smokePlaneMode: true})).toEqual({hold: true, refusal: null});

        const refused = resolveSmokeHold({env: {NEO_HARNESS_SMOKE_HOLD: '1'}, smokePlaneMode: false});

        expect(refused.hold).toBe(false);
        expect(refused.refusal).toContain('NEO_HARNESS_SMOKE_PLANE=1');
        expect(refused.refusal).toContain('attach to or take over')
    });

    test('the script acts only on the smoke\'s own fixture plane: another plane id, root or registry is refused', () => {
        expect(readWalkManifest({smokeRoot: manifestFor().smokeRoot}).planeId).toBe(FIXTURE_PLANE_ID);

        expect(() => assertWalkTarget({manifest: {...manifestFor(), planeId: 'neo-agent-os'}, smokeRoot})).toThrow("refuses plane 'neo-agent-os'");
        expect(() => assertWalkTarget({manifest: manifestFor(), smokeRoot: os.tmpdir()})).toThrow('refuses a manifest for root');
        expect(() => assertWalkTarget({manifest: manifestFor({registryPath: path.join(os.homedir(), '.neo-ai', 'seat-tokens.json')}), smokeRoot})).toThrow('is not inside the smoke root');

        fs.rmSync(walkPaths(smokeRoot).dir, {force: true, recursive: true});
        expect(() => readWalkManifest({smokeRoot}), 'no held run').toThrow('no held smoke run under')
    });

    test('a revoke is what the plane reads next: the stored token is a stale generation', () => {
        expect(verify().ok).toBe(true);
        expect(revokeFixtureToken({manifest: manifestFor(), seats})).toEqual({generation: 2, rows: 0});
        expect(verify()).toEqual({ok: false, reason: 'stale-generation'})
    });

    test('a remap names the stored token as the other account the plane holds, and refuses an identity it does not', () => {
        const manifest = manifestFor();

        expect(remapFixtureToken({identity: FIXTURE_REMAP_IDENTITY, manifest, seats})).toEqual({generation: 2, identity: FIXTURE_REMAP_IDENTITY});
        expect(verify().row.agentIdentityNodeId).toBe(`AGENT_IDENTITY:${FIXTURE_REMAP_IDENTITY}`);

        expect(() => remapFixtureToken({identity: '@neo-opus-ada', manifest, seats})).toThrow("refuses identity '@neo-opus-ada'");
        expect(verify().row.agentIdentityNodeId, 'a refused remap writes nothing').toBe(`AGENT_IDENTITY:${FIXTURE_REMAP_IDENTITY}`)
    });

    test('plane stop and start reach the held run once each and come back answered, a failure included', async () => {
        manifestFor();

        const
            calls   = [],
            watcher = watchPlaneControl({handlers: {
                'plane-start': async () => {throw new Error('port taken')},
                'plane-stop' : async () => calls.push('stop')
            }, pollMs: 20, smokeRoot});

        try {
            expect(await requestPlane({command: 'plane-stop', pollMs: 20, smokeRoot, timeoutMs: 5000})).toMatchObject({command: 'plane-stop', ok: true});
            expect(await requestPlane({command: 'plane-start', pollMs: 20, smokeRoot, timeoutMs: 5000})).toMatchObject({error: 'port taken', ok: false});

            await new Promise(resolve => setTimeout(resolve, 100));
            expect(calls, 'each request runs once').toEqual(['stop'])
        } finally {
            watcher.stop()
        }

        await expect(requestPlane({command: 'plane-reset', smokeRoot})).rejects.toThrow("knows no plane command 'plane-reset'")
    });

    test('a new manifest clears an earlier run\'s request, so a stale command never runs', async () => {
        fs.mkdirSync(walkPaths(smokeRoot).dir, {recursive: true});
        fs.writeFileSync(walkPaths(smokeRoot).control, JSON.stringify({command: 'plane-stop', id: 'stale'}));

        manifestFor();

        const calls   = [],
              watcher = watchPlaneControl({handlers: {'plane-stop': async () => calls.push('stop')}, pollMs: 20, smokeRoot});

        await new Promise(resolve => setTimeout(resolve, 150));
        watcher.stop();
        expect(calls).toEqual([])
    });

    test('cleanup refuses while the held run or its plane still runs, then removes only the smoke root', async () => {
        const manifest = manifestFor({ingressPort: 41002, pid: 4242, planePort: 41001});

        await expect(cleanupHeldRun({isAlive: () => true, manifest, probePortFn: async () => false, smokeRoot})).rejects.toThrow('(pid 4242) still runs');
        await expect(cleanupHeldRun({isAlive: () => false, manifest, probePortFn: async ({port}) => port === 41001, smokeRoot})).rejects.toThrow("fixture plane's port 41001");
        expect(fs.existsSync(smokeRoot), 'a refusal removes nothing').toBe(true);

        expect(await cleanupHeldRun({isAlive: () => false, manifest, probePortFn: async () => false, smokeRoot}))
            .toEqual({planeStopped: true, rootRemoved: true, smokeRoot: path.resolve(smokeRoot)})
    });

    test('the CLI resolves the held run\'s root and revokes through the runtime\'s own seat-token helpers', async () => {
        manifestFor();

        const run = argv => runWalkControl({argv, env: {NEO_HARNESS_BRAIN_ROOT: smokeRoot}, importSeats: async root => {
            expect(root).toBe('/brain');
            return seats
        }});

        expect(await run(['token', 'revoke'])).toEqual({generation: 2, rows: 0});
        expect(verify().reason).toBe('stale-generation');
        await expect(run(['plane', 'reset'])).rejects.toThrow('usage: walkControl.mjs')
    })
});
