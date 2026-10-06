import {expect, test}                         from '@playwright/test';
import {spawn}                                from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync}   from 'node:fs';
import {tmpdir}                               from 'node:os';
import path                                   from 'node:path';
import {resolveAgentOsRuntimeRoot, runBrainScript} from '../../../../harness/brain.mjs';
import {
    createPlaneBroker,
    planeEnvFragment,
    PLANE_MCP_SERVER_NAME,
    readPlaneConfig
} from '../../../../harness/planeConfig.mjs';

/**
 * @summary The plane carrier, composed with a real Brain root: the class comes from a real Fleet app's
 * authenticated probe, passes through the shell's own attach, record and launch env, and ends in the
 * Brain's own config resolution and admission rule. Live arm: it needs `NEO_AGENTOS_RUNTIME_ROOT`, an
 * installed Brain checkout, as the Brain-contract job provides; the credentials are synthetic.
 */

const
    TOKEN    = 'ghp_carrierContractSyntheticNeverReal0',
    IDENTITY = '@fixture-operator',
    // The bootstrap the shell's own config resolver uses (`resolveBrainPaths`): the Brain root's .env, the
    // Engine from the `neo.mjs` package that root serves, then its config.
    BOOTSTRAP = [
        "import 'dotenv/config';",
        "import Neo from 'neo.mjs/src/Neo.mjs';",
        "import * as core from 'neo.mjs/src/core/_export.mjs';",
        "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
        "import AiConfig from './ai/config.mjs';"
    ],
    // A Fleet app on a loopback port with a registered test forge, whose PAT validation answers for the
    // synthetic token only.
    FLEET_APP = [
        ...BOOTSTRAP,
        "const [{createFleetServerApp}, {default: Forges}] = await Promise.all([import('./ai/services/fleet/fleetServer.mjs'), import('./ai/services/fleet/ForgeConnectionRegistryService.mjs')]);",
        "const {token, forgeDir} = JSON.parse(process.env.CARRIER_FIXTURE), nativeFetch = globalThis.fetch;",
        "globalThis.fetch = async (input, init) => String(input) !== 'https://api.github.test/user' ? nativeFetch(input, init)",
        "    : init?.headers?.Authorization === `Bearer ${token}`",
        "        ? new Response(JSON.stringify({id: 4242, login: 'fixture-operator', name: 'Fixture Operator'}), {status: 200, headers: {'content-type': 'application/json', 'x-oauth-scopes': 'repo'}})",
        "        : new Response(JSON.stringify({message: 'Bad credentials'}), {status: 401, headers: {'content-type': 'application/json'}});",
        "Forges.dataDir = forgeDir;",
        "Forges.initialize({actor: 'carrier-contract', apply: true});",
        "Forges.register({actor: 'carrier-contract', apply: true, authProvider: 'github', endpoint: 'https://api.github.test'});",
        "const app = await createFleetServerApp({",
        "    aiConfig: {",
        "        publicUrl: 'https://agent-os.example.test/mc/mcp', allowedHosts: null, mcpHttpHost: '127.0.0.1', mcpListenHost: '127.0.0.1', authMiddleware: null,",
        "        auth: {mode: 'github-pat', host: null, issuerUrl: null, trustProxyIdentity: false, pinFirstProviderSubject: false, githubApiBaseUrl: 'https://api.github.test', patCacheTtlSeconds: 60, patValidationTimeoutMs: 5000, patDiskCachePath: '', allowedUsers: []},",
        "        fleet: {port: 8083, dataDir: '/app/.neo-ai-data/fleet', cockpitOrigins: ['http://127.0.0.1:8080']}",
        "    },",
        "    logger: {info() {}, warn() {}, error() {}},",
        "    planeGuard() {}",
        "});",
        "const server = app.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({port: server.address().port}) + '\\n'));"
    ].join('\n'),
    // The fleet child's question, asked of the Brain under the env the launch built: which credential
    // the fleet surface would be given, and whether the class rule admits it. It prints labels only.
    RESOLVER = [
        ...BOOTSTRAP,
        "const {resolveFleetPlaneAdmissionBearer, assertFleetPlaneAdmissionBearerClass} = await import('./ai/services/fleet/fleetServer.mjs');",
        "const bearer = process.env.NEO_FLEET_PLANE_BEARER ?? '', label = value => !value ? 'none' : value === bearer ? 'plane-bearer' : 'other';",
        "let assertion;",
        "try { assertion = label(assertFleetPlaneAdmissionBearerClass()) } catch { assertion = 'refused' }",
        "process.stdout.write(JSON.stringify({admission: label(resolveFleetPlaneAdmissionBearer()), assertion}));"
    ].join('\n');

