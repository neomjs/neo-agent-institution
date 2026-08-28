import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'MemoriesPaneCoherenceTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import MemoriesPane   from '../../../../../../../../apps/agentos/view/fleet/memories/Container.mjs';

/**
 * @summary Build one wired source envelope in the exact `fleetMemories` contract shape.
 * @param {Object} options
 * @returns {Object}
 */
function envelope({target, offset = 0, sessions, total}) {
    return {
        capability: {state: 'wired', capturedAt: '2026-08-03T09:00:00.000Z'},
        viewer    : '@e2e-operator',
        target,
        page      : {offset, limit: 20},
        sessions,
        count     : sessions.length,
        total
    }
}

/**
 * @summary One minimal session-summary row.
 * @param {String} id
 * @param {String} [timestamp]
 * @returns {Object}
 */
function row(id, timestamp = '2026-08-02T20:00:00.000Z') {
    return {id, sessionId: `${id}-session`, timestamp, title: `Title ${id}`, summary: `Summary ${id}`, category: 'analysis', memoryCount: 1, quality: 90, impact: 40, sourceAgentIdentities: []}
}

/**
 * @summary Create the pane with captured `memoriesRequest` intents.
 * @param {Object} [config]
 * @returns {{pane: Object, requests: Object[]}}
 */
function createPane(config = {}) {
    const requests = [],
          pane     = Neo.create(MemoriesPane, {
              listeners   : {memoriesRequest: data => {
                  const {source, ...params} = data;
                  requests.push(params)
              }},
              ...config
          });

    return {pane, requests}
}

