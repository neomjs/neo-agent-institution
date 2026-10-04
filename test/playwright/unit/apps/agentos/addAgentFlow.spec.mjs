import {setup} from '../../../setup.mjs';

setup({
    appConfig: {
        name: 'AgentOSAddAgentFlowTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance       from '../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import AddAgentForm   from '../../../../../apps/agentos/view/fleet/instances/AddAgentForm.mjs';
import FleetInstances from '../../../../../apps/agentos/store/FleetInstances.mjs';

import AddAgentFlow from '../../../../../apps/agentos/util/AddAgentFlow.mjs';

const CREDENTIAL = 'github_pat_11TESTSECRET_shouldNeverEscape';

const cleanPayload = () => ({
    credential    : CREDENTIAL,
    githubUsername: 'neo-kimi-phoebe',
    harnessType   : 'opencode'
});

const cleanReadback = () => ({
    id            : 'resident-7',
    githubUsername: 'neo-kimi-phoebe',
    harnessType   : 'opencode',
    updatedAt     : '2026-07-18T00:00:00.000Z'
});

test.describe('AgentOS.view.fleet.addAgentFlow — the pure flow half (#15242)', () => {
    test('payload validation names every missing ingredient and passes a complete one', () => {
        expect(AddAgentFlow.validateDefinePayload({}).valid).toBe(false);
        expect(AddAgentFlow.validateDefinePayload({credential: 'x', githubUsername: '   ', harnessType: 'codex'}).valid).toBe(false);
        expect(AddAgentFlow.validateDefinePayload({credential: '',  githubUsername: 'user', harnessType: 'codex'}).valid).toBe(false);
        expect(AddAgentFlow.validateDefinePayload({credential: 'x', githubUsername: 'user', harnessType: ''}).valid).toBe(false);
        expect(AddAgentFlow.validateDefinePayload(cleanPayload())).toEqual({valid: true, reason: ''})
    });

    test('shell credential ingress validates and projects public intent only', () => {
        const bridge = {credentialIngress: 'shell'};

        expect(AddAgentFlow.isShellCredentialIngress(bridge)).toBe(true);
        expect(AddAgentFlow.validateDefinePayload(
            {githubUsername: 'neo-kimi-phoebe', harnessType: 'opencode'},
            {credentialRequired: false}
        )).toEqual({valid: true, reason: ''});
        expect(AddAgentFlow.createDefineAgentIntent({...cleanPayload(), command: 'must-not-cross'}, bridge)).toEqual({
            githubUsername: 'neo-kimi-phoebe',
            harnessType   : 'opencode',
            launchOwner   : 'fleet'
        });
        expect(AddAgentFlow.createDefineAgentIntent(cleanPayload(), {})).toEqual({...cleanPayload(), launchOwner: 'fleet'})
    });

    test('a seat added here is fleet-launched in both modes, and a caller cannot declare it external', () => {
        const payload = {...cleanPayload(), launchOwner: 'external'};

        expect(AddAgentFlow.createDefineAgentIntent(payload, {credentialIngress: 'shell'}).launchOwner).toBe('fleet');
        expect(AddAgentFlow.createDefineAgentIntent(payload, {}).launchOwner).toBe('fleet')
    });

    test('the readback guard fails closed on every poisoned shape and passes the canonical one', () => {
        // missing public identity
        expect(AddAgentFlow.validateReadback({githubUsername: 'x', harnessType: 'y'}, CREDENTIAL).valid).toBe(false);
        // top-level secret key
        expect(AddAgentFlow.validateReadback({...cleanReadback(), token: 'leak'}, CREDENTIAL).valid).toBe(false);
        expect(AddAgentFlow.validateReadback({...cleanReadback(), credential: 'leak'}, CREDENTIAL).valid).toBe(false);
        // serialized credential echo, arbitrarily nested
        expect(AddAgentFlow.validateReadback({...cleanReadback(), meta: {note: `echo ${CREDENTIAL}`}}, CREDENTIAL).valid).toBe(false);
        // non-serializable
        const circular = cleanReadback();
        circular.self  = circular;
        expect(AddAgentFlow.validateReadback(circular, CREDENTIAL).valid).toBe(false);
        // canonical
        expect(AddAgentFlow.validateReadback(cleanReadback(), CREDENTIAL)).toEqual({valid: true, reason: ''})
    });

    test('no bridge → gated, nothing attempted; a bridge without defineAgent is equally gated', async () => {
        const gated = await AddAgentFlow.submitDefineAgent({bridgeResolver: () => null, payload: cleanPayload()});

        expect(gated).toEqual({state: 'gated', reason: AddAgentFlow.FLEET_OFFLINE_REASON});
        // the operator's words: what to do, no bridge or App Worker vocabulary
        expect(gated.reason).toBe('The fleet is not running. Start it, then add the agent.');

        const wrongShape = await AddAgentFlow.submitDefineAgent({bridgeResolver: () => ({}), payload: cleanPayload()});
        expect(wrongShape.state).toBe('gated')
    });

    test('a controlled domain rejection passes its reason through; a transport throw stays sanitized', async () => {
        const rejected = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({defineAgent: async () => ({status: 'rejected', reason: 'duplicate handle'})}),
            payload       : cleanPayload()
        });

        expect(rejected).toEqual({state: 'rejected', reason: 'duplicate handle'});

        const thrown = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({defineAgent: async () => { throw new Error(`boom ${CREDENTIAL}`) }}),
            payload       : cleanPayload()
        });

        expect(thrown.state).toBe('rejected');
        // the sanitization claim: a transport error may carry credential bytes; the outcome must not
        expect(JSON.stringify(thrown)).not.toContain(CREDENTIAL)
    });

    test('an invalid readback resolves rejected; the canonical readback is the ONLY confirmed shape', async () => {
        const echoing = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({defineAgent: async () => ({...cleanReadback(), note: CREDENTIAL})}),
            payload       : cleanPayload()
        });

        expect(echoing.state).toBe('rejected');

        const confirmed = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({defineAgent: async payload => {
                expect(payload.githubUsername).toBe('neo-kimi-phoebe');
                return cleanReadback()
            }}),
            payload: cleanPayload()
        });

        expect(confirmed.state).toBe('readback-confirmed');
        expect(confirmed.definition).toEqual(cleanReadback());
        expect(AddAgentFlow.ADD_AGENT_STATES).toContain(confirmed.state)
    });

    test('a confirmed seat gets its working repo through the wire\'s setRepo; one that cannot be set is named, a malformed one never reaches the bridge', async () => {
        // only the slug crosses: the Fleet composes the clone URL on the seat's forge
        expect(AddAgentFlow.repoOf()).toEqual({repoSlug: 'neomjs/neo'});
        expect(AddAgentFlow.repoOf('  neomjs/neo-agent-brain ')).toEqual({repoSlug: 'neomjs/neo-agent-brain'});
        // the Fleet names the checkout path in lowercase only, so a typed case never reaches its verb
        expect(AddAgentFlow.repoOf('NeoMJS/Neo').repoSlug).toBe('neomjs/neo');

        for (const malformed of ['neo', 'a/b/c', 'https://github.com/x/y.git', 'x/y z']) {
            expect(AddAgentFlow.repoOf(malformed)).toBeNull()
        }

        const
            calls    = [],
            withRepo = {...cleanReadback(), metadata: {repo: {cloneUrl: 'https://github.com/neomjs/neo-agent-brain.git', repoSlug: 'neomjs/neo-agent-brain'}}},
            set      = await AddAgentFlow.submitDefineAgent({
                bridgeResolver: () => ({
                    defineAgent: async () => cleanReadback(),
                    setRepo    : async payload => { calls.push(payload); return {status: 'accepted', agent: withRepo} }
                }),
                payload: {...cleanPayload(), repoSlug: 'neomjs/neo-agent-brain'}
            });

        expect(calls).toEqual([{id: 'resident-7', repoSlug: 'neomjs/neo-agent-brain'}]);
        expect(set).toEqual({state: 'readback-confirmed', definition: withRepo, reason: ''});

        // a repository the Fleet refuses is named with the Fleet's own reason
        const refused = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({
                defineAgent: async () => cleanReadback(),
                setRepo    : async () => ({status: 'rejected', reason: "the owner 'harness' is reserved for the seat's harness homes."})
            }),
            payload: {...cleanPayload(), repoSlug: 'harness/neo'}
        });

        expect(refused).toEqual({
            state     : 'readback-confirmed',
            definition: cleanReadback(),
            reason    : "Agent added, but its working repository is not set: the owner 'harness' is reserved for the seat's harness homes."
        });

        const failing = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({defineAgent: async () => cleanReadback(), setRepo: async () => { throw new Error('down') }}),
            payload       : cleanPayload()
        });

        expect(failing).toEqual({
            state     : 'readback-confirmed',
            definition: cleanReadback(),
            reason    : 'Agent added, but its working repository is not set: set neomjs/neo before starting it.'
        });

        let contacted = false;

        const malformed = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({defineAgent: async () => { contacted = true; return cleanReadback() }}),
            payload       : {...cleanPayload(), repoSlug: 'not a repo'}
        });

        expect(malformed.state).toBe('rejected');
        expect(contacted).toBe(false)
    });

    test('shell submit crosses the generic bridge with public intent only', async () => {
        let received;

        const confirmed = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({
                credentialIngress: 'shell',
                defineAgent      : async payload => {
                    received = payload;
                    return cleanReadback()
                }
            }),
            payload: {...cleanPayload(), command: 'must-not-cross', env: {TOKEN: CREDENTIAL}}
        });

        expect(received).toEqual({
            githubUsername: 'neo-kimi-phoebe',
            harnessType   : 'opencode',
            launchOwner   : 'fleet'
        });
        expect(JSON.stringify(received)).not.toContain(CREDENTIAL);
        expect(confirmed.state).toBe('readback-confirmed')
    });

    test('a GitLab seat names its forge and instance, and its repository crosses as a slug that may name nested groups (#448)', async () => {
        const gitlab = {...cleanPayload(), forge: 'gitlab', forgeHost: ' https://gitlab.example.com '};

        expect(AddAgentFlow.createDefineAgentIntent(gitlab, {})).toEqual({
            ...cleanPayload(), forge: 'gitlab', forgeHost: 'https://gitlab.example.com', launchOwner: 'fleet'
        });
        expect(AddAgentFlow.validateDefinePayload({...gitlab, forgeHost: ' '})).toEqual({
            valid : false,
            reason: 'Username, GitLab instance, harness and personal access token are required.'
        });

        // a GitLab seat names its own repository: the GitHub default is not one of its own
        expect(AddAgentFlow.repoOf('Group/Sub/Project', 'gitlab')).toEqual({repoSlug: 'group/sub/project'});
        expect(AddAgentFlow.repoOf('', 'gitlab')).toBeNull();
        expect(AddAgentFlow.repoOf('project', 'gitlab')).toBeNull();
        expect(AddAgentFlow.repoOf('group/sub/project')).toBeNull();

        const
            defined = [],
            set     = [],
            outcome = await AddAgentFlow.submitDefineAgent({
                bridgeResolver: () => ({
                    defineAgent: async payload => { defined.push(payload); return {...cleanReadback(), forge: 'gitlab', forgeHost: 'https://gitlab.example.com'} },
                    setRepo    : async payload => { set.push(payload); return {status: 'accepted', agent: {...cleanReadback(), forge: 'gitlab'}} }
                }),
                payload: {...gitlab, repoSlug: 'group/sub/project'}
            });

        expect(defined).toEqual([{...cleanPayload(), forge: 'gitlab', forgeHost: 'https://gitlab.example.com', launchOwner: 'fleet'}]);
        expect(set).toEqual([{id: 'resident-7', repoSlug: 'group/sub/project'}]);
        expect(outcome.state).toBe('readback-confirmed');

        let contacted = false;

        const blank = await AddAgentFlow.submitDefineAgent({
            bridgeResolver: () => ({defineAgent: async () => { contacted = true; return cleanReadback() }}),
            payload       : {...gitlab, repoSlug: ''}
        });

        expect(blank).toEqual({state: 'rejected', reason: 'The working repository reads group/project, e.g. group/sub/project.'});
        expect(contacted).toBe(false)
    });
});

