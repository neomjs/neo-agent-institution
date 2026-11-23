import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetSeatCredentialContainerTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        unitTestMode           : true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {test, expect}              from '@playwright/test';
import Neo                         from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                   from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance                    from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import Store                       from '../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs';
import FleetAgent                  from '../../../../../../../../apps/agentos/model/FleetAgent.mjs';
import FleetLifecycleIntentAdapter from '../../../../../../../../apps/agentos/util/FleetLifecycleIntentAdapter.mjs';
import OpenWorkRead                from '../../../../../../../../apps/agentos/util/OpenWorkRead.mjs';
import AgentCard                   from '../../../../../../../../apps/agentos/view/fleet/roster/card/Container.mjs';
import AgentDetail                 from '../../../../../../../../apps/agentos/view/fleet/detail/Container.mjs';

/**
 * @summary End-to-end component verification across `AgentDetail`
 * (`SeatCredentialContainer` + `SeatRuntimeContainer`) and `AgentCard` (`CardControlStatus`):
 * - stopped-only `"Replace token"` offer + `seat-running` explanation on running seats
 * - `planeCredential` (`same-as-forge`, `distinct`, `none`, `unreadable`, failed `getAgent`) with nothing pre-selected
 * - credential next-step cases (Start `credentialRefusal`, `FLEET_SEAT_CREDENTIAL_REPLACEMENT_INCOMPLETE`,
 *   open-work `credentialRefusal` including `'unavailable'` envelope, and `receipt.nextStep === 'replace-seat-credential'`
 *   re-running with `receipt.scope`) while non-matching refusals keep existing text
 * - `tokenExpiresAt` shown in Detail and flagged within 7 days in the cockpit with `"Replace token"`, `null` shows nothing
 */
