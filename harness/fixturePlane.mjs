import crypto          from 'node:crypto';
import fs              from 'node:fs';
import http            from 'node:http';
import path            from 'node:path';
import {pathToFileURL} from 'node:url';
import {allocatePort, awaitPortListening, runBrainScript, stopBrainChild} from './brain.mjs';
import {probePlaneCredential, writePlaneConfig}                           from './planeConfig.mjs';

/**
 * @module harness/fixturePlane
 * @summary The smoke's own plane (`NEO_HARNESS_SMOKE_PLANE=1`). The Brain's Memory Core runs from the
 * runtime root in `seat-token` mode on a loopback port, with every plane member it claims placed under
 * the smoke's isolation root, behind a loopback `/mc` ingress: the route every plane client composes.
 * One seat is minted, and the shell attaches the way the cockpit's attach does. The plane probe names
 * the seat's identity, and the record lands in the smoke's `userData` through an encryption stand-in
 * that lives only as long as the run, so no run touches the OS keychain.
 */

/**
 * @type {String}
 */
export const FIXTURE_PLANE_ENTRY = 'ai/mcp/server/memory-core/mcp-server.mjs';

/**
 * The fixture's seat. A plane binds a request only to an identity its graph holds, so the fixture seeds
 * this node before the plane boots.
 * @type {String}
 */
export const FIXTURE_IDENTITY = '@neo-harness-smoke';

/**
 * A second identity a held run's graph holds, so a walker can re-map the seat's token to another
 * account the plane can name (`walkControl token remap`).
 * @type {String}
 */
export const FIXTURE_REMAP_IDENTITY = '@neo-harness-smoke-remap';

/**
 * @type {String}
 */
export const FIXTURE_PLANE_ID = 'neo-harness-smoke';

/**
 * @summary An encryption stand-in with Electron `safeStorage`'s shape, bound to one run: AES-256-GCM
 * under a key that exists only in this process. The record on disk carries no readable bearer, and
 * nothing reaches the OS keychain.
 * @returns {{decryptString: Function, encryptString: Function, isEncryptionAvailable: Function}}
 */
export function createSmokeSafeStorage() {
    const key = crypto.randomBytes(32);

    return {
        decryptString(buffer) {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));

            decipher.setAuthTag(buffer.subarray(12, 28));
            return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8')
        },
        encryptString(text) {
            const
                iv     = crypto.randomBytes(12),
                cipher = crypto.createCipheriv('aes-256-gcm', key, iv),
                body   = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);

            return Buffer.concat([iv, cipher.getAuthTag(), body])
        },
        isEncryptionAvailable: () => true
    }
}

/**
 * @summary Places every plane member the Memory Core claims under one root: its own members and the
 * Tier-1 ones, the set its boot asserts (Brain `BaseServer.collectMemberEntries`). Each member's
 * default is rebased from the Brain's plane data root. A relocated plane must name every member, or
 * the server's coherence check refuses it.
 * @param {Object} options
 * @param {String} options.repoRoot The Brain runtime root.
 * @param {String} options.planeRoot
 * @param {Object} [options.env] The runtime env for the Brain child.
 * @param {Function} [options.runScript=runBrainScript] Injection seam for tests.
 * @returns {Promise<Object>} `NEO_PLANE_DATA_ROOT` plus one placed path per member env.
 * @throws {Error} When a member's default lies outside the plane data root, so it cannot be placed.
 */
export async function resolvePlaneMemberEnv({repoRoot, planeRoot, env = {}, runScript = runBrainScript}) {
    const
        script = [
            "import Neo from 'neo.mjs/src/Neo.mjs';",
            "import * as core from 'neo.mjs/src/core/_export.mjs';",
            "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
            "import Tier1, {PLANE_MEMBER_PATHS as tier1Paths} from './ai/configBase.mjs';",
            "import MemoryCore, {PLANE_MEMBER_PATHS as memoryCorePaths} from './ai/mcp/server/memory-core/configBase.mjs';",
            "import {resolvePlaneDataRoot} from './ai/planeConfig.mjs';",
            "const leaf = (base, memberPath) => memberPath.split('.').reduce((node, key) => node?.[key], base.config.data);",
            "process.stdout.write(JSON.stringify({",
            "    anchor : resolvePlaneDataRoot({rootDir: process.cwd()}),",
            "    members: [[MemoryCore, memoryCorePaths], [Tier1, tier1Paths]].flatMap(([base, paths]) =>",
            "        paths.map(memberPath => ({default: leaf(base, memberPath)?.default, env: leaf(base, memberPath)?.env, path: memberPath})))",
            "}));"
        ].join('\n'),
        {anchor, members} = await runScript({env, label: 'plane member resolver', repoRoot, script}),
        placed            = {NEO_PLANE_DATA_ROOT: planeRoot};

    for (const member of members) {
        const relative = typeof member.default === 'string' ? path.relative(anchor, member.default) : '';

        if (!member.env || !relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`plane member ${member.path} cannot be placed: its default ${member.default} is not under ${anchor}`)
        }

        placed[member.env] = path.join(planeRoot, relative)
    }

    return placed
}

