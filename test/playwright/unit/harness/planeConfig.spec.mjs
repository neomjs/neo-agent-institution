import {expect, test}                          from '@playwright/test';
import {mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir}                                from 'node:os';
import path                                    from 'node:path';
import {
    createPlaneBroker,
    forgetPlaneConfig,
    normalizePlaneBase,
    PLANE_BEARER_FILE,
    PLANE_CONFIG_FILE,
    PLANE_MCP_SERVER_NAME,
    planeEnvFragment,
    probePlaneCredential,
    readPlaneConfig,
    writePlaneConfig
} from '../../../../harness/planeConfig.mjs';

const BEARER = 'ghp_fixtureBearerNeverReal0000000000';

/**
 * A reversible stand-in for Electron's `safeStorage`: the stored bytes must not contain the plain
 * bearer, which is what the arms assert about the file on disk.
 */
function fakeSafeStorage({available = true} = {}) {
    return {
        decryptString       : buffer => Buffer.from(buffer.toString(), 'base64').toString().replace(/^enc:/, ''),
        encryptString       : value => Buffer.from(Buffer.from(`enc:${value}`).toString('base64')),
        isEncryptionAvailable: () => available
    }
}

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'plane-config-'));

/**
 * One fetch answer: the probe reads the status, the headers and the text.
 */
function answer(status, body, headers = {}) {
    return {headers: new Headers(headers), status, text: async () => body}
}

/**
 * A plane's MCP route as measured on the local plane: without a credential it answers 401 with a
 * bearer challenge; an admitted PAT gets the `initialize` answer over SSE, naming the server.
 */
function fakePlane({admits = true, name = PLANE_MCP_SERVER_NAME} = {}) {
    const requests = [];

    async function fetchFn(url, init) {
        const authorization = init.headers?.Authorization ?? null;

        requests.push({authorization, method: init.method, session: init.headers?.['mcp-session-id'] ?? null, url});

        if (init.method === 'DELETE') {
            return answer(200, '')
        }

        if (!authorization || !admits) {
            return answer(401, '{"error":"invalid_token"}', {'www-authenticate': 'Bearer error="invalid_token"'})
        }

        return answer(200, `event: message\ndata: ${JSON.stringify({id: 1, jsonrpc: '2.0', result: {serverInfo: {name, version: '1.0.0'}}})}\n\n`, {'content-type': 'text/event-stream', 'mcp-session-id': 'session-1'})
    }

    return {fetchFn, requests}
}

/**
 * A host that is not a plane: it answers `status` to everything, credential or not.
 */
function stranger(status) {
    const requests = [];

    return {requests, fetchFn: async (url, init) => { requests.push(init.headers?.Authorization ?? null); return answer(status, '<html></html>') }}
}