test.describe('AgentDetail & AgentCard — replace a stopped seat\'s GitHub token (#902)', () => {
    const
        NOW             = Date.parse('2026-11-23T12:00:00.000Z'),
        observedSources = {
            roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
            repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
            runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
        };

    let store, detail, card;

    const clearBridge = () => { delete globalThis.AgentOS?.fleet };
    const setBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };

    function makeRecord(values = {}) {
        store = Neo.create(Store, {
            keyProperty: 'agentId',
            model      : FleetAgent,
            data       : [{
                agentId       : 'clio',
                displayName   : 'Clio',
                githubUsername: 'neo-fable-clio',
                state         : 'off',
                sources       : observedSources,
                ...values
            }]
        });
        return store.get('clio')
    }

    test.afterEach(() => {
        clearBridge();
        card?.destroy();
        detail?.destroy();
        store?.destroy();
        card = detail = store = null
    });

    test('AC-2: Agent Detail offers "Replace token" only for a stopped seat and explains cause seat-running when running', () => {
        const record = makeRecord({state: 'off'});
        detail = Neo.create(AgentDetail, {appName, now: NOW, record});

        const
            section = detail.getReference('seat-credential'),
            button  = section.getReference('replace-token-button'),
            line    = section.getReference('credential-line');

        expect(section.hidden).toBe(false);
        expect(button.hidden).toBe(false);
        expect(button.disabled).toBe(false);
        expect(button.text).toBe('Replace token');

        for (const runningState of ['ok', 'idle', 'wedged', 'limited']) {
            record.set({state: runningState});
            detail.applyRecord();

            expect(button.hidden, runningState).toBe(true);
            expect(detail.getReference('seat-runtime').getReference('runtime-replace-token').hidden, runningState).toBe(true);
            expect(line.text, runningState).toContain('seat-running');
            expect(line.text, runningState).toContain('Stop the seat')
        }

        record.set({state: 'off'});
        detail.applyRecord();
        expect(button.hidden).toBe(false)
    });

    test('AC-3: same-as-forge and distinct show the Agent OS choice with nothing pre-selected; none, unreadable, and failed reads replace for GitHub only', async () => {
        const
            record = makeRecord({state: 'off'}),
            calls  = [];

        detail = Neo.create(AgentDetail, {appName, now: NOW, record});

        const
            section     = detail.getReference('seat-credential'),
            offer       = section.getReference('scope-offer'),
            note        = section.getReference('credential-note'),
            forgeChip   = section.getReference('scope-forge'),
            planeChip   = section.getReference('scope-forge-and-bound-plane');

        // 1. 'same-as-forge' -> opens choice with nothing pre-selected and states Agent OS uses same token today
        setBridge({
            credentialIngress    : 'shell',
            getAgent             : async id => ({id, planeCredential: 'same-as-forge'}),
            replaceSeatCredential: async payload => {
                calls.push(payload);
                return {status: 'replaced', id: payload.id, scope: payload.scope, receipt: {scope: payload.scope, nextStep: 'start-agent'}}
            }
        });

        await section.onReplaceClick();
        expect(offer.hidden).toBe(false);
        expect(section.selectedScope).toBeNull();
        expect(forgeChip.vdom['aria-pressed']).toBe('false');
        expect(planeChip.vdom['aria-pressed']).toBe('false');
        expect(forgeChip.cls).not.toContain('is-selected');
        expect(planeChip.cls).not.toContain('is-selected');
        expect(note.hidden).toBe(false);
        expect(note.text).toContain('same token today');
        expect(calls).toEqual([]);

        await section.onScopeForgeClick();
        expect(calls).toEqual([{id: 'clio', scope: 'forge'}]);
        expect(offer.hidden).toBe(true);
        expect(section.getReference('credential-status').text).toContain('GitHub token replaced');

        // 2. 'distinct' -> opens choice with nothing pre-selected and warns second choice overwrites distinct token
        calls.length = 0;
        setBridge({
            credentialIngress    : 'shell',
            getAgent             : async id => ({id, planeCredential: 'distinct'}),
            replaceSeatCredential: async payload => {
                calls.push(payload);
                return {status: 'replaced', id: payload.id, scope: payload.scope, receipt: {scope: payload.scope, nextStep: 'start-agent'}}
            }
        });

        await section.onReplaceClick();
        expect(offer.hidden).toBe(false);
        expect(section.selectedScope).toBeNull();
        expect(forgeChip.vdom['aria-pressed']).toBe('false');
        expect(planeChip.vdom['aria-pressed']).toBe('false');
        expect(note.text).toContain('different token today');
        expect(note.text).toContain('overwrite');

        await section.onScopePlaneClick();
        expect(calls).toEqual([{id: 'clio', scope: 'forge-and-bound-plane'}]);
        expect(offer.hidden).toBe(true);

        // 3. 'none' -> replaces immediately for GitHub only with no Agent OS choice
        calls.length = 0;
        setBridge({
            credentialIngress    : 'shell',
            getAgent             : async id => ({id, planeCredential: 'none'}),
            replaceSeatCredential: async payload => {
                calls.push(payload);
                return {status: 'replaced', id: payload.id, scope: payload.scope, receipt: {scope: payload.scope, nextStep: 'start-agent'}}
            }
        });

        await section.onReplaceClick();
        expect(offer.hidden).toBe(true);
        expect(calls).toEqual([{id: 'clio', scope: 'forge'}]);

        // 4. 'unreadable' -> replaces for GitHub only and explains why Agent OS choice is missing
        calls.length = 0;
        setBridge({
            credentialIngress    : 'shell',
            getAgent             : async id => ({id, planeCredential: 'unreadable'}),
            replaceSeatCredential: async payload => {
                calls.push(payload);
                return {status: 'rejected', reason: 'prompt canceled'}
            }
        });

        await section.onReplaceClick();
        expect(offer.hidden).toBe(true);
        expect(calls).toEqual([{id: 'clio', scope: 'forge'}]);
        expect(note.hidden).toBe(false);
        expect(note.text).toContain('Agent OS choice is unavailable');

        // 5. Failed getAgent read -> replaces for GitHub only with the failure reason explained
        calls.length = 0;
        setBridge({
            credentialIngress    : 'shell',
            getAgent             : async () => { throw new Error('IPC channel closed') },
            replaceSeatCredential: async payload => {
                calls.push(payload);
                return {status: 'rejected', reason: 'prompt canceled'}
            }
        });

        await section.onReplaceClick();
        expect(offer.hidden).toBe(true);
        expect(calls).toEqual([{id: 'clio', scope: 'forge'}]);
        expect(note.hidden).toBe(false);
        expect(note.text).toContain('IPC channel closed')
    });

    test('AC-4: all three Fix-3 next-step cases show "Replace token" (and receipt retry reuses receipt.scope); other refusals keep today\'s text', async () => {
        const record = makeRecord({state: 'off'});
        detail = Neo.create(AgentDetail, {appName, now: NOW, record});
        card   = Neo.create(AgentCard,   {appName, now: NOW, record});

        const
            runtime        = detail.getReference('seat-runtime'),
            runtimeReplace = runtime.getReference('runtime-replace-token'),
            section        = detail.getReference('seat-credential'),
            cardStatus     = card.getReference('control-status');

        // Non-credential Start refusal keeps exact today's text and hides "Replace token" on Status
        await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'clio'}, record, {
            bridge: {startAgent: async () => ({status: 'rejected', reason: "agent 'clio' was released to its own harness."})}
        });
        detail.applyRecord();
        card.applyRecord();
        expect(cardStatus.text).toBe("⚠ rejected: agent 'clio' was released to its own harness.");
        expect(runtime.getReference('runtime-control-feedback').text).toBe("agent 'clio' was released to its own harness.");
        expect(runtimeReplace.hidden).toBe(true);

        // Case 1a: Start refused with credentialRefusal {surface: 'forge', verdict: 'refused'}
        await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'clio'}, record, {
            bridge: {
                startAgent: async () => ({
                    status           : 'rejected',
                    reason           : "agent 'clio' has no GitHub PAT stored; store one before starting it.",
                    credentialRefusal: {surface: 'forge', cause: 'indeterminate', verdict: 'refused', status: null}
                })
            }
        });
        detail.applyRecord();
        card.applyRecord();
        expect(cardStatus.text).toBe("⚠ rejected: agent 'clio' has no GitHub PAT stored; store one before starting it. · Replace token");
        expect(runtimeReplace.hidden).toBe(false);
        expect(section.getReference('credential-line').text).toContain('Next step: Replace token');

        // Case 1b: Start refused with code FLEET_SEAT_CREDENTIAL_REPLACEMENT_INCOMPLETE
        await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'clio'}, record, {
            bridge: {
                startAgent: async () => ({
                    status: 'rejected',
                    code  : 'FLEET_SEAT_CREDENTIAL_REPLACEMENT_INCOMPLETE',
                    reason: "agent 'clio' has an incomplete credential replacement across its forge and plane stores; re-run replaceSeatCredential to reconcile it before starting."
                })
            }
        });
        detail.applyRecord();
        card.applyRecord();
        expect(cardStatus.text).toContain('· Replace token');
        expect(runtimeReplace.hidden).toBe(false);

        // Case 2: Open-work refusal + 2-day expiry on fleetOpenWork.seats[id] inside an 'unavailable' envelope
        record.set({controlReason: null});
        const
            in2Days       = new Date(NOW + 2 * 86_400_000).toISOString(),
            openWorkOwner = {
                openWorkSnapshot: {
                    state     : 'unavailable',
                    observedAt: new Date(NOW - 60_000).toISOString(),
                    seats     : {
                        '@neo-fable-clio': {
                            authored         : [],
                            reviewing        : [],
                            credentialRefusal: {surface: 'forge', verdict: 'refused', cause: 'insufficient-capability', reason: 'missing read:org scope'},
                            tokenExpiresAt   : in2Days
                        }
                    }
                }
            };
        record.set(OpenWorkRead.seatOpenWork(openWorkOwner, record.githubUsername));
        detail.applyRecord();
        card.applyRecord();
        expect(cardStatus.text).toBe('⚠ GitHub token refused: missing read:org scope · Replace token');
        expect(section.getReference('credential-expiry').hidden).toBe(false);
        expect(section.getReference('credential-expiry').text).toContain('Replace token');
        expect(runtimeReplace.hidden).toBe(false);
        expect(runtime.getReference('runtime-control-feedback').text).toBe('missing read:org scope');

        // Case 3: Incomplete replacement receipt -> nextStep: 'replace-seat-credential' re-runs with receipt.scope
        const calls = [];
        let getAgentCalls = 0;
        setBridge({
            credentialIngress: 'shell',
            getAgent         : async id => {
                getAgentCalls++;
                return {id, planeCredential: 'same-as-forge'}
            },
            replaceSeatCredential: async payload => {
                calls.push(payload);
                if (calls.length === 1) {
                    return {
                        status : 'rejected',
                        reason : 'seat plane credential could not be persisted',
                        receipt: {
                            scope     : 'forge-and-bound-plane',
                            coherent  : false,
                            incomplete: true,
                            nextStep  : 'replace-seat-credential'
                        }
                    }
                }
                return {
                    status : 'replaced',
                    id     : payload.id,
                    scope  : payload.scope,
                    receipt: {scope: payload.scope, coherent: true, incomplete: false, nextStep: 'start-agent'}
                }
            }
        });

        // Clicking Status-tab "Replace token" switches to Configuration tab and initiates the flow
        await runtime.onReplaceTokenClick();
        expect(detail.getReference('detail-tabs').activeIndex).toBe(1);
        expect(getAgentCalls).toBe(1);

        // First attempt fails halfway with receipt.nextStep === 'replace-seat-credential'
        await section.onScopePlaneClick();
        expect(calls).toEqual([{id: 'clio', scope: 'forge-and-bound-plane'}]);
        expect(section.getReference('credential-line').text).toContain('seat plane credential could not be persisted · Next step: Replace token');
        expect(section.getReference('scope-offer').hidden).toBe(true);

        // Clicking "Replace token" again re-runs directly with the receipt's scope ('forge-and-bound-plane') without calling getAgent again
        await section.onReplaceClick();
        card.applyRecord();
        expect(getAgentCalls).toBe(1);
        expect(calls).toEqual([
            {id: 'clio', scope: 'forge-and-bound-plane'},
            {id: 'clio', scope: 'forge-and-bound-plane'}
        ]);
        expect(section.getReference('credential-status').text).toContain('GitHub token replaced');

        // Pre-replacement refusal and expiry stay retired across Detail (line, expiry, Status tab) and card,
        // even if the held pre-replacement snapshot is re-projected onto the record
        record.set(OpenWorkRead.seatOpenWork(openWorkOwner, record.githubUsername));
        detail.applyRecord();
        card.applyRecord();
        expect(section.getReference('credential-line').text).not.toContain('Replace token');
        expect(section.getReference('credential-expiry').hidden).toBe(true);
        expect(runtimeReplace.hidden).toBe(true);
        expect(runtime.getReference('runtime-control-feedback').hidden).toBe(true);
        expect(cardStatus.hidden).toBe(true);
        expect(cardStatus.text).toBe('');

        // A subsequent open-work read observed strictly after the replacement surfaces its own refusal and expiry
        const
            in4Days    = new Date(NOW + 4 * 86_400_000).toISOString(),
            newerOwner = {
                openWorkSnapshot: {
                    state     : 'ok',
                    observedAt: new Date(NOW + 60_000).toISOString(),
                    seats     : {
                        '@neo-fable-clio': {
                            authored         : [],
                            reviewing        : [],
                            credentialRefusal: {surface: 'forge', verdict: 'refused', cause: 'insufficient-capability', reason: 'new token lacks workflow scope'},
                            tokenExpiresAt   : in4Days
                        }
                    }
                }
            };
        record.set(OpenWorkRead.seatOpenWork(newerOwner, record.githubUsername));
        detail.applyRecord();
        card.applyRecord();
        expect(section.getReference('credential-line').text).toContain('new token lacks workflow scope · Next step: Replace token');
        expect(section.getReference('credential-expiry').hidden).toBe(false);
        expect(section.getReference('credential-expiry').text).toContain('in 4d');
        expect(runtimeReplace.hidden).toBe(false);
        expect(runtime.getReference('runtime-control-feedback').text).toBe('new token lacks workflow scope');
        expect(cardStatus.hidden).toBe(false);
        expect(cardStatus.text).toBe('⚠ GitHub token refused: new token lacks workflow scope · Replace token')
    });

    test('AC-5: tokenExpiresAt renders in Agent Detail, flags within 7 days in the cockpit with "Replace token", and null shows no expiry', () => {
        const record = makeRecord({state: 'off', tokenExpiresAt: null});
        detail = Neo.create(AgentDetail, {appName, now: NOW, record});
        card   = Neo.create(AgentCard,   {appName, now: NOW, record});

        const
            expiryLine     = detail.getReference('seat-credential').getReference('credential-expiry'),
            runtimeReplace = detail.getReference('seat-runtime').getReference('runtime-replace-token'),
            cardStatus     = card.getReference('control-status');

        // null -> no expiry shown anywhere
        expect(expiryLine.hidden).toBe(true);
        expect(expiryLine.text).toBe('');
        expect(runtimeReplace.hidden).toBe(true);
        expect(cardStatus.hidden).toBe(true);

        // > 7 days -> shown in Agent Detail, not flagged as expiring in the cockpit
        const in20Days = new Date(NOW + 20 * 86_400_000).toISOString();
        record.set({tokenExpiresAt: in20Days});
        detail.applyRecord();
        card.applyRecord();
        expect(expiryLine.hidden).toBe(false);
        expect(expiryLine.text).toBe(`GitHub token expires ${in20Days}`);
        expect(expiryLine.cls).not.toContain('is-expiring');
        expect(runtimeReplace.hidden).toBe(true);
        expect(cardStatus.hidden).toBe(true);

        // <= 7 days -> flagged in both Agent Detail and cockpit card with "Replace token" as action
        const in5Days = new Date(NOW + 5 * 86_400_000).toISOString();
        record.set({tokenExpiresAt: in5Days});
        detail.applyRecord();
        card.applyRecord();
        expect(expiryLine.hidden).toBe(false);
        expect(expiryLine.cls).toContain('is-expiring');
        expect(expiryLine.text).toContain('in 5d');
        expect(expiryLine.text).toContain('Replace token');
        expect(runtimeReplace.hidden).toBe(false);
        expect(cardStatus.hidden).toBe(false);
        expect(cardStatus.cls).toContain('is-credential-expiring');
        expect(cardStatus.text).toBe('⚠ GitHub token expires in 5d · Replace token')
    });

    test('a not-yet-expired 7-day token warning ranks below unplanned-exit and launch-admission state, while expired or refused tokens keep their rank', () => {
        const
            in6Days    = new Date(NOW + 6 * 86_400_000).toISOString(),
            exitReason = {
                state      : 'harness-update',
                exitedAt   : '2026-11-23T11:55:00.000Z',
                matchedLine: 'Quit and Install',
                logPath    : '/tmp/claude.log'
            },
            record     = makeRecord({state: 'off', exitReason, tokenExpiresAt: in6Days});

        detail = Neo.create(AgentDetail, {appName, now: NOW, record});
        card   = Neo.create(AgentCard,   {appName, now: NOW, record, rosterState: 'live'});

        const
            runtimeFeedback = detail.getReference('seat-runtime').getReference('runtime-control-feedback'),
            cardStatus      = card.getReference('control-status');

        // Stopped seat with harness-update exit + token expiring in 6d: exit reason leads on both card and Status tab
        expect(cardStatus.text).toContain('stopped · harness update — Claude Desktop quit this seat');
        expect(cardStatus.text).not.toContain('GitHub token expires');
        expect(cardStatus.cls).toContain('is-exit-harness-update');
        expect(cardStatus.cls).not.toContain('is-credential-expiring');
        expect(cardStatus.vdom.title).toContain('stopped · harness update');
        expect(cardStatus.vdom.title).toContain('GitHub token expires in 6d');

        expect(runtimeFeedback.text.startsWith('stopped · harness update — Claude Desktop quit this seat')).toBe(true);
        expect(runtimeFeedback.text).toContain('GitHub token expires in 6d');

        // Running seat with launch admission + token expiring in 6d: launch admission leads on the card
        record.set({state: 'ok', exitReason: null, launchAdmission: {state: 'reserved'}});
        detail.applyRecord();
        card.applyRecord();
        expect(cardStatus.text).toBe('Preparing tool access');
        expect(cardStatus.cls).not.toContain('is-credential-expiring');
        expect(cardStatus.vdom.title).toContain('Fleet is preparing new tool connections.');
        expect(cardStatus.vdom.title).toContain('GitHub token expires in 6d');

        // Already-expired token keeps its rank above unplanned exit
        const alreadyExpired = new Date(NOW - 60_000).toISOString();
        record.set({state: 'off', exitReason, launchAdmission: null, tokenExpiresAt: alreadyExpired});
        detail.applyRecord();
        card.applyRecord();
        expect(cardStatus.text).toBe('⚠ GitHub token expired · Replace token');
        expect(cardStatus.cls).toContain('is-credential-refused');
        expect(runtimeFeedback.text.startsWith('GitHub token expired')).toBe(true);

        // Refused token also keeps its rank above unplanned exit
        record.set({
            openWorkCredentialRefusal: {surface: 'forge', verdict: 'refused', cause: 'insufficient-capability', reason: 'missing read:org scope'},
            tokenExpiresAt           : in6Days
        });
        detail.applyRecord();
        card.applyRecord();
        expect(cardStatus.text).toBe('⚠ GitHub token refused: missing read:org scope · Replace token');
        expect(cardStatus.cls).toContain('is-credential-refused');
        expect(runtimeFeedback.text).toBe('missing read:org scope')
    });
});
