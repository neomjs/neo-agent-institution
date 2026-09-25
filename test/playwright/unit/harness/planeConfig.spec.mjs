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
        expect(planeEnvFragment({planeConfig: {planeBase: null, bearer: null}, env: {}})).toEqual({})
    });

    test('the credential probe: 401 and 403 reject, any other status accepts, a network failure is unreachable', async () => {
        const seen = [], respond = status => async (url, init) => {
            seen.push({url, authorization: init.headers.Authorization});
            return {status, body: {cancel: async () => {}}}
        };

        expect(await probePlaneCredential({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, fetchFn: respond(401)})).toBe('rejected');
        expect(await probePlaneCredential({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, fetchFn: respond(403)})).toBe('rejected');
        expect(await probePlaneCredential({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, fetchFn: respond(400)})).toBe('accepted');
        expect(await probePlaneCredential({planeBase: 'http://127.0.0.1:3102', bearer: BEARER, fetchFn: async () => { throw new Error('ECONNREFUSED') }})).toBe('unreachable');

        expect(seen[0].url, 'the credential rides the header, never the URL').toBe('http://127.0.0.1:3102/mc/mcp');
        expect(seen[0].authorization).toBe(`Bearer ${BEARER}`)
    })
});

test.describe('harness/planeConfig — the plane broker behind planeStatus() and attachPlane()', () => {
    function makeBroker({packaged = true, prompt = BEARER, status = 400, trusted = true, available = true, fact = null} = {}) {
        const
            dir         = tempDir(),
            safeStorage = fakeSafeStorage({available}),
            calls       = {prompts: [], relaunches: 0};

        const broker = createPlaneBroker({
            dir,
            fetchFn         : async () => ({status, body: {cancel: async () => {}}}),
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
            [{status: 401},      {planeBase: 'http://127.0.0.1:3102'}, 'rejected']
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

    test('an untrusted sender is refused before anything runs', async () => {
        const {broker, calls} = makeBroker({trusted: false});

        expect(() => broker.status({})).toThrow('untrusted sender');
        await expect(broker.attach({}, {planeBase: 'http://127.0.0.1:3102'})).rejects.toThrow('untrusted sender');
        expect(calls.prompts).toEqual([])
    })
});
