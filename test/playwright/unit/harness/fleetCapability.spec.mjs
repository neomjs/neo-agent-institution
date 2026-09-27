import {expect, test} from '@playwright/test';
import {execFile}     from 'node:child_process';
import {
    createAbsentFleetCapability,
    createFleetCapability,
    projectPublicAgentIntent,
    projectPublicCredentialIntent
} from '../../../../harness/fleetCapability.mjs';
import {loadAgentOsModule} from '../../fixtures.mjs';

// the wire vocabulary is the Brain's client-safe contract; the credential-bearing verb
// classification is launcher-private and lives beside the other launcher trust inputs
const [
    {
        createFleetWireOffer,
        createFleetWireRequest,
        createFleetWireResponse,
        FLEET_WIRE_METHODS,
        FLEET_WIRE_RESPONSE_STATES,
        inspectFleetWireResponse
    },
    {FLEET_CREDENTIAL_METHODS}
] = await Promise.all([
    loadAgentOsModule('src/fleet/contract/wire.mjs'),
    loadAgentOsModule('ai/services/fleet/fleetLaunchContract.mjs')
]);

const bearerToken = 'B'.repeat(43);

const createCapability = options => createFleetCapability({
    bearerToken,
    createWireOffer    : createFleetWireOffer,
    createWireRequest  : createFleetWireRequest,
    createWireResponse : createFleetWireResponse,
    credentialMethods  : FLEET_CREDENTIAL_METHODS,
    inspectWireResponse: inspectFleetWireResponse,
    responseStates     : FLEET_WIRE_RESPONSE_STATES,
    wireMethods        : FLEET_WIRE_METHODS,
    ...options
});

// Defines one agent in a throwaway registry of the Brain root this suite runs on and reads the row
// back. The registry is a Neo singleton on that root's own engine, so it runs in a child process,
// booted the way the Brain daemons boot.
const defineInBrainRegistry = params => new Promise((resolve, reject) => {
    const script = [
        "import Neo from 'neo.mjs/src/Neo.mjs';",
        "import * as core from 'neo.mjs/src/core/_export.mjs';",
        "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
        "import fs from 'node:fs';",
        "import os from 'node:os';",
        "import path from 'node:path';",
        "import FleetRegistryService from './ai/services/fleet/FleetRegistryService.mjs';",
        "import {launchRefusalOf} from './src/fleet/contract/launchAuthority.mjs';",
        "const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-define-'));",
        "try {",
        "    FleetRegistryService.dataDir = dataDir;",
        "    const row = FleetRegistryService.getAgent(FleetRegistryService.defineAgent(JSON.parse(process.argv[1])).id);",
        "    process.stdout.write(JSON.stringify({...row, launchRefusal: launchRefusalOf(row)}))",
        "} finally {",
        "    FleetRegistryService.dataDir = null;",
        "    fs.rmSync(dataDir, {force: true, recursive: true})",
        "}"
    ].join('\n');

    execFile(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(params)], {
        cwd: process.env.NEO_AGENTOS_RUNTIME_ROOT
    }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message))) : resolve(JSON.parse(stdout)))
});

