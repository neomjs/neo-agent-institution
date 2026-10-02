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

/**
 * @summary Drive the engine's own edge math on a register with no layout measured: ten visible
 * rows from the top, so every fixture corpus here is at its edge — the engine announces it once
 * per store count ({@link Neo.grid.Body#updateMountedAndVisibleRows}) and the grid relays it.
 * @param {Neo.grid.Container} grid
 */
function edge(grid) {
    grid.body.availableRows = 10;
    grid.body.updateMountedAndVisibleRows()
}

test.describe('MemoriesPane — target-state coherence (selected target is part of the snapshot key)', () => {
    test('a landed page asks nothing on its own; the register\'s edge asks once at the rendered depth; a target switch invalidates old cards and the gate IMMEDIATELY — no stale-depth offset request can be emitted', () => {
        const {pane, requests} = createPane(),
              grid             = pane.getReference('memories-summary-grid');

        pane.activeAgent = '@neo-opus-ada';
        expect(requests).toEqual([{agentIdentity: '@neo-opus-ada'}]);

        // page zero of 3 arrives: the pane renders it and asks for NOTHING — continuation is
        // deliberate; the paging chrome's replacement is the operator's scroll edge, no button anywhere
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3});
        expect(pane.summaryStore.count).toBe(2);
        expect(requests).toEqual([{agentIdentity: '@neo-opus-ada'}]);

        // the engine's edge (a 2-row store is at its edge on first layout): ONE follow-up intent
        // at the rendered depth; parked there, a further tick asks nothing more — the engine
        // latches per count, and the pane's own gate holds while the window is in flight
        edge(grid);
        expect(requests).toEqual([
            {agentIdentity: '@neo-opus-ada'},
            {agentIdentity: '@neo-opus-ada', offset: 2}
        ]);
        edge(grid);
        pane.onSummaryScrollEdge();
        expect(requests).toHaveLength(2);

        // the switch: old target's cards die NOW, before any response — and the ONLY new intent
        // is the new target's page zero, never a continuation off Ada's stale depth (the exact
        // failure class the old more-button guard pinned; the edge inherits the guard)
        pane.activeAgent = '@neo-fable-clio';
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-fable-clio'});
        expect(requests).toHaveLength(3);
        expect(pane.summaryStore.count).toBe(0);
        expect(pane.renderedTarget).toBe(null);
        expect(pane.getReference('memories-meta').text).toBe('Reading @neo-fable-clio…');

        // an edge with no adopted corpus asks nothing
        edge(grid);
        pane.onSummaryScrollEdge();
        expect(requests).toHaveLength(3);

        pane.destroy()
    });

    test('a late foreign-target envelope is NOT adopted and its edge asks nothing; the selected target\'s page zero is adopted and its edge asks', () => {
        const {pane, requests} = createPane(),
              grid             = pane.getReference('memories-summary-grid');

        pane.activeAgent = '@neo-opus-ada';
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3});
        pane.activeAgent = '@neo-fable-clio';

        const baseline = requests.length;

        // the stale Ada page lands AFTER the switch — it must not resurrect cards, and no edge can
        // request off it (a foreign envelope re-opening the chain would leak the old target's
        // corpus into the new selection's wire traffic)
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3});
        expect(pane.summaryStore.count).toBe(0);
        expect(pane.renderedTarget).toBe(null);
        expect(pane.getReference('memories-meta').text).toBe('Reading @neo-fable-clio…');
        edge(grid);
        pane.onSummaryScrollEdge();
        expect(requests).toHaveLength(baseline);

        // the selected target's page zero arrives — NOW the pane adopts, asks nothing on the
        // landing, and the edge anchors on the ACCEPTED page's depth
        pane.snapshot = envelope({target: '@neo-fable-clio', sessions: [row('c1')], total: 2});
        expect(pane.summaryStore.count).toBe(1);
        expect(pane.renderedTarget).toBe('@neo-fable-clio');
        expect(requests).toHaveLength(baseline);
        edge(grid);
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-fable-clio', offset: 1});

        pane.destroy()
    });

    test('a same-target offset continuation extends the corpus; the honest end stops the edge; a repeated answer cannot loop it', () => {
        const {pane, requests} = createPane(),
              grid             = pane.getReference('memories-summary-grid');

        pane.activeAgent = '@neo-opus-ada';
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3});
        edge(grid);
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-opus-ada', offset: 2});

        pane.snapshot = envelope({target: '@neo-opus-ada', offset: 2, sessions: [row('a0', '2026-08-01T10:00:00.000Z')], total: 3});

        expect(pane.summaryStore.count).toBe(3);
        expect(pane.renderedTarget).toBe('@neo-opus-ada');
        expect(pane.getReference('memories-meta').text).toContain('3 of 3 sessions');

        // corpus complete: the landing asked nothing, and the edge of a complete corpus asks
        // nothing — the last intent is still the offset-2 request
        const settled = requests.length;
        edge(grid);
        pane.onSummaryScrollEdge();
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-opus-ada', offset: 2});
        expect(requests).toHaveLength(settled);

        // an echo-less repeat (the producer now claims 4 but returns the held row again): the
        // landing asks nothing, and the engine announces no new edge for an unchanged count —
        // a stuck producer costs nothing, never an infinite request loop. Told the edge is
        // reached (the operator left and returned), the pane asks exactly once at the rendered
        // depth and holds while that window is in flight.
        pane.snapshot = envelope({target: '@neo-opus-ada', offset: 2, sessions: [row('a0', '2026-08-01T10:00:00.000Z')], total: 4});
        expect(pane.summaryStore.count).toBe(3);
        edge(grid);
        expect(requests).toHaveLength(settled);
        pane.onSummaryScrollEdge();
        pane.onSummaryScrollEdge();
        expect(requests.length).toBe(settled + 1);
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-opus-ada', offset: 3});

        // the empty answer lands: nothing renders, nothing is requested on the landing
        pane.snapshot = envelope({target: '@neo-opus-ada', offset: 3, sessions: [], total: 4});
        expect(requests.length).toBe(settled + 1);

        pane.destroy()
    });

    test('rematerializing from an owner-held PARTIAL snapshot derives the selection and fires nothing; its edge asks for the rest — a complete one\'s edge asks nothing', () => {
        const {pane, requests} = createPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 3})
        });

        expect(pane.activeAgent).toBe('@neo-opus-ada');
        expect(pane.summaryStore.count).toBe(2);
        expect(pane.renderedTarget).toBe('@neo-opus-ada');
        expect(pane.getReference('memories-refresh').hidden).toBe(false);
        // the held corpus is INCOMPLETE (2 of 3): rematerialization re-reads nothing (page zero
        // stays owner truth) and asks nothing on its own; the register's edge asks for the rest
        expect(requests).toEqual([]);
        edge(pane.getReference('memories-summary-grid'));
        expect(requests).toEqual([{agentIdentity: '@neo-opus-ada', offset: 2}]);

        pane.destroy();

        const complete = createPane({
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 2})
        });

        expect(complete.pane.summaryStore.count).toBe(2);
        edge(complete.pane.getReference('memories-summary-grid'));
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
     * @summary Pane with captured intents for BOTH event families, plus the summary reads.
     * @param {Object} [config]
     * @returns {{pane: Object, drills: Object[], closes: Number[], requests: Object[]}}
     */
    function createDrillPane(config = {}) {
        const drills   = [],
              closes   = [],
              requests = [],
              pane     = Neo.create(MemoriesPane, {
                  listeners   : {
                      memoriesRequest: data => {
                          const {source, ...params} = data;
                          requests.push(params)
                      },
                      sessionDetailRequest: data => {
                          const {source, ...params} = data;
                          drills.push(params)
                      },
                      sessionDetailClosed: () => closes.push(1)
                  },
                  ...config
              });

        return {pane, drills, closes, requests}
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

    test('drill coherence: a foreign-session envelope is NOT adopted and its edge asks nothing; the matching one renders, and the turn register\'s edge walks the session to its honest end while the summary register stays quiet', () => {
        const {pane, drills, requests} = createDrillPane({
            // a PARTIAL summary corpus (1 of 2): the summary register has more to ask for, which
            // is exactly what a drill in progress must suspend
            snapshot: envelope({target: '@neo-opus-ada', sessions: [row('a1')], total: 2})
        });
        const
            turnGrid    = pane.getReference('memories-turn-grid'),
            summaryGrid = pane.getReference('memories-summary-grid');

        pane.onCardOpen(pane.summaryStore.first());

        // late foreign-session page: rejected — no rows resurrect, no edge can request off it
        pane.drillSnapshot = drillEnvelope({sessionId: 'other-session-id', turns: [turn('x1', 'other-session-id')], total: 1});
        expect(pane.turnStore.count).toBe(0);
        expect(pane.renderedDrillSession).toBe(null);
        edge(turnGrid);
        pane.onTurnScrollEdge();
        expect(drills).toHaveLength(1);

        // the matching page adopts: turn rows render and the landing requests NOTHING; the turn
        // register's edge anchors on the accepted depth (2 of 5 → one offset-2 intent; the
        // "older turns" button's replacement) and holds while that window is in flight
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', turns: [turn('t1', 'a1-session'), turn('t2', 'a1-session')], total: 5});
        expect(pane.turnStore.count).toBe(2);
        expect(pane.renderedDrillSession).toBe('a1-session');
        expect(turnGrid.hidden).toBe(false);
        expect(drills).toHaveLength(1);
        edge(turnGrid);
        expect(drills.at(-1)).toEqual({sessionId: 'a1-session', title: 'Title a1', offset: 2});
        edge(turnGrid);
        pane.onTurnScrollEdge();
        expect(drills).toHaveLength(2);

        // while the drill owns the zone, the summary register's edge asks nothing — its partial
        // corpus resumes only when the operator returns to the list
        edge(summaryGrid);
        pane.onSummaryScrollEdge();
        expect(requests).toEqual([]);

        // the continuation extends — the landing asks nothing, the next edge walks on from the NEW depth
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', offset: 2, turns: [turn('t3', 'a1-session')], total: 5});
        expect(pane.turnStore.count).toBe(3);
        expect(drills).toHaveLength(2);
        edge(turnGrid);
        expect(drills.at(-1)).toEqual({sessionId: 'a1-session', title: 'Title a1', offset: 3});

        // honest end: the final page completes the session, and its edge asks nothing
        pane.drillSnapshot = drillEnvelope({sessionId: 'a1-session', offset: 3, turns: [turn('t4', 'a1-session'), turn('t5', 'a1-session')], total: 5});
        expect(pane.turnStore.count).toBe(5);
        edge(turnGrid);
        pane.onTurnScrollEdge();
        expect(drills).toHaveLength(3);

        // back to the list: the edge the register announced behind the drill was refused, not
        // forgotten — the pane replays it once, and the re-shown layout (same count, engine latched)
        // adds nothing
        pane.onDrillBackClick();
        expect(requests).toEqual([{agentIdentity: '@neo-opus-ada', offset: 1}]);
        edge(summaryGrid);
        expect(requests).toHaveLength(1);

        pane.destroy()
    });

    test('a summary continuation that lands behind an open drill pages nothing there, and the edge it announced is replayed once on return', () => {
        const
            {pane, drills, requests} = createDrillPane(),
            summaryGrid              = pane.getReference('memories-summary-grid');

        pane.activeAgent = '@neo-opus-ada';
        pane.snapshot = envelope({target: '@neo-opus-ada', sessions: [row('a1'), row('a2')], total: 10});
        edge(summaryGrid);
        expect(requests).toEqual([{agentIdentity: '@neo-opus-ada'}, {agentIdentity: '@neo-opus-ada', offset: 2}]);

        pane.onCardOpen(pane.summaryStore.first());
        expect(drills).toHaveLength(1);

        // the offset-2 window lands while the drill owns the zone. A hidden register keeps the
        // geometry it last measured, so in the browser the store set itself runs the body's layout
        // (onStoreLoad → createViewData → updateMountedAndVisibleRows), which announces the NEW
        // count and latches it; a unit grid has no width, so that layout is forced here. The pane
        // pages nothing behind the drill.
        pane.snapshot = envelope({target: '@neo-opus-ada', offset: 2, sessions: [row('a3')], total: 10});
        expect(pane.summaryStore.count).toBe(3);
        edge(summaryGrid);
        expect(requests).toHaveLength(2);

        // back: the re-shown register lays out at the latched count, so the engine stays quiet; the
        // pane replays the edge it refused, exactly once
        pane.onDrillBackClick();
        expect(requests.at(-1)).toEqual({agentIdentity: '@neo-opus-ada', offset: 3});
        expect(requests).toHaveLength(3);
        edge(summaryGrid);
        pane.onDrillBackClick();
        expect(requests).toHaveLength(3);

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
        // the summary cards' `is-derived` chip lives inside the pooled SummaryRowComponent cells now —
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
