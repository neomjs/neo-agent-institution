import {expect, test}                                        from '@playwright/test';
import {execFileSync}                                        from 'node:child_process';
import {EventEmitter, once}                                  from 'node:events';
import {mkdtemp, rm, symlink}                                from 'node:fs/promises';
import {readFileSync, writeFileSync, mkdirSync, existsSync}  from 'node:fs';
import net                                                   from 'node:net';
import {homedir, tmpdir}                                     from 'node:os';
import path                                                  from 'node:path';
import {fileURLToPath}                                       from 'node:url';
import {createFleetWireResponse, FLEET_WIRE_RESPONSE_STATES} from 'neo-agent-brain/fleet-contract';
import {
    allocatePort,
    assertIsolatedProfile,
    awaitFleetReady,
    awaitOrchestratorReady,
    awaitReadyMarker,
    buildBrainProfile,
    buildPackagedBrainEnv,
    clearRunState,
    detectLiveBrain,
    FLEET_SERVER_ENTRY,
    ORCHESTRATOR_ENTRY,
    OWNER_MARKER_STRIP,
    loadFleetRuntimeContracts,
    probeFleetServing,
    probePort,
    registerOwnedChild,
    resolveAgentOsRuntimeRoot,
    resolveBrainPaths,
    resolveProductBrainPlan,
    besidePlaneRefusal,
    bootFailureCause,
    fleetReadyOrPlaneRefusal,
    PLANE_REFUSAL_DETAIL_MAX,
    planeRefusal,
    resolveRealPath,
    resolveSmokeRoot,
    resolveUiFleetTransport,
    runBrainScript,
    startBrainChild,
    stopBrainChild,
    stopBrainTree,
    sweepStaleRunState,
    writeRunState
} from '../../../../harness/brain.mjs';

const productRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * A stub supervised child: EventEmitter shape matching the ChildProcess surface the lifecycle
 * contract consumes (stdout stream, exit/error events, pid, exitCode).
 */
function createFakeChild({pid = 4242} = {}) {
    const child = new EventEmitter();

    child.pid      = pid;
    child.exitCode = null;
    child.stdout   = new EventEmitter();
    child.stderr   = new EventEmitter();

    child.emitLine = line => child.stdout.emit('data', Buffer.from(line + '\n'));
    child.exit     = (code = 0, signal = null) => {
        child.exitCode = code;
        child.emit('exit', code, signal)
    };

    return child
}

/**
 * A stub process-group registry backing an injected killFn: signal 0 probes liveness (throws
 * ESRCH when the group is gone), SIGINT/SIGKILL transition it per the scenario. Signals must
 * arrive group-addressed (negative pid) — that IS the descendant-ownership contract.
 */
function createFakeGroup({pid, diesOn}) {
    const state = {alive: true, signals: []};

    state.killFn = (target, signal) => {
        if (target !== -pid && signal !== 0) {
            throw new Error(`expected group-addressed signal, got target=${target}`)
        }

        if (!state.alive) {
            const error = new Error('ESRCH');
            error.code  = 'ESRCH';
            throw error
        }

        if (signal !== 0) {
            state.signals.push(signal);

            if (diesOn.includes(signal)) {
                state.alive = false
            }
        }

        return true
    };

    return state
}

/**
 * @summary Creates disjoint installed-public and private-runtime module fixtures, or both at the
 * same explicitly supplied packaged root. The stale runtime wire path fails if accidentally loaded.
 * Every module answers with the name of the root it was LOADED from, read off its own location:
 * the source text is a constant, and no value is ever built into code.
 * @param {String} root
 * @param {Object} options
 * @param {Boolean} [options.product=false]
 * @param {Boolean} [options.runtime=false]
 */
function writeFleetRootFixture(root, {product = false, runtime = false}) {
    const modules = {
        ...(product && {
            'node_modules/neo-agent-brain/src/fleet/contract/index.mjs': [
                "const tag = new URL('../../../../../', import.meta.url).pathname.split('/').at(-2);",
                'export const FLEET_WIRE_METHODS = [tag];',
                'export const FLEET_WIRE_RESPONSE_STATES = {ok: tag};',
                ...['createFleetWireOffer', 'createFleetWireRequest', 'createFleetWireResponse', 'inspectFleetWireResponse']
                    .map(name => `export const ${name} = () => tag;`)
            ].join('\n')
        }),
        ...(runtime && {
            'ai/graph/normalizeAgentIdentityNodeId.mjs': 'export const normalizeAgentIdentityNodeId = value => value;',
            'ai/services/fleet/fleetLaunchContract.mjs': [
                "const tag = new URL('../../../', import.meta.url).pathname.split('/').at(-2);",
                'export const FLEET_CREDENTIAL_METHODS = [tag];',
                'export const probeExistingFleetServer = () => tag;',
                'export const resolveFleetBearer = () => tag;'
            ].join('\n'),
            'src/fleet/contract/wire.mjs': "throw new Error('runtime vocabulary must not be imported');"
        })
    };

    for (const [relativePath, source] of Object.entries(modules)) {
        const target = path.join(root, relativePath);

        mkdirSync(path.dirname(target), {recursive: true});
        writeFileSync(target, source, 'utf8')
    }
}