test.describe('harness Fleet capability', () => {
    // A checkout booted with the Brain leg off and no Brain root has no contract to build the real
    // capability from; the route still answers — by rejecting with the reason that names the shape
    // (never a hand-made envelope the renderer would read as malformed), sender trust first.
    test('the absent capability rejects every request with the named reason, sender trust first', async () => {
        const
            reason     = 'fleet: this shell boots without a Brain root',
            capability = createAbsentFleetCapability({isTrustedSender: event => event?.trusted === true, reason}),
            request    = {method: 'listAgents', params: {}};

        await expect(capability.request({trusted: true}, request)).rejects.toThrow(reason);
        await expect(capability.request({trusted: false}, request)).rejects.toThrow('fleet: untrusted shell sender');

        expect(() => createAbsentFleetCapability({isTrustedSender: null, reason})).toThrow(TypeError);
        expect(() => createAbsentFleetCapability({isTrustedSender: () => true, reason: ''})).toThrow(TypeError)
    });

    test('requires credential methods inside the wire allowlist and snapshots both inputs', async () => {
        expect(() => createCapability({
            credentialMethods: ['defineAgent', 'ghostCredentialVerb'],
            getBrain         : async () => ({fleetPort: 8083, up: true}),
            isTrustedSender  : () => true,
            wireMethods      : ['defineAgent']
        })).toThrow(/canonical wire contract/);

        const
            credentialMethods = [],
            wireMethods       = ['listAgents'],
            capability        = createCapability({
                credentialMethods,
                fetchImpl      : async () => ({
                    json: async () => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result: []})
                }),
                getBrain       : async () => ({fleetPort: 8083, up: true}),
                isTrustedSender: () => true,
                wireMethods
            });

        credentialMethods.push('listAgents');
        wireMethods.length = 0;

        await expect(capability.request({}, {method: 'listAgents', params: {}})).resolves.toMatchObject({
            ok    : true,
            result: [],
            state : FLEET_WIRE_RESPONSE_STATES.ok
        })
    });

    test('checks sender trust before inspecting the request or touching credential, readiness, and network seams', async () => {
        const
            calls   = {brain: 0, credential: 0, fetch: 0},
            request = new Proxy({}, {
                get() {
                    throw new Error('request inspected before sender trust')
                },
                ownKeys() {
                    throw new Error('request enumerated before sender trust')
                }
            }),
            capability = createCapability({
                bearerToken,
                credentialProvider: async () => { calls.credential++; return 'never' },
                fetchImpl         : async () => { calls.fetch++; throw new Error('network must stay dark') },
                getBrain          : async () => { calls.brain++; return {fleetPort: 8083, up: true} },
                isTrustedSender   : () => false
            });

        await expect(capability.request({sender: 'untrusted'}, request)).resolves.toMatchObject({
            error: 'fleet: untrusted shell sender',
            ok   : false,
            state: FLEET_WIRE_RESPONSE_STATES.refused
        });
        expect(calls).toEqual({brain: 0, credential: 0, fetch: 0})
    });

    test('rejects malformed, over-wide, and non-allowlisted requests before credential, readiness, or network access', async () => {
        const
            calls      = {brain: 0, credential: 0, fetch: 0},
            capability = createCapability({
                bearerToken,
                credentialProvider: async () => { calls.credential++; return 'never' },
                fetchImpl         : async () => { calls.fetch++; throw new Error('network must stay dark') },
                getBrain          : async () => { calls.brain++; return {fleetPort: 8083, up: true} },
                isTrustedSender   : () => true
            }),
            invalidRequests = [
                null,
                [],
                {method: 42},
                {method: 'getManager'},
                {extra: true, method: 'listAgents'},
                {method: 'listAgents', protocol: createFleetWireOffer()},
                {method: 'defineAgent', params: {githubUsername: '', harnessType: 'codex'}},
                {method: 'connectTenant', params: {tenantUrl: ''}}
            ];

        for (const request of invalidRequests) {
            const result = await capability.request({sender: 'trusted'}, request);

            expect(result.ok, JSON.stringify(request)).toBe(false)
        }

        expect(calls).toEqual({brain: 0, credential: 0, fetch: 0})
    });

    test('rejects credential verbs locally when the shell has no credential provider', async () => {
        const
            calls      = {brain: 0, fetch: 0},
            capability = createCapability({
                bearerToken,
                fetchImpl      : async () => { calls.fetch++; throw new Error('network must stay dark') },
                getBrain       : async () => { calls.brain++; return {fleetPort: 8083, up: true} },
                isTrustedSender: () => true
            });

        await expect(capability.request({}, {
            method: 'defineAgent',
            params: {githubUsername: 'alice', harnessType: 'codex'}
        })).resolves.toMatchObject({
            error: "fleet: shell credential ingress unavailable for 'defineAgent'",
            ok   : false,
            state: FLEET_WIRE_RESPONSE_STATES.refused
        });
        await expect(capability.request({}, {
            method: 'connectTenant',
            params: {tenantUrl: 'https://tenant.example.com'}
        })).resolves.toMatchObject({
            error: "fleet: shell credential ingress unavailable for 'connectTenant'",
            ok   : false,
            state: FLEET_WIRE_RESPONSE_STATES.refused
        });

        expect(calls).toEqual({brain: 0, fetch: 0})
    });

    test('projects defineAgent onto public intent before obtaining and attaching the main-owned credential', async () => {
        const
            event              = {sender: 'trusted'},
            mainCredential     = 'github_pat_main_owned',
            rendererCredential = 'github_pat_renderer_smuggled',
            calls              = {credential: [], fetch: []},
            capability         = createCapability({
                bearerToken,
                credentialProvider: async input => { calls.credential.push(input); return mainCredential },
                fetchImpl         : async (url, init) => {
                    calls.fetch.push({init, url});
                    return {
                        json: async () => createFleetWireResponse(
                            FLEET_WIRE_RESPONSE_STATES.ok,
                            {result: {id: 'agent-alice'}}
                        )
                    }
                },
                getBrain       : async () => ({fleetPort: 9191, up: true}),
                isTrustedSender: candidate => candidate === event
            }),
            result = await capability.request(event, {
                method: 'defineAgent',
                params: {
                    args          : ['--unsafe'],
                    command       : '/tmp/renderer-command',
                    credential    : rendererCredential,
                    env           : {TOKEN: rendererCredential},
                    executablePath: '/tmp/renderer-binary',
                    githubUsername: ' alice ',
                    harnessType   : ' codex ',
                    id            : ' agent-alice ',
                    viewerIdentity: '@forged'
                }
            });

        expect(result).toMatchObject({
            ok    : true,
            result: {id: 'agent-alice'},
            state : FLEET_WIRE_RESPONSE_STATES.ok
        });
        expect(calls.credential).toEqual([{
            event,
            intent: {
                githubUsername: 'alice',
                harnessType   : 'codex',
                id            : 'agent-alice'
            },
            method: 'defineAgent'
        }]);
        expect(calls.fetch).toHaveLength(1);
        expect(calls.fetch[0].url).toBe('http://127.0.0.1:9191/fleet');
        expect(calls.fetch[0].init.headers.Authorization).toBe(`Bearer ${bearerToken}`);

        const outbound = JSON.parse(calls.fetch[0].init.body);

        expect(outbound).toEqual({
            method: 'defineAgent',
            params: {
                credential    : mainCredential,
                githubUsername: 'alice',
                harnessType   : 'codex',
                id            : 'agent-alice'
            },
            protocol: createFleetWireOffer()
        });
        expect(JSON.stringify(outbound)).not.toContain(rendererCredential);
        expect(JSON.stringify(outbound)).not.toContain('renderer-command');
        expect(projectPublicAgentIntent({
            githubUsername: ' alice ',
            harnessType   : ' codex ',
            id            : ' agent-alice ',
            launchOwner   : ' fleet '
        })).toEqual({
            githubUsername: 'alice',
            harnessType   : 'codex',
            id            : 'agent-alice',
            launchOwner   : 'fleet'
        });
        expect(projectPublicAgentIntent({githubUsername: 'alice', harnessType: 'codex', launchOwner: {fleet: true}}))
            .toEqual({githubUsername: 'alice', harnessType: 'codex'})
    });

    test('an external defineAgent crosses as public intent without asking for a credential; a Fleet-launched one, or one without a launch owner, still asks (#280)', async () => {
        const
            event      = {sender: 'trusted'},
            calls      = {credential: [], fetch: []},
            capability = createCapability({
                bearerToken,
                credentialProvider: async input => { calls.credential.push(input.intent); return 'github_pat_main_owned' },
                fetchImpl         : async (url, init) => {
                    calls.fetch.push(JSON.parse(init.body).params);
                    return {json: async () => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result: {id: 'emmy'}})}
                },
                getBrain       : async () => ({bundledFleet: true, fleetPort: 9191, up: true}),
                isTrustedSender: candidate => candidate === event
            }),
            define = params => capability.request(event, {method: 'defineAgent', params});

        await expect(define({credential: 'github_pat_renderer_smuggled', githubUsername: 'neo-gpt-emmy', harnessType: 'codex-desktop', launchOwner: 'external'}))
            .resolves.toMatchObject({ok: true});

        // nothing was asked, and nothing but the public intent crossed
        expect(calls.credential).toEqual([]);
        expect(calls.fetch).toEqual([{githubUsername: 'neo-gpt-emmy', harnessType: 'codex-desktop', launchOwner: 'external'}]);

        await define({githubUsername: 'alice', harnessType: 'codex', launchOwner: 'fleet'});
        await define({githubUsername: 'bob',   harnessType: 'codex'});

        expect(calls.credential.map(intent => intent.githubUsername)).toEqual(['alice', 'bob']);
        expect(calls.fetch.slice(1).map(params => params.credential)).toEqual(['github_pat_main_owned', 'github_pat_main_owned'])
    });

    test('the Brain this shell runs on stores the external seat the shell forwards as refused a start from birth; a Fleet-launched one stays startable', async () => {
        const
            event      = {sender: 'trusted'},
            forwarded  = [],
            capability = createCapability({
                credentialProvider: async () => 'github_pat_main_owned',
                fetchImpl         : async (url, init) => {
                    forwarded.push(JSON.parse(init.body).params);
                    return {json: async () => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result: {}})}
                },
                getBrain       : async () => ({bundledFleet: true, fleetPort: 9191, up: true}),
                isTrustedSender: candidate => candidate === event
            }),
            define = params => capability.request(event, {method: 'defineAgent', params});

        await define({githubUsername: 'neo-gpt-emmy',    harnessType: 'codex-desktop', launchOwner: 'external'});
        await define({githubUsername: 'neo-kimi-phoebe', harnessType: 'opencode',      launchOwner: 'fleet'});

        const [external, fleet] = await Promise.all(forwarded.map(defineInBrainRegistry));

        expect(external).toMatchObject({launchOwner: 'external', launchRefusal: 'released to its own harness: adopt it to start it here'});
        expect(external.launchOwnerSince).toBe(external.createdAt);
        expect(fleet).toMatchObject({launchOwner: 'fleet', launchRefusal: null});
        expect(fleet.launchOwnerSince).toBe(fleet.createdAt)
    });

    test('a Fleet this shell did not start from its bundled Brain registers no external seat — a same-bearer reused or a checkout Fleet is refused before the write; a Fleet-launched seat still goes through', async () => {
        const
            event = {sender: 'trusted'},
            // a reused incumbent answers on the same port, bearer and viewer; a checkout spawns its env-selected Brain
            boots = [
                {fleetPort: 9191, mode: 'attach', up: true},
                {bundledFleet: false, fleetPort: 9191, mode: 'own', up: true}
            ];

        for (const boot of boots) {
            const
                calls      = {credential: [], fetch: []},
                capability = createCapability({
                    credentialProvider: async () => { calls.credential.push(1); return 'github_pat_main_owned' },
                    fetchImpl         : async (url, init) => {
                        calls.fetch.push(JSON.parse(init.body).params);
                        return {json: async () => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result: {}})}
                    },
                    getBrain       : async () => boot,
                    isTrustedSender: candidate => candidate === event
                }),
                define = params => capability.request(event, {method: 'defineAgent', params}),
                refusal = await define({githubUsername: 'neo-gpt-emmy', harnessType: 'codex-desktop', launchOwner: 'external'});

            expect(refusal).toMatchObject({state: FLEET_WIRE_RESPONSE_STATES.refused});
            expect(refusal.error).toContain('bundled Brain');
            expect(calls.fetch).toEqual([]);
            expect(calls.credential).toEqual([]);

            await define({githubUsername: 'alice', harnessType: 'codex', launchOwner: 'fleet'});
            expect(calls.fetch.map(params => params.launchOwner)).toEqual(['fleet'])
        }
    });

    test('projects connectTenant onto tenantUrl only before attaching the provider credential', async () => {
        const
            event          = {sender: 'trusted'},
            mainCredential = 'tenant_pat_main_owned',
            calls          = {credential: [], fetch: []},
            capability     = createCapability({
                bearerToken,
                credentialProvider: async input => { calls.credential.push(input); return mainCredential },
                fetchImpl         : async (url, init) => {
                    calls.fetch.push({init, url});
                    return {
                        json: async () => createFleetWireResponse(
                            FLEET_WIRE_RESPONSE_STATES.ok,
                            {result: {status: 'connected'}}
                        )
                    }
                },
                getBrain       : async () => ({fleetPort: 8083, up: true}),
                isTrustedSender: candidate => candidate === event
            }),
            result = await capability.request(event, {
                method: 'connectTenant',
                params: {
                    credential    : 'tenant_pat_renderer_smuggled',
                    tenantUrl     : ' https://tenant.example.com/agentos/ ',
                    viewerIdentity: '@forged'
                }
            });

        expect(result).toMatchObject({
            ok    : true,
            result: {status: 'connected'},
            state : FLEET_WIRE_RESPONSE_STATES.ok
        });
        expect(calls.credential).toEqual([{
            event,
            intent: {tenantUrl: 'https://tenant.example.com/agentos/'},
            method: 'connectTenant'
        }]);
        expect(calls.fetch).toHaveLength(1);
        expect(JSON.parse(calls.fetch[0].init.body)).toEqual({
            method: 'connectTenant',
            params: {
                credential: mainCredential,
                tenantUrl : 'https://tenant.example.com/agentos/'
            },
            protocol: createFleetWireOffer()
        });
        expect(projectPublicCredentialIntent('connectTenant', {
            credential: 'discard-me',
            tenantUrl : ' https://tenant.example.com/agentos/ '
        })).toEqual({tenantUrl: 'https://tenant.example.com/agentos/'})
    });

    test('rejects a canceled credential before Brain readiness and network access', async () => {
        const
            calls      = {brain: 0, fetch: 0},
            capability = createCapability({
                bearerToken,
                credentialProvider: async () => null,
                fetchImpl         : async () => { calls.fetch++; throw new Error('network must stay dark') },
                getBrain          : async () => { calls.brain++; return {fleetPort: 8083, up: true} },
                isTrustedSender   : () => true
            });

        await expect(capability.request({}, {
            method: 'defineAgent',
            params: {githubUsername: 'alice', harnessType: 'codex'}
        })).resolves.toMatchObject({
            error: "fleet: shell credential ingress canceled for 'defineAgent'",
            ok   : false,
            state: FLEET_WIRE_RESPONSE_STATES.refused
        });
        expect(calls).toEqual({brain: 0, fetch: 0})
    });

    test('censuses both the Fleet bearer and provider credential out of response envelopes', async () => {
        const mainCredential = 'github_pat_main_owned';

        for (const reflectedSecret of [bearerToken, mainCredential]) {
            const capability = createCapability({
                    bearerToken,
                    credentialProvider: async () => mainCredential,
                    fetchImpl         : async () => ({
                        json: async () => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.operationFailed, {
                            error: `upstream reflected ${reflectedSecret}`
                        })
                    }),
                    getBrain       : async () => ({fleetPort: 8083, up: true}),
                    isTrustedSender: () => true
                }),
                result = await capability.request({}, {
                    method: 'defineAgent',
                    params: {githubUsername: 'alice', harnessType: 'codex'}
                });

            expect(result).toMatchObject({
                error: 'fleet: secret-bearing response rejected',
                ok   : false,
                state: FLEET_WIRE_RESPONSE_STATES.refused
            });
            expect(JSON.stringify(result)).not.toContain(reflectedSecret)
        }
    });

    test('censuses escaped provider credentials from failure text and nested success data', async () => {
        const credentials = [
            'github_pat_quote_"_value',
            'github_pat_backslash_\\_value',
            'github_pat_newline_\n_value',
            '  github_pat_trimmed_value  '
        ];

        for (const credential of credentials) {
            for (const reflection of new Set([credential, credential.trim()])) {
                for (const envelope of [
                    createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.operationFailed, {
                        error: `upstream reflected ${reflection}`
                    }),
                    createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {
                        result: {nested: {credential: reflection}}
                    }),
                    createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {
                        result: {nested: {[reflection]: 'reflected key'}}
                    })
                ]) {
                    const capability = createCapability({
                            bearerToken,
                            credentialProvider: async () => credential,
                            fetchImpl         : async () => ({json: async () => envelope}),
                            getBrain          : async () => ({fleetPort: 8083, up: true}),
                            isTrustedSender   : () => true
                        }),
                        result = await capability.request({}, {
                            method: 'defineAgent',
                            params: {githubUsername: 'alice', harnessType: 'codex'}
                        });

                    expect(result).toEqual(createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.refused, {
                        error: 'fleet: secret-bearing response rejected'
                    }))
                }
            }
        }
    });

    test('a skewed or malformed server reply is returned only as a closed local refusal', async () => {
        const replies = [
            {ok: true, result: []},
            {ok: true, state: FLEET_WIRE_RESPONSE_STATES.ok, protocol: createFleetWireResponse(
                FLEET_WIRE_RESPONSE_STATES.ok,
                {result: []}
            ).protocol},
            createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {
                protocol: {version: 2, capabilities: createFleetWireOffer().capabilities},
                result  : []
            }),
            {
                ...createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result: []}),
                protocol: {
                    ...createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result: []}).protocol,
                    bearer: 'must-never-cross'
                }
            }
        ];

        for (const reply of replies) {
            const capability = createCapability({
                fetchImpl      : async () => ({json: async () => reply}),
                getBrain       : async () => ({fleetPort: 8083, up: true}),
                isTrustedSender: () => true
            });
            const result = await capability.request({}, {method: 'listAgents'});

            expect(result).toMatchObject({ok: false, state: FLEET_WIRE_RESPONSE_STATES.refused});
            expect(result.error).toMatch(/malformed|unoffered/)
        }
    })
});
