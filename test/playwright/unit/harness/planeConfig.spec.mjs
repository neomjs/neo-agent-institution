import {expect, test}                          from '@playwright/test';
import {existsSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir}                                from 'node:os';
import path                                    from 'node:path';
import {
    createPlaneBroker,
    forgetPlaneConfig,
    launchedPlaneRecord,
    normalizePlaneBase,
    PLANE_BEARER_FILE,
    PLANE_CONFIG_FILE,
    PLANE_MCP_SERVER_NAME,
    planeEnvFragment,
    probePlaneBearerClass,
    probePlaneCredential,
    readPlaneConfig,
    writePlaneConfig
} from '../../../../harness/planeConfig.mjs';
import {runtimePlaneCause} from '../../../../harness/brain.mjs';

const BEARER   = 'ghp_fixtureBearerNeverReal0000000000',
      IDENTITY = '@fixture-viewer';

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
 * One fetch answer: the probes read the status, the headers, and the text or the JSON.
 */
function answer(status, body, headers = {}) {
    return {headers: new Headers(headers), json: async () => JSON.parse(body), status, text: async () => body}
}

/**
 * One MCP message over SSE, the way the plane's transport answers.
 */
const sse = message => answer(200, `event: message\ndata: ${JSON.stringify(message)}\n\n`, {'content-type': 'text/event-stream'});

/**
 * A plane's MCP route as measured on the local plane: without a credential it answers 401 with a
 * bearer challenge; an admitted PAT gets the `initialize` answer over SSE, naming the server, and
 * `list_permissions` in that session answers `{identity, capabilities, grantedToOthers}` —
 * `PermissionService`'s shape, as a text item unless `structured` is set. Its fleet surface answers
 * `/fleet/probe` with the admission context, whose `authSource` the live plane gives a GitHub PAT as
 * `github-pat`; `fleetSurface: false` is a plane that composes none.
 */
