import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitOperatorMailboxTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * Covers the app-side operator-mailbox seam on `FleetCockpit` — the three methods the
 * composition root owns so the operator is a first-class Fleet participant:
 *
 * - `composeOperatorMessage` — the WRITE: route one composed message to the authenticated verb, then
 *   re-poll ONLY on a real send. Its unit is the routing + conditional re-read decision, so the bridge
 *   verb and the re-read (`loadOperatorInbox`) are both spied — this isolates "did it send, and did it
 *   re-read exactly when a message actually landed" from how either collaborator behaves.
 * - `buildOperatorRecipientOptions` — the pure roster→picker mapping: the mailbox IDENTITY
 *   (`@githubUsername`), never the Fleet `agentId` key. The fixture makes the two fields DIFFER so a
 *   read of the wrong one fails the test rather than passing by coincidence.
 * - `loadOperatorInbox` — the READ-OBSERVE own-inbox mirror read (the cockpit's one mailbox
 *   surface): the
 *   fail-closed matrix (no identity / no verb → honestly unobserved) plus BOTH fences (a superseded
 *   generation and a destroyed owner never write). The runtime source of `operatorRecord` is wired
 *   separately; the method's routing is fully pinned here by setting the identity owner-side.
 *
 * Same lightweight harness as the `loadActivity` block above: a plain fake cockpit + the prototype
 * method under `.call`, so each method's decision is exercised in isolation with no full instantiation.
 */