/**
 * @summary A reversible stand-in for Electron's `safeStorage`.
 */
const safeStorage = {
    decryptString        : buffer => Buffer.from(buffer.toString(), 'base64').toString().replace(/^enc:/, ''),
    encryptString        : value => Buffer.from(Buffer.from(`enc:${value}`).toString('base64')),
    isEncryptionAvailable: () => true
};

/**
 * @summary The Memory Core half of the attach probe, the one the plane under test does not serve: a
 * bearer challenge, then the server's name and `list_permissions` for the synthetic token.
 */
async function memoryCore(url, init) {
    const
        authorized = init.headers?.Authorization === `Bearer ${TOKEN}`,
        rpc        = init.body ? JSON.parse(init.body) : null,
        reply      = (status, body, headers = {}) => new Response(body, {headers, status});

    if (init.method === 'DELETE') return reply(200, '');
    if (!authorized) return reply(401, '{}', {'www-authenticate': 'Bearer error="invalid_token"'});
    if (rpc.method === 'notifications/initialized') return reply(202, '');

    const result = rpc.method === 'initialize'
        ? {protocolVersion: '2025-03-26', serverInfo: {name: PLANE_MCP_SERVER_NAME, version: '1'}}
        : {content: [{text: JSON.stringify({capabilities: [], grantedToOthers: [], identity: IDENTITY}), type: 'text'}]};

    return reply(200, JSON.stringify({id: rpc.id, jsonrpc: '2.0', result}), {'content-type': 'application/json', 'mcp-session-id': 'session-1'})
}

/**
 * @summary Starts the Fleet app in the Brain root and resolves its base once it listens.
 */
function startFleetApp({brainRoot, forgeDir}) {
    const child = spawn(process.env.NEO_HARNESS_NODE_BIN || 'node', ['--input-type=module', '-e', FLEET_APP], {
        cwd  : brainRoot,
        env  : {...process.env, CARRIER_FIXTURE: JSON.stringify({forgeDir, token: TOKEN})},
        stdio: ['ignore', 'pipe', 'pipe']
    });

    return new Promise((resolve, reject) => {
        let stderr = '', stdout = '';

        child.stderr.on('data', chunk => { stderr += chunk });
        child.once('exit', code => reject(new Error(`the Fleet app exited (${code}): ${stderr.slice(0, 800)}`)));
        child.stdout.on('data', chunk => {
            stdout += chunk;

            // the Brain may log before it listens; the port is the one line that parses as {port}
            const port = stdout.split('\n').map(line => { try { return JSON.parse(line).port } catch { return null } }).find(Number.isInteger);

            port && resolve({base: `http://127.0.0.1:${port}`, stop: () => child.kill()})
        })
    })
}

// one Fleet app and one attach serve every arm
test.describe.configure({mode: 'serial'});