/**
 * @summary Seeds the fixture's `AgentIdentity` nodes into the plane graph the env names, through the Brain's
 * own seeder, before the plane holds that graph.
 * @param {Object} options
 * @param {String} options.repoRoot The Brain runtime root.
 * @param {Object} options.env The plane's env: its members and runtime.
 * @param {String[]} [options.identities=[FIXTURE_IDENTITY]] A held run adds {@link FIXTURE_REMAP_IDENTITY}.
 * @param {Function} [options.runScript=runBrainScript] Injection seam for tests.
 * @returns {Promise<{seeded: Number}>}
 */
export function seedFixtureIdentity({repoRoot, env, identities = [FIXTURE_IDENTITY], runScript = runBrainScript}) {
    const documents = identities.map(id => ({
        description: 'A harness smoke fixture plane identity; it exists only in that plane\'s graph',
        id,
        name       : 'Harness smoke',
        properties : {accountType: 'agent', displayName: 'Harness smoke', githubLogin: id},
        type       : 'AgentIdentity'
    }));

    return runScript({
        env,
        label : 'fixture identity seeder',
        repoRoot,
        script: [
            "import Neo from 'neo.mjs/src/Neo.mjs';",
            "import * as core from 'neo.mjs/src/core/_export.mjs';",
            "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
            "import {seedAgentIdentities} from './ai/scripts/setup/seedAgentIdentities.mjs';",
            `const seeded = await seedAgentIdentities({identities: ${JSON.stringify(documents)}, log: () => {}});`,
            // the Memory Core's services keep the loop alive, as the seeder's own CLI knows
            "process.stdout.write(JSON.stringify({seeded}), () => process.exit(0));"
        ].join('\n')
    })
}

/**
 * @summary The fixture's ingress: `<planeBase>/mc/<path>` reaches the Memory Core's `/<path>`, the
 * mapping a real plane's ingress owns. Both directions stream, so Streamable HTTP's event streams pass
 * untouched. Anything outside `/mc/` answers 404.
 * @param {Object} options
 * @param {Number} options.targetPort The Memory Core's loopback port.
 * @returns {Promise<{close: Function, port: Number}>}
 */
export function startFixtureIngress({targetPort}) {
    const server = http.createServer((request, response) => {
        if (!request.url.startsWith('/mc/')) {
            response.writeHead(404).end();
            return
        }

        const upstream = http.request({
            headers: {...request.headers, host: `127.0.0.1:${targetPort}`},
            host   : '127.0.0.1',
            method : request.method,
            path   : request.url.slice('/mc'.length),
            port   : targetPort
        }, reply => {
            response.writeHead(reply.statusCode, reply.headers);
            reply.pipe(response)
        });

        upstream.on('error', () => response.headersSent ? response.destroy() : response.writeHead(502).end());
        request.pipe(upstream)
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({
            // an open event stream would hold `close` until its client leaves
            close: () => new Promise(done => {
                server.close(() => done());
                server.closeAllConnections()
            }),
            port : server.address().port
        }))
    })
}

/**
 * @summary Resolves once the child listens on its port, and rejects when it exits first or never
 * listens. The Memory Core logs to its own file sink, so the port is the only readiness signal.
 * @param {Object} options
 * @param {import('node:child_process').ChildProcess} options.child
 * @param {Number} options.port
 * @param {Number} options.timeoutMs
 * @returns {Promise<void>}
 */
function awaitChildListening({child, port, timeoutMs}) {
    return new Promise((resolve, reject) => {
        const onExit = (code, signal) => reject(new Error(`the fixture plane exited before it listened (code=${code} signal=${signal})`));

        child.once('exit', onExit);
        awaitPortListening({port, timeoutMs}).then(listening => {
            child.off('exit', onExit);
            listening ? resolve() : reject(new Error(`the fixture plane did not listen on ${port} within ${timeoutMs}ms`))
        })
    })
}

/**
 * @summary The fixture plane's Memory Core process as a handle a held run can stop and start: one child
 * at a time, each joining the smoke's owner as drain-owned but never a Brain claim (see
 * {@link startFixturePlane}). The plane's members live on disk under the smoke root, so a restarted
 * child reads the same graph and the same seat registry.
 * @param {Object} options
 * @param {Object} options.env The plane's env.
 * @param {Number} options.port The Memory Core's loopback port.
 * @param {Function} options.registerChild
 * @param {String} options.repoRoot The Brain runtime root.
 * @param {Function} options.startChild
 * @param {Function} [options.onLog]
 * @param {Function} [options.stopChild=stopBrainChild]
 * @param {Number} [options.timeoutMs=30000]
 * @returns {{start: Function, stop: Function}} `stop()` resolves the stop report once the plane's
 *     process group is gone, a forced stop included, and throws while any of it survives.
 */