test.describe('harness/planeConfig — the packaged shell\'s plane record', () => {
    test('a stored record reads back, and plane.json carries no credential', () => {
        const dir = tempDir(), safeStorage = fakeSafeStorage();

        writePlaneConfig({dir, safeStorage, planeBase: 'http://127.0.0.1:3102/', bearer: BEARER});

        expect(readPlaneConfig({dir, safeStorage})).toEqual({planeBase: 'http://127.0.0.1:3102', bearer: BEARER});
        expect(readFileSync(path.join(dir, PLANE_CONFIG_FILE), 'utf8')).not.toContain(BEARER);
        expect(readFileSync(path.join(dir, PLANE_BEARER_FILE)).toString()).not.toContain(BEARER);
        expect(statSync(path.join(dir, PLANE_BEARER_FILE)).mode & 0o777).toBe(0o600)
    });

    test('without OS encryption nothing is stored, rather than a plain-text PAT', () => {
        const dir = tempDir();

        expect(() => writePlaneConfig({dir, safeStorage: fakeSafeStorage({available: false}), planeBase: 'http://127.0.0.1:3102', bearer: BEARER}))
            .toThrow('cannot encrypt');
        expect(readPlaneConfig({dir, safeStorage: fakeSafeStorage()})).toEqual({planeBase: null, bearer: null})
    });

    test('a missing record is unconfigured, and a bearer that no longer decrypts reads as absent', () => {
        const dir = tempDir();

        expect(readPlaneConfig({dir, safeStorage: fakeSafeStorage()})).toEqual({planeBase: null, bearer: null});

        writeFileSync(path.join(dir, PLANE_CONFIG_FILE), JSON.stringify({planeBase: 'https://plane.example'}));
        writeFileSync(path.join(dir, PLANE_BEARER_FILE), 'not a blob this keychain wrote');

        const broken = {...fakeSafeStorage(), decryptString: () => { throw new Error('decrypt failed') }};

        expect(readPlaneConfig({dir, safeStorage: broken})).toEqual({planeBase: 'https://plane.example', bearer: null})
    });

    test('forgetting removes both files and tolerates their absence', () => {
        const dir = tempDir(), safeStorage = fakeSafeStorage();

        writePlaneConfig({dir, safeStorage, planeBase: 'https://plane.example', bearer: BEARER});
        forgetPlaneConfig({dir});
        forgetPlaneConfig({dir});

        expect(readPlaneConfig({dir, safeStorage})).toEqual({planeBase: null, bearer: null})
    });

    test('a plane base is https, or plain http on loopback only, and never carries credentials', () => {
        expect(normalizePlaneBase(' https://plane.example/base/ ')).toBe('https://plane.example/base');
        expect(normalizePlaneBase('http://localhost:3102')).toBe('http://localhost:3102');
        expect(normalizePlaneBase('http://[::1]:3102')).toBe('http://[::1]:3102');

        expect(() => normalizePlaneBase('http://plane.example')).toThrow('https');
        expect(() => normalizePlaneBase('https://user:secret@plane.example')).toThrow('credentials');
        expect(() => normalizePlaneBase('ftp://plane.example')).toThrow('http(s)');
        expect(() => normalizePlaneBase('plane.example')).toThrow('http(s)')
    });

    test('the env fragment: a set plane base keeps the stored bearer away from it; a set bearer wins', () => {
        const planeConfig = {planeBase: 'https://plane.example', bearer: BEARER};

        expect(planeEnvFragment({planeConfig, env: {}})).toEqual({NEO_FLEET_PLANE_BASE: 'https://plane.example', NEO_FLEET_PLANE_BEARER: BEARER});
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BASE: 'http://127.0.0.1:3102'}}), 'the launcher and checkout env win whole').toEqual({});
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BASE: ''}}), 'an explicitly empty base still wins').toEqual({});
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BEARER: 'env-bearer'}})).toEqual({NEO_FLEET_PLANE_BASE: 'https://plane.example'});
        expect(planeEnvFragment({planeConfig: {planeBase: null, bearer: null}, env: {}})).toEqual({});
        expect(planeEnvFragment({planeConfig: {planeBase: 'https://plane.example', bearer: null}, env: {}}), 'a bearer that no longer decrypts is no record').toEqual({});
        expect(planeEnvFragment({planeConfig: {planeBase: 'https://plane.example', bearer: null}, env: {NEO_FLEET_PLANE_BEARER: 'env-bearer'}})).toEqual({NEO_FLEET_PLANE_BASE: 'https://plane.example'})
    });

    test('the credential probe accepts only the Memory Core naming itself after a bearer challenge', async () => {
        const plane = fakePlane();

        expect(await probePlaneCredential({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, fetchFn: plane.fetchFn})).toBe('accepted');
        expect(plane.requests.map(({authorization, method}) => `${method} ${authorization ? 'with' : 'without'} PAT`)).toEqual(['POST without PAT', 'POST with PAT', 'DELETE with PAT']);
        expect(plane.requests[1].url, 'the credential rides the header, never the URL').toBe('http://127.0.0.1:3102/mc/mcp');
        expect(plane.requests[1].authorization).toBe(`Bearer ${BEARER}`);
        expect(plane.requests[2].session, 'the probe closes the session it opened').toBe('session-1')
    });

    test('a host that is not a plane never sees the PAT', async () => {
        for (const status of [200, 404, 405]) {
            const host = stranger(status);

            expect(await probePlaneCredential({planeBase: 'https://example.com', bearer: BEARER, fetchFn: host.fetchFn}), String(status)).toBe('not-a-plane');
            expect(host.requests, String(status)).toEqual([null])
        }
    });

    test('a plane that refuses the PAT rejects it; an MCP server that is not the Memory Core is not a plane', async () => {
        expect(await probePlaneCredential({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: fakePlane({admits: false}).fetchFn})).toBe('rejected');
        expect(await probePlaneCredential({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: fakePlane({name: 'another-mcp-server'}).fetchFn})).toBe('not-a-plane')
    });

    test('a network failure at either step is unreachable', async () => {
        const plane = fakePlane();

        expect(await probePlaneCredential({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: async () => { throw new Error('ECONNREFUSED') }})).toBe('unreachable');
        expect(await probePlaneCredential({
            bearer   : BEARER,
            fetchFn  : async (url, init) => init.headers?.Authorization ? Promise.reject(new Error('reset')) : plane.fetchFn(url, init),
            planeBase: 'https://plane.example'
        })).toBe('unreachable')
    })
});

