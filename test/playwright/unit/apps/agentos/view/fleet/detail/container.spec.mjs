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
    let AgentDetail, AgentDetailController, AgentDefinition, FleetAgent, FleetTenants, OpenWorkSeat, Store;

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
        OpenWorkSeat          = (await import('../../../../../../../../apps/agentos/util/OpenWorkSeat.mjs')).default;
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

    test('the Seat row names the family in words, only for a reported family; a Claude Desktop seat with a folder adds its first-launch step, and the row never repeats the path', () => {
        const
            repoPath = '/Users/x/Library/Application Support/neo-harness/brain/fleet/agents/vega/neomjs/neo',
            detail   = createDetail({agentId: 'vega', displayName: 'Vega', harnessType: 'claude-desktop', repoPath, state: 'ok'}),
            part     = reference => detail.down({reference});

        expect(part('detail-seat').hidden).toBe(false);
        expect(part('detail-seat-family').text).toBe('Claude · App');
        expect(part('detail-seat-launch').hidden).toBe(false);
        expect(part('detail-seat-launch').text).toBe('Open the repository folder below in Claude\'s Code tab, then Start on the card.');
        expect(part('detail-seat').items.map(item => item.text ?? '').join(' '), 'the path lives on the Repository pane alone').not.toContain(repoPath);

        // another family has the row and no first-launch step: it is launched into its folder
        applySet(detail, {harnessType: 'codex-desktop'});
        expect(part('detail-seat-family').text).toBe('Codex · App');
        expect(part('detail-seat-launch').hidden).toBe(true);

        // a Claude Desktop seat without a reported folder has no step to point at
        applySet(detail, {harnessType: 'claude-desktop', repoPath: null});
        expect(part('detail-seat').hidden).toBe(false);
        expect(part('detail-seat-launch').hidden).toBe(true);

        // no reported family: no row, no placeholder
        applySet(detail, {harnessType: null});
        expect(part('detail-seat').hidden).toBe(true);

        detail.destroy()
    });

    test('after a Start, a session outside the seat\'s folder reads as a state word in the Seat row, and in full under the Repository pane\'s path (#522)', () => {
        const
            repoPath = '/Users/x/agents/vega/neomjs/neo',
            observed = '/Users/x/Desktop/scratch',
            detail   = createDetail({
                agentId: 'vega', displayName: 'Vega', harnessType: 'claude-desktop', repoPath, state: 'ok',
                sessionFolder: {state: 'wrong', expected: repoPath, observed}
            }),
            part     = reference => detail.down({reference}),
            words    = () => part('detail-seat-folder').vdom.cn.map(node => node.text).join(''),
            session  = () => part('pane-repo-body').vdom.cn.find(node => node.cls?.includes('fm-detail-repo-session')) ?? null;

        // AC-1: the Seat row stays one short line with no path; the pane says where and what to do
        expect(part('detail-seat-folder').hidden).toBe(false);
        expect(words()).toBe('wrong folder · see Repository');
        expect(part('detail-seat-folder').vdom.cn[0].cls).toContain('is-wrong');
        expect(part('detail-seat-folder').vdom.title).toBeUndefined();
        expect(session().cls).toContain('is-wrong');
        expect(session().text).toBe(`The session opened in ${observed}, so it loads none of the seat's servers, memory or hooks. Reopen this folder in Claude's Code tab.`);
        // the first-launch step gives way to what happened
        expect(part('detail-seat-launch').hidden).toBe(true);

        // AC-2: pending and unknown read as themselves, with their reasons
        applySet(detail, {sessionFolder: {state: 'pending', expected: repoPath}});
        expect(words()).toBe('not opened yet · see Repository');
        expect(session().text).toBe("No session has opened since the launch. Open this folder in Claude's Code tab.");
        applySet(detail, {sessionFolder: {state: 'unknown', expected: repoPath, reason: 'the session records could not be read'}});
        expect(words()).toBe('folder unknown · see Repository');
        expect(session().text).toBe("Where the session opened is unknown: the session records could not be read. Check that Claude's Code tab has this folder open.");

        // the launch's folder is the verdict's authority: the repository changed or cleared since the
        // launch is not where the session should be, so the pane names the launch's folder
        applySet(detail, {repoPath: '/Users/x/agents/vega/neomjs/other', sessionFolder: {state: 'wrong', expected: repoPath, observed}});
        expect(session().text).toBe(`The session opened in ${observed}, so it loads none of the seat's servers, memory or hooks. This launch expected ${repoPath}. Reopen that folder in Claude's Code tab, or Restart it on the card to launch in this repository.`);
        applySet(detail, {repoPath: null});
        expect(session().text).toBe(`The session opened in ${observed}, so it loads none of the seat's servers, memory or hooks. This launch expected ${repoPath}. Reopen that folder in Claude's Code tab.`);

        // ok adds no line, and AC-3: a Brain that reports no folder state renders nothing new
        for (const sessionFolder of [{state: 'ok', expected: repoPath}, null]) {
            applySet(detail, {repoPath, sessionFolder});
            expect(part('detail-seat-folder').hidden).toBe(true);
            expect(session()).toBeNull()
        }

        detail.destroy()
    });

    test('the Repository pane shows the whole clone path, with Copy path only while a path is reported', () => {
        const
            repoPath = '/Users/x/Library/Application Support/neo-harness/brain/fleet/agents/vega/neomjs/neo',
            detail   = createDetail({agentId: 'vega', harnessType: 'claude-desktop', repoSlug: 'neomjs/neo', repoPath, state: 'ok'}),
            part     = reference => detail.down({reference});

        expect(body(detail, 'repo').vdom.cn.map(node => node.text)).toEqual(['neomjs/neo', repoPath]);
        expect(part('detail-repo-copy').hidden).toBe(false);
        expect(part('detail-repo-copy').text).toBe('Copy path');
        expect(part('detail-repo-field').vdom.value).toBe(repoPath);

        applySet(detail, {repoPath: null});
        expect(body(detail, 'repo').vdom.cn.map(node => node.text)).toEqual(['neomjs/neo']);
        expect(part('detail-repo-copy').hidden).toBe(true);
        expect(part('detail-repo-field').vdom.value).toBe('');

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
            await detail.onCopyRepoPath({detail: 1});

            expect(calls.slice(0, 2)).toEqual([['select', detail.down({reference: 'detail-repo-field'}).id], ['execCommand', 'copy']])
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
                // prs: no ledger and no open-work answer → unobserved
            }
        });

        expect(chip(detail, 'thought-stream').cls).toContain('is-fresh');
        expect(chip(detail, 'thought-stream').text).toBe('updated 10s ago');
        expect(chip(detail, 'lane').cls).toContain('is-stale');
        expect(chip(detail, 'repo').cls).toContain('is-lost');
        expect(chip(detail, 'prs').cls).toContain('is-unobserved');
        expect(chip(detail, 'prs').text).toBe('not observed — open-work read unanswered');

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

        card.onCardClick({path: [{id: `${card.id}__connection__edit`}]});
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

    test('AC-3 (#524): Configuration keeps the seat\'s commit identity, read once per seat, and declares it through the runner', async () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const
            priorFleet = globalThis.AgentOS?.fleet,
            intents    = [],
            reads      = [];
        let answer = {state: 'missing', name: 'Ada', reason: 'its forge account offers no email this PAT can read'};

        globalThis.AgentOS ??= {};
        globalThis.AgentOS.fleet = {registryBridge: {
            configureAgent: async intent => {
                intents.push(intent);
                return {status: 'accepted', agent: {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}}
            },
            fleetSeatGitIdentity: async ({id}) => {
                reads.push(id);
                return answer
            }
        }};

        try {
            const
                detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
                row    = detail.getReference('identity-row'),
                fields = row.getReference('identity-fields');

            await expect.poll(() => row.identity?.state).toBe('missing');
            expect(row.hidden).toBe(false);
            expect(row.getReference('identity-line').text).toBe('No commit identity: its forge account offers no email this PAT can read.');
            expect(row.getReference('identity-repair').text).toBe('Declare identity');
            expect(fields.hidden).toBe(true);

            // a roster refresh re-seats the same seat: no second read
            applySet(detail, {displayName: 'Ada (renamed)'});
            expect(reads).toEqual(['ada']);

            // a half pair is refused before the wire
            row.onRepairClick();
            row.getReference('field-git-email').value = '';
            await detail.controller.onDeclareGitIdentity({gitName: 'Ada', gitEmail: ''});
            expect(intents).toEqual([]);
            expect(row.status).toEqual({state: 'rejected', reason: 'Name and email are both required.'});

            answer = {state: 'declared', source: 'declaration', name: 'Ada', email: 'ada@example.com'};
            await detail.controller.onDeclareGitIdentity({gitName: 'Ada', gitEmail: 'ada@example.com'});

            // only the pair crosses, and the Fleet's read-back answer is what the row shows
            expect(intents).toEqual([{id: 'ada', gitName: 'Ada', gitEmail: 'ada@example.com'}]);
            await expect.poll(() => row.identity?.state).toBe('declared');
            expect(reads).toEqual(['ada', 'ada']);
            expect(row.getReference('identity-line').text).toBe('Commits as Ada <ada@example.com> · declared');
            expect(row.getReference('identity-repair').text).toBe('Change identity');
            expect(fields.hidden).toBe(true);

            detail.destroy()
        } finally {
            globalThis.AgentOS.fleet = priorFleet
        }
    });

    test('#559: the Seat group reads the declaration beside the config, asks the Fleet what to offer, and declares one field through the runner', async () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex-desktop', model: 'gpt-6-sol'}
        ]});
        stores.push(definitions);

        const
            priorFleet = globalThis.AgentOS?.fleet,
            intents    = [],
            reads      = [];

        globalThis.AgentOS ??= {};
        globalThis.AgentOS.fleet = {registryBridge: {
            configureAgent: async intent => {
                intents.push(intent);
                // the Fleet answers the whole definition, and a withdrawn field is absent from it
                return {status: 'accepted', agent: {id: 'ada', githubUsername: 'ada', harnessType: 'codex-desktop', ...(intent.model ? {model: intent.model} : {})}}
            },
            fleetSeatModelCatalog: async ({id}) => {
                reads.push(id);
                return {state: 'complete', reason: null, models: [{id: 'gpt-6-luna', efforts: ['high']}, {id: 'gpt-6-sol', efforts: ['max']}]}
            },
            fleetSeatGitIdentity: async () => ({state: 'derived', name: 'Ada', email: 'ada@example.com'})
        }};

        try {
            const
                detail = createDetail({agentId: 'ada', displayName: 'Ada', state: 'off', harnessSettings: {model: 'gpt-6-luna', reasoningEffort: null}}, {agentDefinitions: definitions}),
                group  = detail.getReference('seat-model'),
                line   = () => group.getReference('model-line').text;

            expect(group.hidden).toBe(false);
            expect(line()).toBe('declared gpt-6-sol · reads gpt-6-luna (configured on disk) · applies at next start');

            // running reads the same: the harness reads its config when it launches
            applySet(detail, {state: 'ok'});
            expect(line()).toBe('declared gpt-6-sol · reads gpt-6-luna (configured on disk) · applies at next start');

            // a start the Fleet refused for the declaration: the row says so in the Fleet's words
            applySet(detail, {state: 'off', seatModel: {state: 'refused', model: 'gpt-6-sol', reasoningEffort: null, reason: 'model gpt-6-sol is not available'}});
            expect(line()).toBe('declared gpt-6-sol · start refused: model gpt-6-sol is not available');

            applySet(detail, {seatModel: null});
            group.onActionClick({component: group.getReference('model-change')});
            await expect.poll(() => group.catalog?.state).toBe('complete');
            expect(reads).toEqual(['ada']);

            await detail.controller.onDeclareSeatModel({field: 'model', value: 'gpt-6-luna'});

            // only the one field crosses; the accepted readback re-seats the group and closes the offer
            expect(intents).toEqual([{id: 'ada', model: 'gpt-6-luna'}]);
            expect(definitions.get('ada').model).toBe('gpt-6-luna');
            expect(line()).toBe('declared gpt-6-luna');
            expect([group.editing, group.status.state]).toEqual([null, 'idle']);

            // withdrawn: the readback carries no model, and the row reads what the config is set to
            await detail.controller.onDeclareSeatModel({field: 'model', value: null});
            expect(intents.at(-1)).toEqual({id: 'ada', model: null});
            expect(definitions.get('ada').model).toBeNull();
            expect(line()).toBe('derived · reads gpt-6-luna (configured on disk)');

            // a field the group does not own never reaches the wire
            await detail.controller.onDeclareSeatModel({field: 'harnessType', value: 'codex'});
            expect(intents).toHaveLength(2);

            detail.destroy()
        } finally {
            globalThis.AgentOS.fleet = priorFleet
        }
    });

    test('#559: a catalog read or a declaration answers only the seat and harness it started for', async () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex-desktop', model: 'gpt-6-sol'},
            {id: 'eos', githubUsername: 'eos', harnessType: 'codex-desktop'}
        ]});
        stores.push(definitions);

        const
            priorFleet = globalThis.AgentOS?.fleet,
            catalogs   = [],
            saves      = [];

        globalThis.AgentOS ??= {};
        globalThis.AgentOS.fleet = {registryBridge: {
            fleetSeatModelCatalog: () => { const held = deferred(); catalogs.push(held); return held.promise },
            configureAgent       : () => { const held = deferred(); saves.push(held); return held.promise },
            fleetSeatGitIdentity : async () => ({state: 'derived', name: 'Ada', email: 'ada@example.com'})
        }};

        try {
            const
                detail   = createDetail({agentId: 'ada', displayName: 'Ada', state: 'off'}, {agentDefinitions: definitions}),
                group    = detail.getReference('seat-model'),
                codexSet = {state: 'complete', reason: null, models: [{id: 'gpt-6-sol', efforts: ['low', 'max']}]};

            // control: the same binding's answer lands
            const read = detail.controller.readSeatCatalog();
            catalogs[0].resolve(codexSet);
            await read;
            expect(group.catalog).toEqual(codexSet);

            // the same seat moves to another harness: its catalog goes, and a Codex answer still on its way stays out
            const late = detail.controller.readSeatCatalog();
            definitions.get('ada').set({harnessType: 'claude-code'});
            expect(group.catalog).toBeNull();
            catalogs[1].resolve(codexSet);
            await late;
            expect(group.catalog, 'a reply from the prior binding').toBeNull();

            // a declaration for Ada, refused after the group shows Eos, paints nothing on Eos
            const save = detail.controller.onDeclareSeatModel({field: 'reasoningEffort', value: 'max'});
            expect(group.status.state).toBe('pending');
            detail.record = makeRecord({agentId: 'eos', displayName: 'Eos', state: 'off'});
            expect(group.seat.id).toBe('eos');
            saves[0].resolve({status: 'rejected', reason: "effort 'max' is not available"});
            await save;
            expect(group.status).toEqual({state: 'idle', reason: ''});

            detail.destroy()
        } finally {
            globalThis.AgentOS.fleet = priorFleet
        }
    });

    test('AC-3 (#524): a late answer for a seat no longer shown paints nothing; a seat without a definition shows no row', async () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'},
            {id: 'eos', githubUsername: 'eos', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const
            priorFleet = globalThis.AgentOS?.fleet,
            held       = deferred();

        globalThis.AgentOS ??= {};
        globalThis.AgentOS.fleet = {registryBridge: {
            fleetSeatGitIdentity: ({id}) => id === 'ada' ? held.promise : Promise.resolve({state: 'derived', name: 'Eos', email: 'eos@example.com'})
        }};

        try {
            const
                detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
                row    = detail.getReference('identity-row');

            expect(row.getReference('identity-line').text).toBe('Identity not yet read.');

            detail.record = makeRecord({agentId: 'eos', displayName: 'Eos'});
            await expect.poll(() => row.identity?.state).toBe('derived');

            held.resolve({state: 'missing', reason: 'its forge account offers no email this PAT can read'});
            await held.promise;
            expect(row.identity.name).toBe('Eos');

            detail.record = makeRecord({agentId: 'nobody', displayName: 'Nobody'});
            expect(row.hidden).toBe(true);

            detail.destroy()
        } finally {
            globalThis.AgentOS.fleet = priorFleet
        }
    });

    test('AC-3 (#524): only the latest identity request paints the row: A → B → A, and a declaration over a read still on its way', async () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'},
            {id: 'eos', githubUsername: 'eos', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const
            priorFleet = globalThis.AgentOS?.fleet,
            reads      = {ada: [], eos: []},
            missing    = {state: 'missing', reason: 'its forge account offers no email this PAT can read'},
            declared   = {state: 'declared', name: 'Ada', email: 'ada@example.com'},
            settle     = () => new Promise(resolve => setTimeout(resolve, 0));

        globalThis.AgentOS ??= {};
        globalThis.AgentOS.fleet = {registryBridge: {
            configureAgent      : async intent => ({status: 'accepted', agent: {id: intent.id, githubUsername: intent.id, harnessType: 'codex'}}),
            fleetSeatGitIdentity: ({id}) => {
                const reply = deferred();
                reads[id].push(reply);
                return reply.promise
            }
        }};

        try {
            const
                detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
                row    = detail.getReference('identity-row');

            // A, then B, then A again: the first read of A is still on its way
            expect(reads.ada).toHaveLength(1);
            expect(row.getReference('identity-status').text).toBe('Reading…');
            detail.record = makeRecord({agentId: 'eos', displayName: 'Eos'});
            reads.eos[0].resolve({state: 'derived', name: 'Eos', email: 'eos@example.com'});
            await expect.poll(() => row.identity?.name).toBe('Eos');
            detail.record = makeRecord({agentId: 'ada', displayName: 'Ada'});
            reads.ada[1].resolve(declared);
            await expect.poll(() => row.identity?.state).toBe('declared');

            reads.ada[0].resolve(missing);
            await settle();
            expect(row.identity).toEqual(declared);

            // a declaration is the latest request: the read it overtook paints nothing either
            detail.controller.readGitIdentity();
            await detail.controller.onDeclareGitIdentity({gitName: 'Ada', gitEmail: 'ada@example.com'});
            expect(reads.ada).toHaveLength(4);
            reads.ada[3].resolve(declared);
            reads.ada[2].resolve(missing);
            await settle();
            expect(row.identity).toEqual(declared);

            detail.destroy()
        } finally {
            globalThis.AgentOS.fleet = priorFleet
        }
    });

    test('AC-3 (#524): a read that failed has one action in Detail, "Read again", which reads the seat again', async () => {
        const definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        stores.push(definitions);

        const
            priorFleet = globalThis.AgentOS?.fleet,
            answers    = [{state: 'unknown', reason: 'its forge account could not be read (HTTP 401)'}, {state: 'derived', name: 'Ada', email: 'ada@example.com'}];

        globalThis.AgentOS ??= {};
        globalThis.AgentOS.fleet = {registryBridge: {fleetSeatGitIdentity: async () => answers.shift()}};

        try {
            const
                detail = createDetail({agentId: 'ada', displayName: 'Ada'}, {agentDefinitions: definitions}),
                row    = detail.getReference('identity-row');

            await expect.poll(() => row.identity?.state).toBe('unknown');
            expect(row.getReference('identity-repair').hidden).toBe(true);
            expect(row.getReference('identity-read').hidden).toBe(false);

            row.onReadClick();
            await expect.poll(() => row.identity?.state).toBe('derived');
            expect(row.getReference('identity-read').hidden).toBe(true);
            expect(row.getReference('identity-repair').text).toBe('Change identity');

            detail.destroy()
        } finally {
            globalThis.AgentOS.fleet = priorFleet
        }
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
            replacementLoaded = new Promise(resolve => replacement.on('load', resolve)),
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
        const originalRefresh = card.refresh;
        let refreshes = 0;
        card.refresh = function(...args) {
            refreshes++;
            return originalRefresh.apply(this, args)
        };
        detail.agentDefinitions = replacement;
        expect(card.record).toBe(replacement.get('ada'));
        expect(card.agentDefinitionsStore).toBe(replacement);
        await replacementLoaded; // settle the new Store's legitimate initial load before measuring the late response
        const refreshesAfterRebind = refreshes;
        definitions.get('ada').set({statusText: 'old Store mutation'});
        expect(refreshes, 'the old Store listener is detached after rebinding').toBe(refreshesAfterRebind);
        result.resolve({status: 'accepted', agent: {id: 'ada', harnessType: 'native-neo'}});
        await request;

        expect(definitions.get('ada').harnessType).toBe('native-neo');
        expect(replacement.get('ada').harnessType).toBe('claude-code');
        expect(statuses.map(([, state]) => state)).toEqual(['pending']);
        expect(refreshes, 'the late readback caused no repaint after the new Store was bound').toBe(refreshesAfterRebind);
        replacement.get('ada').set({statusText: 'current Store'});
        expect(refreshes, 'the replacement Store listener remains live').toBeGreaterThan(refreshesAfterRebind);

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

        expect(chip(detail, 'thought-stream').text).toBe('not observed — source not wired');
        expect(chip(detail, 'thought-stream').cls).toContain('is-unobserved');
        expect(chip(detail, 'thought-stream').vdom.title).toContain('policy-aware read');

        // the pull requests pane has its producer: without an answer it says so in the resolver's words
        expect(chip(detail, 'prs').text).toBe('not observed — open-work read unanswered');
        expect(chip(detail, 'prs').vdom.title).toBe(chip(detail, 'prs').text);

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

    test.describe('the Pull requests pane reads the seat\'s open work (#501)', () => {
        const
            seat     = '@neo-vega',
            minsAgo  = minutes => new Date(NOW - minutes * 60_000).toISOString(),
            prRow    = (repo, number, role, extra = {}) => ({repo, number, holder: {role, ids: [seat]}, ...extra}),
            answer   = (authored, reviewing, observedAt) => ({state: 'ok', observedAt, seats: {[seat]: {authored, reviewing}}}),
            list     = detail => detail.down({reference: 'pr-list'}),
            none     = detail => detail.down({reference: 'prs-none'}),
            rowsOf   = detail => list(detail).vdom.cn,
            heldFrom = snapshot => OpenWorkSeat.held(snapshot, seat);

        test('three held rows render worst first in the resolver\'s words through the list\'s Store, and the pill reads the read\'s observation (AC-1)', () => {
            const detail = createDetail({agentId: 'vega', state: 'ok', openWorkHeld: heldFrom(answer(
                [prRow('neomjs/neo-agent-brain', 806, 'author', {ci: 'pending', title: 'feat: the memory import at Start'}), prRow('neomjs/neo-agent-institution', 504, 'author', {ci: 'red', observedAt: minsAgo(2)})],
                [prRow('neomjs/neo', 19379, 'reviewer')],
                minsAgo(1)
            ))});

            // the rows are the list Store's records in the resolver's order: the Store sorts nothing
            expect(list(detail).store.className).toBe('AgentOS.store.HeldPullRequests');
            expect(list(detail).store.items.map(record => record.id)).toEqual(['neomjs/neo-agent-institution#504', 'neomjs/neo-agent-brain#806', 'neomjs/neo#19379']);
            expect(list(detail).hidden).toBe(false);
            expect(none(detail).hidden).toBe(true);
            rowsOf(detail).forEach(row => expect(row.cls).toContain('fm-detail-pr'));

            expect(rowsOf(detail).map(row => row.cn[0].text)).toEqual(['neomjs/neo-agent-institution #504', 'neomjs/neo-agent-brain #806', 'neomjs/neo #19379']);
            expect(rowsOf(detail).map(row => row.cn.at(-1).text)).toEqual(['author · red · observed 2m ago', 'author · changes requested', 'reviewer · review due']);
            expect(rowsOf(detail)[0].cn[0]).toMatchObject({tag: 'a', href: 'https://github.com/neomjs/neo-agent-institution/pull/504', rel: 'noopener', target: '_blank'});

            // the title slot: a row whose producer carries a title shows it between reference and line
            expect(rowsOf(detail)[1].cn.map(node => node.cls[0])).toEqual(['fm-detail-pr-ref', 'fm-detail-pr-title', 'fm-detail-pr-line']);
            expect(rowsOf(detail)[1].cn[1].text).toBe('feat: the memory import at Start');
            expect(rowsOf(detail)[0].cn, 'no title, no slot').toHaveLength(2);

            // the oldest held row's observation is the pane's
            expect(chip(detail, 'prs').text).toBe('updated 2m ago');
            expect(chip(detail, 'prs').cls).toContain('is-fresh');

            detail.destroy()
        });

        test('an idle detail carries no list: it joins the pane for the first resident shown', () => {
            const idle = Neo.create(AgentDetail, {appName});

            expect(list(idle)).toBeFalsy();
            idle.destroy();

            const detail = createDetail({agentId: 'vega', state: 'ok', openWorkHeld: heldFrom(null)});

            expect(list(detail).store.className).toBe('AgentOS.store.HeldPullRequests');
            expect(list(detail).hidden).toBe(true);

            detail.destroy()
        });

        test('nothing held renders the empty sentence, an unanswered read renders no list and says so on the pill (AC-2)', () => {
            const detail = createDetail({agentId: 'vega', state: 'ok', openWorkHeld: heldFrom(answer([prRow('neomjs/neo', 7, 'author', {ci: 'red'})], [], minsAgo(1)))});

            expect(list(detail).store.getCount()).toBe(1);

            // the next answer holds nothing: the Store empties and the sentence replaces the list
            applySet(detail, {openWorkHeld: heldFrom(answer([], [], minsAgo(1)))});
            expect(list(detail).store.getCount()).toBe(0);
            expect(list(detail).hidden).toBe(true);
            expect(none(detail).hidden).toBe(false);
            expect(none(detail).text).toBe('no pull request waits on this seat');
            expect(chip(detail, 'prs').text).toBe('updated 1m ago');

            applySet(detail, {openWorkHeld: heldFrom(null)});
            expect(list(detail).hidden).toBe(true);
            expect(none(detail).hidden, 'no answer is not an answer holding nothing').toBe(true);
            expect(chip(detail, 'prs').text).toBe('not observed — open-work read unanswered');
            expect(chip(detail, 'prs').cls).toContain('is-unobserved');

            detail.destroy()
        });

        test('a failed pulse reads stale at once: a recent observation the producer marks stale keeps its rows and its real age', () => {
            const
                failed = {...answer([prRow('neomjs/neo', 7, 'author', {ci: 'red', observedAt: minsAgo(1)})], [], minsAgo(1)), state: 'stale'},
                detail = createDetail({agentId: 'vega', state: 'ok', openWorkHeld: heldFrom(failed)});

            expect(chip(detail, 'prs').text).toBe('stale · last seen 1m ago');
            expect(chip(detail, 'prs').cls).toContain('is-stale');
            expect(rowsOf(detail).map(row => row.cn[0].text)).toEqual(['neomjs/neo #7']);

            // the control: the same observation from a pulse that succeeded is fresh
            applySet(detail, {openWorkHeld: heldFrom({...failed, state: 'ok'})});
            expect(chip(detail, 'prs').text).toBe('updated 1m ago');
            expect(chip(detail, 'prs').cls).toContain('is-fresh');

            detail.destroy()
        });

        test('the rows re-age with the pane\'s clock, like its pill', () => {
            const detail = createDetail({agentId: 'vega', state: 'ok', openWorkHeld: heldFrom(answer(
                [prRow('neomjs/neo', 7, 'author', {ci: 'red', observedAt: minsAgo(2)})], [], minsAgo(2)
            ))});

            expect(rowsOf(detail)[0].cn.at(-1).text).toBe('author · red · observed 2m ago');

            detail.now = NOW + 60_000;
            expect(rowsOf(detail)[0].cn.at(-1).text).toBe('author · red · observed 3m ago');
            expect(chip(detail, 'prs').text).toBe('updated 3m ago');

            detail.destroy()
        });

        test('a stale read keeps its rows and carries its age; an answer never reads as source not wired (AC-3)', () => {
            const detail = createDetail({agentId: 'vega', state: 'ok', openWorkHeld: heldFrom({
                ...answer([prRow('neomjs/neo', 7, 'author', {ci: 'red', stale: true, observedAt: minsAgo(12)})], [], minsAgo(12)),
                state: 'stale'
            })});

            expect(rowsOf(detail).map(row => row.cn[1].text)).toEqual(['author · red · observed 12m ago · stale']);
            expect(chip(detail, 'prs').text).toBe('stale · last seen 12m ago');
            expect(chip(detail, 'prs').cls).toContain('is-stale');
            expect(chip(detail, 'prs').text).not.toContain('source not wired');

            detail.destroy()
        });
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