test.describe('AgentOS.view.fleet.instances.AddAgentForm — flow wiring + the credential-settle rule (#15242)', () => {
    test('bridge absent at construction renders gated with the submit affordance disabled-with-reason', () => {
        const form = Neo.create(AddAgentForm, {appName: 'AgentOSAddAgentFlowTest'});

        expect(form.flowStatus).toEqual({state: 'gated', reason: AddAgentFlow.FLEET_OFFLINE_REASON});
        expect(form.getReference('submit-button').disabled).toBe(true);

        const statusCls = form.getReference('flow-status').cls;
        expect(statusCls).toContain('is-gated');

        form.destroy()
    });

    test('the form names its forge once, by its chip, and its token field "Personal access token" (#245, #448)', () => {
        const
            form   = Neo.create(AddAgentForm, {appName: 'AgentOSAddAgentFlowTest'}),
            labels = form.items
                .filter(item => item.labelText || item.cls?.includes('fm-add-section'))
                .map(item => item.labelText ?? item.text),
            forges = form.getReference('forge-row').items;

        expect(labels).toEqual(['Account', 'GitLab instance', 'Username', 'Personal access token', 'Working repository', 'Harness']);
        expect(JSON.stringify(labels)).not.toMatch(/GitHub (username|PAT)/);
        expect(forges.map(item => item.text)).toEqual(['GitHub', 'GitLab']);
        expect(forges.filter(item => item.cls.includes('is-selected')).map(item => item.text)).toEqual(['GitHub']);
        expect(form.getReference('field-forge-host').hidden).toBe(true);

        form.destroy()
    });

    test('the destination line follows the injected plane facts and the PAT explains its one-token purpose (#503)', () => {
        const
            instanceStore = Neo.create(FleetInstances, {data: [{
                profileId        : 'bound-profile',
                label            : 'Shared Agent OS',
                canonicalEndpoint: 'https://shared.example.test'
            }, {
                profileId        : 'other-profile',
                label            : 'Other Agent OS',
                canonicalEndpoint: 'https://other.example.test'
            }]}),
            form = Neo.create(AddAgentForm, {
                appName       : 'AgentOSAddAgentFlowTest',
                boundProfileId: 'bound-profile',
                instanceStore
            });

        expect(form.getReference('destination-line').text).toBe('Agent OS: Shared Agent OS');
        expect(form.items.find(item => item.cls?.includes('fm-add-credential-help')).text)
            .toBe('This token gives the agent access to its repositories and the connected Agent OS.');

        instanceStore.get('bound-profile').set({label: 'Updated Agent OS'});
        expect(form.getReference('destination-line').text).toBe('Agent OS: Updated Agent OS');

        form.boundProfileId = 'other-profile';
        expect(form.getReference('destination-line').text).toBe('Agent OS: Other Agent OS');

        instanceStore.remove('other-profile');
        expect(form.getReference('destination-line').text).toBe('Agent OS: no instance');
        form.boundProfileId = 'bound-profile';
        expect(form.getReference('destination-line').text).toBe('Agent OS: Updated Agent OS');

        form.shellCustody  = true;
        form.shellPlaneBase = 'https://agent-os.example.test';

        expect(form.getReference('destination-line').text).toBe('Agent OS: agent-os.example.test');
        form.shellCustody = false;

        const destination = form.getReference('destination-line');

        expect(destination.text).toBe('Agent OS: Updated Agent OS');

        form.destroy();
        instanceStore.get('bound-profile').set({label: 'After destroy'});

        expect(destination.text).toBe('Agent OS: Updated Agent OS');

        instanceStore.destroy()
    });

    test('the harness choice is one chip per product, with App / Command line only where a product ships both (#245)', () => {
        const
            form     = Neo.create(AddAgentForm, {appName: 'AgentOSAddAgentFlowTest'}),
            products = form.getReference('product-row').items,
            runsAs   = form.getReference('runs-as-row'),
            chip     = (row, key, value) => row.items.find(item => item[key] === value),
            selected = row => row.items.filter(item => item.cls.includes('is-selected')).map(item => item.text);

        // one chip per product in the Brain's catalog, never one per harness type
        expect(products.map(item => item.text)).toEqual(['Codex', 'Claude', 'OpenCode', 'Kimi Code', 'Antigravity', 'Native']);

        // the first product's first type is seated: Codex on the command line
        expect(form.harnessType).toBe('codex');
        expect(selected(form.getReference('product-row'))).toEqual(['Codex']);
        expect(runsAs.hidden).toBe(false);
        expect(selected(runsAs)).toEqual(['Command line']);

        form.onRunsAsChipClick({component: chip(runsAs, 'runsAs', 'app')});
        expect(form.harnessType).toBe('codex-desktop');

        // a product switch keeps the run mode where the product has it: Codex app → Claude app
        form.onProductChipClick({component: chip(form.getReference('product-row'), 'product', 'claude')});
        expect(form.harnessType).toBe('claude-desktop');
        expect(selected(runsAs)).toEqual(['App']);

        // a single-type product hides the run-mode row
        form.onProductChipClick({component: chip(form.getReference('product-row'), 'product', 'kimi-code')});
        expect(form.harnessType).toBe('kimi-code');
        expect(runsAs.hidden).toBe(true);

        form.destroy()
    });

    test('a confirmed round-trip fires agentDefinitionAccepted with the readback AND clears the PAT field', async () => {
        const
            fired = [],
            calls = [],
            form  = Neo.create(AddAgentForm, {
                appName       : 'AgentOSAddAgentFlowTest',
                bridgeResolver: () => ({defineAgent: async payload => {
                    calls.push(payload);
                    return cleanReadback()
                }})
            });

        form.on('agentDefinitionAccepted', data => fired.push(data));

        const credentialField = await form.getField('credential');
        const usernameField   = await form.getField('githubUsername');

        usernameField.value   = 'neo-kimi-phoebe';
        credentialField.value = CREDENTIAL;
        form.harnessType      = 'opencode';

        await form.onSubmitClick();

        expect(form.flowStatus.state).toBe('readback-confirmed');
        expect(fired).toHaveLength(1);
        expect(fired[0].agent).toEqual(cleanReadback());
        expect(calls).toEqual([{...cleanPayload(), launchOwner: 'fleet'}]);
        // the settle rule: no terminal state leaves credential bytes in the field
        expect(credentialField.value ?? '').toBe('');

        form.destroy()
    });

    test('the GitLab chip shows the instance, and the token, repository and submit follow the forge (#448)', async () => {
        const
            calls = [],
            form  = Neo.create(AddAgentForm, {
                appName       : 'AgentOSAddAgentFlowTest',
                bridgeResolver: () => ({defineAgent: async payload => { calls.push(payload); return cleanReadback() }})
            }),
            chip  = forge => form.getReference('forge-row').items.find(item => item.forge === forge),
            host  = form.getReference('field-forge-host'),
            repo  = form.getReference('field-repo');

        form.onForgeChipClick({component: chip('gitlab')});

        expect(chip('gitlab').cls).toContain('is-selected');
        expect(host.hidden).toBe(false);
        expect(form.getReference('field-credential').placeholderText).toBe('glpat-…');
        expect(repo.placeholderText).toBe('group/project');
        // the GitHub default leaves; a GitLab seat names its own repository
        expect(repo.value ?? '').toBe('');

        (await form.getField('githubUsername')).value = 'neo-kimi-phoebe';
        (await form.getField('credential')).value     = CREDENTIAL;
        host.value                                    = 'https://gitlab.example.com';
        repo.value                                    = 'group/sub/project';
        form.harnessType                              = 'opencode';

        await form.onSubmitClick();

        expect(calls).toEqual([{...cleanPayload(), forge: 'gitlab', forgeHost: 'https://gitlab.example.com', launchOwner: 'fleet'}]);

        // back on GitHub, the instance hides, and an emptied repository field gets the default back
        repo.value = '';
        form.onForgeChipClick({component: chip('github')});

        expect(host.hidden).toBe(true);
        expect(repo.value).toBe(AddAgentFlow.DEFAULT_REPO_SLUG);

        form.destroy()
    });

    test('shell mode renders no PAT field and submits only public intent', async () => {
        let received;

        const form = Neo.create(AddAgentForm, {
            appName       : 'AgentOSAddAgentFlowTest',
            bridgeResolver: () => ({
                credentialIngress: 'shell',
                defineAgent      : async payload => {
                    received = payload;
                    return cleanReadback()
                }
            })
        });

        expect(form.items.some(item => item.name === 'credential')).toBe(false);
        // the help line no longer describes a field the form does not show: it names the next step
        expect(form.getReference('credential-help').text).toBe('On Add, the app asks once for this agent\'s token.');
        // shell ingress removes the inline PAT control; its submit remains an idle, valid state
        expect(form.flowStatus).toEqual({state: 'idle', reason: ''});

        const usernameField = await form.getField('githubUsername');

        usernameField.value = 'neo-kimi-phoebe';
        form.harnessType    = 'opencode';

        await form.onSubmitClick();

        expect(received).toEqual({
            githubUsername: 'neo-kimi-phoebe',
            harnessType   : 'opencode',
            launchOwner   : 'fleet'
        });
        expect(form.flowStatus.state).toBe('readback-confirmed');

        form.destroy()
    });

    test('a rejected round-trip still clears the PAT field — the settle rule is terminal-state-independent', async () => {
        const form = Neo.create(AddAgentForm, {
            appName       : 'AgentOSAddAgentFlowTest',
            bridgeResolver: () => ({defineAgent: async () => ({status: 'rejected', reason: 'nope'})})
        });

        const credentialField = await form.getField('credential');
        const usernameField   = await form.getField('githubUsername');

        usernameField.value   = 'neo-kimi-phoebe';
        credentialField.value = CREDENTIAL;

        await form.onSubmitClick();

        expect(form.flowStatus).toEqual({state: 'rejected', reason: 'nope'});
        expect(credentialField.value ?? '').toBe('');

        form.destroy()
    });

    test('an incomplete definition rejects before submitting — the flow never renders an in-flight state it is not in', async () => {
        const
            bridgeCalls = [],
            form        = Neo.create(AddAgentForm, {
                appName       : 'AgentOSAddAgentFlowTest',
                bridgeResolver: () => ({defineAgent: async () => { bridgeCalls.push(1); return cleanReadback() }})
            });

        await form.onSubmitClick(); // nothing filled in

        expect(form.flowStatus.state).toBe('rejected');
        expect(bridgeCalls).toHaveLength(0);

        form.destroy()
    });
});