test.describe('harness/planeConfig — the plane broker behind planeStatus() and attachPlane()', () => {
    function makeBroker({packaged = true, prompt = BEARER, host = fakePlane(), trusted = true, available = true, decrypts = true, fact = null} = {}) {
        const
            dir         = tempDir(),
            keychain    = fakeSafeStorage({available}),
            safeStorage = decrypts ? keychain : {...keychain, decryptString: () => { throw new Error('decrypt failed') }},
            calls       = {prompts: [], relaunches: 0};

        const broker = createPlaneBroker({
            dir,
            fetchFn         : host.fetchFn,
            getTransportFact: () => fact,
            isTrustedSender : () => trusted,
            packaged,
            promptCredential: async ({method}) => { calls.prompts.push(method); return prompt },
            relaunch        : () => { calls.relaunches++ },
            safeStorage
        });

        return {broker, calls, dir, safeStorage}
    }

    test('an attach stores the record, relaunches, and the reply never carries the PAT', async () => {
        const {broker, calls, dir, safeStorage} = makeBroker();
        const reply = await broker.attach({}, {planeBase: 'http://127.0.0.1:3102'});

        expect(reply).toEqual({ok: true, reason: null, relaunching: true});
        expect(JSON.stringify(reply)).not.toContain(BEARER);
        expect(calls).toEqual({prompts: ['plane-attach'], relaunches: 1});
        expect(readPlaneConfig({dir, safeStorage})).toEqual({planeBase: 'http://127.0.0.1:3102', bearer: BEARER});
        expect(broker.status({})).toEqual({attached: false, configured: true, packaged: true, planeBase: 'http://127.0.0.1:3102'})
    });

    test('every refusal stores nothing and relaunches nothing', async () => {
        const cases = [
            [{packaged: false},  {planeBase: 'http://127.0.0.1:3102'}, 'not-packaged'],
            [{},                 {planeBase: 'http://plane.example'},  'invalid-plane-base'],
            [{available: false}, {planeBase: 'http://127.0.0.1:3102'}, 'encryption-unavailable'],
            [{prompt: null},     {planeBase: 'http://127.0.0.1:3102'}, 'canceled'],
            [{host: fakePlane({admits: false})}, {planeBase: 'http://127.0.0.1:3102'}, 'rejected'],
            [{host: stranger(404)},              {planeBase: 'https://example.com'},   'not-a-plane']
        ];

        for (const [options, request, reason] of cases) {
            const {broker, calls, dir} = makeBroker(options);

            expect(await broker.attach({}, request), reason).toEqual({ok: false, reason, relaunching: false});
            expect(calls.relaunches, reason).toBe(0);
            expect(readPlaneConfig({dir, safeStorage: fakeSafeStorage()}), reason).toEqual({planeBase: null, bearer: null})
        }
    });

    test('status reports an attached boot from the settled transport fact', () => {
        const {broker} = makeBroker({fact: {mode: 'plane-attach', up: true}});

        expect(broker.status({})).toEqual({attached: true, configured: false, packaged: true, planeBase: null})
    });

    test('a record whose bearer no longer decrypts reads as unconfigured, so the card offers to reconnect', () => {
        const {broker, dir} = makeBroker({decrypts: false});

        writeFileSync(path.join(dir, PLANE_CONFIG_FILE), JSON.stringify({planeBase: 'https://plane.example'}));
        writeFileSync(path.join(dir, PLANE_BEARER_FILE), 'not a blob this keychain wrote');

        expect(broker.status({})).toEqual({attached: false, configured: false, packaged: true, planeBase: 'https://plane.example'})
    });

    test('an untrusted sender is refused before anything runs', async () => {
        const {broker, calls} = makeBroker({trusted: false});

        expect(() => broker.status({})).toThrow('untrusted sender');
        await expect(broker.attach({}, {planeBase: 'http://127.0.0.1:3102'})).rejects.toThrow('untrusted sender');
        expect(calls.prompts).toEqual([])
    })
});