test.describe('harness brain lifecycle', () => {
    const
        agentIdentityNodeId = '@neo-gpt-emmy',
        bearerToken         = 'A'.repeat(43);

    let workDir;

    test.beforeEach(async () => {
        workDir = await mkdtemp(path.join(tmpdir(), 'neo-harness-brain-'))
    });

    test.afterEach(async () => {
        await rm(workDir, {force: true, recursive: true})
    });

    test('checkout runtime authority is explicit, absolute, and never inferred from Institution cwd', () => {
        expect(() => resolveAgentOsRuntimeRoot({})).toThrow(/NEO_AGENTOS_RUNTIME_ROOT/);
        expect(() => resolveAgentOsRuntimeRoot({NEO_AGENTOS_RUNTIME_ROOT: '../neo-agent-brain'}))
            .toThrow(/absolute/);
        expect(resolveAgentOsRuntimeRoot({NEO_AGENTOS_RUNTIME_ROOT: workDir})).toBe(path.resolve(workDir))
    });

    test('resolveBrainPaths bootstraps the Engine from the neo.mjs package the Brain root serves, never from a Brain-root ./src', async () => {
        // The Brain root has no src/Neo.mjs since the split: its daemons import the Engine from
        // the `neo.mjs` package in their own node_modules, after `dotenv/config`. The resolver is
        // the same process shape, so it mirrors that bootstrap line for line.
        const
            calls      = [],
            execFileFn = (file, args, options, callback) => {
                calls.push({args, options});
                callback(null, JSON.stringify({fleetPlaneBase: 'http://127.0.0.1:3102'}), '')
            },
            resolved   = await resolveBrainPaths({env: {NEO_FLEET_PLANE_BASE: 'http://127.0.0.1:3102'}, execFileFn, repoRoot: workDir}),
            [{args, options}] = calls;

        expect(resolved).toEqual({fleetPlaneBase: 'http://127.0.0.1:3102'});
        expect(args.slice(0, 2)).toEqual(['--input-type=module', '-e']);
        expect(args[2].split('\n').slice(0, 5)).toEqual([
            "import 'dotenv/config';",
            "import Neo from 'neo.mjs/src/Neo.mjs';",
            "import * as core from 'neo.mjs/src/core/_export.mjs';",
            "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
            "import AiConfig from './ai/config.mjs';"
        ]);
        expect(args[2]).not.toMatch(/from '\.\/src\//);
        expect(options.cwd).toBe(workDir);
        expect(options.env.NEO_FLEET_PLANE_BASE).toBe('http://127.0.0.1:3102');
    });

    test('resolveBrainPaths rejects with the child\'s stderr on failure and names non-JSON output', async () => {
        const failing = (file, args, options, callback) => callback(new Error('exit 1'), '', 'ERR_MODULE_NOT_FOUND: src/Neo.mjs'),
              garbled = (file, args, options, callback) => callback(null, 'not json', '');

        await expect(resolveBrainPaths({execFileFn: failing, repoRoot: workDir})).rejects.toThrow(/config resolver failed: ERR_MODULE_NOT_FOUND/);
        await expect(resolveBrainPaths({execFileFn: garbled, repoRoot: workDir})).rejects.toThrow(/non-JSON: not json/);
    });

    test('resolveBrainPaths resolves every supervised leaf against a real Brain root (NEO_AGENTOS_RUNTIME_ROOT)', async () => {
        test.skip(!process.env.NEO_AGENTOS_RUNTIME_ROOT, 'live arm: set NEO_AGENTOS_RUNTIME_ROOT to an installed Brain checkout');

        const resolved = await resolveBrainPaths({repoRoot: resolveAgentOsRuntimeRoot(process.env)});

        expect(Object.keys(resolved).sort()).toEqual([
            'backupPath', 'chromaDataDir', 'chromaPort', 'dbPath', 'fleetAgentsRoot', 'fleetDataDir', 'fleetPlaneBase', 'orchestratorDataDir'
        ]);
        expect(path.isAbsolute(resolved.dbPath)).toBe(true);
        expect(Number.isInteger(Number(resolved.chromaPort))).toBe(true);
    });

    test('Fleet contracts keep the public product and private runtime roots independent, cache both, and support the explicit packaged same-root case', async () => {
        const
            productA = path.join(workDir, 'product-a'),
            productB = path.join(workDir, 'product-b'),
            runtimeA = path.join(workDir, 'runtime-a'),
            runtimeB = path.join(workDir, 'runtime-b'),
            packaged = path.join(workDir, 'packaged');

        for (const root of [productA, productB]) writeFleetRootFixture(root, {product: true});
        for (const root of [runtimeA, runtimeB]) writeFleetRootFixture(root, {runtime: true});
        writeFleetRootFixture(packaged, {product: true, runtime: true});

        const first = loadFleetRuntimeContracts({productRoot: productA, runtimeRoot: runtimeA});

        expect(loadFleetRuntimeContracts({productRoot: productA, runtimeRoot: runtimeA})).toBe(first);

        const contracts = await first;

        expect(contracts.FLEET_WIRE_METHODS).toEqual(['product-a']);
        expect(contracts.FLEET_CREDENTIAL_METHODS).toEqual(['runtime-a']);
        expect(contracts.resolveFleetBearer()).toBe('runtime-a');
        expect(contracts.normalizeAgentIdentityNodeId('@viewer')).toBe('@viewer');

        const otherProduct = await loadFleetRuntimeContracts({productRoot: productB, runtimeRoot: runtimeA});
        const otherRuntime = await loadFleetRuntimeContracts({productRoot: productA, runtimeRoot: runtimeB});

        expect(otherProduct.FLEET_WIRE_METHODS).toEqual(['product-b']);
        expect(otherProduct.FLEET_CREDENTIAL_METHODS).toEqual(['runtime-a']);
        expect(otherRuntime.FLEET_WIRE_METHODS).toEqual(['product-a']);
        expect(otherRuntime.FLEET_CREDENTIAL_METHODS).toEqual(['runtime-b']);

        const assembled = await loadFleetRuntimeContracts({productRoot: packaged, runtimeRoot: packaged});

        expect(assembled.FLEET_WIRE_METHODS).toEqual(['packaged']);
        expect(assembled.FLEET_CREDENTIAL_METHODS).toEqual(['packaged'])
    });

    test('Fleet contract roots reject omission, relative values, swapping and a missing installed public entry without using the runtime vocabulary', async () => {
        const
            productRoot = path.join(workDir, 'product'),
            runtimeRoot = path.join(workDir, 'runtime');

        writeFleetRootFixture(productRoot, {product: true});
        writeFleetRootFixture(runtimeRoot, {runtime: true});

        expect(() => loadFleetRuntimeContracts({runtimeRoot})).toThrow(/absolute productRoot/);
        expect(() => loadFleetRuntimeContracts({productRoot})).toThrow(/absolute runtimeRoot/);
        expect(() => loadFleetRuntimeContracts({productRoot: 'relative', runtimeRoot})).toThrow(/absolute productRoot/);
        expect(() => loadFleetRuntimeContracts({productRoot, runtimeRoot: 'relative'})).toThrow(/absolute runtimeRoot/);

        await expect(loadFleetRuntimeContracts({productRoot: runtimeRoot, runtimeRoot: productRoot}))
            .rejects.toMatchObject({code: 'ERR_MODULE_NOT_FOUND'});
        await expect(loadFleetRuntimeContracts({productRoot: path.join(workDir, 'missing'), runtimeRoot}))
            .rejects.toMatchObject({code: 'ERR_MODULE_NOT_FOUND'})
    });

    test('buildBrainProfile binds every mutable path under the isolation root and gates every side lane off', () => {
        const profile = buildBrainProfile({chromaPort: 18500, fleetPort: 18501, isolationRoot: workDir});

        for (const leafName of ['NEO_AI_DB_PATH', 'NEO_AI_ORCHESTRATOR_DIR', 'NEO_BACKUP_PATH', 'NEO_CHROMA_DATA_DIR_TEST', 'NEO_FLEET_AGENTS_ROOT', 'NEO_FLEET_DATA_DIR', 'NEO_REM_RUN_STATE_DIR']) {
            expect(profile[leafName].startsWith(workDir + path.sep)).toBe(true)
        }

        expect(profile.UNIT_TEST_MODE).toBe('1');
        expect(profile.NEO_CHROMA_PORT_TEST).toBe('18500');
        expect(profile.NEO_FLEET_PLANE_BASE).toBe('');
        expect(profile.NEO_FLEET_PLANE_BEARER).toBe('');
        expect(profile.NEO_FLEET_PORT).toBe('18501');

        // Every gate leaf is OFF — an ungated port-bearing task can reap live listeners
        // (ProcessSupervisorService.reconcileSingletonPort), so this list is a safety contract.
        const gates = Object.entries(profile).filter(([name]) => name.endsWith('_ENABLED'));

        expect(gates.map(([name]) => name).sort()).toEqual([
            'NEO_DEPLOYMENT_STATE_BRIDGE_ENABLED',
            'NEO_ORCHESTRATOR_CORPUS_PROJECTION_ENABLED',
            'NEO_ORCHESTRATOR_DEV_SERVER_ENABLED',
            'NEO_ORCHESTRATOR_EMBED_DAEMON_ENABLED',
            'NEO_ORCHESTRATOR_GOLDEN_PATH_REPO_ENRICHMENT_ENABLED',
            'NEO_ORCHESTRATOR_GRAPHLOG_COMPACTION_ENABLED',
            'NEO_ORCHESTRATOR_KB_SYNC_ENABLED',
            'NEO_ORCHESTRATOR_LMS_ENABLED',
            'NEO_ORCHESTRATOR_MESSAGE_DAEMON_ENABLED',
            'NEO_ORCHESTRATOR_MLX_ENABLED',
            'NEO_ORCHESTRATOR_NL_BRIDGE_ENABLED',
            'NEO_ORCHESTRATOR_OLLAMA_ENABLED',
            'NEO_ORCHESTRATOR_PRIMARY_DEV_SYNC_ENABLED',
            'NEO_ORCHESTRATOR_SWARM_HEARTBEAT_ENABLED'
        ]);
        gates.forEach(([, value]) => expect(value).toBe('0'))
    });

    test('a diagnostic run roots itself in the per-user temp dir when packaged, stable across runs', () => {
        const
            harnessDir = '/checkout/harness',
            tempDir    = path.join(tmpdir(), 'user-temp');

        // packaged: the temp dir, never derived from userData; the same path every run, so the sweep finds a crashed run
        expect(resolveSmokeRoot({env: {}, harnessDir, packaged: true, tempDir})).toBe(path.join(tempDir, 'neo-harness-smoke'));
        expect(resolveSmokeRoot({env: {}, harnessDir, packaged: true, tempDir})).toBe(resolveSmokeRoot({env: {}, harnessDir, packaged: true, tempDir}));
        // checkout: the gitignored `.brain/smoke` beside the harness
        expect(resolveSmokeRoot({env: {}, harnessDir, packaged: false, tempDir})).toBe(path.join(harnessDir, '.brain', 'smoke'));
        // an explicit root wins in both modes
        expect(resolveSmokeRoot({env: {NEO_HARNESS_BRAIN_ROOT: '/pinned'}, harnessDir, packaged: true, tempDir})).toBe('/pinned');
        expect(resolveSmokeRoot({env: {NEO_HARNESS_BRAIN_ROOT: '/pinned'}, harnessDir, packaged: false, tempDir})).toBe('/pinned')
    });

    test('a refusal beside a running plane is typed, and only it names a cause', () => {
        const refusal = besidePlaneRefusal(8000);

        expect(refusal.message).toContain('a plane already runs on this machine (Chroma holds localhost:8000)');
        expect(bootFailureCause(refusal)).toEqual({detail: 'Chroma holds localhost:8000', source: 'organism-beside-plane'});
        expect(bootFailureCause(new Error('fleet port 8083 cannot be reused')), 'any other failure stays generic').toBeNull();
        expect(bootFailureCause(null)).toBeNull()
    });

    test('a plane refusal quotes the fleet child\'s last line, bounded, and never one that carries a secret', () => {
        const
            line    = '[fleet] plane mode refused (http://127.0.0.1:3102): plane identity mismatch — fix fleet.planeBase / fleet.planeBearer, or empty the base for in-process mode.',
            refusal = planeRefusal(line, ['fleet-bearer-secret']);

        expect(refusal.code).toBe('plane-refused');
        expect(refusal.detail).toBe(line);
        expect(refusal.message).toContain('plane identity mismatch');
        expect(bootFailureCause(refusal)).toEqual({detail: line, source: 'plane-refused'});
        expect(planeRefusal('x'.repeat(500)).detail).toHaveLength(PLANE_REFUSAL_DETAIL_MAX);
        expect(planeRefusal('Authorization: Bearer fleet-bearer-secret', ['fleet-bearer-secret']).detail, 'a line carrying a secret is dropped, not shown').toBeNull();
        expect(planeRefusal(null).detail).toBeNull()
    });

    test('only a plane-attach fleet child that exited before ready is a plane refusal, quoted once its output has closed', async () => {
        const failure = new Error('fleet transport exited before ready (code=1 signal=null)');

        await expect(fleetReadyOrPlaneRefusal({awaitReady: async () => {}, child: createFakeChild(), lastLine: () => null, mode: 'plane-attach'})).resolves.toBeUndefined();

        const ownMode = createFakeChild();

        ownMode.exitCode = 1;
        await expect(fleetReadyOrPlaneRefusal({awaitReady: async () => { throw failure }, child: ownMode, lastLine: () => 'x', mode: 'own'}), 'another mode keeps its own error').rejects.toBe(failure);

        const timeout = new Error('fleet transport did not become ready within 15000ms');

        await expect(fleetReadyOrPlaneRefusal({awaitReady: async () => { throw timeout }, child: createFakeChild(), lastLine: () => 'x', mode: 'plane-attach'}), 'a child still alive keeps its own error').rejects.toBe(timeout);

        // The refusal line lands on the output streams after `exit`: it is quoted only once `close` says they drained.
        const refused = createFakeChild();
        let last = null;

        refused.stdout.on('data', chunk => { last = String(chunk).trim() });

        const pending = fleetReadyOrPlaneRefusal({
            awaitReady: async () => { refused.exit(1); throw failure },
            child     : refused,
            drainMs   : 5000,
            lastLine  : () => last,
            mode      : 'plane-attach'
        });

        await new Promise(resolve => setTimeout(resolve, 20));
        refused.emitLine('[fleet] plane mode refused (http://127.0.0.1:3102): plane identity mismatch');
        refused.emit('close', 1, null);

        await expect(pending).rejects.toMatchObject({code: 'plane-refused', detail: '[fleet] plane mode refused (http://127.0.0.1:3102): plane identity mismatch'});

        const silent = createFakeChild();

        await expect(fleetReadyOrPlaneRefusal({
            awaitReady: async () => { silent.exit(1); throw failure },
            child     : silent,
            drainMs   : 20,
            lastLine  : () => null,
            mode      : 'plane-attach'
        }), 'an output that never closes is waited for a bounded time').rejects.toMatchObject({code: 'plane-refused', detail: null})
    });

    test('resolveProductBrainPlan: a declared plane outranks host liveness and can start only Fleet', () => {
        // Port 1 is intentionally unreachable. The classifier never probes it: declaration selects
        // topology, while the spawned Fleet transport owns authenticated readiness and refusal.
        expect(resolveProductBrainPlan({
            fleetServing     : false,
            orchestratorAlive: false,
            planeBase        : '  http://127.0.0.1:1  '
        })).toEqual({
            mode             : 'plane-attach',
            planeBase        : 'http://127.0.0.1:1',
            startFleet       : true,
            startOrchestrator: false
        });

        expect(resolveProductBrainPlan({
            fleetServing     : true,
            orchestratorAlive: true,
            planeBase        : 'http://127.0.0.1:3102'
        })).toEqual({
            mode             : 'plane-attach',
            planeBase        : 'http://127.0.0.1:3102',
            startFleet       : false,
            startOrchestrator: false
        })
    });

    test('resolveProductBrainPlan: without a plane, host liveness selects attach else own', () => {
        expect(resolveProductBrainPlan({
            fleetServing     : false,
            orchestratorAlive: true,
            planeBase        : ''
        })).toEqual({mode: 'attach', planeBase: null, startFleet: true, startOrchestrator: false});

        expect(resolveProductBrainPlan({
            fleetServing     : false,
            orchestratorAlive: false,
            planeBase        : '   '
        })).toEqual({mode: 'own', planeBase: null, startFleet: true, startOrchestrator: true})
    });

    test('assertIsolatedProfile passes an isolated resolution and names every escape', () => {
        const isolated = {
            backupPath         : path.join(workDir, 'backups'),
            chromaDataDir      : path.join(workDir, 'chroma'),
            chromaPort         : 18500,
            dbPath             : path.join(workDir, 'sqlite', 'memory-core-graph.sqlite'),
            fleetAgentsRoot    : path.join(workDir, 'fleet', 'agents'),
            fleetDataDir       : path.join(workDir, 'fleet'),
            orchestratorDataDir: path.join(workDir, 'orchestrator')
        };

        expect(assertIsolatedProfile({chromaPort: 18500, isolationRoot: workDir, resolved: isolated})).toEqual([]);

        const leaky = assertIsolatedProfile({
            chromaPort   : 18500,
            isolationRoot: workDir,
            resolved     : {...isolated, chromaPort: 8000, dbPath: '.neo-ai-data/sqlite/memory-core-graph.sqlite'}
        });

        expect(leaky.some(violation => violation.includes('dbPath'))).toBe(true);
        expect(leaky.some(violation => violation.includes('chromaPort'))).toBe(true);
        expect(leaky).toHaveLength(2)
    });

    test('the installed profile leaves the agents\' seats on the Brain\'s per-user default, outside its data root and backups', async () => {
        const
            env      = buildPackagedBrainEnv({backupRoot: path.join(workDir, 'backups'), dataRoot: path.join(workDir, 'brain')}),
            // an operator's own NEO_FLEET_AGENTS_ROOT would win; unset here, so the Brain's leaf default answers
            resolved = await resolveBrainPaths({env: {...env, NEO_FLEET_AGENTS_ROOT: undefined, UNIT_TEST_MODE: ''}, repoRoot: resolveAgentOsRuntimeRoot(process.env)});

        expect(Object.hasOwn(env, 'NEO_FLEET_AGENTS_ROOT')).toBe(false);
        expect(resolved.fleetAgentsRoot).toBe(path.join(homedir(), '.neo-ai', 'agents'))
    });

    test('Fleet durable storage is isolated separately from the seat working-tree root', async () => {
        const profiles = [
            // the packaged smoke contains its seats the way main.mjs builds it
            {...buildPackagedBrainEnv({agentsRoot: path.join(workDir, 'fleet', 'agents'), backupRoot: path.join(workDir, 'backups'), dataRoot: workDir}), UNIT_TEST_MODE: ''},
            buildBrainProfile({chromaPort: 18500, fleetPort: 18501, isolationRoot: workDir})
        ];

        for (const env of profiles) {
            const resolved = await resolveBrainPaths({repoRoot: resolveAgentOsRuntimeRoot(process.env), env});
            expect(resolved.fleetDataDir).toBe(path.join(workDir, 'fleet'));
            expect(resolved.fleetAgentsRoot).toBe(path.join(workDir, 'fleet', 'agents'));
            expect(assertIsolatedProfile({resolved, isolationRoot: workDir, chromaPort: resolved.chromaPort})).toEqual([]);

            for (const fleetDataDir of [undefined, path.join(workDir, '..', 'outside-fleet')]) {
                expect(assertIsolatedProfile({
                    resolved: {...resolved, fleetDataDir}, isolationRoot: workDir, chromaPort: resolved.chromaPort
                })).toEqual([expect.stringContaining('fleetDataDir=')]);
            }
        }
    });

    /**
     * @summary Runs the Brain's own boot check, `collectPlaneMembers` + `assertPlaneMemberCoherence`,
     * in the Brain root: Tier-1 on its own, and each MCP server's members together with the Tier-1
     * members it inherits, the way `BaseServer#collectMemberEntries` composes them. No `.env` is
     * loaded, so only the env handed in can place a member.
     * @param {Object} env Merged over process.env by `runBrainScript`; an `undefined` value unsets a key.
     * @returns {Promise<Object>} `{dataRoot, results: [{name, ok, count?, error?}]}`
     */
    const runPlaneMemberCheck = env => {
        const script = [
            "import Neo from 'neo.mjs/src/Neo.mjs';",
            "import * as core from 'neo.mjs/src/core/_export.mjs';",
            "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
            "import AiConfig from './ai/config.template.mjs';",
            "import Tier1Base, {PLANE_MEMBER_PATHS as TIER1_PATHS} from './ai/configBase.mjs';",
            "import {assertPlaneMemberCoherence, collectPlaneMembers} from './ai/planeConfig.mjs';",
            "const results = [];",
            "const members = (memberPaths, resolvedConfig, descriptorData) => collectPlaneMembers({memberPaths, resolvedConfig, descriptorData});",
            "const check = (name, list) => {",
            "    try { assertPlaneMemberCoherence({dataRoot: AiConfig.plane.dataRoot, members: list}); results.push({name, ok: true, count: list.length}) }",
            "    catch (error) { results.push({name, ok: false, error: error.message}) }",
            "};",
            "check('tier-1', members(TIER1_PATHS, AiConfig, Tier1Base.config.data));",
            "for (const server of ['memory-core', 'knowledge-base', 'neural-link']) {",
            "    const config = (await import(`./ai/mcp/server/${server}/config.template.mjs`)).default,",
            "          base   = await import(`./ai/mcp/server/${server}/configBase.mjs`);",
            "    check(server, [...members(base.PLANE_MEMBER_PATHS, config, base.default.config.data), ...members(TIER1_PATHS, config, Tier1Base.config.data)]);",
            "}",
            "process.stdout.write(JSON.stringify({dataRoot: AiConfig.plane.dataRoot, deploymentMode: AiConfig.orchestrator.deploymentMode, results}));"
        ].join('\n');

        return runBrainScript({env, label: 'plane member check', repoRoot: resolveAgentOsRuntimeRoot(process.env), script})
    };

    test('the packaged profile relocates the plane and places every member the Brain declares, so the Brain\'s own boot check passes for all four config bases (#347)', async () => {
        const
            env     = {...buildPackagedBrainEnv({backupRoot: path.join(workDir, 'backups'), dataRoot: workDir}), UNIT_TEST_MODE: ''},
            checked = await runPlaneMemberCheck(env);

        expect(checked.dataRoot, 'the plane itself moved to the data root').toBe(workDir);
        expect(checked.deploymentMode, 'the localOnly lanes (Chroma, the embed and message daemons) run').toBe('local');
        expect(checked.results.map(({name, ok, error}) => ({name, ok, error}))).toEqual(
            ['tier-1', 'memory-core', 'knowledge-base', 'neural-link'].map(name => ({name, ok: true, error: undefined}))
        );
        expect(env.NEO_MEMORY_DB_PATH, 'the memory-core graph is the orchestrator\'s file, never a second one').toBe(env.NEO_AI_DB_PATH);

        // the control: one member left on its build-time default fails boot, and names itself
        env.NEO_MEMORY_DB_PATH = undefined;

        const {results} = await runPlaneMemberCheck(env);

        expect(results.find(result => result.name === 'memory-core')).toMatchObject({ok: false, error: expect.stringContaining('storagePaths.graphProd')});
        expect(results.find(result => result.name === 'tier-1').ok, 'the other bases stay placed').toBe(true)
    });

    test('the product\'s backups resolve beside its plane, never beneath it, in the Brain\'s own resolution', async () => {
        const
            dataRoot   = path.join(workDir, 'brain'),
            backupRoot = path.join(workDir, 'backups'),
            resolved   = await resolveBrainPaths({env: {...buildPackagedBrainEnv({backupRoot, dataRoot}), UNIT_TEST_MODE: ''}, repoRoot: resolveAgentOsRuntimeRoot(process.env)});

        expect(resolved.backupPath).toBe(backupRoot);
        expect(path.relative(dataRoot, resolved.backupPath).startsWith('..'), 'whatever removes the plane root must not remove the bundles that restore it (ADR 0019 §10.9)').toBe(true)
    });

    // Isolation is a filesystem-IDENTITY contract: a symlinked ancestor inside the root satisfies
    // a lexical prefix check while the data lands outside. The containment must resolve links.
    test('assertIsolatedProfile flags a symlinked ancestor escaping the root by identity', async () => {
        const outside = await mkdtemp(path.join(tmpdir(), 'neo-harness-outside-'));

        try {
            const isolated = {
                backupPath         : path.join(workDir, 'backups'),
                chromaDataDir      : path.join(workDir, 'chroma'),
                chromaPort         : 18500,
                dbPath             : path.join(workDir, 'sqlite', 'memory-core-graph.sqlite'),
                fleetAgentsRoot    : path.join(workDir, 'fleet', 'agents'),
                fleetDataDir       : path.join(workDir, 'fleet'),
                orchestratorDataDir: path.join(workDir, 'orchestrator')
            };

            // The lexical form is identical before and after; only the identity changes.
            expect(assertIsolatedProfile({chromaPort: 18500, isolationRoot: workDir, resolved: isolated})).toEqual([]);

            await symlink(outside, path.join(workDir, 'sqlite'));

            const violations = assertIsolatedProfile({chromaPort: 18500, isolationRoot: workDir, resolved: isolated});

            expect(violations.some(violation => violation.includes('dbPath'))).toBe(true);
            await symlink(outside, path.join(workDir, 'fleet'));
            expect(assertIsolatedProfile({chromaPort: 18500, isolationRoot: workDir, resolved: isolated})
                .some(violation => violation.includes('fleetDataDir'))).toBe(true);
            // realpath both sides: os.tmpdir() itself sits behind a symlink on macOS (/var → /private/var).
            expect(resolveRealPath(isolated.dbPath).startsWith(resolveRealPath(outside))).toBe(true)
        } finally {
            await rm(outside, {force: true, recursive: true})
        }
    });

    test('probeFleetServing reuses only the canonical same-bearer, same-viewer probe', async () => {
        const fetchFn = async (url, init) => {
            expect(url).toContain('/fleet/probe');
            expect(url).not.toContain(bearerToken);
            expect(init.headers.Authorization).toBe(`Bearer ${bearerToken}`);
            return {ok: true, status: 200, json: async () => ({result: {agentIdentityNodeId, pid: 7}})}
        };

        const admitted = await probeFleetServing({productRoot, agentIdentityNodeId, bearerToken, fetchFn, port: 1});

        expect(admitted).toEqual({reusable: true, reason: 'same token, same viewer', viewer: agentIdentityNodeId, pid: 7});

        const wrongBearer = await probeFleetServing({
            productRoot,
            agentIdentityNodeId,
            bearerToken,
            fetchFn: async () => ({ok: false, status: 401}),
            port   : 1
        });

        expect(wrongBearer.reusable).toBe(false);
        expect(wrongBearer.reason).toContain('rejected our bearer');

        const wrongViewer = await probeFleetServing({
            productRoot,
            agentIdentityNodeId,
            bearerToken,
            fetchFn: async () => ({ok: true, status: 200, json: async () => ({result: {agentIdentityNodeId: '@other', pid: 8}})}),
            port   : 1
        });

        expect(wrongViewer.reusable).toBe(false);
        expect(wrongViewer.reason).toContain('wrong-viewer')
    });

    test('awaitReadyMarker resolves on the marker and never on PID existence alone', async () => {
        const
            child = createFakeChild(),
            ready = awaitReadyMarker({child, label: 'orchestrator', marker: '[Orchestrator] Started.', timeoutMs: 2000});

        let settled = false;

        ready.then(() => { settled = true });

        // PID-file-era false readiness: lines flow, process exists — not ready yet.
        child.emitLine('[2026-07-10T20:00:00.000Z] [PID:4242] [INFO] [Orchestrator] Found existing instance');
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(settled).toBe(false);

        child.emitLine('[2026-07-10T20:00:01.000Z] [PID:4242] [INFO] [Orchestrator] Started. summaryInterval=1000ms');
        await expect(ready).resolves.toBeUndefined()
    });

    test('awaitOrchestratorReady rejects deterministically on early exit', async () => {
        const
            child = createFakeChild(),
            ready = awaitOrchestratorReady({child, timeoutMs: 2000});

        child.exit(1);
        await expect(ready).rejects.toThrow(/exited before ready \(code=1/)
    });

    test('awaitReadyMarker rejects on spawn error and on an already-exited child', async () => {
        const errored = createFakeChild();
        const ready   = awaitReadyMarker({child: errored, label: 'orchestrator', marker: 'never', timeoutMs: 2000});

        errored.emit('error', new Error('ENOENT'));
        await expect(ready).rejects.toThrow(/failed to spawn: ENOENT/);

        const dead = createFakeChild();

        dead.exitCode = 127;
        await expect(awaitReadyMarker({child: dead, label: 'fleet', marker: 'never', timeoutMs: 2000}))
            .rejects.toThrow(/exited before ready \(code=127/)
    });

    test('awaitReadyMarker rejects on timeout', async () => {
        const child = createFakeChild();

        await expect(awaitReadyMarker({child, label: 'orchestrator', marker: 'never-emitted', timeoutMs: 120}))
            .rejects.toThrow(/not ready within 120ms/)
    });

    test('awaitFleetReady polls through failures and refuses a legacy ok:true envelope', async () => {
        const child = createFakeChild();

        let calls = 0;

        const fetchFn = async (url, init) => {
            calls++;
            expect(url).toContain('/fleet');
            expect(url).not.toContain(bearerToken);
            expect(init.headers.Authorization).toBe(`Bearer ${bearerToken}`);
            expect(JSON.parse(init.body)).toMatchObject({
                method  : 'listAgents',
                protocol: {versions: [1]}
            });

            if (calls < 3) {
                throw new Error('ECONNREFUSED')
            }

            if (calls === 3) {
                return {json: async () => ({ok: true, result: []})}
            }

            return {
                json: async () => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result: []})
            }
        };

        await expect(awaitFleetReady({productRoot, bearerToken, child, fetchFn, port: 18501, timeoutMs: 5000})).resolves.toBeUndefined();
        expect(calls).toBeGreaterThanOrEqual(4)
    });

    test('awaitFleetReady rejects when the transport child dies first', async () => {
        const
            child = createFakeChild(),
            ready = awaitFleetReady({productRoot, bearerToken, child, fetchFn: async () => { throw new Error('ECONNREFUSED') }, port: 18501, timeoutMs: 5000});

        child.exit(1);
        await expect(ready).rejects.toThrow(/fleet transport exited before ready/)
    });

    test('awaitFleetReady fails closed when the authoritative wire contract cannot load', async () => {
        const
            child    = createFakeChild(),
            repoRoot = await mkdtemp(path.join(tmpdir(), 'neo-fleet-wire-missing-'));

        await rm(repoRoot, {recursive: true});

        await expect(awaitFleetReady({
            productRoot,
            bearerToken,
            child,
            fetchFn  : async () => { throw new Error('fetch must not run') },
            port     : 18501,
            repoRoot,
            timeoutMs: 5000
        })).rejects.toThrow(/fleet wire contract unavailable/)
    });

    // SIGINT is the graceful rung by measurement: the chromadb npm wrapper ignores group-SIGTERM
    // indefinitely but exits on SIGINT in milliseconds; every supervised entry handles both.
    test('stopBrainChild settles the graceful group path: SIGINT only, group empty, never forced', async () => {
        const
            child = createFakeChild({pid: 5001}),
            group = createFakeGroup({diesOn: ['SIGINT'], pid: 5001}),
            stop  = await stopBrainChild(child, {graceMs: 500, killFn: group.killFn, pollMs: 20});

        expect(stop).toEqual({exited: true, forced: false, groupEmpty: true});
        expect(group.signals).toEqual(['SIGINT'])
    });

    test('stopBrainChild escalates a SIGINT-ignoring group to SIGKILL and reports forced', async () => {
        const
            child = createFakeChild({pid: 5002}),
            group = createFakeGroup({diesOn: ['SIGKILL'], pid: 5002}),
            stop  = await stopBrainChild(child, {graceMs: 100, killFn: group.killFn, pollMs: 20});

        expect(stop).toEqual({exited: true, forced: true, groupEmpty: true});
        expect(group.signals).toEqual(['SIGINT', 'SIGKILL'])
    });

    test('stopBrainChild is idempotent: a second stop of a dead group settles immediately', async () => {
        const
            child = createFakeChild({pid: 5003}),
            group = createFakeGroup({diesOn: ['SIGINT'], pid: 5003});

        await stopBrainChild(child, {graceMs: 500, killFn: group.killFn, pollMs: 20});

        const again = await stopBrainChild(child, {graceMs: 500, killFn: group.killFn, pollMs: 20});

        expect(again).toEqual({exited: true, forced: false, groupEmpty: true});
        expect(group.signals).toEqual(['SIGINT'])
    });

    test('stopBrainTree stops the consumer (fleet) before the organism (orchestrator)', async () => {
        const
            order        = [],
            orchestrator = createFakeChild({pid: 6001}),
            fleet        = createFakeChild({pid: 6002}),
            groups       = {
                6001: createFakeGroup({diesOn: ['SIGINT'], pid: 6001}),
                6002: createFakeGroup({diesOn: ['SIGINT'], pid: 6002})
            },
            killFn = (target, signal) => {
                const pid = Math.abs(target);

                signal === 'SIGINT' && order.push(pid);
                return groups[pid].killFn(target, signal)
            },
            report = await stopBrainTree([
                {child: orchestrator, label: 'orchestrator'},
                {child: fleet,        label: 'fleet'}
            ], {graceMs: 500, killFn, pollMs: 20});

        expect(order).toEqual([6002, 6001]);
        expect(report.fleet.groupEmpty).toBe(true);
        expect(report.orchestrator.groupEmpty).toBe(true)
    });

    test('startBrainChild exposes an absolute checkout entry and per-spawn argv identity', () => {
        let invocation;

        const child = startBrainChild({
            entry           : ORCHESTRATOR_ENTRY,
            ownershipTokenFn: () => 'spawn-token-a',
            repoRoot        : workDir,
            spawnFn         : (command, args, options) => {
                invocation = {args, command, options};
                return createFakeChild()
            }
        });
        const absoluteEntry = path.join(workDir, ORCHESTRATOR_ENTRY);

        expect(invocation.args).toEqual(['--import', OWNER_MARKER_STRIP, absoluteEntry, '--neo-harness-owner=spawn-token-a']);
        expect(invocation.options.cwd).toBe(workDir);
        expect(invocation.options.detached).toBe(true);
        expect(child.neoHarnessIdentity).toEqual({entry: absoluteEntry, ownershipToken: 'spawn-token-a'})
    });

    // The Memory Core's commander refuses an unknown option, so the entry must never see the marker,
    // while the sweep still reads it right after the entry.
    test('a real child never sees its owner marker, and ps still shows it after the entry', async () => {
        writeFileSync(path.join(workDir, 'entry.mjs'), 'process.stdout.write(JSON.stringify(process.argv.slice(2))); setTimeout(() => {}, 5000)');

        const
            child   = startBrainChild({entry: 'entry.mjs', ownershipTokenFn: () => 'marker-token', repoRoot: workDir}),
            [argv]  = await once(child.stdout, 'data'),
            command = execFileSync('ps', ['-o', 'command=', '-p', String(child.pid)], {encoding: 'utf8'});

        try {
            expect(JSON.parse(String(argv))).toEqual([]);
            expect(command).toContain(`${path.join(workDir, 'entry.mjs')} --neo-harness-owner=marker-token`)
        } finally {
            await stopBrainChild(child, {graceMs: 1000})
        }
    });

    test('startBrainChild rejects entries outside its checkout root', () => {
        expect(() => startBrainChild({
            entry           : path.join('..', 'sibling', ORCHESTRATOR_ENTRY),
            ownershipTokenFn: () => 'spawn-token-a',
            repoRoot        : workDir,
            spawnFn         : () => createFakeChild()
        })).toThrow(/entry must resolve inside repoRoot/)
    });

    // A bare PGID OR program name is not ownership: ids are recycled and every checkout runs the
    // same scripts. Cleanup requires this checkout's absolute entry AND this spawn's argv token.
    test('run-state sweep requires exact checkout + spawn identity, skips recycled pids, clears state', () => {
        const
            group        = createFakeGroup({diesOn: ['SIGKILL'], pid: 7001}),
            ownedEntry   = path.join(workDir, ORCHESTRATOR_ENTRY),
            siblingEntry = path.join(workDir + '-sibling', ORCHESTRATOR_ENTRY);

        writeRunState({
            children     : [
                {entry: ownedEntry, ownershipToken: 'owned-token', pgid: 7001},
                {entry: ownedEntry, ownershipToken: 'owned-token', pgid: 7002},
                {entry: ownedEntry, ownershipToken: 'owned-token', pgid: 7003},
                {entry: ownedEntry, pgid: 7004},
                {entry: ownedEntry, ownershipToken: 'owned-token', pgid: 7005},
                {entry: ownedEntry, ownershipToken: 'owned-token', pgid: 999999}
            ],
            isolationRoot: workDir
        });

        const killFn = (target, signal) => {
            if ([7002, 7003, 7004, 7005, 999999].includes(Math.abs(target))) {
                if (Math.abs(target) !== 999999 && signal === 0) {
                    return true // alive — but identity will fail closed below
                }

                const error = new Error('ESRCH');
                error.code  = 'ESRCH';
                throw error
            }

            return group.killFn(target, signal)
        };

        const commandFn = pgid => ({
            7001: `node ${ownedEntry} --neo-harness-owner=owned-token`,
            7002: `node ${ownedEntry} --neo-harness-owner=later-spawn`,
            7003: `node ${siblingEntry} --neo-harness-owner=owned-token`,
            7004: `node ${ownedEntry}`,
            7005: `node /prefix${ownedEntry} --neo-harness-owner=owned-token`
        })[pgid] ?? '';

        // 7001 matches both identities. 7002 has a later token. 7003 is a sibling checkout.
        // 7004 is a legacy record without a token; 7005 only contains the entry as a suffix.
        // 999999 is dead. Only 7001 is signal-authorized.
        expect(sweepStaleRunState({commandFn, isolationRoot: workDir, killFn})).toEqual([7001]);
        expect(group.signals).toEqual(['SIGKILL']);
        expect(existsSync(path.join(workDir, 'run-state.json'))).toBe(false);

        // No state file → no-op.
        expect(sweepStaleRunState({commandFn, isolationRoot: workDir, killFn})).toEqual([])
    });

    test('run-state sweep clears malformed JSON without signaling', () => {
        const runStateFile = path.join(workDir, 'run-state.json');

        writeFileSync(runStateFile, '{not-json', 'utf8');
        expect(sweepStaleRunState({
            isolationRoot: workDir,
            killFn       : () => { throw new Error('must not signal') }
        })).toEqual([]);
        expect(existsSync(runStateFile)).toBe(false);

        writeFileSync(runStateFile, JSON.stringify({children: [null, 'legacy', {}]}), 'utf8');
        expect(sweepStaleRunState({isolationRoot: workDir})).toEqual([]);
        expect(existsSync(runStateFile)).toBe(false)
    });

    test('clearRunState removes the record after a clean stop and tolerates absence', () => {
        writeRunState({
            children: [{
                entry         : path.join(workDir, ORCHESTRATOR_ENTRY),
                ownershipToken: 'clean-token',
                pgid          : 7100
            }],
            isolationRoot: workDir
        });
        expect(existsSync(path.join(workDir, 'run-state.json'))).toBe(true);

        clearRunState({isolationRoot: workDir});
        expect(existsSync(path.join(workDir, 'run-state.json'))).toBe(false);

        clearRunState({isolationRoot: workDir}) // idempotent
    });

    test('detectLiveBrain: protocol identity drives attach; a foreign listener reads held-not-serving', async () => {
        const dataDir = path.join(workDir, 'orchestrator');

        mkdirSync(dataDir, {recursive: true});
        writeFileSync(path.join(dataDir, 'orchestrator-daemon.pid'), '8123', 'utf8');

        const live = await detectLiveBrain({
            productRoot,
            agentIdentityNodeId,
            bearerToken,
            commandFn          : () => `node ${ORCHESTRATOR_ENTRY}`,
            fleetPort          : 18501,
            killFn             : () => true,
            orchestratorDataDir: dataDir,
            probeFleetFn       : async options => {
                expect(options).toEqual({agentIdentityNodeId, bearerToken, port: 18501, productRoot});
                return {reusable: true, reason: 'same token, same viewer'}
            },
            probePortFn        : async () => true
        });

        expect(live).toEqual({
            fleetPortHeld     : true,
            fleetRefusalReason: null,
            fleetServing      : true,
            orchestratorAlive : true,
            orchestratorPid   : 8123
        });

        // A foreign HTTP server on the fleet port: occupied, but NOT the fleet protocol —
        // attach must not treat it as a reachable Brain surface.
        const squatted = await detectLiveBrain({
            productRoot,
            agentIdentityNodeId,
            bearerToken,
            commandFn          : () => `node ${ORCHESTRATOR_ENTRY}`,
            fleetPort          : 18501,
            killFn             : () => true,
            orchestratorDataDir: dataDir,
            probeFleetFn       : async () => ({reusable: false, reason: 'a process on the Fleet port rejected our bearer — refusing silent reuse'}),
            probePortFn        : async () => true
        });

        expect(squatted.fleetServing).toBe(false);
        expect(squatted.fleetPortHeld).toBe(true);
        expect(squatted.fleetRefusalReason).toContain('rejected our bearer');

        const unresolvedViewer = await detectLiveBrain({
            productRoot,
            agentIdentityNodeId: null,
            bearerToken,
            commandFn          : () => `node ${ORCHESTRATOR_ENTRY}`,
            fleetPort          : 18501,
            killFn             : () => true,
            orchestratorDataDir: dataDir,
            probeFleetFn       : probeFleetServing,
            probePortFn        : async () => true
        });

        expect(unresolvedViewer.fleetServing).toBe(false);
        expect(unresolvedViewer.fleetRefusalReason).toContain('canonical expected Fleet viewer');

        // A recycled pid running something else must NOT read as a live Brain.
        const foreign = await detectLiveBrain({
            productRoot,
            agentIdentityNodeId,
            bearerToken,
            commandFn          : () => '/usr/bin/some-other-tool',
            fleetPort          : 18501,
            killFn             : () => true,
            orchestratorDataDir: dataDir,
            probeFleetFn       : async () => { throw new Error('a free port must not be probed as an incumbent') },
            probePortFn        : async () => false
        });

        expect(foreign.orchestratorAlive).toBe(false);
        expect(foreign.fleetServing).toBe(false);
        expect(foreign.fleetPortHeld).toBe(false);

        // No PID file at all.
        const missing = await detectLiveBrain({
            productRoot,
            agentIdentityNodeId,
            bearerToken,
            fleetPort          : 18501,
            orchestratorDataDir: path.join(workDir, 'nowhere'),
            probeFleetFn       : async () => { throw new Error('a free port must not be probed as an incumbent') },
            probePortFn        : async () => false
        });

        expect(missing.orchestratorAlive).toBe(false)
    });

    test('allocatePort returns a free loopback port and probePort tracks its occupancy', async () => {
        const port = await allocatePort();

        expect(await probePort({port, timeoutMs: 500})).toBe(false);

        const server = net.createServer();

        await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
        expect(await probePort({port, timeoutMs: 500})).toBe(true);
        await new Promise(resolve => server.close(resolve));
        expect(await probePort({port, timeoutMs: 500})).toBe(false)
    });

    test('run-state file content carries the ownership token per group', () => {
        const entry = path.join(workDir, ORCHESTRATOR_ENTRY);

        writeRunState({
            children     : [{entry, ownershipToken: 'token-111', pgid: 111}],
            isolationRoot: workDir
        });

        expect(JSON.parse(readFileSync(path.join(workDir, 'run-state.json'), 'utf8')))
            .toEqual({children: [{entry, ownershipToken: 'token-111', pgid: 111}]})
    })
});

test.describe('registerOwnedChild — teardown ownership is unconditional; Brain observation routes by flag', () => {
    test('owner coverage is deterministic: observed AND unobserved children BOTH join the drain list', () => {
        const
            children = [],
            watched  = [],
            organism = new EventEmitter(),
            uiFleet  = new EventEmitter(),
            watch    = (child, label) => watched.push(label);

        registerOwnedChild({children, entry: {child: organism, label: 'orchestrator'}, watch});
        registerOwnedChild({children, entry: {child: uiFleet, label: 'fleet', observeBrain: false}, watch, onUnobservedExit: () => {}});

        // The cycle-1 falsifier's inverse, pinned: the drain list carries EVERY registered child
        // regardless of observation routing — ownership never narrows with the watcher.
        expect(children.map(entry => entry.label)).toEqual(['orchestrator', 'fleet']);
        expect(watched).toEqual(['orchestrator'])
    });

    test('an unobserved child\'s death reaches the diagnostic sink — and ONLY the sink', () => {
        const
            children = [],
            logged   = [],
            watched  = [],
            uiFleet  = new EventEmitter();

        registerOwnedChild({
            children,
            entry           : {child: uiFleet, label: 'fleet', observeBrain: false},
            onUnobservedExit: summary => logged.push(summary),
            watch           : (child, label) => watched.push(label)
        });

        uiFleet.emit('exit', null, 'SIGKILL');

        // Fault visibility WITHOUT health mutation: the sink names the child and the signal,
        // while the Brain-health watcher was never attached (a UI transport is not a Brain).
        expect(logged).toEqual(['fleet: exit signal SIGKILL']);
        expect(watched).toEqual([])
    });

    test('an observed child routes to the Brain watcher and never to the sink', () => {
        const
            children = [],
            logged   = [],
            watched  = [],
            organism = new EventEmitter();

        registerOwnedChild({
            children,
            entry           : {child: organism, label: 'orchestrator'},
            onUnobservedExit: summary => logged.push(summary),
            watch           : (child, label) => watched.push(label)
        });

        expect(watched).toEqual(['orchestrator']);
        expect(logged).toEqual([])
    })
});

test.describe('resolveUiFleetTransport — the reuse|spawn|foreign OWNER COMPOSITION is witnessed, not just its parts', () => {
    test('reuse: a canonical same-bearer listener is adopted — spawn and registration are NEVER invoked', async () => {
        const
            calls   = {registered: [], spawned: 0},
            outcome = [];

        const result = await resolveUiFleetTransport({
            productRoot,
            awaitReady    : async () => { throw new Error('awaitReady must not run on reuse') },
            bearerToken   : 'shell-held-bearer',
            fleetPort     : 18083,
            onOutcome     : line => outcome.push(line),
            probePortFn   : async () => true,
            probeServingFn: async () => ({reusable: true}),
            registerChild : entry => calls.registered.push(entry),
            spawn         : () => { calls.spawned++; throw new Error('spawn must not run on reuse') }
        });

        expect(result).toEqual({fleetPort: 18083, mode: 'reuse', up: true});
        expect(calls.spawned).toBe(0);
        expect(calls.registered).toEqual([]);
        expect(outcome).toEqual(['reuse fleetPort=18083'])
    });

    test('foreign listener: refusal is named, up stays false, the window path never throws — and nothing spawns', async () => {
        const
            calls   = {registered: [], spawned: 0},
            outcome = [];

        const result = await resolveUiFleetTransport({
            productRoot,
            awaitReady    : async () => { throw new Error('awaitReady must not run on foreign') },
            bearerToken   : 'shell-held-bearer',
            fleetPort     : 18083,
            onOutcome     : line => outcome.push(line),
            probePortFn   : async () => true,
            probeServingFn: async () => ({reusable: false, reason: 'bearer subject mismatch'}),
            registerChild : entry => calls.registered.push(entry),
            spawn         : () => { calls.spawned++; throw new Error('spawn must not run on foreign') }
        });

        // the refusal travels IN the outcome: the cockpit banner renders the named case, so the
        // shell log must not be the only place the reason exists
        expect(result).toEqual({fleetPort: 18083, mode: 'foreign-listener', reason: 'bearer subject mismatch', up: false});
        expect(calls.spawned).toBe(0);
        expect(calls.registered).toEqual([]);
        expect(outcome).toEqual(['foreign-listener fleetPort=18083 reason=bearer subject mismatch'])
    });

    test('spawn: the composition itself registers observeBrain:false and gates up:true on real readiness', async () => {
        const
            child    = new EventEmitter(),
            sequence = [],
            calls    = {registered: []};

        const result = await resolveUiFleetTransport({
            productRoot,
            awaitReady    : async ({bearerToken, port, productRoot: requestProductRoot, repoRoot}) => {
                expect(requestProductRoot).toBe(productRoot);
                expect(repoRoot).toBe('/fixture/runtime');
                sequence.push(`ready:${bearerToken}:${port}`)
            },
            bearerToken   : 'shell-held-bearer',
            fleetPort     : 18083,
            onOutcome     : line => sequence.push(line),
            probePortFn   : async () => false,
            probeServingFn: async () => { throw new Error('serving probe must not run on a free port') },
            registerChild : entry => { calls.registered.push(entry); sequence.push('registered') },
            repoRoot      : '/fixture/runtime',
            spawn         : ({fleetPort}) => { sequence.push(`spawn:${fleetPort}`); return child }
        });

        expect(result).toEqual({fleetPort: 18083, mode: 'spawn', up: true});
        // The cycle-1 invariant is wired IN the composition: ownership without Brain observation.
        expect(calls.registered).toEqual([{child, label: 'fleet', observeBrain: false}]);
        // Registration precedes readiness (an early quit must find the owner non-empty), and
        // readiness precedes the up:true outcome line.
        expect(sequence).toEqual(['spawn:18083', 'registered', 'ready:shell-held-bearer:18083', 'spawn fleetPort=18083'])
    })
});