test.describe('AgentOS.view.fleet.instances.AddAgentForm — the added seat\'s commit identity (#524)', () => {
    const missing = {state: 'missing', name: 'Phoebe', reason: 'its forge account offers no email this PAT can read'};

    /**
     * @summary A form over a stub bridge whose identity reads answer from `answers` in turn.
     * @param {Object[]} answers
     * @param {Object}   [extra] More bridge verbs.
     * @returns {{form: Object, accepted: Object[], reads: String[], intents: Object[]}}
     */
    const mountForm = (answers, extra={}) => {
        const
            accepted = [],
            intents  = [],
            reads    = [],
            bridge   = {
                defineAgent         : async () => cleanReadback(),
                fleetSeatGitIdentity: async ({id}) => {
                    reads.push(id);
                    return answers.length > 1 ? answers.shift() : answers[0]
                },
                configureAgent      : async intent => {
                    intents.push(intent);
                    return {status: 'accepted', agent: {...cleanReadback(), gitName: intent.gitName, gitEmail: intent.gitEmail}}
                },
                ...extra
            },
            form     = Neo.create(AddAgentForm, {appName: 'AgentOSAddAgentFlowTest', bridgeResolver: () => bridge});

        form.on('agentDefinitionAccepted', data => accepted.push(data.agent));

        return {form, accepted, reads, intents}
    };

    const fill = async form => {
        (await form.getField('githubUsername')).value = 'neo-kimi-phoebe';
        (await form.getField('credential')).value     = CREDENTIAL;
        form.harnessType = 'opencode'
    };

    test('AC-1: a derived or declared identity asks nothing new', async () => {
        for (const answer of [{state: 'derived', name: 'Phoebe', email: 'phoebe@example.com'}, {state: 'declared', name: 'Phoebe', email: 'phoebe@example.com'}]) {
            const {form, reads} = mountForm([answer]);

            await fill(form);
            await form.onSubmitClick();

            expect(form.flowStatus.state).toBe('readback-confirmed');
            expect(reads).toEqual(['resident-7']);
            expect(form.getReference('git-identity').hidden).toBe(true);

            form.destroy()
        }
    });

    test('AC-2: the define stands before the identity is read, and a failed derivation mounts the row inline', async () => {
        let release;
        const
            held = new Promise(resolve => {release = resolve}),
            {form, accepted, reads} = mountForm([missing], {fleetSeatGitIdentity: async ({id}) => {
                reads.push(id);
                return held
            }});

        await fill(form);
        const submitted = form.onSubmitClick();

        // the read is in flight, and the define already stands: confirmed and handed to the owner
        await expect.poll(() => reads).toEqual(['resident-7']);
        expect(form.flowStatus.state).toBe('readback-confirmed');
        expect(accepted).toHaveLength(1);
        expect(form.getReference('git-identity').hidden).toBe(true);

        release(missing);
        await submitted;

        const row = form.getReference('git-identity');

        expect(row.hidden).toBe(false);
        expect(row.getReference('identity-line').text).toBe('No commit identity: its forge account offers no email this PAT can read.');
        expect(row.getReference('identity-fields').hidden).toBe(false);

        form.destroy()
    });

    test('AC-2: the declaration goes through configureAgent, and the Fleet\'s answer closes the row', async () => {
        const {form, accepted, intents} = mountForm([missing, {state: 'declared', source: 'declaration', name: 'Phoebe', email: 'phoebe@example.com'}]);

        await fill(form);
        await form.onSubmitClick();

        const row = form.getReference('git-identity');

        row.getReference('field-git-email').value = 'phoebe@example.com';
        await form.onDeclareGitIdentity({gitName: row.getReference('field-git-name').value, gitEmail: 'phoebe@example.com'});

        expect(intents).toEqual([{id: 'resident-7', gitName: 'Phoebe', gitEmail: 'phoebe@example.com'}]);
        expect(row.hidden).toBe(true);
        expect(form.flowStatus).toEqual({state: 'readback-confirmed', reason: 'Agent added. Commits as Phoebe <phoebe@example.com> · declared.'});
        // the updated definition reaches the owner's roster, as the define did
        expect(accepted.map(agent => agent.gitEmail)).toEqual([undefined, 'phoebe@example.com']);

        form.destroy()
    });

    test('AC-2: a refused declaration keeps the row open with the Fleet\'s reason; a half pair never crosses', async () => {
        const {form, intents} = mountForm([missing], {configureAgent: async intent => {
            intents.push(intent);
            return {status: 'rejected', reason: 'gitEmail is not an email address'}
        }});

        await fill(form);
        await form.onSubmitClick();

        const row = form.getReference('git-identity');

        await form.onDeclareGitIdentity({gitName: 'Phoebe', gitEmail: ''});
        expect(intents).toEqual([]);
        expect(row.status).toEqual({state: 'rejected', reason: 'Name and email are both required.'});

        await form.onDeclareGitIdentity({gitName: 'Phoebe', gitEmail: 'phoebe'});
        expect(row.hidden).toBe(false);
        expect(row.status).toEqual({state: 'rejected', reason: 'gitEmail is not an email address'});

        form.destroy()
    });

    test('AC-2: a read that failed shows "not yet read" with its reason, and the retry reads again', async () => {
        const {form, reads} = mountForm([
            {state: 'unknown', reason: 'the fleet could not be reached'},
            {state: 'derived', name: 'Phoebe', email: 'phoebe@example.com'}
        ]);

        await fill(form);
        await form.onSubmitClick();

        const row = form.getReference('git-identity');

        expect(row.hidden).toBe(false);
        expect(row.getReference('identity-line').text).toBe('Identity not yet read: the fleet could not be reached.');
        expect(row.getReference('identity-read').hidden).toBe(false);

        await form.readGitIdentity();
        expect(reads).toEqual(['resident-7', 'resident-7']);
        expect(row.hidden).toBe(true);

        form.destroy()
    });

    test('a bridge without the identity verb reads as not yet read, never as success', async () => {
        const {form} = mountForm([missing], {fleetSeatGitIdentity: undefined});

        await fill(form);
        await form.onSubmitClick();

        const row = form.getReference('git-identity');

        expect(form.flowStatus.state).toBe('readback-confirmed');
        expect(row.hidden).toBe(false);
        expect(row.getReference('identity-line').text).toBe('Identity not yet read: this fleet does not report commit identities.');

        form.destroy()
    });

    test('AC-2: only the latest identity request paints the row: an older reply of the same seat is ignored, and Read again waits for its answer', async () => {
        const
            replies = [],
            reply   = () => {
                let resolve;
                const promise = new Promise(res => {resolve = res});
                replies.push({promise, resolve});
                return promise
            },
            {form}  = mountForm([missing], {fleetSeatGitIdentity: () => reply()});

        await fill(form);

        const submitted = form.onSubmitClick();

        await expect.poll(() => replies.length).toBe(1);
        replies[0].resolve({state: 'unknown', reason: 'the fleet could not be reached'});
        await submitted;

        const row = form.getReference('git-identity');

        expect(row.hidden).toBe(false);

        // two retries: the second is the latest request, and Read again waits while one is in flight
        const first = form.readGitIdentity();

        expect(row.getReference('identity-read').disabled).toBe(true);
        expect(row.getReference('identity-status').text).toBe('Reading…');

        const second = form.readGitIdentity();

        replies[2].resolve({state: 'derived', name: 'Phoebe', email: 'phoebe@example.com'});
        await second;
        expect(row.hidden).toBe(true);

        replies[1].resolve({state: 'unknown', reason: 'the fleet could not be reached'});
        expect(await first).toBeNull();
        expect(row.hidden).toBe(true);
        expect(row.identity.state).toBe('derived');

        form.destroy()
    });
});