export function createPlaneProcess({env, port, registerChild, repoRoot, startChild, onLog, stopChild = stopBrainChild, timeoutMs = 30000}) {
    let child = null;

    return {
        async start() {
            if (child && child.exitCode === null && child.signalCode === null) {
                throw new Error('the fixture plane already runs')
            }

            child = startChild({entry: FIXTURE_PLANE_ENTRY, env, onLog, repoRoot});
            registerChild({child, ...child.neoHarnessIdentity, label: 'plane', observeBrain: false});
            await awaitChildListening({child, port, timeoutMs})
        },
        async stop() {
            const report = child ? await stopChild(child) : {exited: true, forced: false, groupEmpty: true};

            if (report.groupEmpty !== true) {
                throw new Error(`the fixture plane did not stop: its process group outlived the drain (${JSON.stringify(report)})`)
            }

            return report
        }
    }
}

/**
 * @summary Starts the fixture plane and writes the shell's record for it. The Memory Core child joins
 * the caller's owner before anything waits on it, so teardown owns it on every path; the ingress is
 * the caller's to close. The child is drain-owned but never a Brain claim (`observeBrain: false`): it
 * stands in for a REMOTE plane, whose outage the shell meets through its own reads, never as a crash of
 * a child it owns. A held run stops and starts it through the returned handles; the ingress keeps its
 * port, so the shell's stored plane base stays valid across a restart, as a real ingress's does.
 * @param {Object} options
 * @param {String} options.repoRoot The Brain runtime root.
 * @param {String} options.isolationRoot The smoke's root; the plane lives in `<isolationRoot>/plane`.
 * @param {String} options.recordDir Where the plane record goes: the smoke's `userData`.
 * @param {Object} options.safeStorage The run's encryption stand-in.
 * @param {Function} options.registerChild `(entry) => void`, the smoke's child owner.
 * @param {Function} options.startChild `startBrainChild`.
 * @param {Boolean} [options.holdMode=false] A held run also seeds {@link FIXTURE_REMAP_IDENTITY}.
 * @param {Function} [options.onLog]
 * @param {Object} [options.runtimeEnv] The runtime env Brain children need (packaged: the bundled runtime's).
 * @param {Function} [options.stopChild=stopBrainChild]
 * @param {Number} [options.timeoutMs=30000]
 * @returns {Promise<{close: Function, identities: String[], ingressPort: Number, planeBase: String, planePort: Number, registryPath: String, startPlane: Function, stopPlane: Function}>}
 */
export async function startFixturePlane({repoRoot, isolationRoot, recordDir, safeStorage, registerChild, startChild, holdMode = false, onLog, runtimeEnv = {}, stopChild = stopBrainChild, timeoutMs = 30000}) {
    const
        members               = await resolvePlaneMemberEnv({env: runtimeEnv, planeRoot: path.join(isolationRoot, 'plane'), repoRoot}),
        seats                 = await import(pathToFileURL(path.join(repoRoot, 'ai/mcp/server/shared/helpers/seatToken.mjs')).href),
        {row, token}          = seats.mintSeatToken({agentIdentityNodeId: `AGENT_IDENTITY:${FIXTURE_IDENTITY}`}),
        [chromaPort, mcpPort] = await Promise.all([allocatePort(), allocatePort()]),
        registryPath          = members.NEO_AUTH_SEAT_TOKEN_REGISTRY_PATH,
        identities            = holdMode ? [FIXTURE_IDENTITY, FIXTURE_REMAP_IDENTITY] : [FIXTURE_IDENTITY];

    const env = {
        ...members,
        ...runtimeEnv,
        MCP_HTTP_PORT       : String(mcpPort),
        NEO_AGENT_IDENTITY  : FIXTURE_IDENTITY,
        NEO_AUTH_MODE       : 'seat-token',
        // an allocated port no Chroma serves: the plane admits and answers without its vector store
        NEO_CHROMA_PORT     : String(chromaPort),
        NEO_MCP_LISTEN_HOST : '127.0.0.1',
        NEO_PLANE_ID        : FIXTURE_PLANE_ID,
        NEO_TRANSPORT       : 'streamable-http',
        // a real plane's graph is a file; the unit-test switch would swap it for one in memory
        UNIT_TEST_MODE      : ''
    };

    fs.mkdirSync(path.dirname(registryPath), {recursive: true});
    seats.writeSeatTokenRegistry(registryPath, seats.buildSeatTokenRegistry({generation: 1, planeId: FIXTURE_PLANE_ID, rows: [row]}));
    await seedFixtureIdentity({env, identities, repoRoot});

    const planeProcess = createPlaneProcess({env, onLog, port: mcpPort, registerChild, repoRoot, startChild, stopChild, timeoutMs});

    await planeProcess.start();

    const
        ingress   = await startFixtureIngress({targetPort: mcpPort}),
        planeBase = `http://127.0.0.1:${ingress.port}`;

    try {
        const {identity, verdict} = await probePlaneCredential({bearer: token, planeBase});

        if (verdict !== 'accepted') {
            throw new Error(`the fixture plane refused its own seat (${verdict})`)
        }

        writePlaneConfig({bearer: token, dir: recordDir, identity, planeBase, safeStorage})
    } catch (error) {
        await ingress.close();
        throw error
    }

    return {close: ingress.close, identities, ingressPort: ingress.port, planeBase, planePort: mcpPort, registryPath, startPlane: planeProcess.start, stopPlane: planeProcess.stop}
}