test.describe('Fleet cockpit — operator mailbox (compose · recipients · own-inbox read, #15377)', () => {
    let FleetCockpit, FleetCockpitController;

    // scope the mock to the `fleet` subkey ONLY (see the loadActivity block): replacing `globalThis.AgentOS`
    // would wipe every `AgentOS.*` registration for later specs in the shared worker.
    const clearBridge = () => { delete globalThis.AgentOS?.fleet };
    const setBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };

    // a fake owner for the compose seam: it records what `loadOperatorInbox` is (or is not) called with,
    // so the re-poll decision is assertable without dragging in the real read's pane/subject/bridge machinery.
    const makeComposeOwner = () => Object.assign(Object.create(FleetCockpitController.prototype), {
        inboxReloads: [],
        loadOperatorInbox(params) { this.inboxReloads.push(params); return Promise.resolve() }
    });

    // a fake owner for the read seam: a spy pane, an owner-held identity, the generation counter, and the
    // last-known snapshot — exactly the surface `loadOperatorInbox` reads and writes.
    const makeReadOwner = ({subject = 'NODE:operator', priorSnapshot = null, generation = 0, isDestroyed = false} = {}) => {
        const pane    = {snapshot: priorSnapshot, set(values) {Object.assign(this, values)}},
              cockpit = Object.assign(Object.create(FleetCockpitController.prototype), {
                  component                  : {getOperatorMailboxPane: () => pane, livenessReadTimeout: 1000},
                  operatorProfileId          : null,
                  operatorRecord             : subject ? {agentIdentityNodeId: subject} : null,
                  operatorSnapshot           : priorSnapshot,
                  operatorInboxReadGeneration: generation,
                  isDestroyed
              });

        return {pane, cockpit}
    };

    test.beforeAll(async () => {
        FleetCockpit           = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs')).default;
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default
    });

    test.afterEach(() => clearBridge());

    // --- composeOperatorMessage: fail-closed refusal + conditional canonical re-read -------------------

    test('compose · no bridge → honest per-recipient not-wired refusal, nothing sent, no re-poll', async () => {
        clearBridge();

        const owner   = makeComposeOwner(),
              outcome = await owner.composeOperatorMessage({to: 'AGENT:*', body: 'hi'});

        // one result per target, each an honest not-wired refusal — the surface renders each recipient's state
        expect(outcome).toEqual({results: [{to: 'AGENT:*', outcome: {status: 'not-wired', reason: 'fleet: operator compose verb not wired'}}]});
        expect(owner.inboxReloads, 'a refused send must not re-poll the inbox').toHaveLength(0)
    });

    test('compose · a bridge without composeOperatorMessage → the same not-wired refusal', async () => {
        setBridge({});

        const owner   = makeComposeOwner(),
              outcome = await owner.composeOperatorMessage({to: 'AGENT:*', body: 'hi'});

        expect(outcome).toEqual({results: [{to: 'AGENT:*', outcome: {status: 'not-wired', reason: 'fleet: operator compose verb not wired'}}]});
        expect(owner.inboxReloads).toHaveLength(0)
    });

    test('compose · a real send (messageId came back) passes the payload through UNCHANGED and re-polls once at offset 0', async () => {
        const seen = [];
        // frozen: if the cockpit tried to inject a sender field here (it must not — the server stamps it at
        // the authenticated ingress), strict-mode mutation of a frozen object would throw and fail the test
        const message = Object.freeze({to: '@neo-fable-vega', subject: 's', body: 'b', priority: 'high'});

        setBridge({composeOperatorMessage: async payload => { seen.push(payload); return {messageId: 'M:42', status: 'sent'} }});

        const owner   = makeComposeOwner(),
              outcome = await owner.composeOperatorMessage(message);

        // asserted against a fresh literal, not `message` itself, so an added/changed field would be caught;
        // the single target passes through with `to` set to that one recipient (never the list)
        expect(seen).toEqual([{to: '@neo-fable-vega', subject: 's', body: 'b', priority: 'high'}]);
        expect(outcome).toEqual({results: [{to: '@neo-fable-vega', outcome: {messageId: 'M:42', status: 'sent'}}]});
        // the ONLY re-read: from the top of the inbox, exactly once, because a message genuinely landed
        expect(owner.inboxReloads).toEqual([{offset: 0}])
    });

    test('compose · a rejected outcome (no messageId) returns honestly and re-polls NOTHING', async () => {
        setBridge({composeOperatorMessage: async () => ({status: 'rejected', reason: 'recipient unknown'})});

        const owner   = makeComposeOwner(),
              outcome = await owner.composeOperatorMessage({to: '@ghost', body: 'b'});

        expect(outcome).toEqual({results: [{to: '@ghost', outcome: {status: 'rejected', reason: 'recipient unknown'}}]});
        expect(owner.inboxReloads, 'nothing was sent, so nothing changed to re-read').toHaveLength(0)
    });

    test('compose · SEVERAL named recipients FAN OUT — one call each, per-target outcome, one re-poll for the batch', async () => {
        const seen = [];
        // vega sends, ghost is rejected — a discriminating mix a single aggregate verdict could not produce
        setBridge({composeOperatorMessage: async payload => {
            seen.push(payload.to);
            return payload.to === '@ghost' ? {status: 'rejected', reason: 'recipient unknown'} : {messageId: 'M:' + payload.to, status: 'sent'}
        }});

        const owner   = makeComposeOwner(),
              outcome = await owner.composeOperatorMessage({to: ['@neo-fable-vega', '@ghost'], subject: 's', body: 'b', priority: 'high'});

        // one authenticated call per named target, in order — the verb is one-target, the fan-out is the cockpit's
        expect(seen).toEqual(['@neo-fable-vega', '@ghost']);
        // each recipient carries its OWN result: vega landed, ghost was refused
        expect(outcome).toEqual({results: [
            {to: '@neo-fable-vega', outcome: {messageId: 'M:@neo-fable-vega', status: 'sent'}},
            {to: '@ghost',          outcome: {status: 'rejected', reason: 'recipient unknown'}}
        ]});
        // exactly one re-poll for the whole batch, because at least one message genuinely landed
        expect(owner.inboxReloads).toEqual([{offset: 0}])
    });

    test('compose · onOperatorCompose writes the settled outcome BACK onto the operator-mailbox — closes the loop', async () => {
        // the review's P1: the surface fires compose intent-only and Observable.fire discards handler
        // returns, so the fan-out result must return as owner-written state. This is the ONLY path it
        // reaches the UI — a probe mailbox catches the write-back.
        const mailbox    = {},
              controller = Object.create(FleetCockpitController.prototype);

        controller.composeOperatorMessage = async () => ({results: [{to: '@a', outcome: {messageId: 'M', status: 'sent'}}]});
        controller.getReference           = ref => ref === 'operator-mailbox' ? mailbox : null;

        await controller.onOperatorCompose({message: {to: ['@a']}, source: 'operator-mailbox'});

        expect(mailbox.composeOutcome).toEqual({results: [{to: '@a', outcome: {messageId: 'M', status: 'sent'}}]})
    });

    // --- buildOperatorRecipientOptions: the live roster → @githubUsername identity mapping -------------

    test('recipients · no provider roster yet → only the broadcast sentinel', () => {
        const owner = {resolveFleetRosterStore: () => null};

        expect(FleetCockpitController.prototype.buildOperatorRecipientOptions.call(owner)).toEqual([
            {id: 'AGENT:*', name: 'All agents (broadcast)'}
        ])
    });

    test('recipients · maps the LIVE roster to @githubUsername identities — NOT the agentId key — and drops rows with no mailbox identity', () => {
        // agentId ('vega') deliberately differs from githubUsername ('neo-fable-vega') so the test FAILS if the
        // mapping ever reads the wrong field; the third row has no githubUsername (an unregistered guest) and drops
        const items = [
            {agentId: 'vega',  githubUsername: 'neo-fable-vega'},
            {agentId: 'grace', githubUsername: 'neo-claude-opus'},
            {agentId: 'guest'}
        ];
        const owner = {resolveFleetRosterStore: () => ({items})};

        expect(FleetCockpitController.prototype.buildOperatorRecipientOptions.call(owner)).toEqual([
            {id: 'AGENT:*',          name: 'All agents (broadcast)'},
            {id: '@neo-fable-vega',  name: 'neo-fable-vega'},
            {id: '@neo-claude-opus', name: 'neo-claude-opus'}
        ])
    });

    // --- loadOperatorInbox: fail-closed matrix + both fences ------------------------------------------

    test('inbox · no bound operator identity → stays honestly unobserved, but the read attempt still advances the generation', async () => {
        // a snapshot that must NOT land: proving the guard fires before any read
        setBridge({fleetMailboxMirror: async () => ({rows: ['should-not-land']})});

        const {pane, cockpit} = makeReadOwner({subject: null});

        await cockpit.loadOperatorInbox({offset: 0});

        expect(pane.snapshot, 'no subject → the pane must not receive a fabricated snapshot').toBe(null);
        expect(cockpit.operatorSnapshot).toBe(null);
        // starting a read invalidates any older in-flight read even when THIS one fail-closes
        expect(cockpit.operatorInboxReadGeneration, 'the generation advances before the guard, so a slower older read cannot win').toBe(1)
    });

    test('inbox · a bridge without fleetMailboxMirror → fail-closed, no snapshot', async () => {
        setBridge({});

        const {pane, cockpit} = makeReadOwner();

        await cockpit.loadOperatorInbox({offset: 0});

        expect(pane.snapshot).toBe(null)
    });

    test('inbox · pane + subject + verb → reads at the operator identity and offset, writes BOTH owner and pane', async () => {
        const seen     = [],
              snapshot = {rows: [{id: 'msg-1'}], offset: 20};

        setBridge({fleetMailboxMirror: async params => { seen.push(params); return snapshot }});

        const {pane, cockpit} = makeReadOwner();

        await cockpit.loadOperatorInbox({offset: 20});

        // the subject is the operator's OWN identity, held owner-side; the offset threads through unchanged
        expect(seen).toEqual([{subjectAgentId: 'NODE:operator', offset: 20}]);
        expect(cockpit.operatorSnapshot).toBe(snapshot);
        expect(pane.snapshot).toBe(snapshot)
    });

    const openQuestions = (rows = [{messageId: 'MESSAGE:q'}]) => ({
        state: 'ok', reason: null, count: rows.length, rows, page: {limit: 50, offset: 0, count: rows.length, hasMore: false}, capturedAt: '2026-10-09T04:00:00.000Z'
    });

    test('inbox · the open view reads the operator\'s open questions and writes them to the pane alone', async () => {
        const seen = [], questions = openQuestions();

        setBridge({
            fleetMailboxMirror: async () => { throw new Error('the all-mail read must not run in the open view') },
            fleetOwnQuestions : async params => { seen.push(params); return questions }
        });

        const {pane, cockpit} = makeReadOwner();

        pane.view = 'open';
        await cockpit.loadOperatorInbox({offset: 0});

        // no identity crosses: the questions read is the viewer's own, stamped by the transport
        expect(seen).toEqual([{offset: 0}]);
        expect(pane.questions).toBe(questions);
        expect(pane.snapshot, 'the all-mail window stays as it was').toBe(null);
        expect(cockpit.operatorSnapshot, 'only the all-mail window is held for a rematerialized pane').toBe(null)
    });

    test('inbox · one fence serves both lists: a switch supersedes the other list\'s read in flight', async () => {
        let release;

        setBridge({
            fleetMailboxMirror: () => new Promise(resolve => { release = () => resolve({rows: ['late']}) }),
            fleetOwnQuestions : async () => openQuestions()
        });

        const {pane, cockpit} = makeReadOwner(),
              allMail         = cockpit.loadOperatorInbox({offset: 0});

        await Promise.resolve(); // the tracked wire invokes the bridge inside its promise chain
        pane.view = 'open';
        const questions = cockpit.loadOperatorInbox({offset: 0});
        expect(cockpit.operatorInboxReadInFlight, 'the new view queues behind the one real wire').toBe(1);
        release();
        await Promise.all([allMail, questions]);

        expect(pane.snapshot, 'the superseded all-mail window never lands').toBe(null);
        expect(pane.questions.state).toBe('ok')
    });

    test('inbox · a gesture-torn mailbox resolves through the owner\'s held vessel handle', async () => {
        const docked  = {id: 'docked'},
              torn    = {id: 'torn'},
              proto   = FleetCockpit.prototype,
              cockpit = {
                  dockModel      : {items: {operator: {reference: 'operator-mailbox'}}},
                  getReference   : reference => reference === 'operator-mailbox' ? docked : null,
                  paneReference  : proto.paneReference,
                  // the engine's tear-out owner holds the captured handle; the accessor asks it first
                  tearOutHandlers: {heldPane: itemId => itemId === 'operator' ? torn : null, heldPanes: () => [torn]},
                  vesselPane     : proto.vesselPane
              };

        expect(proto.getOperatorMailboxPane.call(cockpit)).toBe(torn)
    });

    test('inbox · a superseded read never overwrites newer news (generation fence)', async () => {
        const fresh = {rows: ['fresh']},
              stale = {rows: ['stale']};

        const {pane, cockpit} = makeReadOwner({priorSnapshot: fresh, generation: 5});

        // the verb bumps the owner's generation DURING the await — modelling a newer read that started and
        // finished while this one was in flight; when this stale read resumes, its captured generation no longer matches
        setBridge({fleetMailboxMirror: async () => { cockpit.operatorInboxReadGeneration++; return stale }});

        await cockpit.loadOperatorInbox({offset: 0});

        expect(pane.snapshot, 'the loser of the race must not write staler news over newer').toBe(fresh);
        expect(cockpit.operatorSnapshot).toBe(fresh)
    });

    test('inbox · a read that resolves after the cockpit is destroyed writes nothing', async () => {
        const prior = {rows: ['prior']};

        const {pane, cockpit} = makeReadOwner({priorSnapshot: prior, isDestroyed: true});

        setBridge({fleetMailboxMirror: async () => ({rows: ['late']})});

        await cockpit.loadOperatorInbox({offset: 0});

        expect(pane.snapshot).toBe(prior);
        expect(cockpit.operatorSnapshot).toBe(prior)
    });

    test('inbox · the verb throwing keeps the last-known snapshot (fail-closed catch)', async () => {
        const prior = {rows: ['prior']};

        const {pane, cockpit} = makeReadOwner({priorSnapshot: prior});

        setBridge({fleetMailboxMirror: async () => { throw new Error('ingress down') }});

        await cockpit.loadOperatorInbox({offset: 0});

        // fail-closed: the pane never renders "no mail" for a read that did not happen
        expect(pane.snapshot).toBe(prior);
        expect(cockpit.operatorSnapshot).toBe(prior)
    });

    // --- loadOperatorIdentity: the whoami bootstrap (resolveViewerIdentity → seed → pane) --------------

    test('identity · no resolveViewerIdentity verb → fail-closed, no operatorRecord seeded', async () => {
        setBridge({});

        const cockpit = Object.assign(Object.create(FleetCockpitController.prototype), {
            component: {getOperatorMailboxPane: () => ({set() {}})}, operatorRecord: null
        });

        await cockpit.loadOperatorIdentity();

        expect(cockpit.operatorRecord).toBe(null)
    });

    test('identity · resolveViewerIdentity ok → seeds operatorRecord (incl. the githubUsername possession authority) AND pushes it to the pane', async () => {
        // a realistic @-form node id — the mailbox subject the adapter returns, not a `NODE:` placeholder
        setBridge({resolveViewerIdentity: async () => ({ok: true, agentIdentityNodeId: '@neo-opus-grace'})});

        const paneSets = [],
              pane     = {set(cfg) { paneSets.push(cfg) }},
              cockpit  = Object.assign(Object.create(FleetCockpitController.prototype), {
                  component              : {getOperatorMailboxPane: () => pane},
                  isDestroyed            : false,
                  operatorRecord         : null,
                  resolveFleetRosterStore: () => null
              });

        await cockpit.loadOperatorIdentity();

        // the record MUST carry `githubUsername` — MailboxPane's possession guard canonicalizes it to
        // `@<username>` and matches the admission's subjectAgentId; seeding only the node id fails
        // possession closed and the own inbox never renders (the exact review finding).
        // The push also carries the seat-conflation posture (null here: no roster in this fake —
        // absence of roster truth is not a clean bill).
        const expected = {agentIdentityNodeId: '@neo-opus-grace', githubUsername: 'neo-opus-grace'};
        expect(cockpit.operatorRecord).toEqual(expected);
        expect(paneSets).toEqual([{record: expected, identityPosture: null}])
    });

    test('identity · a refusal (ok:false — unbound / source-not-wired) never seeds a wrong subject', async () => {
        setBridge({resolveViewerIdentity: async () => ({ok: false, error: 'viewer identity unbound — authenticated ingress required'})});

        const cockpit = Object.assign(Object.create(FleetCockpitController.prototype), {
            component: {getOperatorMailboxPane: () => ({set() {}})}, isDestroyed: false, operatorRecord: null
        });

        await cockpit.loadOperatorIdentity();

        expect(cockpit.operatorRecord, 'a refusal leaves the pane honestly unobserved, never a fallback identity').toBe(null)
    });

    test('identity · a bridge throw (no bearer injected) ends in the loader: the boot call is fire-and-forget, so a rejection would surface as an unhandled App Worker error', async () => {
        setBridge({resolveViewerIdentity: async () => { throw new Error('fleet bearer not injected') }});

        const cockpit = Object.assign(Object.create(FleetCockpitController.prototype), {
            component: {getOperatorMailboxPane: () => ({set() {}})}, isDestroyed: false, operatorRecord: null
        });

        await expect(cockpit.loadOperatorIdentity()).resolves.toBe(null);

        expect(cockpit.operatorRecord, 'a throw is absence, never a fallback identity').toBe(null)
    });

    test('identity · a not-yet-materialized pane (torn, or dropped by a custom document) still seeds the record for a projection-time read', async () => {
        setBridge({resolveViewerIdentity: async () => ({ok: true, agentIdentityNodeId: '@neo-opus-grace'})});

        // the pane resolves null (the resident tab normally exists at identity time, but a torn
        // vessel mid-flight or a memories-less custom document leaves the accessor empty); the
        // `?.set` no-ops but the record is held owner-side (with the possession authority), so the
        // next projection materializes the pane and reads. The posture derive rides the same
        // resolution over the cockpit surface (an empty provider roster → null posture).
        const cockpit = Object.assign(Object.create(FleetCockpitController.prototype), {
            component              : {getOperatorMailboxPane: () => null},
            isDestroyed            : false,
            operatorRecord         : null,
            resolveFleetRosterStore: () => null
        });

        await cockpit.loadOperatorIdentity();

        expect(cockpit.operatorRecord).toEqual({agentIdentityNodeId: '@neo-opus-grace', githubUsername: 'neo-opus-grace'})
    });

    test.describe('target binding — the operator\'s mailbox belongs to the profile that answered (#436)', () => {
        const
            mail     = {rows: ['a:mail']},
            operator = {agentIdentityNodeId: '@op', githubUsername: 'op'},
            retired  = {composeOutcome: null, identityPosture: null, questions: null, readFailed: false, record: null, snapshot: null},
            flush    = () => new Promise(resolve => setTimeout(resolve, 0)),
            // the identity and window profile A answered, held the way a real controller holds them
            heldByA  = (fields = {}) => {
                const pane = {sets: [], set(cfg) { this.sets.push(cfg) }};

                return {pane, cockpit: Object.assign(Object.create(FleetCockpitController.prototype), {
                    component                  : {getOperatorMailboxPane: () => pane},
                    isDestroyed                : false,
                    operatorIdentityPosture    : null,
                    operatorInboxReadGeneration: 3,
                    operatorProfileId          : 'a',
                    operatorRecord             : {...operator},
                    operatorSnapshot           : mail,
                    resolveFleetRosterStore    : () => null,
                    ...fields
                })}
            };

        test('a switch to an unreachable profile retires the old identity and window — nothing of A stays under B', async () => {
            const {pane, cockpit} = heldByA();

            setBridge({profileId: 'b', resolveViewerIdentity: async () => { throw new Error('plane unreachable') }});

            await expect(cockpit.loadOperatorIdentity()).resolves.toBe(null);

            expect(pane.sets).toEqual([retired]);
            expect(cockpit.operatorRecord).toBe(null);
            expect(cockpit.operatorSnapshot).toBe(null);
            expect(cockpit.operatorProfileId).toBe(null);
            expect(cockpit.operatorInboxReadGeneration, 'the retire fences any read A still has in flight').toBe(4)
        });

        test('a page asked through B\'s bridge is never read as A\'s viewer', async () => {
            const
                asked             = [],
                {pane, cockpit}   = heldByA();

            setBridge({profileId: 'b', fleetMailboxMirror: async params => { asked.push(params); return {rows: ['b:mail']} }});

            await cockpit.loadOperatorInbox({offset: 20});

            expect(asked).toEqual([]);
            expect(pane.sets).toEqual([retired]);
            expect(cockpit.operatorSnapshot).toBe(null)
        });

        test('an answer that started under A does not land once B is the bridge in hand', async () => {
            let release;

            const {pane, cockpit} = heldByA({operatorProfileId: null, operatorRecord: null, operatorSnapshot: null});

            setBridge({profileId: 'a', resolveViewerIdentity: () => new Promise(resolve => { release = resolve })});

            const identity = cockpit.loadOperatorIdentity();

            setBridge({profileId: 'b'});
            release({ok: true, agentIdentityNodeId: '@op'});

            await expect(identity).resolves.toBe(null);
            expect(cockpit.operatorRecord).toBe(null);
            expect(pane.sets).toEqual([]);

            // a window A was still reading: B's retire fences it
            const held = heldByA();

            setBridge({profileId: 'a', fleetMailboxMirror: () => new Promise(resolve => { release = resolve })});

            const read = held.cockpit.loadOperatorInbox({offset: 0});

            setBridge({profileId: 'b', resolveViewerIdentity: async () => ({ok: false})});
            await held.cockpit.loadOperatorIdentity();
            release({rows: ['a:late']});
            await read;

            expect(held.cockpit.operatorSnapshot).toBe(null);
            expect(held.pane.snapshot).toBe(undefined)
        });

        // the inherited re-drive is the liveness layer's own; stubbed here so the override is what runs
        const reconnectable = cockpit => Object.assign(cockpit, Object.fromEntries([
            'ensureViewerWakeStream', 'loadActivity', 'loadBrainHealth', 'loadDeploymentState',
            'loadGoldenPath', 'loadGraphScene', 'loadRoster', 'loadTasks'
        ].map(name => [name, () => {}])), {component: {
            ...cockpit.component, getCatchUpPane: () => null, getMemoriesPane: () => null, getWakeRoutesPane: () => null
        }});

        test('Reconnect after a switch binds B\'s identity, which reads its own first window — no second read', async () => {
            const
                {pane, cockpit} = heldByA(),
                reads           = [];

            reconnectable(cockpit).loadOperatorInbox = params => { reads.push(params) };

            setBridge({profileId: 'b', resolveViewerIdentity: async () => ({ok: true, agentIdentityNodeId: '@op'})});

            cockpit.reconnectFleet();
            await flush();

            // the same handle on both instances still re-binds: the retire nulled it, so the pane's
            // record goes null → set and the pane asks for its first window itself
            expect(pane.sets).toEqual([retired, {record: operator, identityPosture: null}]);
            expect(cockpit.operatorProfileId).toBe('b');
            expect(reads).toEqual([])
        });

        test('Reconnect on the same profile retires nothing and re-reads the first window', async () => {
            const
                {pane, cockpit} = heldByA(),
                reads           = [];

            reconnectable(cockpit).loadOperatorInbox = params => { reads.push(params) };

            setBridge({profileId: 'a', resolveViewerIdentity: async () => ({ok: true, agentIdentityNodeId: '@op'})});

            cockpit.reconnectFleet();
            await flush();

            expect(pane.sets).toEqual([{record: operator, identityPosture: null}]);
            expect(cockpit.operatorSnapshot).toBe(mail);
            expect(reads).toEqual([{offset: 0}])
        });

        test('an A Reconnect still in flight when B binds adds no read of B\'s window', async () => {
            let release;

            const
                {pane, cockpit} = heldByA(),
                reads           = [];

            reconnectable(cockpit).loadOperatorInbox = params => { reads.push(params) };

            setBridge({profileId: 'a', resolveViewerIdentity: () => new Promise(resolve => { release = resolve })});
            cockpit.reconnectFleet();

            setBridge({profileId: 'b', resolveViewerIdentity: async () => ({ok: true, agentIdentityNodeId: '@op'})});
            cockpit.reconnectFleet();
            await flush();

            // A's answer settles last: stale, so its continuation reads nothing
            release({ok: true, agentIdentityNodeId: '@op'});
            await flush();

            expect(pane.sets).toEqual([retired, {record: operator, identityPosture: null}]);
            expect(cockpit.operatorProfileId).toBe('b');
            expect(reads, 'B bound anew, so only the pane asks for its first window').toEqual([])
        });

        test('a send A started that settles after B binds keeps its result, but never reaches B\'s pane or B\'s inbox', async () => {
            let release;

            const
                {pane, cockpit} = heldByA(),
                receipt         = {messageId: 'MESSAGE:a-sent'},
                reads           = [];

            cockpit.getReference      = reference => reference === 'operator-mailbox' ? pane : null;
            cockpit.loadOperatorInbox = params => { reads.push(params) };

            setBridge({profileId: 'a', composeOperatorMessage: () => new Promise(resolve => { release = resolve })});

            const sent = cockpit.onOperatorCompose({message: {to: '@peer', subject: 's', body: 'b'}});

            setBridge({profileId: 'b', resolveViewerIdentity: async () => ({ok: true, agentIdentityNodeId: '@op'})});
            await cockpit.loadOperatorIdentity();
            release(receipt);

            await expect(sent, 'the real send result still returns').resolves.toEqual({results: [{to: '@peer', outcome: receipt}]});
            expect(pane.composeOutcome, 'A\'s receipt never lands in B\'s form').toBe(undefined);
            expect(reads, 'and B\'s inbox is not re-read on A\'s behalf').toEqual([]);
            expect(pane.sets).toEqual([retired, {record: operator, identityPosture: null}])
        });
    });
});
