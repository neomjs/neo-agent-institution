import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetAgentDetailTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance       from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * @summary Tests for the FM cockpit AgentDetail drill-in view — the identity
 * header (name-as-display-state over the durable id, engine-as-metadata, family rebind in place,
 * no role fields) over the four SSOT panes, each freshness-labeled per §2.2.1 (fresh/stale/lost
 * from a wired ledger, honest `unobserved` until a feed lands). `now` is injected + pinned so the
 * freshness contract renders deterministically.
 */
test.describe('Fleet cockpit AgentDetail — drill-in inspector (#14608)', () => {
    let AgentDetail, AgentDetailController, AgentDefinition, FleetAgent, FleetTenants, Store;

    const
        stores          = [],
        // a fixed clock + observations at fixed offsets; a wired runtime so the state dot can render live
        NOW             = Date.parse('2026-07-12T00:00:00.000Z'),
        observedSources = {
            roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
            repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
            runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
        },
        observedLane = {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed'};

    // a real store-backed record — the production shape (an AgentOS.store.FleetRoster row). The store
    // mirrors FleetRoster's keyProperty (the collection default 'id' would shadow the model's).
    const makeRecord = data => {
        const row = {
                  // mirrors production: the roster DTO carries the mailbox IDENTITY authority
                  // (@githubUsername) beside the registry key — consumed by the south mailbox
                  // surfaces (recipient picker, subject scoping), so the fixture keeps both fields.
                  githubUsername: data.githubUsername === undefined ? `neo-${data.agentId}` : data.githubUsername,
                  ...data,
                  sources: data.sources === undefined ? observedSources : data.sources
              },
              store = Neo.create(Store, {keyProperty: 'agentId', model: FleetAgent, data: [row]});

        stores.push(store);

        return store.get(data.agentId)
    };

    const createDetail = (data, config = {}) => Neo.create(AgentDetail, {appName, now: NOW, record: makeRecord(data), ...config});

    // the cockpit routes the store's recordChange to the view; standalone units drive the same seam.
    const applySet = (detail, values) => {
        detail.record.set(values);
        detail.applyRecord()
    };

    const chip = (detail, key) => detail.down({reference: `pane-${key}-freshness`});
    const body = (detail, key) => detail.down({reference: `pane-${key}-body`});
    /**
     * @summary Hold a transport response or scheduler wait until the test releases it.
     * @returns {{promise: Promise, resolve: Function, reject: Function}}
     */
    const deferred = () => {
        let resolve, reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject  = rej
        });

        return {promise, resolve, reject}
    };

    test.beforeAll(async () => {
        AgentDetail           = (await import('../../../../../../../../apps/agentos/view/fleet/detail/Container.mjs')).default;
        AgentDetailController = (await import('../../../../../../../../apps/agentos/view/fleet/detail/Controller.mjs')).default;
        AgentDefinition       = (await import('../../../../../../../../apps/agentos/model/AgentDefinition.mjs')).default;
        FleetAgent            = (await import('../../../../../../../../apps/agentos/model/FleetAgent.mjs')).default;
        FleetTenants          = (await import('../../../../../../../../apps/agentos/store/FleetTenants.mjs')).default;
        Store                 = (await import('../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default
    });

    test.afterAll(() => {
        stores.forEach(store => store.destroy());
        stores.length = 0
    });

    test('no record → the honest empty state; header + tabs hidden until a resident is selected', () => {
        const detail = Neo.create(AgentDetail, {appName});

        expect(detail.down({reference: 'detail-empty'}).hidden).toBe(false);
        expect(detail.down({reference: 'detail-header'}).hidden).toBe(true);
        // the visibility gate is the TAB container (Status + Configuration ride inside it)
        expect(detail.down({reference: 'detail-tabs'}).hidden).toBe(true);

        detail.destroy()
    });

    test('the detail body is a tab container: Status panes + the Configuration tab — the mailbox surface lives in the south pane alone', () => {
        const detail = Neo.create(AgentDetail, {appName});
        const tabs   = detail.down({reference: 'detail-tabs'});

        expect(detail.down({reference: 'detail-panes'})).toBeTruthy();
        expect(detail.down({reference: 'config-pane'})).toBeTruthy();

        // exactly one surface may carry the Mailbox label (the south pane owns the view) — the
        // retired per-agent tab must not silently return
        expect(detail.down({reference: 'mailbox-pane'})).toBeFalsy();

        const buttonTexts = tabs.getTabBar().items.map(button => button.text);
        expect(buttonTexts).toEqual(['Status', 'Configuration']);

        detail.destroy()
    });

    test('a11y: the drill is a named landmark region that survives a record re-seat (#14619)', () => {
        const detail = createDetail({
            agentId: 'vega', displayName: 'Vega', family: 'claude', engineTag: 'opus-4.8', state: 'ok'
        });

        // the drill is a named landmark region so screen-reader users land in a labeled region on
        // drill-in (not an unnamed pane)
        expect(detail.vdom.role).toBe('region');
        expect(detail.vdom['aria-label']).toBe('Agent detail');

        // applyRecord re-seats via child-reference .set() and never replaces the root, so the region
        // MUST survive a re-seat — a returning agent selection must not silently drop the landmark
        applySet(detail, {displayName: 'Vega Prime'});
        expect(detail.vdom.role).toBe('region');
        expect(detail.vdom['aria-label']).toBe('Agent detail');

        detail.destroy()
    });

    test('a selected resident renders the ADR-0032 identity header + reveals the panes; no per-view provider', () => {
        const detail = createDetail({
            agentId: 'vega', avatarUrl: 'vega.png', displayName: 'Vega', family: 'claude', engineTag: 'opus-4.8', state: 'ok'
        });

        // one record surface, zero providers
        expect(detail.record.agentId).toBe('vega');
        expect(detail.stateProvider ?? null).toBeNull();

        // empty state gone, header + panes shown
        expect(detail.down({reference: 'detail-empty'}).hidden).toBe(true);
        expect(detail.down({reference: 'detail-header'}).hidden).toBe(false);
        expect(detail.down({reference: 'detail-panes'}).hidden).toBe(false);

        // identity header: family rail + state dot + name/engine/id from the record
        expect(detail.down({ntype: 'fm-family-rail'}).family).toBe('claude');
        expect(detail.down({ntype: 'fm-state-dot'}).state).toBe('ok');
        expect(detail.down({ntype: 'image'}).src).toBe('vega.png');
        expect(detail.down({reference: 'detail-name'}).text).toBe('Vega');
        expect(detail.down({reference: 'detail-engine'}).text).toBe('opus-4.8');
        // the durable anchor is always shown — name is display state OVER it (§2.3.2)
        expect(detail.down({reference: 'detail-id'}).text).toBe('vega');

        detail.destroy()
    });

    test('the Seat row: the family in words, the whole path and Copy path, only for a reported path; a Claude Desktop seat adds its first-launch step', () => {
        const
            repoPath = '/Users/x/Library/Application Support/neo-harness/brain/fleet/agents/vega/neomjs/neo',
            detail   = createDetail({agentId: 'vega', displayName: 'Vega', harnessType: 'claude-desktop', repoPath, state: 'ok'}),
            part     = reference => detail.down({reference});

        expect(part('detail-seat').hidden).toBe(false);
        expect(part('detail-seat-family').text).toBe('Claude · App');
        expect(part('detail-seat-path').text, 'the whole path, never elided').toBe(repoPath);
        expect(part('detail-seat-copy').text).toBe('Copy path');
        expect(part('detail-seat-field').vdom.value).toBe(repoPath);
        expect(part('detail-seat-launch').hidden).toBe(false);
        expect(part('detail-seat-launch').text).toBe('Open this folder in Claude\'s Code tab, then start the seat from its card.');

        // another family has the row and no first-launch step: it is launched into its folder
        applySet(detail, {harnessType: 'codex-desktop'});
        expect(part('detail-seat-family').text).toBe('Codex · App');
        expect(part('detail-seat-launch').hidden).toBe(true);

        // no reported path: no row, no placeholder
        applySet(detail, {repoPath: null});
        expect(part('detail-seat').hidden).toBe(true);

        detail.destroy()
    });

    test('Copy path selects the unseen field, copies through the main thread, and hands the focus back', async () => {
        const
            detail = createDetail({agentId: 'vega', harnessType: 'codex', repoPath: '/Users/x/agents/vega/neomjs/neo', state: 'ok'}),
            calls  = [],
            main   = Neo.main ?? (Neo.main = {}),
            saved  = main.DomAccess;

        main.DomAccess = {
            selectNode : async ({id})      => calls.push(['select', id]),
            execCommand: async ({command}) => calls.push(['execCommand', command]),
            focus      : async ({id})      => calls.push(['focus', id])
        };

        try {
            await detail.onCopySeatPath({detail: 1});

            expect(calls.slice(0, 2)).toEqual([['select', detail.down({reference: 'detail-seat-field'}).id], ['execCommand', 'copy']])
        } finally {
            main.DomAccess = saved;
            detail.destroy()
        }
    });

    test('ADR-0032 §2.3.2: name/engine are display state over the durable id — a rename re-renders in place, never a re-key', () => {
        const detail   = createDetail({agentId: 'vega', displayName: 'Vega', engineTag: 'opus-4.8', state: 'ok'});
        const beforeId = detail.id;

        applySet(detail, {displayName: 'Vega (renamed)', engineTag: 'fable-5'});

        expect(detail.id).toBe(beforeId);           // the SAME instance — identity is the durable id
        expect(detail.record.agentId).toBe('vega');
        expect(detail.down({reference: 'detail-name'}).text).toBe('Vega (renamed)');
        expect(detail.down({reference: 'detail-engine'}).text).toBe('fable-5');
        expect(detail.down({reference: 'detail-id'}).text).toBe('vega');

        detail.destroy()
    });

    test('ADR-0032 §2.3.3: a cross-family swap rebinds the rail in place — the SAME resident, not a new self', () => {
        const detail   = createDetail({agentId: 'vega', family: 'claude', state: 'ok'});
        const beforeId = detail.id;

        applySet(detail, {family: 'gpt'});

        expect(detail.id).toBe(beforeId);
        expect(detail.down({ntype: 'fm-family-rail'}).family).toBe('gpt');

        detail.destroy()
    });

    test('a null displayName falls back to the durable id, never a blank name slot', () => {
        const detail = createDetail({agentId: 'neo-gpt-emmy', displayName: null, state: 'ok'});

        expect(detail.down({reference: 'detail-name'}).text).toBe('neo-gpt-emmy');

        detail.destroy()
    });

    test('participationStatus renders as availability (not a role); an unstamped status hides the line', () => {
        const detail = createDetail({agentId: 'gem', participationStatus: 'operator_benched', state: 'off'});

        const rowTexts = () => (detail.down({reference: 'detail-ledger'}).vdom.cn ?? []).map(node => node.text ?? '');

        expect(rowTexts()).toContain('status');
        expect(rowTexts()).toContain('operator benched');

        // null (no identity-root fact) → no row, never guessed: in the ledger, absent facts are absent
        applySet(detail, {participationStatus: null});
        expect(rowTexts()).not.toContain('status');

        detail.destroy()
    });

    test('the state dot is gated on a wired runtime source — missing runtime evidence never renders live', () => {
        const
            detail  = createDetail({agentId: 'vega', state: 'ok'}),
            session = () => {
                const nodes = detail.down({reference: 'detail-ledger'}).vdom.cn ?? [],
                      index = nodes.findIndex(node => node.text === 'session');

                return {text: nodes[index + 1]?.text, title: nodes[index + 1]?.title ?? null}
            };

        expect(detail.down({ntype: 'fm-state-dot'}).state).toBe('ok');
        expect(detail.down({ntype: 'fm-state-dot'}).live).toBe(true);
        expect(session()).toEqual({text: 'working', title: null});

        // missing runtime evidence resolves the resident offline, unobserved — the SAME truth the
        // grid card renders (one resolver, three surfaces), never live, never a false benched verdict
        applySet(detail, {sources: {
            ...observedSources,
            runtime: {source: 'fleet:runtimeStatus', state: 'not-wired', confidence: 'none'}
        }});
        expect(detail.down({ntype: 'fm-state-dot'}).state).toBe('off');
        expect(detail.down({ntype: 'fm-state-dot'}).live).toBe(false);
        // the detail carries the reason too
        expect(session()).toEqual({text: 'offline · unobserved', title: 'Fleet runs no process for it, so it has no session to read'});

        applySet(detail, {participationStatus: 'operator_benched'});
        expect(session().text).toBe('offline · benched');

        detail.destroy()
    });

    test('§2.2.1 freshness: each pane renders its ledger class — fresh/stale/lost from observedAt, unobserved with no ledger', () => {
        const detail = createDetail({agentId: 'vega', state: 'ok'}, {
            paneLedgers: {
                'thought-stream': {observedAt: '2026-07-11T23:59:50.000Z', freshnessTtl: 30_000}, // 10s → fresh
                lane            : {observedAt: '2026-07-11T23:58:30.000Z', freshnessTtl: 30_000}, // 90s → stale
                repo            : {lost: true}                                                    // explicit → lost
                // prs: no ledger → unobserved
            }
        });

        expect(chip(detail, 'thought-stream').cls).toContain('is-fresh');
        expect(chip(detail, 'thought-stream').text).toBe('updated 10s ago');
        expect(chip(detail, 'lane').cls).toContain('is-stale');
        expect(chip(detail, 'repo').cls).toContain('is-lost');
        expect(chip(detail, 'prs').cls).toContain('is-unobserved');
        expect(chip(detail, 'prs').text).toBe('not observed — source not wired');

        detail.destroy()
    });

    test('§2.2.1 freshness re-labels reactively when a feed stamps a new observation (paneLedgers set)', () => {
        const detail = createDetail({agentId: 'vega', state: 'ok'});

        // no ledgers → all unobserved
        expect(chip(detail, 'lane').cls).toContain('is-unobserved');

        // a feed wires the lane ledger → the pane sharpens to timestamped freshness, no re-seat
        detail.paneLedgers = {lane: {observedAt: '2026-07-11T23:59:55.000Z', freshnessTtl: 30_000}}; // 5s → fresh
        expect(chip(detail, 'lane').cls).toContain('is-fresh');
        expect(chip(detail, 'lane').text).toBe('updated 5s ago');

        detail.destroy()
    });

    test('the lane pane body renders the record-known lane line + open-lane count; feed-gated panes degrade honestly', () => {
        const detail = createDetail({agentId: 'vega', laneLine: 'FM cockpit agent detail view', openLaneCount: 17, state: 'ok'});

        expect(body(detail, 'lane').text).toBe('FM cockpit agent detail view · 17 open lanes');
        // a feed-gated pane never fabricates a stream — and never repeats the head's honest
        // "not observed" as a body line either: the body stays EMPTY, the awaiting truth
        // rides the freshness pill's title
        expect(body(detail, 'thought-stream').text).toBe('');
        expect(chip(detail, 'thought-stream').vdom.title).toContain('awaiting a policy-aware read');

        // no lane reported → honest fallback, no fabricated count
        applySet(detail, {laneLine: null, openLaneCount: null});
        expect(body(detail, 'lane').text).toBe('no current lane reported');

        detail.destroy()
    });

    test('the lane source uses the roster observation stamp while the body ages the lane claim itself', () => {
        const detail = createDetail({
            agentId: 'vega',
            laneLine: 'working on #418',
            laneClaimedAt: new Date(NOW - 120_000).toISOString(),
            openLaneCount: 17,
            sources: {...observedSources, lane: observedLane},
            state: 'ok'
        }, {rosterObservedAt: NOW - 10_000});

        // With no explicit lane ledger, the wired lane fact derives its pill age from roster admission.
        expect(chip(detail, 'lane').text).toBe('updated 10s ago');
        expect(body(detail, 'lane').text).toBe('working on #418 · claimed 2m ago · 17 open lanes');

        // A later roster read re-ages the source pill in place; it does not rewrite the claim timestamp.
        detail.rosterObservedAt = NOW - 40 * 60_000;
        expect(chip(detail, 'lane').cls).toContain('is-lost');
        expect(body(detail, 'lane').text).toBe('working on #418 · claimed 2m ago · 17 open lanes');

        detail.destroy()
    });

    test('an explicit lane pane ledger outranks the roster source for freshness only', () => {
        const detail = createDetail({
            agentId: 'vega',
            laneLine: 'working on #418',
            laneClaimedAt: new Date(NOW - 120_000).toISOString(),
            openLaneCount: 1,
            sources: {...observedSources, lane: observedLane},
            state: 'ok'
        }, {
            paneLedgers: {lane: {observedAt: new Date(NOW - 20_000).toISOString(), freshnessTtl: 30_000}},
            rosterObservedAt: NOW - 40 * 60_000
        });

        expect(chip(detail, 'lane').text).toBe('updated 20s ago');
        expect(chip(detail, 'lane').cls).toContain('is-fresh');
        expect(body(detail, 'lane').text).toBe('working on #418 · claimed 2m ago · 1 open lane');

        detail.destroy()
    });

    test('a hostile producer reason reaches the readout as TEXT, never as markup (@neo-gpt\'s exact probe)', () => {
        // The describer was never wrong: it returns the producer's reason as DATA, exactly as asked.
        // The view then interpolated that data into an `html` string, and Neo routes `html` to
        // innerHTML — so a remote adapter's sentence about its own failure became executable in the
        // cockpit. telltale.spec.mjs cannot see this: it asks what the describer RETURNS, and the
        // defect lives in what the view DOES with it. That gap is why the probe belongs here.
        //
        // The reason is the one string on this surface nobody in this repo writes.
        const hostile = '<img src=x onerror=globalThis.PWNED=1>',
              detail  = createDetail({
                  agentId : 'vega',
                  state   : 'ok',
                  wake    : {state: 'on'},
                  throttle: {source: 'fleet:throttle', state: 'unknown', confidence: 'none', reason: hostile}
              });

        const ledger = detail.down({reference: 'detail-ledger'});

        // the sink itself: ANY html on this node re-opens the hole regardless of today's content
        expect(ledger.html).toBeFalsy();

        const nodes = ledger.vdom.cn ?? [];

        // carried, inert, and still READABLE — an operator needs the producer's evidence; it rides
        // the pill's title ATTRIBUTE, which is an attribute string: inert like a text node
        expect(nodes.some(node => node.title === hostile)).toBe(true);

        // …and nowhere as markup, on any node
        nodes.forEach(node => {
            expect(node.html).toBeFalsy();
            (node.cls ?? []).forEach(cls => expect(cls).not.toContain('<'))
        });

        expect(globalThis.PWNED).toBeUndefined();

        delete globalThis.PWNED;
        detail.destroy()
    });

    test('an honest reason still renders alongside both axes — the guard must not eat the evidence', () => {
        const detail = createDetail({
            agentId : 'vega',
            state   : 'ok',
            wake    : {state: 'on'},
            throttle: {source: 'fleet:throttle', state: 'unknown', confidence: 'none', reason: 'no throttle reader injected'}
        });

        const nodes = detail.down({reference: 'detail-ledger'}).vdom.cn ?? [],
              texts = nodes.map(node => node.text ?? '');

        // an OBSERVED capacity axis renders (the source gate silences only the unreported case),
        // wearing the axis word the enum measures; the producer's reason rides the pill title
        expect(texts).toContain('capacity');
        expect(texts).toContain('unknown');
        expect(nodes.some(node => node.title === 'no throttle reader injected')).toBe(true);
        expect(texts).toContain('wake');
        expect(texts).toContain('on');

        detail.destroy()
    });

    test('the drill-in states all three source facts unconditionally — the counterpart to the card\'s one word-line', () => {
        // the default fixture wires all three (roster/repo/runtime observed). The detail is the opposite
        // of the card's exception-based strip: every source states itself, with its producer, always —
        // an operator who drilled in needs "runtime: wired, observed by X" confirmed, never omitted.
        const detail = createDetail({agentId: 'vega', state: 'ok'}),
              ledger = detail.down({reference: 'detail-ledger'});

        // the same sink guard the old stacks carried: ANY html on this node re-opens the innerHTML hole
        expect(ledger.html).toBeFalsy();

        const nodes = ledger.vdom.cn ?? [],
              texts = nodes.map(node => node.text ?? '');

        // all three axes state themselves, each pill carrying confidence in TEXT and the producer
        // literal on its title — the provenance the compact card had no room for
        expect(texts).toContain('runtime');
        expect(texts).toContain('repository');
        expect(texts).toContain('roster');
        expect(texts.filter(text => text === 'wired · observed')).toHaveLength(3);
        expect(nodes.some(node => node.title === 'fleet:runtimeStatus')).toBe(true);

        detail.destroy()
    });

    test('a not-wired source states its condition in TEXT and earns the state colour — never colour alone', () => {
        // runtime reader absent → normalizeFleetSources fails it closed to not-wired. The detail must SAY
        // "not wired", not merely tint it — colour is never the sole bearer of the meaning (WCAG 1.4.1).
        const detail = createDetail({
            agentId: 'vega',
            state  : 'ok',
            sources: {
                roster    : {source: 'fleet:listAgents',  state: 'wired', confidence: 'observed'},
                repoStatus: {source: 'fleet:fleetStatus', state: 'wired', confidence: 'observed'},
                runtime   : null // absent → fails closed to not-wired + none
            }
        });

        const nodes       = detail.down({reference: 'detail-ledger'}).vdom.cn ?? [],
              runtimeIdx  = nodes.findIndex(node => node.text === 'runtime'),
              runtimePill = nodes[runtimeIdx + 1];

        // the condition rides the TEXT plus the absence tone class — never colour alone
        expect(runtimePill.text).toBe('not wired');
        expect(runtimePill.cls).toContain('is-unobserved');

        // the ledger stays unconditional — the two wired sources still state themselves
        const texts = nodes.map(node => node.text ?? '');
        expect(texts).toContain('repository');
        expect(texts).toContain('roster');
        expect(texts.filter(text => text === 'wired · observed')).toHaveLength(2);

        detail.destroy()
    });

    test('§2.2.1 wall-clock aging: a later `now` re-classifies fresh → lost in place (time-reactive, not just re-seat)', () => {
        const detail = createDetail({agentId: 'vega', state: 'ok'}, {
            paneLedgers: {lane: {observedAt: '2026-07-11T23:59:50.000Z', freshnessTtl: 30_000}} // 10s before NOW → fresh
        });
        expect(chip(detail, 'lane').cls).toContain('is-fresh');

        // 5 minutes of wall clock later (past 4×TTL) → the SAME pane ages to lost, same instance, no
        // re-seat. Production driver: startFreshnessAging()'s timer re-runs applyPaneFreshness off the
        // live Date.now(); here the injected clock advances deterministically through afterSetNow.
        const beforeId = detail.id;
        detail.now = Date.parse('2026-07-12T00:05:00.000Z');
        expect(detail.id).toBe(beforeId);
        expect(chip(detail, 'lane').cls).toContain('is-lost');

        detail.destroy()
    });

    test('the configuration tab joins on the registry key and degrades honestly without a definition (#15242)', () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const
            detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
            card   = detail.getReference('config-pane');

        // the join: FleetAgent.agentId === AgentDefinition.id (the Fleet Registry key)
        expect(card.record).toBe(definitions.get('ada'));

        // a resident with NO stored definition renders the tab's honest empty line — never a
        // fabricated config, and never the keeper-view's off-context "select an agent" copy
        detail.record = makeRecord({agentId: 'ghost', displayName: 'Ghost'});
        expect(card.record).toBeNull();
        expect(JSON.stringify(card.vdom.cn)).toContain('no stored definition');

        detail.destroy()
    });

    test('the configuration tab receives the exact provider tenant Store and tracks its live availability', () => {
        const
            definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
                {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
            ]}),
            tenants = Neo.create(FleetTenants, {data: [{
                id: 'tenant-a', endpoint: 'https://tenant.example.com', status: 'connected'
            }]});

        stores.push(definitions, tenants);

        const
            detail = createDetail(
                {agentId: 'ada', displayName: 'Ada'},
                {agentDefinitions: definitions, fleetTenants: tenants}
            ),
            card = detail.getReference('config-pane');

        expect(card.tenantStore).toBe(tenants);
        expect(JSON.stringify(card.vdom.cn)).toContain('https://tenant.example.com');
        expect(JSON.stringify(card.vdom.cn)).not.toContain('Unavailable');

        tenants.get('tenant-a').set({status: 'disconnected'});

        expect(JSON.stringify(card.vdom.cn)).toContain('https://tenant.example.com · Unavailable');

        const replacement = Neo.create(FleetTenants, {data: [{
            id: 'tenant-b', endpoint: 'https://replacement.example.com', status: 'connected'
        }]});

        stores.push(replacement);
        detail.fleetTenants = replacement;

        expect(card.tenantStore).toBe(replacement);
        expect(JSON.stringify(card.vdom.cn)).toContain('https://replacement.example.com');

        detail.destroy()
    });

    test('the detail controller handles the tab intent: only its accepted readback changes the shared record (#15242)', async () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const
            detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
            card   = detail.getReference('config-pane'),
            result = deferred(),
            intents = [];

        // AgentOS is the APP NAMESPACE — deleting it would unregister every AgentOS.* class for
        // the tests that follow in this worker. Stub the `fleet` key only, and restore it.
        const priorFleet = globalThis.AgentOS?.fleet;

        globalThis.AgentOS ??= {};
        globalThis.AgentOS.fleet = {registryBridge: {configureAgent: intent => {
            intents.push(intent);
            // the runner curates the wire intent: no event envelope may cross
            expect(Object.keys(intent).sort()).toEqual(['harnessType', 'id']);
            return result.promise
        }}};

        card.fire('configIntent', {id: 'ada', harnessType: 'claude-code', source: 'evt-noise'});
        expect(JSON.stringify(card.vdom.cn)).toContain('Saving configuration');
        result.resolve({status: 'accepted', agent: {id: 'ada', harnessType: 'claude-code', mcpServers: null}});
        await expect.poll(() => card.saveStatus.state).toBe('accepted');

        // only the RESPONSE mutated the record; the tab's card re-rendered through its own sink
        expect(definitions.get('ada').harnessType).toBe('claude-code');
        expect(JSON.stringify(card.vdom.cn)).toContain('Configuration saved.');

        detail.destroy();
        card.fire('configIntent', {id: 'ada', harnessType: 'codex'});
        expect(intents).toHaveLength(1);
        globalThis.AgentOS.fleet = priorFleet
    });

    test('an external definition write (another owner\'s readback) refreshes the seated tab in place (#15242)', () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions});

        // e.g. the Accounts keeper-view lands an accepted readback on the SAME store record —
        // record identity unchanged, so the card's reactive `record` never re-fires; the store's
        // recordChange → the detail's refresh keeps the tab live (the same-record contract).
        // statusText is asserted because the card renders it RAW — a harnessType would render its
        // registry LABEL (or the fail-closed "Unknown harness"), making the raw string a blind probe.
        definitions.get('ada').set({statusText: 'externally refreshed'});

        expect(JSON.stringify(detail.getReference('config-pane').vdom.cn)).toContain('externally refreshed');

        detail.destroy()
    });

    test('a definition ADDED after mount seats the tab; REMOVED clears it to the honest empty state (#15440)', () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: []});
        stores.push(definitions);

        const
            detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
            card   = detail.getReference('config-pane');

        // mounted BEFORE its definition exists — the honest empty line, not a fabricated config
        expect(card.record).toBeNull();

        // membership delivers the definition later (e.g. the S5 zone's accepted readback upsert)
        definitions.add({id: 'ada', githubUsername: 'ada', harnessType: 'codex'});
        expect(card.record).toBe(definitions.get('ada'));

        // removal must clear the seat — a removed definition rendering on is a stale ghost
        definitions.remove(definitions.get('ada'));
        expect(card.record).toBeNull();

        detail.destroy()
    });

    test('a wholesale reload re-seats the tab onto the NEW record instance (#15440)', () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const
            detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
            card   = detail.getReference('config-pane'),
            first  = definitions.get('ada');

        expect(card.record).toBe(first);

        // a reload replaces membership wholesale: same id, NEW record instance — the reactive
        // `record` config would suppress a same-identity write, so the re-seat must carry the swap
        definitions.clear();
        definitions.add({id: 'ada', githubUsername: 'ada', harnessType: 'claude-code'});

        const second = definitions.get('ada');

        expect(second).not.toBe(first);
        expect(card.record).toBe(second);

        detail.destroy()
    });

    test('destroy detaches the provider-owned store listeners — no zombie re-seat, no zombie recordChange (#15440)', () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        // the spies must be installed BEFORE construction: the listener registry captures the fn
        // ref at on() time, so only a pre-construct prototype patch makes the registered ref the spy
        const
            calls             = {mutation: 0, recordChange: 0},
            originalMutation  = AgentDetailController.prototype.onDefinitionsStoreMutation,
            originalRecChange = AgentDetailController.prototype.onDefinitionRecordChange;

        AgentDetailController.prototype.onDefinitionsStoreMutation = function(...args) {
            calls.mutation++;
            return originalMutation.apply(this, args)
        };
        AgentDetailController.prototype.onDefinitionRecordChange = function(...args) {
            calls.recordChange++;
            return originalRecChange.apply(this, args)
        };

        try {
            const detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions});

            // positive control: the live listeners DO fire through real store mutations
            definitions.add({id: 'grace', githubUsername: 'grace', harnessType: 'codex'});
            definitions.get('ada').set({statusText: 'still alive'});

            const alive = {...calls};
            expect(alive.mutation).toBeGreaterThan(0);
            expect(alive.recordChange).toBeGreaterThan(0);

            detail.destroy();

            // the store OUTLIVES the view (provider-owned) — post-destroy mutations must not reach it
            definitions.add({id: 'clio', githubUsername: 'clio', harnessType: 'codex'});
            definitions.get('ada').set({statusText: 'after teardown'});

            expect(calls.mutation).toBe(alive.mutation);
            expect(calls.recordChange).toBe(alive.recordChange)
        } finally {
            AgentDetailController.prototype.onDefinitionsStoreMutation = originalMutation;
            AgentDetailController.prototype.onDefinitionRecordChange   = originalRecChange
        }
    });

    test('a late accepted readback updates its original Store but cannot repaint a rebound inspector', async () => {
        const
            definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
                {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
            ]}),
            replacement = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
                {id: 'ada', githubUsername: 'ada', harnessType: 'claude-code'}
            ]}),
            result = deferred();

        stores.push(definitions, replacement);

        const
            detail     = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
            controller = detail.getController(),
            card       = detail.getReference('config-pane'),
            statuses   = [],
            setStatus  = card.setSaveStatus,
            priorFleet = globalThis.AgentOS?.fleet;

        card.setSaveStatus = function(...args) {
            statuses.push(args);
            return setStatus.apply(this, args)
        };
        globalThis.AgentOS ??= {};
        globalThis.AgentOS.fleet = {registryBridge: {configureAgent: () => result.promise}};

        const request = controller.onConfigIntent({id: 'ada', harnessType: 'native-neo'});

        expect(statuses.map(([, state]) => state)).toEqual(['pending']);

        // The response belongs to the old shared Store; this inspector now renders the replacement.
        detail.agentDefinitions = replacement;
        expect(card.record).toBe(replacement.get('ada'));
        const originalRefresh = card.refresh;
        let refreshes = 0;
        card.refresh = function(...args) {
            refreshes++;
            return originalRefresh.apply(this, args)
        };
        result.resolve({status: 'accepted', agent: {id: 'ada', harnessType: 'native-neo'}});
        await request;

        expect(definitions.get('ada').harnessType).toBe('native-neo');
        expect(replacement.get('ada').harnessType).toBe('claude-code');
        expect(statuses.map(([, state]) => state)).toEqual(['pending']);
        expect(refreshes, 'the old Store listener is detached').toBe(0);
        replacement.get('ada').set({statusText: 'current Store'});
        expect(refreshes, 'the replacement Store listener remains live').toBeGreaterThan(0);

        globalThis.AgentOS.fleet = priorFleet;
        detail.destroy()
    });

    test('two real inspectors preserve cross-owner supersession on the shared definition', async () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const first = createDetail({agentId: 'ada'}, {agentDefinitions: definitions});
        const second = createDetail({agentId: 'ada'}, {agentDefinitions: definitions});
        const waits = [], priorFleet = globalThis.AgentOS?.fleet;
        globalThis.AgentOS.fleet = {registryBridge: {configureAgent: () => {
            const wait = deferred();
            waits.push(wait);
            return wait.promise
        }}};

        try {
            const older = first.getController().onConfigIntent({id: 'ada', harnessType: 'claude-code'});
            const newer = second.getController().onConfigIntent({id: 'ada', harnessType: 'native-neo'});
            waits[1].resolve({status: 'accepted', agent: {id: 'ada', harnessType: 'native-neo'}});
            await newer;
            waits[0].resolve({status: 'accepted', agent: {id: 'ada', harnessType: 'claude-code'}});
            await older;

            expect(definitions.get('ada').harnessType).toBe('native-neo');
            expect(first.getReference('config-pane').saveStatus.state).toBe('superseded');
            expect(second.getReference('config-pane').saveStatus.state).toBe('accepted')
        } finally {
            globalThis.AgentOS.fleet = priorFleet;
            first.destroy();
            second.destroy()
        }
    });

    for (const accepted of [true, false]) {
        test(`a late ${accepted ? 'accepted' : 'rejected'} intent cannot repaint the destroyed owner`, async () => {
            const
                definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
                    {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
                ]}),
                result = deferred();

            stores.push(definitions);

            const
                detail     = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
                controller = detail.getController(),
                card       = detail.getReference('config-pane'),
                statuses   = [],
                setStatus  = card.setSaveStatus,
                priorFleet = globalThis.AgentOS?.fleet;

            card.setSaveStatus = function(...args) {
                statuses.push(args);
                return setStatus.apply(this, args)
            };
            globalThis.AgentOS ??= {};
            globalThis.AgentOS.fleet = {registryBridge: {configureAgent: () => result.promise}};

            const request = controller.onConfigIntent({id: 'ada', harnessType: 'native-neo'});

            detail.destroy();
            result.resolve(accepted
                ? {status: 'accepted', agent: {id: 'ada', harnessType: 'native-neo'}}
                : {status: 'rejected', reason: 'late rejection'});
            await request;

            expect(statuses.map(([, state]) => state)).toEqual(['pending']);
            expect(definitions.get('ada').harnessType).toBe(accepted ? 'native-neo' : 'codex');
            globalThis.AgentOS.fleet = priorFleet
        });
    }

    test('the controller ages the pane on schedule, keeps scheduling with no record, and stops after destroy', async () => {
        const
            scheduled = [],
            ticks = [],
            originalTimeout = Object.getOwnPropertyDescriptor(AgentDetailController.prototype, 'timeout'),
            originalStart = AgentDetailController.prototype.startFreshnessAging,
            originalNow = Date.now;
        let clock = NOW;

        Date.now = () => clock;
        AgentDetailController.prototype.timeout = function(ms) {
            const wait = deferred();
            scheduled.push({...wait, ms});
            return wait.promise
        };
        AgentDetailController.prototype.startFreshnessAging = function(...args) {
            const tick = originalStart.apply(this, args);
            ticks.push(tick);
            return tick
        };

        let detail;

        try {
            detail = createDetail({agentId: 'vega', state: 'ok'}, {
                now: null,
                paneLedgers: {lane: {observedAt: new Date(NOW - 10_000).toISOString(), freshnessTtl: 30_000}}
            });

            const controller = detail.getController();
            let refreshes = 0;
            const applyFreshness = detail.applyPaneFreshness;

            detail.applyPaneFreshness = function(...args) {
                refreshes++;
                return applyFreshness.apply(this, args)
            };

            expect(scheduled.map(({ms}) => ms)).toEqual([30_000]);
            expect(chip(detail, 'lane').cls).toContain('is-fresh');
            clock = NOW + 5 * 60_000;
            // No record/config mutation drives this render: only the production scheduler tick.
            const beforeAge = refreshes;
            scheduled[0].resolve();
            await ticks[0];

            expect(refreshes).toBe(beforeAge + 1);
            expect(chip(detail, 'lane').cls).toContain('is-lost');
            expect(scheduled.map(({ms}) => ms)).toEqual([30_000, 30_000]);

            detail.now = NOW;
            clock += 5 * 60_000;
            scheduled[1].resolve();
            await ticks[1];
            expect(chip(detail, 'lane').cls).toContain('is-fresh');

            detail.record = null;
            const beforeEmptyTick = refreshes;
            scheduled[2].resolve();
            await ticks[2];

            expect(refreshes).toBe(beforeEmptyTick);
            expect(scheduled.map(({ms}) => ms)).toEqual([30_000, 30_000, 30_000, 30_000]);

            detail.destroy();
            const afterDestroy = refreshes;
            scheduled[3].resolve();
            await ticks[3];

            expect(refreshes).toBe(afterDestroy);
            expect(controller.isDestroyed).toBe(true);
            expect(scheduled).toHaveLength(4)
        } finally {
            detail?.isDestroyed || detail?.destroy();
            Date.now = originalNow;
            AgentDetailController.prototype.startFreshnessAging = originalStart;
            if (originalTimeout) {
                Object.defineProperty(AgentDetailController.prototype, 'timeout', originalTimeout)
            } else {
                delete AgentDetailController.prototype.timeout
            }
        }
    });

    test('panes without a producer name what they await; the lane pill states the roster source fact (#391 AC-1)', () => {
        const detail = createDetail({agentId: 'vega', state: 'ok'});

        for (const [key, producer] of [
            ['thought-stream', 'policy-aware read'],
            ['prs',            'per-seat open-work projection']
        ]) {
            expect(chip(detail, key).text, key).toBe('not observed — source not wired');
            expect(chip(detail, key).cls, key).toContain('is-unobserved');
            expect(chip(detail, key).vdom.title, key).toContain(producer)
        }

        // The lane now has a roster-row source axis. An absent lane fact uses its explicit source
        // vocabulary rather than borrowing the old feed-waiting text from an unwired pane.
        expect(chip(detail, 'lane').text).toBe('not wired — the roster row carried no lane claim fact');
        expect(chip(detail, 'lane').cls).toContain('is-unobserved');
        expect(chip(detail, 'lane').vdom.title).toBe(chip(detail, 'lane').text);

        // a pane whose source answered carries no awaiting title: the pill itself is the answer
        detail.rosterObservedAt = NOW;
        expect(chip(detail, 'repo').vdom.title).toBeNull();

        detail.destroy()
    });

    test('the repository pane and the header row derive from ONE descriptor — the roster row\'s repoStatus fact, aged from the roster admission (#391 AC-2)', () => {
        const detail = createDetail({agentId: 'vega', state: 'ok', repoSlug: 'neomjs/neo', repoPath: '/seats/vega/neo'}, {rosterObservedAt: NOW - 10_000});

        expect(chip(detail, 'repo').cls).toContain('is-fresh');
        expect(chip(detail, 'repo').text).toBe('updated 10s ago');
        expect(body(detail, 'repo').vdom.cn.map(node => node.text)).toEqual(['neomjs/neo', '/seats/vega/neo']);

        // no roster read in this mount: the pane says so instead of claiming an observation it never had
        detail.rosterObservedAt = null;
        expect(chip(detail, 'repo').text).toBe('unobserved — no roster read has landed in this mount');
        expect(chip(detail, 'repo').cls).toContain('is-unobserved');

        // the roster's own missing fact reaches the pane in the roster's words — the SAME fact the
        // header's `repository` row renders, so the two cannot disagree
        const missing = createDetail({
            agentId: 'ada', state: 'ok',
            sources: {...observedSources, repoStatus: {source: 'fleet:fleetStatus', state: 'missing', confidence: 'none', reason: 'no repository status answered for this agent'}}
        }, {rosterObservedAt: NOW});

        expect(chip(missing, 'repo').text).toBe('missing — no repository status answered for this agent');
        // the full answer rides the title too: a rail-width head elides the pill's words
        expect(chip(missing, 'repo').vdom.title).toBe('missing — no repository status answered for this agent');
        expect(body(missing, 'repo').vdom.cn.map(node => node.text)).toEqual(['no repository declared']);

        const rows = missing.down({reference: 'detail-ledger'}).vdom.cn,
              axis = rows.findIndex(node => node.text === 'repository');

        expect(axis).toBeGreaterThan(-1);
        expect(rows[axis + 1].text).toBe('missing');

        detail.destroy();
        missing.destroy()
    });

    test('an explicit pane ledger outranks the derived source, and the roster stamp re-ages the repository pane in place', () => {
        const detail = createDetail({agentId: 'vega', state: 'ok', repoSlug: 'neomjs/neo'}, {rosterObservedAt: NOW - 5_000});

        expect(chip(detail, 'repo').text).toBe('updated 5s ago');

        // a later roster admission moves the observation without a record re-seat
        detail.rosterObservedAt = NOW - 1_000;
        expect(chip(detail, 'repo').text).toBe('updated 1s ago');

        // a feed stamping the pane directly still wins over the derived roster source
        detail.paneLedgers = {repo: {lost: true}};
        expect(chip(detail, 'repo').cls).toContain('is-lost');

        detail.destroy()
    });
});