test.describe('MemoriesPane — target-state coherence (selected target is part of the snapshot key)', () => {
    test('a target switch invalidates old cards and the drain chain IMMEDIATELY — no stale-depth offset request can be emitted', () => {
        const {pane, requests} = createPane();

        pane.activeAgent = '@neo-opus-ada';
        expect(requests).toEqual([{agentIdentity: '@neo-opus-ada'}]);

        // page zero of 3 arrives: the pane renders it AND drains — one follow-up intent at the
        // rendered depth (the paging chrome's replacement; no button anywhere)
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3});
        expect(pane.summaryStore.count).toBe(2);
        expect(requests).toEqual([
            {agentIdentity: '@neo-opus-ada'},
            {agentIdentity: '@neo-opus-ada', offset: 2}
        ]);

        // the switch: old target's cards die NOW, before any response — and the ONLY new intent
        // is the new target's page zero, never a continuation off Ada's stale depth (the exact
        // failure class the old more-button guard pinned; the drain inherits the guard)
        pane.activeAgent = '@neo-fable-clio';
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-fable-clio'});
        expect(requests).toHaveLength(3);
        expect(pane.summaryStore.count).toBe(0);
        expect(pane.renderedTarget).toBe(null);
        expect(pane.getReference('memories-meta').text).toBe('Reading @neo-fable-clio…');

        pane.destroy()
    });

    test('a late foreign-target envelope is NOT adopted and never drains; the selected target\'s page zero is and does', () => {
        const {pane, requests} = createPane();

        pane.activeAgent = '@neo-opus-ada';
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3});
        pane.activeAgent = '@neo-fable-clio';

        const baseline = requests.length;

        // the stale Ada page lands AFTER the switch — it must not resurrect cards, and it must
        // not fire a drain request either (a foreign envelope re-opening the chain would leak
        // the old target's corpus into the new selection's wire traffic)
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3});
        expect(pane.summaryStore.count).toBe(0);
        expect(pane.renderedTarget).toBe(null);
        expect(pane.getReference('memories-meta').text).toBe('Reading @neo-fable-clio…');
        expect(requests).toHaveLength(baseline);

        // the selected target's page zero arrives — NOW the pane adopts AND the drain anchors on
        // the ACCEPTED page's depth
        pane.snapshot = envelope({target: '@neo-fable-clio', sessions: [row('c1')], total: 2});
        expect(pane.summaryStore.count).toBe(1);
        expect(pane.renderedTarget).toBe('@neo-fable-clio');
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-fable-clio', offset: 1});

        pane.destroy()
    });

    test('a same-target offset continuation extends the corpus; the honest end stops the drain; a repeated envelope cannot loop it', () => {
        const {pane, requests} = createPane();

        pane.activeAgent = '@neo-opus-ada';
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3});
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-opus-ada', offset: 2});

        pane.snapshot = envelope({target: '@neo-opus-ada', offset: 2, sessions: [row('a0', '2026-08-01T10:00:00.000Z')], total: 3});

        expect(pane.summaryStore.count).toBe(3);
        expect(pane.renderedTarget).toBe('@neo-opus-ada');
        expect(pane.getReference('memories-meta').text).toContain('3 of 3 sessions');

        // corpus complete: the drain stopped — the last intent is still the offset-2 request
        const settled = requests.length;
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-opus-ada', offset: 2});

        // an echo-less repeat (same continuation again — no new depth) must NOT re-fire: the
        // floor makes a stuck producer cost one render, never an infinite request loop
        pane.snapshot = envelope({target: '@neo-opus-ada', offset: 2, sessions: [row('a0', '2026-08-01T10:00:00.000Z')], total: 4});
        expect(pane.summaryStore.count).toBe(3);
        expect(requests.length).toBe(settled + 1);
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-opus-ada', offset: 3});

        pane.snapshot = envelope({target: '@neo-opus-ada', offset: 3, sessions: [], total: 4});
        expect(requests.length).toBe(settled + 1);

        pane.destroy()
    });

    test('rematerializing from an owner-held PARTIAL snapshot derives the selection and resumes the drain — a complete one fires nothing', () => {
        const {pane, requests} = createPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3})
        });

        expect(pane.activeAgent).toBe('@neo-opus-ada');
        expect(pane.summaryStore.count).toBe(2);
        expect(pane.renderedTarget).toBe('@neo-opus-ada');
        expect(pane.getReference('memories-refresh').hidden).toBe(false);
        // the held corpus is INCOMPLETE (2 of 3): the drain resumes assembling it — the no-chrome
        // contract's remat consequence (never a page-zero re-read, which stays owner truth)
        expect(requests).toEqual([{agentIdentity: '@neo-opus-ada', offset: 2}]);

        pane.destroy();

        const complete = createPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 2})
        });

        expect(complete.pane.summaryStore.count).toBe(2);
        expect(complete.requests).toEqual([]);

        complete.pane.destroy()
    });

    test('rematerializing with no held snapshot renders the explicit-choice state and fires nothing', () => {
        const {pane, requests} = createPane();

        expect(pane.activeAgent).toBe(null);
        expect(pane.summaryStore.count).toBe(0);
        expect(pane.getReference('memories-meta').text).toBe('Select an agent card in the roster to read their recent sessions.');
        expect(pane.getReference('memories-state').text).toBe('Session summaries render here once an agent is chosen.');
        expect(pane.getReference('memories-state').hidden).toBeFalsy();
        expect(pane.getReference('memories-summary-grid').hidden).toBe(true);
        expect(pane.getReference('memories-refresh').hidden).toBe(true);
        expect(requests).toEqual([]);

        pane.destroy()
    });

    test('NO paging chrome exists; the grids ride the pane stores; band facts are stamped record truth', () => {
        const {pane} = createPane();

        pane.activeAgent = '@neo-opus-ada';
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [
            row('a1', '2026-08-02T20:00:00.000Z'),
            row('a2', '2026-08-02T08:00:00.000Z'),
            row('a3', '2026-07-20T10:00:00.000Z')
        ], total: 3});

        // the retired chrome is GONE, not hidden
        expect(pane.getReference('memories-more')).toBeNull();
        expect(pane.getReference('memories-drill-more')).toBeNull();

        const summaryGrid = pane.getReference('memories-summary-grid');

        expect(summaryGrid.store).toBe(pane.summaryStore);
        expect(pane.getReference('memories-turn-grid').store).toBe(pane.turnStore);
        expect(summaryGrid.hidden).toBe(false);

        // band facts stamped into the bags before they became records (the one-data-path
        // contract): first card of each viewer-calendar band carries the label, the rest null.
        // With a live clock all three 2026 stamps fall in ONE 'earlier' band → exactly one label.
        const facts = pane.summaryStore.items.map(record => record.bandFacts);

        expect(facts[0]).toEqual({label: 'earlier'});
        expect(facts[1]).toBe(null);
        expect(facts[2]).toBe(null);

        pane.destroy()
    });
});


