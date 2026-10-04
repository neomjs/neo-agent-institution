import {expect, test}            from '@playwright/test';
import {EventEmitter}            from 'node:events';
import http                      from 'node:http';
import net                       from 'node:net';
import path                      from 'node:path';
import {allocatePort, probePort} from '../../../../harness/brain.mjs';
import {
    createPlaneProcess,
    createSmokeSafeStorage,
    resolvePlaneMemberEnv,
    startFixtureIngress
} from '../../../../harness/fixturePlane.mjs';

const ANCHOR = '/brain/.neo-ai-data';

/**
 * A Brain child that answers the member resolver with the given members, under {@link ANCHOR}.
 */
function membersScript(members) {
    return async ({label}) => {
        expect(label).toBe('plane member resolver');
        return {anchor: ANCHOR, members}
    }
}

test.describe('harness fixture plane', () => {
    test('the stand-in round-trips a bearer, never stores it readable, and cannot read another run\'s record', () => {
        const
            bearer = 'neo_fixture_seat_token_never_real',
            run    = createSmokeSafeStorage(),
            sealed = run.encryptString(bearer);

        expect(run.isEncryptionAvailable()).toBe(true);
        expect(sealed.includes(Buffer.from(bearer))).toBe(false);
        expect(run.decryptString(sealed)).toBe(bearer);
        expect(() => createSmokeSafeStorage().decryptString(sealed)).toThrow()
    });

    test('every member lands under the plane root, rebased from the Brain\'s plane data root', async () => {
        const placed = await resolvePlaneMemberEnv({
            planeRoot: '/smoke/plane',
            repoRoot : '/brain',
            runScript: membersScript([
                {default: `${ANCHOR}/sqlite/memory-core-graph.sqlite`, env: 'NEO_MEMORY_DB_PATH',                path: 'storagePaths.graphProd'},
                {default: `${ANCHOR}/sqlite/memory-core-graph.sqlite`, env: 'NEO_AI_DB_PATH',                    path: 'orchestrator.dbPath'},
                {default: `${ANCHOR}/seat-tokens/registry.json`,       env: 'NEO_AUTH_SEAT_TOKEN_REGISTRY_PATH', path: 'auth.seatTokenRegistryPath'}
            ])
        });

        expect(placed).toEqual({
            NEO_AI_DB_PATH                   : path.join('/smoke/plane', 'sqlite', 'memory-core-graph.sqlite'),
            NEO_AUTH_SEAT_TOKEN_REGISTRY_PATH: path.join('/smoke/plane', 'seat-tokens', 'registry.json'),
            NEO_MEMORY_DB_PATH               : path.join('/smoke/plane', 'sqlite', 'memory-core-graph.sqlite'),
            NEO_PLANE_DATA_ROOT              : '/smoke/plane'
        })
    });

    test('a member that cannot be placed fails the plane closed instead of defaulting outside it', async () => {
        for (const member of [
            {default: '/elsewhere/state.json', env: 'NEO_ELSEWHERE', path: 'outside.anchor'},
            {default: `${ANCHOR}/state.json`,  env: undefined,       path: 'no.env'},
            {default: undefined,               env: 'NEO_NO_DEFAULT', path: 'no.default'}
        ]) {
            await expect(resolvePlaneMemberEnv({planeRoot: '/smoke/plane', repoRoot: '/brain', runScript: membersScript([member])}))
                .rejects.toThrow(`plane member ${member.path} cannot be placed`)
        }
    });

    test('the ingress maps /mc/<path> onto the target\'s /<path> and answers 404 for anything else', async () => {
        const
            seen   = [],
            target = http.createServer((request, response) => {
                seen.push({authorization: request.headers.authorization, method: request.method, url: request.url});
                response.writeHead(200, {'content-type': 'application/json'}).end('{"ok":true}')
            });

        await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));

        const ingress = await startFixtureIngress({targetPort: target.address().port});

        try {
            const
                routed = await fetch(`http://127.0.0.1:${ingress.port}/mc/mcp?x=1`, {headers: {authorization: 'Bearer t'}, method: 'POST', body: '{}'}),
                outside = await fetch(`http://127.0.0.1:${ingress.port}/fleet/events`);

            expect(routed.status).toBe(200);
            expect(await routed.json()).toEqual({ok: true});
            expect(outside.status).toBe(404);
            expect(seen).toEqual([{authorization: 'Bearer t', method: 'POST', url: '/mcp?x=1'}])
        } finally {
            await ingress.close();
            await new Promise(resolve => target.close(resolve))
        }
    });

    test('a held run stops and restarts the plane child: one at a time, drain-owned, never a Brain claim', async () => {
        const
            port       = await allocatePort(),
            registered = [],
            stopped    = [],
            // a stand-in Memory Core: listens on the plane's port until it is stopped
            startChild = ({entry}) => {
                const child = Object.assign(new EventEmitter(), {entry, exitCode: null, neoHarnessIdentity: {pgid: registered.length + 1}, signalCode: null});

                child.server = net.createServer().listen(port, '127.0.0.1');
                return child
            },
            stopChild  = async child => {
                stopped.push(child);
                await new Promise(resolve => child.server.close(resolve));
                child.exitCode = 0;
                child.emit('exit', 0, null);
                return {exited: true, forced: false, groupEmpty: true}
            },
            plane      = createPlaneProcess({env: {}, port, registerChild: entry => registered.push(entry), repoRoot: '/brain', startChild, stopChild, timeoutMs: 5000});

        expect(await plane.stop(), 'nothing to stop before a start').toEqual({exited: true, forced: false, groupEmpty: true});
        expect(stopped).toEqual([]);

        await plane.start();
        expect(registered.map(entry => ({entry: entry.child.entry, label: entry.label, observeBrain: entry.observeBrain}))).toEqual([{entry: 'ai/mcp/server/memory-core/mcp-server.mjs', label: 'plane', observeBrain: false}]);
        await expect(plane.start(), 'one child at a time').rejects.toThrow('the fixture plane already runs');

        await plane.stop();
        expect(stopped).toEqual([registered[0].child]);
        expect(await probePort({port}), 'the plane is down').toBe(false);

        await plane.start();
        expect(registered.length, 'a restart registers its new child for teardown').toBe(2);
        expect(await probePort({port}), 'the plane is back on its port').toBe(true);

        await plane.stop()
    })
});