function fakePlane({admits = true, authSource = 'github-pat', fleetSurface = true, identity = IDENTITY, name = PLANE_MCP_SERVER_NAME, structured = false, toolError = false} = {}) {
    const requests = [];

    async function fetchFn(url, init) {
        const
            authorization = init.headers?.Authorization ?? null,
            rpc           = init.body ? JSON.parse(init.body) : null;

        requests.push({authorization, method: init.method, rpc: rpc?.method ?? null, session: init.headers?.['mcp-session-id'] ?? null, url});

        if (init.method === 'DELETE') {
            return answer(200, '')
        }

        if (url.endsWith('/fleet/probe') && !fleetSurface) {
            return answer(404, '')
        }

        if (!authorization || !admits) {
            return answer(401, '{"error":"invalid_token"}', {'www-authenticate': 'Bearer error="invalid_token"'})
        }

        if (url.endsWith('/fleet/probe')) {
            return answer(200, JSON.stringify({ok: true, result: {identity: {authProvider: 'github', authSource, userId: identity}, pid: 1}}))
        }

        if (rpc.method === 'initialize') {
            const reply = sse({id: rpc.id, jsonrpc: '2.0', result: {protocolVersion: '2025-03-26', serverInfo: {name, version: '1.0.0'}}});

            reply.headers.set('mcp-session-id', 'session-1');
            return reply
        }

        if (rpc.method === 'notifications/initialized') {
            return answer(202, '')
        }

        const payload = {capabilities: [], grantedToOthers: [], identity};

        return sse({id: rpc.id, jsonrpc: '2.0', result: toolError
            ? {content: [{text: 'permission lookup failed', type: 'text'}], isError: true}
            : structured ? {content: [], structuredContent: payload} : {content: [{text: JSON.stringify(payload), type: 'text'}]}})
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
    test('a stored record reads back with its identity, and plane.json carries no credential', () => {
        const dir = tempDir(), safeStorage = fakeSafeStorage();

        writePlaneConfig({dir, safeStorage, planeBase: 'http://127.0.0.1:3102/', bearer: BEARER, identity: IDENTITY});

        expect(readPlaneConfig({dir, safeStorage})).toEqual({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, identity: IDENTITY, authSource: null});
        expect(JSON.parse(readFileSync(path.join(dir, PLANE_CONFIG_FILE), 'utf8'))).toEqual({identity: IDENTITY, planeBase: 'http://127.0.0.1:3102'});
        expect(readFileSync(path.join(dir, PLANE_BEARER_FILE)).toString()).not.toContain(BEARER);
        expect(statSync(path.join(dir, PLANE_BEARER_FILE)).mode & 0o777).toBe(0o600)
    });

    test('the record keeps the plane\'s class verdict for its bearer in plane.json, and only a class the plane could have named', () => {
        const dir = tempDir(), safeStorage = fakeSafeStorage();

        writePlaneConfig({dir, safeStorage, planeBase: 'http://127.0.0.1:3102', bearer: BEARER, identity: IDENTITY, authSource: 'github-pat'});

        expect(readPlaneConfig({dir, safeStorage}).authSource).toBe('github-pat');
        expect(JSON.parse(readFileSync(path.join(dir, PLANE_CONFIG_FILE), 'utf8'))).toEqual({authSource: 'github-pat', identity: IDENTITY, planeBase: 'http://127.0.0.1:3102'});
        expect(existsSync(path.join(dir, 'plane-fleet-credential.bin')), 'no second secret is stored').toBe(false);

        for (const authSource of [null, '', 'GitHub PAT', 'github-pat\nNEO_X=1', 42, {}]) {
            writePlaneConfig({dir, safeStorage, planeBase: 'http://127.0.0.1:3102', bearer: BEARER, identity: IDENTITY, authSource});

            expect(readPlaneConfig({dir, safeStorage}).authSource, JSON.stringify(authSource)).toBeNull()
        }

        writeFileSync(path.join(dir, PLANE_CONFIG_FILE), JSON.stringify({authSource: 'github pat', identity: IDENTITY, planeBase: 'http://127.0.0.1:3102'}));

        expect(readPlaneConfig({dir, safeStorage}).authSource, 'a hand-edited class that no plane names reads as none').toBeNull()
    });

    test('a record is stored whole or not at all: without OS encryption, or without an identity, nothing is written', () => {
        const dir = tempDir();

        expect(() => writePlaneConfig({dir, safeStorage: fakeSafeStorage({available: false}), planeBase: 'http://127.0.0.1:3102', bearer: BEARER, identity: IDENTITY}))
            .toThrow('cannot encrypt');

        for (const identity of [undefined, '', '@', 'two words', 'AGENT:*']) {
            expect(() => writePlaneConfig({dir, safeStorage: fakeSafeStorage(), planeBase: 'http://127.0.0.1:3102', bearer: BEARER, identity}), String(identity))
                .toThrow('identity')
        }

        expect(readPlaneConfig({dir, safeStorage: fakeSafeStorage()})).toEqual({planeBase: null, bearer: null, identity: null, authSource: null})
    });

    test('a missing record is unconfigured, a bearer that no longer decrypts reads as absent, and a record from before the identity reads it as null', () => {
        const dir = tempDir();

        expect(readPlaneConfig({dir, safeStorage: fakeSafeStorage()})).toEqual({planeBase: null, bearer: null, identity: null, authSource: null});

        writeFileSync(path.join(dir, PLANE_CONFIG_FILE), JSON.stringify({planeBase: 'https://plane.example'}));
        writeFileSync(path.join(dir, PLANE_BEARER_FILE), 'not a blob this keychain wrote');

        const broken = {...fakeSafeStorage(), decryptString: () => { throw new Error('decrypt failed') }};

        expect(readPlaneConfig({dir, safeStorage: broken})).toEqual({planeBase: 'https://plane.example', bearer: null, identity: null, authSource: null})
    });

    test('forgetting removes every file of the record and tolerates their absence', () => {
        const dir = tempDir(), safeStorage = fakeSafeStorage();

        writePlaneConfig({dir, safeStorage, planeBase: 'https://plane.example', bearer: BEARER, identity: IDENTITY, authSource: 'github-pat'});
        forgetPlaneConfig({dir});
        forgetPlaneConfig({dir});

        expect(readPlaneConfig({dir, safeStorage})).toEqual({planeBase: null, bearer: null, identity: null, authSource: null});
        expect(existsSync(path.join(dir, PLANE_BEARER_FILE))).toBe(false)
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

    test('the env fragment: the stored bearer brings its identity, over one the launcher left behind', () => {
        const planeConfig = {planeBase: 'https://plane.example', bearer: BEARER, identity: IDENTITY};

        expect(planeEnvFragment({planeConfig, env: {}}), 'a Finder launch: nothing inherited').toEqual({
            NEO_AGENT_IDENTITY                   : IDENTITY,
            NEO_FLEET_PLANE_ADMISSION_BEARER     : '',
            NEO_FLEET_PLANE_ADMISSION_BEARER_FILE: '',
            NEO_FLEET_PLANE_BASE                 : 'https://plane.example',
            NEO_FLEET_PLANE_BEARER               : BEARER,
            NEO_FLEET_PLANE_BEARER_CLASS         : ''
        });
        expect(planeEnvFragment({planeConfig, env: {NEO_AGENT_IDENTITY: 'neo-fable-clio'}}).NEO_AGENT_IDENTITY, 'a shell another session launched')
            .toBe(IDENTITY);
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BEARER: 'env-bearer'}}), 'an env bearer keeps the env\'s identity')
            .toEqual({NEO_FLEET_PLANE_BASE: 'https://plane.example'});
        expect(planeEnvFragment({planeConfig: {...planeConfig, identity: null}, env: {NEO_AGENT_IDENTITY: 'neo-fable-clio'}}), 'a record from before the identity is no record: the shell boots on its own and the card offers to attach again')
            .toEqual({})
    });

    test('the env fragment: a set plane base keeps the stored bearer away from it; a set bearer wins', () => {
        const planeConfig = {planeBase: 'https://plane.example', bearer: BEARER, identity: IDENTITY};

        expect(planeEnvFragment({planeConfig, env: {}})).toEqual({
            NEO_AGENT_IDENTITY                   : IDENTITY,
            NEO_FLEET_PLANE_ADMISSION_BEARER     : '',
            NEO_FLEET_PLANE_ADMISSION_BEARER_FILE: '',
            NEO_FLEET_PLANE_BASE                 : 'https://plane.example',
            NEO_FLEET_PLANE_BEARER               : BEARER,
            NEO_FLEET_PLANE_BEARER_CLASS         : ''
        });
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BASE: 'http://127.0.0.1:3102'}}), 'the launcher and checkout env win whole').toEqual({});
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BASE: ''}}), 'an explicitly empty base still wins').toEqual({});
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BEARER: 'env-bearer'}})).toEqual({NEO_FLEET_PLANE_BASE: 'https://plane.example'});
        expect(planeEnvFragment({planeConfig: {planeBase: null, bearer: null}, env: {}})).toEqual({});
        expect(planeEnvFragment({planeConfig: {planeBase: 'https://plane.example', bearer: null}, env: {}}), 'a bearer that no longer decrypts is no record').toEqual({});
        expect(planeEnvFragment({planeConfig: {planeBase: 'https://plane.example', bearer: null}, env: {NEO_FLEET_PLANE_BEARER: 'env-bearer'}})).toEqual({NEO_FLEET_PLANE_BASE: 'https://plane.example'})
    });

    test('the env fragment: the bearer travels once with its recorded class, and both admission variables are emptied over ones the launch left behind', () => {
        const
            planeConfig = {planeBase: 'https://plane.example', bearer: BEARER, identity: IDENTITY, authSource: 'github-pat'},
            inherited   = {
                NEO_FLEET_PLANE_ADMISSION_BEARER     : 'inherited-fleet-credential',
                NEO_FLEET_PLANE_ADMISSION_BEARER_FILE: '/elsewhere/fleet.token',
                NEO_FLEET_PLANE_BEARER_CLASS         : 'github-pat'
            },
            // the fleet child's env as the launch composes it: the inherited env, then the fragment
            child       = (env, record = planeConfig) => ({...env, ...planeEnvFragment({env, planeConfig: record})});

        expect(child({}), 'a Finder launch').toMatchObject({NEO_FLEET_PLANE_BEARER: BEARER, NEO_FLEET_PLANE_BEARER_CLASS: 'github-pat'});
        expect(Object.values(child({})).filter(value => value === BEARER), 'the PAT is exported once; the Brain derives the fleet-surface credential from its class').toHaveLength(1);
        expect(child(inherited), 'an inherited admission credential cannot reach the record\'s plane').toMatchObject({
            NEO_FLEET_PLANE_ADMISSION_BEARER     : '',
            NEO_FLEET_PLANE_ADMISSION_BEARER_FILE: ''
        });

        for (const authSource of [null, undefined]) {
            expect(child(inherited, {...planeConfig, authSource}).NEO_FLEET_PLANE_BEARER_CLASS, 'a record without a class declares none, over an inherited one')
                .toBe('')
        }

        expect(planeEnvFragment({planeConfig: {...planeConfig, authSource: 'seat-token'}, env: {}}).NEO_FLEET_PLANE_BEARER_CLASS, 'a class is exported as the plane named it; the Brain decides what it arms')
            .toBe('seat-token');
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BEARER: 'env-bearer'}}), 'an env bearer brings no class of the record\'s')
            .toEqual({NEO_FLEET_PLANE_BASE: 'https://plane.example'});
        expect(planeEnvFragment({planeConfig, env: {NEO_FLEET_PLANE_BASE: 'http://127.0.0.1:3102'}}), 'another plane never sees the stored bearer or its class')
            .toEqual({})
    });

    test('a launch is the stored record\'s only when the record supplied both its plane and its credential', () => {
        const
            record   = {bearer: 'stored-bearer', identity: '@ada', planeBase: 'https://plane.example'},
            launched = (env, planeConfig = record) => launchedPlaneRecord(planeConfig, planeEnvFragment({env, planeConfig}));

        expect(launched({}), 'the record alone').toBe(record);
        expect(launched({NEO_FLEET_PLANE_BASE: 'https://other.example'}), 'an inherited plane base').toBeNull();
        expect(launched({NEO_FLEET_PLANE_BEARER: 'env-bearer'}), 'an inherited PAT on the record\'s plane').toBeNull();
        expect(launched({}, null), 'no stored record').toBeNull();
        expect(launched({}, {...record, identity: null}), 'a record without its identity supplies no launch').toBeNull()
    });

    test('the credential probe accepts only the Memory Core naming itself after a bearer challenge, and learns whose PAT it is', async () => {
        const plane = fakePlane();

        expect(await probePlaneCredential({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, fetchFn: plane.fetchFn})).toEqual({identity: IDENTITY, verdict: 'accepted'});
        expect(plane.requests.map(({authorization, method, rpc}) => `${method}${rpc ? ` ${rpc}` : ''} ${authorization ? 'with' : 'without'} PAT`)).toEqual([
            'POST initialize without PAT',
            'POST initialize with PAT',
            'POST notifications/initialized with PAT',
            'POST tools/call with PAT',
            'DELETE with PAT'
        ]);
        expect(plane.requests[1].url, 'the credential rides the header, never the URL').toBe('http://127.0.0.1:3102/mc/mcp');
        expect(plane.requests[1].authorization).toBe(`Bearer ${BEARER}`);
        expect(plane.requests.slice(2).map(({session}) => session), 'the identity is read in the admitted session, which is closed again')
            .toEqual(['session-1', 'session-1', 'session-1'])
    });

    test('the identity is the plane\'s list_permissions answer, as a text item or structured content, in its canonical @ form', async () => {
        const probe = host => probePlaneCredential({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: host.fetchFn});

        expect(await probe(fakePlane({structured: true}))).toEqual({identity: IDENTITY, verdict: 'accepted'});
        expect(await probe(fakePlane({identity: ' fixture-viewer '}))).toEqual({identity: IDENTITY, verdict: 'accepted'})
    });

    test('a plane that names no identity for the PAT refuses it as no-identity, and still closes its session', async () => {
        for (const options of [{identity: null}, {identity: ''}, {identity: 'AGENT:*'}, {identity: 'two words'}, {toolError: true}]) {
            const plane = fakePlane(options);

            expect(await probePlaneCredential({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: plane.fetchFn}), JSON.stringify(options))
                .toEqual({identity: null, verdict: 'no-identity'});
            expect(plane.requests.at(-1).method, JSON.stringify(options)).toBe('DELETE')
        }
    });

    test('a host that is not a plane never sees the PAT', async () => {
        for (const status of [200, 404, 405]) {
            const host = stranger(status);

            expect(await probePlaneCredential({planeBase: 'https://example.com', bearer: BEARER, fetchFn: host.fetchFn}), String(status)).toEqual({identity: null, verdict: 'not-a-plane'});
            expect(host.requests, String(status)).toEqual([null])
        }
    });

    test('a plane that refuses the PAT rejects it; an MCP server that is not the Memory Core is not a plane', async () => {
        expect(await probePlaneCredential({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: fakePlane({admits: false}).fetchFn})).toEqual({identity: null, verdict: 'rejected'});

        const other = fakePlane({name: 'another-mcp-server'});

        expect(await probePlaneCredential({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: other.fetchFn})).toEqual({identity: null, verdict: 'not-a-plane'});
        expect(other.requests.map(({rpc}) => rpc), 'a server that is not the Memory Core is never asked for an identity').not.toContain('tools/call')
    });

    test('the class probe asks the fleet surface with the bearer and takes the plane\'s authSource as it names it', async () => {
        const plane = fakePlane();

        expect(await probePlaneBearerClass({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, fetchFn: plane.fetchFn})).toBe('github-pat');
        expect(plane.requests.map(({authorization, method, url}) => ({authorization, method, url}))).toEqual([
            {authorization: `Bearer ${BEARER}`, method: 'GET', url: 'http://127.0.0.1:3102/fleet/probe'}
        ]);
        expect(await probePlaneBearerClass({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: fakePlane({authSource: 'gitlab-pat'}).fetchFn})).toBe('gitlab-pat')
    });

    test('the class probe never guesses: a refusal, no fleet surface, another answer or no answer is no class', async () => {
        const
            probe = fetchFn => probePlaneBearerClass({planeBase: 'https://plane.example', bearer: BEARER, fetchFn}),
            reply = (status, body) => async () => answer(status, typeof body === 'string' ? body : JSON.stringify(body));

        expect(await probe(fakePlane({admits: false}).fetchFn), 'refused').toBeNull();
        expect(await probe(fakePlane({fleetSurface: false}).fetchFn), 'a plane that composes no fleet surface').toBeNull();
        expect(await probe(stranger(200).fetchFn), 'a host that is not a plane').toBeNull();
        expect(await probe(reply(200, {ok: false, error: {code: 'denied'}})), 'not ok').toBeNull();
        expect(await probe(reply(200, {ok: true, result: {identity: null}})), 'no admission context').toBeNull();
        expect(await probe(reply(200, {ok: true, result: {identity: {authSource: 'GitHub PAT'}}})), 'not a class the plane names').toBeNull();
        expect(await probe(async () => { throw new TypeError('fetch failed') }), 'unreachable').toBeNull()
    });

    test('a network failure at any step is unreachable', async () => {
        const plane = fakePlane();

        expect(await probePlaneCredential({planeBase: 'https://plane.example', bearer: BEARER, fetchFn: async () => { throw new Error('ECONNREFUSED') }})).toEqual({identity: null, verdict: 'unreachable'});
        expect(await probePlaneCredential({
            bearer   : BEARER,
            fetchFn  : async (url, init) => init.headers?.Authorization ? Promise.reject(new Error('reset')) : plane.fetchFn(url, init),
            planeBase: 'https://plane.example'
        })).toEqual({identity: null, verdict: 'unreachable'});
        expect(await probePlaneCredential({
            bearer   : BEARER,
            fetchFn  : async (url, init) => init.body?.includes('tools/call') ? Promise.reject(new Error('reset')) : plane.fetchFn(url, init),
            planeBase: 'https://plane.example'
        }), 'while reading the identity').toEqual({identity: null, verdict: 'unreachable'})
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

    test('an attach stores the record with the plane\'s class for its bearer, relaunches, and the reply never carries the PAT', async () => {
        const {broker, calls, dir, safeStorage} = makeBroker();
        const reply = await broker.attach({}, {planeBase: 'http://127.0.0.1:3102'});

        expect(reply).toEqual({ok: true, reason: null, relaunching: true});
        expect(JSON.stringify(reply)).not.toContain(BEARER);
        expect(calls).toEqual({prompts: ['plane-attach'], relaunches: 1});
        expect(readPlaneConfig({dir, safeStorage})).toEqual({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, identity: IDENTITY, authSource: 'github-pat'});
        expect(broker.status({})).toEqual({attached: false, configured: true, packaged: true, planeBase: 'http://127.0.0.1:3102'})
    });

    test('a plane whose fleet surface names no class still attaches, with no class recorded', async () => {
        const {broker, dir, safeStorage} = makeBroker({host: fakePlane({fleetSurface: false})});

        expect(await broker.attach({}, {planeBase: 'http://127.0.0.1:3102'})).toEqual({ok: true, reason: null, relaunching: true});
        expect(readPlaneConfig({dir, safeStorage}).authSource).toBeNull()
    });

    test('every refusal stores nothing and relaunches nothing', async () => {
        const cases = [
            [{packaged: false},  {planeBase: 'http://127.0.0.1:3102'}, 'not-packaged'],
            [{},                 {planeBase: 'http://plane.example'},  'invalid-plane-base'],
            [{available: false}, {planeBase: 'http://127.0.0.1:3102'}, 'encryption-unavailable'],
            [{prompt: null},     {planeBase: 'http://127.0.0.1:3102'}, 'canceled'],
            [{host: fakePlane({admits: false})},   {planeBase: 'http://127.0.0.1:3102'}, 'rejected'],
            [{host: fakePlane({identity: null})},  {planeBase: 'http://127.0.0.1:3102'}, 'no-identity'],
            [{host: stranger(404)},                {planeBase: 'https://example.com'},   'not-a-plane']
        ];

        for (const [options, request, reason] of cases) {
            const {broker, calls, dir} = makeBroker(options);

            expect(await broker.attach({}, request), reason).toEqual({ok: false, reason, relaunching: false});
            expect(calls.relaunches, reason).toBe(0);
            expect(readPlaneConfig({dir, safeStorage: fakeSafeStorage()}), reason).toEqual({planeBase: null, bearer: null, identity: null, authSource: null});
            expect(options.host?.requests.some(request => request?.url?.endsWith('/fleet/probe')) ?? false, `${reason}: the fleet surface is asked only after the plane admitted the PAT`).toBe(false)
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

    test('a record from before the identity reads as unconfigured too, so the card offers to attach again', () => {
        const {broker, dir, safeStorage} = makeBroker();

        writeFileSync(path.join(dir, PLANE_CONFIG_FILE), JSON.stringify({planeBase: 'https://plane.example'}));
        writeFileSync(path.join(dir, PLANE_BEARER_FILE), safeStorage.encryptString(BEARER));

        expect(readPlaneConfig({dir, safeStorage})).toEqual({planeBase: 'https://plane.example', bearer: BEARER, identity: null, authSource: null});
        expect(broker.status({})).toEqual({attached: false, configured: false, packaged: true, planeBase: 'https://plane.example'})
    });

    test('an untrusted sender is refused before anything runs', async () => {
        const {broker, calls} = makeBroker({trusted: false});

        expect(() => broker.status({})).toThrow('untrusted sender');
        await expect(broker.attach({}, {planeBase: 'http://127.0.0.1:3102'})).rejects.toThrow('untrusted sender');
        expect(calls.prompts).toEqual([])
    })
});

test.describe('harness/planeConfig — verifyPlane(), the broker asking about the launched PAT', () => {
    const LAUNCHED = {bearer: BEARER, identity: IDENTITY, planeBase: 'http://127.0.0.1:3102'};

    function verifier({host = fakePlane(), launched = LAUNCHED, trusted = true} = {}) {
        return createPlaneBroker({
            causeOf         : runtimePlaneCause,
            dir             : tempDir(),
            fetchFn         : host.fetchFn,
            getLaunchedPlane: () => launched,
            getTransportFact: () => null,
            isTrustedSender : () => trusted,
            packaged        : true,
            promptCredential: async () => null,
            relaunch        : () => {},
            safeStorage     : fakeSafeStorage()
        })
    }

    test('names a launched PAT the plane refuses, and the reply never carries it', async () => {
        const reply = await verifier({host: fakePlane({admits: false})}).verify({});

        expect(reply).toEqual({cause: 'plane-credential-refused'});
        expect(JSON.stringify(reply)).not.toContain(BEARER)
    });

    test('names a PAT the plane now admits as another account', async () => {
        expect(await verifier({host: fakePlane({identity: '@someone-else'})}).verify({})).toEqual({cause: 'plane-identity-changed'})
    });

    test('an unchanged PAT, a plane that does not answer, or no plane at all names nothing', async () => {
        const silent = {fetchFn: async () => { throw new TypeError('fetch failed') }};

        expect(await verifier().verify({})).toEqual({cause: null});
        expect(await verifier({host: silent}).verify({})).toEqual({cause: null});
        expect(await verifier({host: stranger(404)}).verify({})).toEqual({cause: null})
    });

    test('a launch that took its plane from elsewhere is never probed', async () => {
        const host = fakePlane({admits: false});

        expect(await verifier({host, launched: null}).verify({})).toEqual({cause: null});
        expect(host.requests).toEqual([])
    });

    test('an untrusted sender is refused before the plane is asked', async () => {
        const host = fakePlane();

        await expect(verifier({host, trusted: false}).verify({})).rejects.toThrow('shell-plane-verify: untrusted sender');
        expect(host.requests).toEqual([])
    })
});