test.describe('harness/planeConfig — the carrier, composed with a real Brain root', () => {
    let root, brainRoot, fleet, dir;

    const
        // the launch's composition: the inherited env, then the record's fragment over it
        // every key the rule reads is set, so neither this process's env nor the Brain root's .env decides a case
        childEnv  = (inherited, record = readPlaneConfig({dir, safeStorage})) => ({
            NEO_FLEET_PLANE_ADMISSION_BEARER     : '',
            NEO_FLEET_PLANE_ADMISSION_BEARER_FILE: '',
            NEO_FLEET_PLANE_BEARER               : '',
            NEO_FLEET_PLANE_BEARER_CLASS         : '',
            NEO_FLEET_PLANE_BEARER_FILE          : '',
            NEO_MCP_HEALTHCHECK_TOKEN_FILE       : '',
            ...inherited,
            ...planeEnvFragment({env: inherited, planeConfig: record})
        }),
        fleetSays = env => runBrainScript({env, label: 'carrier contract', repoRoot: brainRoot, script: RESOLVER});

    test.beforeAll(async () => {
        test.skip(!process.env.NEO_AGENTOS_RUNTIME_ROOT, 'live arm: set NEO_AGENTOS_RUNTIME_ROOT to an installed Brain checkout');

        brainRoot = resolveAgentOsRuntimeRoot(process.env);
        root      = mkdtempSync(path.join(tmpdir(), 'plane-carrier-'));
        dir       = path.join(root, 'userData');
        fleet     = await startFleetApp({brainRoot, forgeDir: path.join(root, 'forge')});

        const broker = createPlaneBroker({
            dir,
            fetchFn         : (url, init) => url.endsWith('/mc/mcp') ? memoryCore(url, init) : fetch(url, init),
            getTransportFact: () => null,
            isTrustedSender : () => true,
            packaged        : true,
            promptCredential: async () => TOKEN,
            relaunch        : () => {},
            safeStorage
        });

        expect(await broker.attach({}, {planeBase: fleet.base})).toEqual({ok: true, reason: null, relaunching: true})
    });

    test.afterAll(() => {
        fleet?.stop();
        root && rmSync(root, {recursive: true, force: true})
    });

    test('the attach records the class the real Fleet probe names, and that PAT is admitted on /fleet as its owner', async () => {
        const record = readPlaneConfig({dir, safeStorage});

        expect(record).toMatchObject({authSource: 'github-pat', bearer: TOKEN, identity: IDENTITY, planeBase: fleet.base});

        const probe = await (await fetch(`${fleet.base}/fleet/probe`, {headers: {Authorization: `Bearer ${TOKEN}`}})).json();

        expect(probe.result.identity.ownerPrincipal).toMatch(/^owner:.+:4242$/)
    });

    test('a forge-PAT record hands its one bearer to the fleet surface, over admission values the launch left behind', async () => {
        const inherited = {NEO_FLEET_PLANE_ADMISSION_BEARER: 'inherited-admission', NEO_FLEET_PLANE_ADMISSION_BEARER_FILE: path.join(root, 'elsewhere.token')};

        expect(await fleetSays(childEnv(inherited))).toEqual({admission: 'plane-bearer', assertion: 'plane-bearer'})
    });

    test('a record without a class derives no fleet-surface credential', async () => {
        const record = {...readPlaneConfig({dir, safeStorage}), authSource: null};

        expect(await fleetSays(childEnv({}, record))).toEqual({admission: 'none', assertion: 'none'})
    });

    test('the bootstrap token still refuses the alias, whatever class is declared', async () => {
        const tokenFile = path.join(root, 'bootstrap.token');

        writeFileSync(tokenFile, TOKEN);

        expect((await fleetSays({...childEnv({}), NEO_MCP_HEALTHCHECK_TOKEN_FILE: tokenFile})).assertion).toBe('refused')
    });

    test('equal bytes declared without a forge class still refuse', async () => {
        const record = {...readPlaneConfig({dir, safeStorage}), authSource: null};

        expect((await fleetSays({...childEnv({}, record), NEO_FLEET_PLANE_ADMISSION_BEARER: TOKEN})).assertion).toBe('refused')
    });

    test('another credential or another plane cannot borrow the record\'s class', async () => {
        expect(await fleetSays(childEnv({NEO_FLEET_PLANE_BEARER: 'another-credential'})), 'a bearer the launch supplied')
            .toEqual({admission: 'none', assertion: 'none'});
        expect(await fleetSays(childEnv({NEO_FLEET_PLANE_BASE: 'https://another-plane.example', NEO_FLEET_PLANE_BEARER: 'another-credential'})), 'another plane')
            .toEqual({admission: 'none', assertion: 'none'})
    })
});