/**
 * @summary Build one wired drill envelope in the exact `fleetSessionMemories` contract shape.
 * @param {Object} options
 * @returns {Object}
 */
function drillEnvelope({sessionId, offset = 0, turns, total}) {
    return {
        capability: {state: 'wired', capturedAt: '2026-08-18T10:00:00.000Z'},
        viewer    : '@e2e-operator',
        sessionId,
        page      : {offset, limit: 20},
        turns,
        count     : turns.length,
        total
    }
}

/**
 * @summary One minimal turn-level memory row.
 * @param {String} id
 * @param {String} sessionId
 * @returns {Object}
 */
function turn(id, sessionId) {
    return {id, sessionId, timestamp: '2026-08-17T18:00:00.000Z', prompt: `Prompt ${id}`, thought: `Thought ${id}`, response: `Response ${id}`, agentIdentity: '@neo-fable-clio', amountToolCalls: 3}
}

test.describe('MemoriesPane — session drill-in (open session is part of the drill snapshot key)', () => {
    /**
     * @summary Pane with captured intents for BOTH event families.
     * @param {Object} [config]
     * @returns {{pane: Object, drills: Object[], closes: Number[]}}
     */
    function createDrillPane(config = {}) {
        const drills = [],
              closes = [],
              pane   = Neo.create(MemoriesPane, {
                  listeners   : {
                      sessionDetailRequest: data => {
                          const {source, ...params} = data;
                          drills.push(params)
                      },
                      sessionDetailClosed: () => closes.push(1)
                  },
                  ...config
              });

        return {pane, drills, closes}
    }

    test('opening a card fires the drill intent and switches the rows zone to the pending drill state', () => {
        const {pane, drills} = createDrillPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1')], total: 1})
        });

        const record = pane.summaryStore.first();

        pane.onCardOpen(record);

        expect(drills).toEqual([{sessionId: 'a1-session', title: 'Title a1'}]);
        expect(pane.drillSession).toEqual({sessionId: 'a1-session', title: 'Title a1'});

        // the drill chrome takes the zone: head visible, summary grid + actions hide, the honest
        // pending copy stands until the session's own envelope answers
        expect(pane.getReference('memories-drill-head').hidden).toBe(false);
        expect(pane.getReference('memories-drill-title').text).toBe('Title a1');
        expect(pane.getReference('memories-summary-grid').hidden).toBe(true);
        expect(pane.getReference('memories-turn-grid').hidden).toBe(true);
        expect(pane.getReference('memories-state').text).toContain('Reading this session’s turns');
        expect(pane.getReference('memories-refresh').hidden).toBe(true);

        // re-opening the SAME session is a no-op — no duplicate wire intent
        pane.onCardOpen(record);
        expect(drills).toHaveLength(1);

        pane.destroy()
    });

    test('drill coherence: a foreign-session envelope is NOT adopted and never drains; the matching one renders and drains', () => {
        const {pane, drills} = createDrillPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1')], total: 1})
        });

        pane.onCardOpen(pane.summaryStore.first());

        // late foreign-session page: rejected — no rows resurrect, no drain fires off its depth
        pane.drillSnapshot = drillEnvelope({sessionId: 'other-session-id', turns: [turn('x1', 'other-session-id')], total: 1});
        expect(pane.turnStore.count).toBe(0);
        expect(pane.renderedDrillSession).toBe(null);
        expect(drills).toHaveLength(1);

        // the matching page adopts: turn rows render, and the drill drain anchors on the accepted
        // depth (2 of 5 → one offset-2 intent; the "older turns" button's replacement)
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', turns: [turn('t1', 'a1-session'), turn('t2', 'a1-session')], total: 5});
        expect(pane.turnStore.count).toBe(2);
        expect(pane.renderedDrillSession).toBe('a1-session');
        expect(pane.getReference('memories-turn-grid').hidden).toBe(false);
        expect(drills.at(-1)).toEqual({sessionId: 'a1-session', title: 'Title a1', offset: 2});

        // the continuation extends — and the chain walks on from the NEW depth
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', offset: 2, turns: [turn('t3', 'a1-session')], total: 5});
        expect(pane.turnStore.count).toBe(3);
        expect(drills.at(-1)).toEqual({sessionId: 'a1-session', title: 'Title a1', offset: 3});

        // honest end: a final short page stops the chain
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', offset: 3, turns: [turn('t4', 'a1-session'), turn('t5', 'a1-session')], total: 5});
        const settled = drills.length;
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', offset: 3, turns: [turn('t4', 'a1-session'), turn('t5', 'a1-session')], total: 5});
        expect(drills).toHaveLength(settled);

        pane.destroy()
    });

    test('back fires the close intent and restores the summary list with its store intact', () => {
        const {pane, closes} = createDrillPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 2})
        });

        pane.onCardOpen(pane.summaryStore.first());
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', turns: [turn('t1', 'a1-session')], total: 1});

        pane.onDrillBackClick();

        expect(closes).toEqual([1]);
        expect(pane.drillSession).toBe(null);
        expect(pane.turnStore.count).toBe(0);
        expect(pane.summaryStore.count).toBe(2);
        expect(pane.getReference('memories-drill-head').hidden).toBe(true);
        expect(pane.getReference('memories-turn-grid').hidden).toBe(true);
        expect(pane.getReference('memories-summary-grid').hidden).toBe(false);
        expect(pane.getReference('memories-refresh').hidden).toBe(false);

        pane.destroy()
    });

    test('provenance vocabulary: the drill head carries the authored tag — never while the derived register shows', () => {
        // the summary cards' `is-derived` chip lives inside the pooled SummaryRow cells now —
        // pinned in summaryRow.spec.mjs; the pane owns the drill head's AUTHORED half
        const {pane} = createDrillPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1')], total: 1})
        });

        const authoredChip = () => {
            const walk = item =>
                (item.cls?.includes('is-authored')) || (item.items || []).some(walk);

            return walk(pane.getReference('memories-drill-head'))
        };

        expect(authoredChip()).toBe(true);
        expect(pane.getReference('memories-drill-head').hidden).toBe(true);

        pane.onCardOpen(pane.summaryStore.first());
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', turns: [turn('t1', 'a1-session')], total: 1});

        expect(pane.getReference('memories-drill-head').hidden).toBe(false);
        expect(pane.getReference('memories-summary-grid').hidden).toBe(true);

        pane.destroy()
    });

    test('rematerializing with an owner-held open drill reopens at that depth and fires nothing', () => {
        const {pane, drills} = createDrillPane({
            snapshot     : envelope({target: '@neo-opus-ada', sessions: [row('a1')], total: 1}),
            drillSession : {sessionId: 'a1-session', title: 'Title a1'},
            drillSnapshot: drillEnvelope({sessionId: 'a1-session', turns: [turn('t1', 'a1-session')], total: 1})
        });

        expect(pane.turnStore.count).toBe(1);
        expect(pane.renderedDrillSession).toBe('a1-session');
        expect(pane.getReference('memories-drill-head').hidden).toBe(false);
        expect(pane.getReference('memories-turn-grid').hidden).toBe(false);
        expect(drills).toEqual([]);

        pane.destroy()
    });

    test('an unavailable drill envelope renders the honest unanswered state with its detail', () => {
        const {pane} = createDrillPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1')], total: 1})
        });

        pane.onCardOpen(pane.summaryStore.first());
        pane.drillSnapshot = {
            capability: {state: 'unavailable', reason: 'session-memories-read-failed', capturedAt: '2026-08-18T10:00:00.000Z', detail: 'wire timeout'},
            viewer    : '@e2e-operator',
            sessionId : 'a1-session',
            page      : {offset: 0, limit: 20},
            turns     : [],
            count     : 0,
            total     : null
        };

        expect(pane.turnStore.count).toBe(0);
        expect(pane.renderedDrillSession).toBe(null);

        const stateEl = pane.getReference('memories-state');

        expect(stateEl.hidden).toBeFalsy();
        expect(stateEl.text).toContain('did not answer');
        expect(stateEl.text).toContain('wire timeout');
        expect(pane.getReference('memories-turn-grid').hidden).toBe(true);

        pane.destroy()
    })
});
