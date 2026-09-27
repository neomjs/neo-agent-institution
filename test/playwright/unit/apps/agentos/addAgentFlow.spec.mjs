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

import AddAgentFlow from '../../../../../apps/agentos/util/AddAgentFlow.mjs';

const CREDENTIAL = 'github_pat_11TESTSECRET_shouldNeverEscape';

// a new resident Fleet launches: the one kind of seat that brings a PAT
const cleanPayload = () => ({
    credential    : CREDENTIAL,
    githubUsername: 'neo-kimi-phoebe',
    harnessType   : 'opencode',
    launchOwner   : 'fleet'
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

    test('the launch owner always crosses explicitly: external unless Fleet launches the seat, and an external seat carries no PAT in either mode (#280)', () => {
        const {launchOwner, ...unowned} = cleanPayload();

        for (const bridge of [{credentialIngress: 'shell'}, {}]) {
            // the default, and anything outside the two answers, is the seat that runs in its own harness
            for (const payload of [unowned, {...unowned, launchOwner: 'external'}, {...unowned, launchOwner: 'root'}]) {
                expect(AddAgentFlow.createDefineAgentIntent(payload, bridge)).toEqual({
                    githubUsername: 'neo-kimi-phoebe',
                    harnessType   : 'opencode',
                    launchOwner   : 'external'
                })
            }

            expect(AddAgentFlow.createDefineAgentIntent(cleanPayload(), bridge).launchOwner).toBe('fleet')
        }

        // a direct-browser Fleet seat still brings its PAT, and validation still asks for one
        expect(AddAgentFlow.createDefineAgentIntent(cleanPayload(), {}).credential).toBe(CREDENTIAL);
        expect(AddAgentFlow.validateDefinePayload({...cleanPayload(), credential: ''}).valid).toBe(false);
        expect(AddAgentFlow.validateDefinePayload({...unowned, credential: '', launchOwner: 'external'}, {externalAllowed: true}))
            .toEqual({valid: true, reason: ''});
        expect(AddAgentFlow.LAUNCH_OWNERS).toEqual(['external', 'fleet'])
    });

    test('only the shell registers a seat that runs in its own harness — a browser bridge refuses it before the write, whatever Fleet it reaches (#280)', async () => {
        const
            {launchOwner, ...unowned} = cleanPayload(),
            writes  = [],
            browser = () => ({defineAgent: async payload => { writes.push(payload); return cleanReadback() }});

        expect(AddAgentFlow.canRegisterExternal({credentialIngress: 'shell'})).toBe(true);
        expect(AddAgentFlow.canRegisterExternal({})).toBe(false);
        expect(AddAgentFlow.canRegisterExternal(null)).toBe(false);

        const refused = AddAgentFlow.validateDefinePayload({...unowned, launchOwner: 'external'});

        expect(refused.valid).toBe(false);
        expect(refused.reason).toContain('can only be added from the installed shell');

        // wire v1 reads the same on an older Fleet and a current one, so the gate precedes the bridge
        expect(await AddAgentFlow.submitDefineAgent({bridgeResolver: browser, payload: {...unowned, launchOwner: 'external'}}))
            .toEqual({state: 'rejected', reason: refused.reason});
        expect(writes).toEqual([]);

        // a Fleet-launched seat on the same bridge still writes, with its PAT
        await AddAgentFlow.submitDefineAgent({bridgeResolver: browser, payload: cleanPayload()});
        expect(writes).toEqual([{...cleanPayload(), launchOwner: 'fleet'}])
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

        expect(gated.state).toBe('gated');
        expect(gated.reason).toContain('fails closed');

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
});

test.describe('AgentOS.view.fleet.instances.AddAgentForm — flow wiring + the credential-settle rule (#15242)', () => {
    test('bridge absent at construction renders gated with the submit affordance disabled-with-reason', () => {
        const form = Neo.create(AddAgentForm, {appName: 'AgentOSAddAgentFlowTest'});

        expect(form.flowStatus.state).toBe('gated');
        expect(form.getReference('submit-button').disabled).toBe(true);

        const statusCls = form.getReference('flow-status').cls;
        expect(statusCls).toContain('is-gated');

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

        form.launchOwner      = 'fleet';
        usernameField.value   = 'neo-kimi-phoebe';
        credentialField.value = CREDENTIAL;
        form.harnessType      = 'opencode';

        await form.onSubmitClick();

        expect(form.flowStatus.state).toBe('readback-confirmed');
        expect(fired).toHaveLength(1);
        expect(fired[0].agent).toEqual(cleanReadback());
        expect(calls).toEqual([cleanPayload()]);
        // the settle rule: no terminal state leaves credential bytes in the field
        expect(credentialField.value ?? '').toBe('');

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
        // a Fleet-launched seat's credential is the native shell's to ask for
        form.launchOwner = 'fleet';
        expect(form.getReference('flow-status').text).toContain('native shell');

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

    test('the form defaults to a seat that runs in its own harness: no PAT field, the choice marked, and a browser bridge writes nothing for it (#280)', async () => {
        let received;

        const form = Neo.create(AddAgentForm, {
            appName       : 'AgentOSAddAgentFlowTest',
            bridgeResolver: () => ({defineAgent: async payload => { received = payload; return cleanReadback() }})
        });

        const
            credentialField = await form.getField('credential'),
            chips           = () => form.getReference('owner-row').items.filter(chip => chip.cls.includes('is-selected')).map(chip => chip.launchOwner);

        expect(form.launchOwner).toBe('external');
        expect(chips()).toEqual(['external']);
        expect(credentialField.hidden).toBe(true);
        expect(form.getReference('flow-status').text).toContain('can only be added from the installed shell');

        // the other answer brings the PAT field back, and switching back hides it again
        form.launchOwner = 'fleet';
        expect(chips()).toEqual(['fleet']);
        expect(credentialField.hidden).toBe(false);
        form.launchOwner = 'external';
        expect(credentialField.hidden).toBe(true);

        (await form.getField('githubUsername')).value = 'neo-gpt-emmy';
        credentialField.value                          = CREDENTIAL;
        form.harnessType                               = 'codex-desktop';

        await form.onSubmitClick();

        expect(received).toBeUndefined();
        expect(form.flowStatus.state).toBe('rejected');
        expect(form.flowStatus.reason).toContain('can only be added from the installed shell');

        form.destroy()
    });

    test('from the shell, the external default crosses as public intent only (#280)', async () => {
        let received;

        const form = Neo.create(AddAgentForm, {
            appName       : 'AgentOSAddAgentFlowTest',
            bridgeResolver: () => ({credentialIngress: 'shell', defineAgent: async payload => { received = payload; return cleanReadback() }})
        });

        expect(await form.getField('credential')).toBeFalsy();   // the shell owns credential entry
        expect(form.getReference('flow-status').text).toContain('no PAT is needed');

        (await form.getField('githubUsername')).value = 'neo-gpt-emmy';
        form.harnessType                               = 'codex-desktop';

        await form.onSubmitClick();

        expect(received).toEqual({githubUsername: 'neo-gpt-emmy', harnessType: 'codex-desktop', launchOwner: 'external'});
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

        form.launchOwner      = 'fleet';   // the seat that brings a PAT
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
