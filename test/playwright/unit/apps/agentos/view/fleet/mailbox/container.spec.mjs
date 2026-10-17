import {setup} from '../../../../../../setup.mjs';

const appName = 'MailboxPaneTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: false,
        unitTestMode           : true,
        useDomApiRenderer      : false
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {test, expect}  from '@playwright/test';
import Neo             from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core       from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import InstanceManager from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import MailboxPane     from '../../../../../../../../apps/agentos/view/fleet/mailbox/Container.mjs';
import OperatorMailbox from '../../../../../../../../apps/agentos/view/fleet/mailbox/OperatorContainer.mjs';
import LivenessCadence from '../../../../../../../../apps/agentos/util/LivenessCadence.mjs';

const CAPTURED_AT = '2026-07-16T12:00:00.000Z';
const NOW         = Date.parse('2026-07-16T12:00:30.000Z');

function wiredSnapshot(rows, page = {limit: 50, offset: 0, count: rows.length}) {
    return {
        capability: {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', capturedAt: CAPTURED_AT, reason: null},
        admission : {state: 'granted', viewerIdentity: '@tobiu', subjectAgentId: '@neo-opus-vega', checkedAt: CAPTURED_AT, reason: null},
        rows,
        page
    }
}

function row(overrides = {}) {
    return {
        messageId     : 'MESSAGE:base',
        subject       : 'a subject',
        from          : '@neo-gpt',
        recipientClass: 'agent',
        priority      : 'normal',
        status        : 'unread',
        taskState     : null,
        partOfThread  : null,
        relatedTickets: [],
        wakeSuppressed: false,
        sentAt        : '2026-07-16T11:00:00.000Z',
        readAt        : null,
        ...overrides
    }
}

function createPane(config = {}) {
    return Neo.create(MailboxPane, {
        appName,
        now: NOW,
        // Mirrors production: the pane always shows a drilled resident, and its record carries the
        // mailbox identity authority the snapshot's admitted subject is checked against. The default
        // matches `wiredSnapshot`'s subject — a pane whose record names a DIFFERENT resident (or no
        // resident at all) cannot prove the mail is his, and renders nothing. Tests opt into that by
        // passing their own record.
        record: {agentId: 'vega', githubUsername: 'neo-opus-vega'},
        ...config
    })
}

test.describe('AgentOS.view.fleet.mailbox.Container — the read-only S1 mailbox mirror pane', () => {
    test('clock ticks age a held open window without requesting another page', () => {
        const pane = createPane({view: 'open', questions: {
            state: 'ok', capturedAt: CAPTURED_AT, count: 1, rows: [],
            page: {limit: 50, offset: 0, count: 0, hasMore: true}
        }});
        let requests = 0;

        pane.on('pageRequest', () => requests++);
        pane.pendingOffset = null;
        const source = pane.questions;

        try {
            pane.now = NOW + 90000;
            expect(pane.getReference('mailbox-freshness').cls).toContain('is-stale');
            expect(requests, 'aging the label is not a page-read intent').toBe(0);
            expect(pane.questions).toBe(source);
            expect(pane.pendingOffset).toBe(null)
        } finally {
            pane.destroy()
        }
    });

    test('a failed refresh keeps recent rows but cannot label them fresh', () => {
        const snapshot = wiredSnapshot([row()]),
              pane = createPane({snapshot, readFailed: true});

        try {
            expect(pane.getReference('mailbox-freshness').cls).toContain('is-stale');
            expect(pane.store.getCount()).toBe(1);
            expect(pane.snapshot.capability.capturedAt).toBe(CAPTURED_AT);
            pane.readFailed = false;
            expect(pane.getReference('mailbox-freshness').cls).toContain('is-fresh')
        } finally {
            pane.destroy()
        }
    });

    test('unobserved: no snapshot renders the honest not-wired state, never rows', () => {
        const pane = createPane();

        expect(pane.getPaneState()).toBe('unobserved');
        expect(pane.getReference('mailbox-state').text).toBe('Mailbox feed not wired');
        expect(pane.getReference('mailbox-state').hidden).toBeFalsy();
        expect(pane.getReference('mailbox-rows').hidden).toBe(true);
        expect(pane.getReference('mailbox-freshness').text).toBe('not observed — source not wired');
        expect(pane.store.getCount()).toBe(0);

        pane.destroy()
    });

    test('denied: a named denial carrying viewer + subject — never an empty-success', () => {
        const pane = createPane({
            snapshot: {
                capability: {state: 'degraded', confidence: 'none', capturedAt: CAPTURED_AT, reason: 'Unauthorized: no CAN_READ_INBOX_OF permission for @neo-opus-vega'},
                admission : {state: 'denied', viewerIdentity: '@neo-observer', subjectAgentId: '@neo-opus-vega', checkedAt: CAPTURED_AT, reason: 'Unauthorized: no CAN_READ_INBOX_OF permission for @neo-opus-vega'},
                rows      : [],
                page      : {limit: 50, offset: 0, count: 0}
            }
        });

        expect(pane.getPaneState()).toBe('denied');

        const stateCmp = pane.getReference('mailbox-state');
        expect(stateCmp.text).toContain('Access denied');
        expect(stateCmp.text).toContain('@neo-observer');
        expect(stateCmp.text).toContain('@neo-opus-vega');
        expect(stateCmp.cls).toContain('is-denied');
        expect(pane.getReference('mailbox-rows').hidden).toBe(true);

        pane.destroy()
    });

    test('an unrecognized envelope fails CLOSED to unobserved — never a fabricated empty inbox', () => {
        // `empty` is a claim about the SUBJECT'S MAIL ("No active messages for @x") and may only be
        // made when the producer actually said so. A torn/unknown payload has no rows either, so a
        // bare length check renders a confident, honest-LOOKING empty inbox out of something the
        // pane never understood — the exact fail-open this pane's four honest states exist to kill.
        const unrecognized = [
            {},
            {capability: {state: 'wired'}},                       // producer half-answered
            {rows: null},                                         // torn
            {rows: 'MESSAGE:not-an-array'},                       // wrong type
            {admission: {state: 'granted'}, page: {limit: 50}},   // envelope without the rows array
            // reviewer's exact falsifiers: a bare rows array is NOT the producer's envelope. The
            // producer emits {capability, admission, rows, page} on EVERY state — its own degrades
            // included — so these came from somewhere else, and rendering them fabricates a mail
            // claim ("No active messages for @x" / a stranger's message list) from a shape the pane
            // never recognized.
            {rows: []},
            {rows: [row({messageId: 'MESSAGE:from-nowhere'})]},
            // each single missing member fails closed on its own
            {admission: {state: 'granted'}, rows: [], page: {limit: 50, offset: 0, count: 0}},
            {capability: {state: 'wired'}, rows: [], page: {limit: 50, offset: 0, count: 0}},
            {capability: {state: 'wired'}, admission: {state: 'granted'}, rows: []}
        ];

        unrecognized.forEach(snapshot => {
            const pane = createPane({snapshot});

            expect(pane.getPaneState(), JSON.stringify(snapshot)).toBe('unobserved');
            expect(pane.getReference('mailbox-state').text).toContain('not wired');
            expect(pane.getReference('mailbox-rows').hidden).toBe(true);

            pane.destroy()
        });

        // the producer's OWN empty answer is still explicitly empty — the guard must not swallow it
        const honest = createPane({snapshot: {
            capability: {state: 'wired', confidence: 'observed', capturedAt: CAPTURED_AT, reason: null},
            admission : {state: 'granted', viewerIdentity: '@tobiu', subjectAgentId: '@neo-opus-vega', checkedAt: CAPTURED_AT, reason: null},
            page      : {limit: 50, offset: 0, count: 0},
            rows      : []
        }});

        expect(honest.getPaneState()).toBe('empty');
        honest.destroy()
    });

    test("a GRANTED snapshot about another resident never renders under this one's name", () => {
        // The reviewer's exact falsifier. The possession guard and the generation latch both protect
        // the SEQUENCE and neither reads the envelope: a granted snapshot for Vega assigned onto
        // Ada's pane satisfies every one of them, because Ada's record was already correct when it
        // landed. The envelope has to be asked who it is ABOUT.
        const ada = createPane({
            record  : {agentId: 'ada', githubUsername: 'neo-opus-ada'},
            snapshot: wiredSnapshot([row({messageId: 'MESSAGE:vega-private', subject: 'VEGA PRIVATE MAIL'})])
        });

        expect(ada.getPaneState(), "vega's mail must not render on ada's pane").toBe('unobserved');
        expect(ada.getReference('mailbox-rows').hidden).toBe(true);
        // the inadmissible snapshot never reaches the grid's store — no row can materialize
        expect(ada.store.getCount()).toBe(0);
        ada.destroy();

        // an EMPTY snapshot about someone else is equally inadmissible: rendering it would say
        // "No active messages for ada" on the strength of a read about vega
        const adaEmpty = createPane({
            record  : {agentId: 'ada', githubUsername: 'neo-opus-ada'},
            snapshot: wiredSnapshot([], {limit: 50, offset: 0, count: 0})
        });
        expect(adaEmpty.getPaneState()).toBe('unobserved');
        adaEmpty.destroy();

        // a DENIAL about someone else cannot be shown either — its sentence names the subject
        const adaDenied = createPane({
            record  : {agentId: 'ada', githubUsername: 'neo-opus-ada'},
            snapshot: {
                capability: {state: 'degraded', confidence: 'none', capturedAt: CAPTURED_AT, reason: 'Unauthorized: no CAN_READ_INBOX_OF permission for @neo-opus-vega'},
                admission : {state: 'denied', viewerIdentity: '@tobiu', subjectAgentId: '@neo-opus-vega', checkedAt: CAPTURED_AT, reason: 'Unauthorized: no CAN_READ_INBOX_OF permission for @neo-opus-vega'},
                rows      : [],
                page      : {limit: 50, offset: 0, count: 0}
            }
        });
        expect(adaDenied.getPaneState()).toBe('unobserved');
        adaDenied.destroy();

        // and a resident with NO identity authority is honestly unverifiable — never an implicit pass
        const unverifiable = createPane({
            record  : {agentId: 'custom-resident', githubUsername: null},
            snapshot: wiredSnapshot([row({messageId: 'MESSAGE:x'})])
        });
        expect(unverifiable.getPaneState()).toBe('unobserved');
        unverifiable.destroy()
    });

    test('degraded (non-admission) carries the adapter reason; empty is explicit, not blank', () => {
        const pane = createPane({
            snapshot: {
                capability: {state: 'degraded', confidence: 'none', capturedAt: CAPTURED_AT, reason: 'database not initialized'},
                admission : {state: 'unavailable', viewerIdentity: '@tobiu', subjectAgentId: '@neo-opus-vega', checkedAt: CAPTURED_AT, reason: 'database not initialized'},
                rows      : [],
                page      : {limit: 50, offset: 0, count: 0}
            }
        });

        expect(pane.getPaneState()).toBe('degraded');
        expect(pane.getReference('mailbox-state').text).toContain('database not initialized');

        pane.snapshot = wiredSnapshot([]);
        expect(pane.getPaneState()).toBe('empty');
        expect(pane.getReference('mailbox-state').text).toContain('No active messages');
        expect(pane.getReference('mailbox-rows').hidden).toBe(true);

        pane.destroy()
    });

    test('an adapter REFUSAL is never blamed on the source: the line names no cause it cannot know', () => {
        // The adapter's fail-closed refusals all arrive as admission 'unavailable' beside
        // capability 'degraded' — identical in shape to a real outage. The pane cannot tell them
        // apart and must not guess: "source degraded" would blame Memory Core for a refusal the
        // adapter made about the VIEWER. The owner's reason is the only honest content.
        const refusals = [
            'asserted viewerIdentity does not match the bound request identity',
            'mailbox mirror requires a bound request identity to attribute admission',
            'mailbox mirror requires one direct subjectAgentId — namespace targets are not admissible'
        ];

        refusals.forEach(reason => {
            const pane = createPane({
                snapshot: {
                    capability: {state: 'degraded', confidence: 'none', capturedAt: CAPTURED_AT, reason},
                    admission : {state: 'unavailable', viewerIdentity: null, subjectAgentId: null, checkedAt: CAPTURED_AT, reason},
                    rows      : [],
                    page      : {limit: 50, offset: 0, count: 0}
                }
            });

            const text = pane.getReference('mailbox-state').text;

            expect(pane.getPaneState()).toBe('degraded');
            expect(text, 'the owner reason is carried verbatim').toContain(reason);
            expect(text, 'no fabricated source-outage attribution').not.toContain('source degraded');
            // a refusal shows no rows — never a half-truth
            expect(pane.getReference('mailbox-rows').hidden).toBe(true);

            pane.destroy()
        })
    });

    test('rows: the full window projects into the grid store newest-first, fresh chip from capturedAt', () => {
        const pane = createPane({
            snapshot: wiredSnapshot([
                row({messageId: 'MESSAGE:old', subject: 'older', sentAt: '2026-07-16T10:00:00.000Z'}),
                row({messageId: 'MESSAGE:new', subject: 'newer', sentAt: '2026-07-16T11:30:00.000Z'})
            ], {limit: 50, offset: 0, count: 2})
        });

        expect(pane.getPaneState()).toBe('rows');
        expect(pane.getReference('mailbox-state').hidden).toBe(true);

        // the rows body is the buffered grid: visible, fed the FULL snapshot window through the
        // pane-owned store (newest-first is the store's binding sort), no paging chrome anywhere
        const rowsGrid = pane.getReference('mailbox-rows');
        expect(rowsGrid.hidden).toBe(false);
        expect(rowsGrid.store).toBe(pane.store);
        expect(pane.store.getCount()).toBe(2);
        expect(pane.store.getAt(0).subject).toBe('newer');
        expect(pane.store.getAt(1).subject).toBe('older');
        expect(pane.getReference('mailbox-page')).toBeNull();

        // capturedAt is 30s old vs a 60s TTL → fresh
        expect(pane.getReference('mailbox-freshness').text).toContain('updated');

        pane.destroy()
    });

    test('thread-collapse is grid truth: the NEWEST message heads the thread, collapsed members hide via the store filter', () => {
        const pane = createPane({
            snapshot: wiredSnapshot([
                row({messageId: 'MESSAGE:t3', subject: 'thread newest', partOfThread: 'THREAD:x', sentAt: '2026-07-16T11:00:00.000Z'}),
                row({messageId: 'MESSAGE:t2', subject: 'thread middle', partOfThread: 'THREAD:x', sentAt: '2026-07-16T10:00:00.000Z'}),
                row({messageId: 'MESSAGE:t1', subject: 'thread oldest', partOfThread: 'THREAD:x', sentAt: '2026-07-16T09:00:00.000Z'}),
                row({messageId: 'MESSAGE:solo', subject: 'standalone', sentAt: '2026-07-16T11:45:00.000Z'})
            ], {limit: 50, offset: 0, count: 4})
        });

        const rowsGrid = pane.getReference('mailbox-rows');

        // the stamped record truth (the one data path stamps facts into the bags before they
        // become records): store order is newest-first, so the newest message heads its thread —
        // the shipped reading order, pinned (Grace's steer, kept)
        expect(pane.store.get('MESSAGE:t3').threadFacts)
            .toEqual({collapsed: true, isHead: true, hiddenCount: 2, inThread: false});

        // collapsed members hide at the store view layer: the filtered count carries head + solo
        // only — and the hidden members survive in the unfiltered source, facts stamped
        expect(pane.store.getCount()).toBe(2);
        expect(pane.store.get('MESSAGE:solo').threadFacts).toBe(null);
        expect(pane.store.allItems.get('MESSAGE:t2').threadFacts)
            .toEqual({collapsed: true, isHead: false, hiddenCount: 2, inThread: true});

        // toggle = display-state navigation on the view-owned field, never a data write; the flip
        // re-projects through the one data path, so records carry FRESH identities + facts
        rowsGrid.onThreadToggleClick({path: [
            {cls: ['fm-mail-thread-toggle']},
            {cls: ['neo-grid-row'], data: {recordId: 'MESSAGE:t3'}}
        ]});

        expect(pane.store.getCount()).toBe(4);
        expect(pane.store.get('MESSAGE:t3').threadFacts.collapsed).toBe(false);
        expect(pane.store.get('MESSAGE:t2').threadFacts)
            .toEqual({collapsed: false, isHead: false, hiddenCount: 2, inThread: true});

        pane.destroy()
    });

    test('the grid toggle click resolves its record through the engine row contract and flips collapse', () => {
        const pane = createPane({
            snapshot: wiredSnapshot([
                row({messageId: 'MESSAGE:h', partOfThread: 'THREAD:z', sentAt: '2026-07-16T11:00:00.000Z'}),
                row({messageId: 'MESSAGE:m', partOfThread: 'THREAD:z', sentAt: '2026-07-16T10:00:00.000Z'})
            ], {limit: 50, offset: 0, count: 2})
        });

        const rowsGrid = pane.getReference('mailbox-rows');

        expect(pane.store.getCount()).toBe(1);

        // the grid body stamps `data.recordId` on every `.neo-grid-row` — the delegated toggle
        // click walks the path to that node, no index math
        rowsGrid.onThreadToggleClick({path: [
            {cls: ['fm-mail-thread-toggle']},
            {cls: ['neo-grid-row'], data: {recordId: 'MESSAGE:h'}}
        ]});

        expect(pane.store.get('MESSAGE:h').threadCollapsed).toBe(false);
        expect(pane.store.getCount()).toBe(2);

        pane.destroy()
    });

    test('STRUCTURAL read-only: zero mutation affordances anywhere in the vdom or the listener surface', () => {
        const pane = createPane({
            snapshot: wiredSnapshot([
                row({messageId: 'MESSAGE:a'}),
                row({messageId: 'MESSAGE:b', partOfThread: 'THREAD:y'}),
                row({messageId: 'MESSAGE:c', partOfThread: 'THREAD:y', sentAt: '2026-07-16T11:10:00.000Z'})
            ], {limit: 50, offset: 0, count: 3})
        });

        // 1. no MUTATION verb anywhere: no data-entry element, no mutation label. The bar is
        //    mutation, NOT interactivity — an earlier revision banned every control, which read as
        //    stricter but forced thread collapse onto a clickable div no keyboard user could
        //    operate. "Read-only" constrains what the operator can CHANGE, never whether they can
        //    reach what they can see; the one display-state toggle is a native button by design.
        const forbidden = /mark.?read|archive|delete|reply|send/i;
        const walk      = node => {
            if (!node || typeof node !== 'object') return;
            expect(['input', 'textarea', 'select', 'form', 'a']).not.toContain(node.tag);
            // the ONLY admissible control is the thread-collapse toggle — display state, not data
            node.tag === 'button' && expect(node.cls).toContain('fm-mail-thread-toggle');
            typeof node.text === 'string' && expect(forbidden.test(node.text)).toBe(false);
            (node.cn || []).forEach(walk)
        };
        walk(pane.getReference('mailbox-rows').vdom);
        walk(pane.getReference('mailbox-state').vdom);

        // 2. the pane's mutation-capable listener surface is exactly ONE delegated click on the
        //    grid, and it targets the toggle BUTTON, not the row (a row-wide listener is an
        //    interactive region with no tab stop). The grid may own further engine-internal
        //    listeners (scroll plumbing) — none of them a mutation affordance.
        const toggleListeners = (pane.getReference('mailbox-rows').domListeners || [])
            .filter(listener => listener.delegate === '.fm-mail-thread-toggle');
        expect(toggleListeners).toHaveLength(1);

        // 3. the pane class itself exports no mutation verb
        Object.getOwnPropertyNames(Object.getPrototypeOf(pane)).forEach(name => {
            expect(forbidden.test(name)).toBe(false)
        });

        // 4. the tab stays countless: the title never renders a count
        expect(pane.getReference('mailbox-title').text).toBe('A2A Mailbox');

        pane.destroy()
    });

    test('no paging chrome exists — the buffered surface owns the whole window (operator direction 2026-08-28)', () => {
        const pane = createPane({snapshot: wiredSnapshot(
            Array.from({length: 50}, (v, i) => row({messageId: `MESSAGE:${i}`, sentAt: `2026-07-16T10:${String(i % 60).padStart(2, '0')}:00.000Z`})),
            {limit: 50, offset: 0, count: 50, hasMore: true}
        )});

        // the offset-window controls retired with the hand-rolled rows: no references, no handlers
        expect(pane.getReference('mailbox-page')).toBeNull();
        expect(pane.getReference('mailbox-page-prev')).toBeNull();
        expect(pane.getReference('mailbox-page-next')).toBeNull();
        expect(pane.onNextPageClick).toBeUndefined();
        expect(pane.fire).toBeDefined();

        // the grid store carries the FULL projected window — scrolling reaches every row,
        // and the honest end of the window is the only end
        expect(pane.store.getCount()).toBe(50);

        pane.destroy()
    });

    test('#416 · a landed window asks for nothing on its own; the next window is asked for at the scroll edge, once, and the honest end asks for nothing', () => {
        const
            fired    = [],
            firstWin = Array.from({length: 50}, (v, i) => row({
                messageId: `MESSAGE:${i}`, subject: `subject ${i}`,
                sentAt   : `2026-07-16T10:${String(59 - (i % 60)).padStart(2, '0')}:00.000Z`
            })),
            pane = createPane({
                snapshot : wiredSnapshot(firstWin, {limit: 50, offset: 0, count: 50, hasMore: true}),
                listeners: {pageRequest: data => fired.push(data.offset)}
            }),
            grid = pane.getReference('mailbox-rows');

        // the construction-time snapshot carries hasMore and the pane requests NOTHING: the drain
        // this replaces fired [50] here, and a boot walked the whole inbox page by page
        expect(fired).toEqual([]);
        expect(pane.store.getCount()).toBe(50);

        // a freshness re-render asks for nothing either
        pane.now = NOW + 1000;
        expect(fired).toEqual([]);

        // the operator reaches the loaded end: ONE request for the next window
        grid.fire('scrollEdge', {startIndex: 40, endIndex: 50, count: 50});
        expect(fired).toEqual([50]);
        expect(pane.pendingOffset).toBe(50);

        // a second announcement while that request is out fires nothing
        grid.fire('scrollEdge', {startIndex: 40, endIndex: 50, count: 50});
        expect(fired).toEqual([50]);

        // the follow-up window APPENDS — row 51+ is genuinely present — and clears the gate
        pane.snapshot = wiredSnapshot(
            Array.from({length: 10}, (v, i) => row({messageId: `MESSAGE:5${i}`, subject: `late ${i}`, sentAt: `2026-07-16T09:0${i % 10}:00.000Z`})),
            {limit: 50, offset: 50, count: 10, hasMore: false}
        );

        expect(pane.store.getCount()).toBe(60);
        expect(pane.store.allItems.get('MESSAGE:55')).toBeTruthy();
        expect(pane.pendingOffset).toBeNull();

        // hasMore: false is the honest end — the edge asks for nothing more
        grid.fire('scrollEdge', {startIndex: 50, endIndex: 60, count: 60});
        expect(fired).toEqual([50]);

        pane.destroy()
    });

    test('#416 · a landed window with more beyond it re-opens the gate: the next edge asks for the following window', () => {
        const
            fired = [],
            win   = (offset, n) => Array.from({length: n}, (v, i) => row({messageId: `MESSAGE:${offset + i}`, sentAt: `2026-07-16T0${9 - (offset / 50)}:${String(59 - i).padStart(2, '0')}:00.000Z`})),
            pane  = createPane({
                snapshot : wiredSnapshot(win(0, 50), {limit: 50, offset: 0, count: 50, hasMore: true}),
                listeners: {pageRequest: data => fired.push(data.offset)}
            }),
            grid  = pane.getReference('mailbox-rows');

        grid.fire('scrollEdge', {startIndex: 40, endIndex: 50, count: 50});
        pane.snapshot = wiredSnapshot(win(50, 50), {limit: 50, offset: 50, count: 50, hasMore: true});

        // the landed window carries hasMore and still asks for nothing by itself (the committed
        // pane requested 100 right here); the operator's next edge does
        expect(fired).toEqual([50]);
        expect(pane.store.getCount()).toBe(100);

        grid.fire('scrollEdge', {startIndex: 90, endIndex: 100, count: 100});
        expect(fired).toEqual([50, 100]);

        // a non-rows state asks for nothing, whatever the edge says
        pane.snapshot = null;
        grid.fire('scrollEdge', {startIndex: 0, endIndex: 0, count: 0});
        expect(fired).toEqual([50, 100]);

        pane.destroy()
    });

    test('#416 · continuation is deliberate: a window of collapsed-only replies ends the gesture\'s reach (no walk of a collapsed inbox), and expanding the thread is how the operator reaches older mail', () => {
        // Sophie's two halves in one arm. Fifty replies under ONE collapsed head render as one
        // visible row. (1) The short first page asks for one window; when that window lands and
        // reveals nothing, the pane asks for NOTHING more however many layouts follow — a
        // total-keyed latch would have walked the whole collapsed inbox at boot, the drain under
        // another projection. (2) The head's count carries what arrived; the operator expands the
        // thread, the rows scroll, and the edge asks for the next window as usual.
        const
            fired  = [],
            reply  = (i, minute) => row({messageId: `MESSAGE:t${i}`, partOfThread: 'THREAD:one', subject: `reply ${i}`, sentAt: `2026-07-16T${String(10 - Math.floor(minute / 60)).padStart(2, '0')}:${String(59 - (minute % 60)).padStart(2, '0')}:00.000Z`}),
            pane   = createPane({
                snapshot : wiredSnapshot(Array.from({length: 50}, (v, i) => reply(i, i)), {limit: 50, offset: 0, count: 50, hasMore: true}),
                listeners: {pageRequest: data => fired.push(data.offset)}
            }),
            grid   = pane.getReference('mailbox-rows'),
            body   = grid.body,
            at     = startIndex => { body.startIndex = startIndex; body.updateMountedAndVisibleRows() };

        body.availableRows = 10;

        expect(pane.store.getCount(), 'one visible head over 49 collapsed replies').toBe(1);

        // the short first page is at its edge from the first layout: one window is asked for
        at(0);
        expect(fired).toEqual([50]);

        // it lands hidden entirely: visible count unchanged, total 100, the producer says more
        pane.snapshot = wiredSnapshot(Array.from({length: 50}, (v, i) => reply(50 + i, 50 + i)), {limit: 50, offset: 50, count: 50, hasMore: true});
        expect(pane.store.getCount()).toBe(1);
        expect(pane.store.allItems.getCount()).toBe(100);
        expect(pane.pendingOffset).toBeNull();
        expect(pane.store.get('MESSAGE:t0').threadFacts.hiddenCount, 'the head carries what arrived').toBe(99);

        // no gesture: however many layouts follow, nothing more is asked for
        at(0); at(0); at(0);
        expect(fired, 'a hidden-only append ends the gesture\'s reach').toEqual([50]);

        // the operator expands the thread: the rows are reachable, the edge works as usual
        grid.onThreadToggleClick({path: [{cls: ['fm-mail-thread-toggle']}, {cls: ['neo-grid-row'], data: {recordId: 'MESSAGE:t0'}}]});
        expect(pane.store.getCount()).toBe(100);
        at(90);
        expect(fired).toEqual([50, 100]);

        // the next window of the expanded thread lands visible; the operator scrolls on
        pane.snapshot = wiredSnapshot(Array.from({length: 50}, (v, i) => reply(100 + i, 100 + i)), {limit: 50, offset: 100, count: 50, hasMore: true});
        expect(pane.store.getCount(), 'the expansion survived the append').toBe(150);
        at(140);
        expect(fired).toEqual([50, 100, 150]);

        // the honest end
        pane.snapshot = wiredSnapshot(Array.from({length: 10}, (v, i) => reply(150 + i, 150 + i)), {limit: 50, offset: 150, count: 10, hasMore: false});
        at(150);
        expect(fired).toEqual([50, 100, 150]);

        pane.destroy()
    });

    test('#416 · the body announces the edge once per store count: parked there it stays quiet, leaving and returning or a grown store re-arms it, a short store announces on first layout', () => {
        const
            edges = [],
            pane  = createPane({snapshot: wiredSnapshot(
                Array.from({length: 50}, (v, i) => row({messageId: `MESSAGE:${i}`, sentAt: `2026-07-16T10:${String(59 - (i % 60)).padStart(2, '0')}:00.000Z`})),
                {limit: 50, offset: 0, count: 50, hasMore: true}
            )}),
            grid  = pane.getReference('mailbox-rows'),
            body  = grid.body,
            at    = startIndex => { body.startIndex = startIndex; body.updateMountedAndVisibleRows() };

        // the engine stamps the firing component as `source`; the contract is the three numbers
        grid.on('scrollEdge', ({count, endIndex, startIndex}) => edges.push({count, endIndex, startIndex}));

        // the engine's own math, with no layout measured in a unit test: 10 visible rows, buffer 3
        body.availableRows = 10;

        at(0);
        expect(edges).toEqual([]);                      // the top of 50 rows is not the edge
        at(40);
        expect(edges).toEqual([{count: 50, endIndex: 50, startIndex: 40}]);
        at(41);
        expect(edges).toHaveLength(1);                  // parked at the edge: quiet
        at(10);
        at(40);
        expect(edges).toHaveLength(2);                  // left and returned: announced again
        at(47);
        expect(edges).toHaveLength(2);                  // still the same edge of the same count

        // the store grows: the viewport is no longer at the edge; reaching the new end announces it
        pane.snapshot = wiredSnapshot(
            Array.from({length: 20}, (v, i) => row({messageId: `MESSAGE:5${i}`, sentAt: `2026-07-16T09:${String(59 - i).padStart(2, '0')}:00.000Z`})),
            {limit: 50, offset: 50, count: 20, hasMore: false}
        );
        at(47);
        expect(edges).toHaveLength(2);                  // 57 + 3 < 70
        at(60);
        expect(edges).toHaveLength(3);
        expect(edges[2]).toEqual({count: 70, endIndex: 70, startIndex: 60});

        pane.destroy();

        // a store shorter than one window is at its edge from the first layout
        const
            shortEdges = [],
            shortPane  = createPane({snapshot: wiredSnapshot(
                Array.from({length: 5}, (v, i) => row({messageId: `MESSAGE:s${i}`, sentAt: `2026-07-16T10:0${i}:00.000Z`})),
                {limit: 50, offset: 0, count: 5, hasMore: true}
            )}),
            shortGrid  = shortPane.getReference('mailbox-rows');

        shortGrid.on('scrollEdge', ({count, endIndex, startIndex}) => shortEdges.push({count, endIndex, startIndex}));
        shortGrid.body.availableRows = 10;
        shortGrid.body.updateMountedAndVisibleRows();
        shortGrid.body.updateMountedAndVisibleRows();
        expect(shortEdges).toEqual([{count: 5, endIndex: 5, startIndex: 0}]);

        shortPane.destroy()
    });

    test('the head is a slot: a host reaches it by reference, and alone the pane puts only its title and freshness chip there', () => {
        const
            pane = createPane(),
            head = pane.getReference('mailbox-head');

        expect(head).toBeTruthy();
        expect(head.items.map(item => item.reference)).toEqual(['mailbox-title', 'mailbox-freshness']);

        pane.destroy()
    });

    test('presence is not permission: only GRANTED over WIRED with a real page window is a mail claim', () => {
        // The reviewer's literal falsifier. Four members PRESENT is not the producer saying anything:
        // a `wired` capability beside an `unavailable` admission is a read that never happened, and
        // its zero rows mean "we could not look" — rendering that as "No active messages for @x"
        // reports the outcome of a read nobody performed.
        const notAMailClaim = [
            // reviewer's exact shape — reached `empty` before this fix
            {capability: {state: 'wired'}, admission: {state: 'unavailable', subjectAgentId: '@neo-opus-vega'}, page: {}, rows: []},
            // ...and the same shape WITH rows reached `rows`
            {capability: {state: 'wired'}, admission: {state: 'unavailable', subjectAgentId: '@neo-opus-vega'}, page: {}, rows: [row({messageId: 'MESSAGE:ghost'})]},
            // an unknown admission state is not granted either — the closed set is the producer's
            {capability: {state: 'wired'}, admission: {state: 'pending', subjectAgentId: '@neo-opus-vega'}, page: {limit: 50, offset: 0, count: 0}, rows: []},
            // a not-wired capability cannot carry a mail claim, whatever admission says
            {capability: {state: 'not-wired'}, admission: {state: 'granted', subjectAgentId: '@neo-opus-vega'}, page: {limit: 50, offset: 0, count: 0}, rows: []},
            // a PRESENT but empty page is `NaN–NaN` bounds and NaN offsets — a window invented from
            // absent numbers, rendered as fact beside the rows
            {capability: {state: 'wired'}, admission: {state: 'granted', subjectAgentId: '@neo-opus-vega'}, page: {}, rows: []},
            {capability: {state: 'wired'}, admission: {state: 'granted', subjectAgentId: '@neo-opus-vega'}, page: {limit: 'many', offset: 0, count: 0}, rows: []}
        ];

        notAMailClaim.forEach(snapshot => {
            const pane = createPane({snapshot});

            expect(pane.getPaneState(), JSON.stringify(snapshot)).toBe('unobserved');
            expect(pane.getReference('mailbox-rows').hidden).toBe(true);

            pane.destroy()
        })
    });

    test('the freshness chip never claims currency it cannot place in time', () => {
        // Class audit, not a reported falsifier: every OTHER claim on this pane was fail-open at
        // least once today (empty from a torn envelope, empty from an unavailable admission), so the
        // chip is the last surface that renders a producer-derived assertion. It reads
        // `capability.capturedAt`; a snapshot whose timestamp is absent or unparseable must not
        // become "fresh" — that would be currency invented from a value nobody supplied.
        const unplaceable = [null, undefined, '', 'not-a-date', 12345, {}];

        unplaceable.forEach(capturedAt => {
            const pane = createPane({snapshot: {
                capability: {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', capturedAt, reason: null},
                admission : {state: 'granted', viewerIdentity: '@tobiu', subjectAgentId: '@neo-opus-vega', checkedAt: CAPTURED_AT, reason: null},
                page      : {limit: 50, offset: 0, count: 1},
                rows      : [row({messageId: 'MESSAGE:a'})]
            }});

            const chip = pane.getReference('mailbox-freshness');

            expect(chip.cls, `capturedAt=${JSON.stringify(capturedAt)} must not read as fresh`).not.toContain('is-fresh');
            expect(chip.text).toContain('not observed');
            // the ROWS still render — the producer authorized them; only the age claim is unknown
            expect(pane.getPaneState()).toBe('rows');

            pane.destroy()
        })
    });

    test('hostile subjects: the record layer strips markup before any row can render it', () => {
        // Layer 1 of the double defense (the record String convert strips tags — RecordFactory);
        // layer 2 (text-only vdom leaves) is pinned per-row in `rowComponent.spec.mjs`, where the
        // rendering now lives.
        const pane = createPane({
            snapshot: wiredSnapshot([
                row({messageId: 'MESSAGE:xss', subject: 'deploy <img src=x onerror=alert(1)> done'})
            ], {limit: 50, offset: 0, count: 1})
        });

        expect(pane.store.get('MESSAGE:xss').subject).toBe('deploy  done');

        pane.destroy()
    });

    test('collapse display state: persists across no-change polls, resets when rows change; store dies with the pane', () => {
        const threadRows = () => [
            row({messageId: 'MESSAGE:h', partOfThread: 'THREAD:z', sentAt: '2026-07-16T11:00:00.000Z'}),
            row({messageId: 'MESSAGE:i', partOfThread: 'THREAD:z', sentAt: '2026-07-16T10:00:00.000Z'})
        ];
        const pane = createPane({snapshot: wiredSnapshot(threadRows(), {limit: 50, offset: 0, count: 2})});

        pane.store.get('MESSAGE:h').threadCollapsed = false;

        // an identical-rows poll (only capture time advanced): the store's data config
        // equality-gates on the unchanged payload, so the operator's expansion PERSISTS —
        // a refresh with nothing new never yanks an open thread shut
        const samePoll = wiredSnapshot(threadRows(), {limit: 50, offset: 0, count: 2});
        samePoll.capability.capturedAt = '2026-07-16T12:01:00.000Z';
        pane.snapshot = samePoll;
        expect(pane.store.get('MESSAGE:h').threadCollapsed).toBe(false);

        // a CHANGED row set (a new message landed): wholesale replace → fresh records →
        // thread heads collapsed again (display state is row-set-scoped, explicitly seeded)
        pane.snapshot = wiredSnapshot([
            row({messageId: 'MESSAGE:j', partOfThread: 'THREAD:z', sentAt: '2026-07-16T11:30:00.000Z'}),
            ...threadRows()
        ], {limit: 50, offset: 0, count: 3});
        expect(pane.store.get('MESSAGE:j').threadCollapsed).toBe(true);
        // h is now a COLLAPSED MEMBER (j heads the thread) — hidden from the filtered view by
        // design, so the assertion reads the unfiltered source
        expect(pane.store.allItems.get('MESSAGE:h').threadCollapsed).toBe(true);

        const store = pane.store;
        pane.destroy();
        // Base.destroy wipes own properties past our explicit null — falsy is the contract
        expect(pane.store).toBeFalsy();
        expect(store.isDestroyed).toBe(true)
    });
});

test.describe('AgentOS.view.fleet.mailbox.Container — the open message (#551)', () => {
    const open = (pane, messageId) => pane.getReference('mailbox-rows').fire('select', {record: pane.store.get(messageId)});

    test('selecting a row opens its detail beside the list and asks for its body; deselecting closes it', () => {
        const pane = createPane(), asked = [];

        pane.on('messageOpen', data => asked.push(data.messageId));
        pane.snapshot = wiredSnapshot([row({messageId: 'MESSAGE:a'}), row({messageId: 'MESSAGE:b', status: 'read'})]);

        const
            detail   = pane.getReference('mailbox-detail'),
            splitter = pane.getReference('mailbox-splitter');

        expect(detail.hidden, 'nothing is open until a row is selected').toBe(true);
        expect(splitter.hidden, 'no split without a detail').toBe(true);
        expect(pane.getReference('mailbox-body').items, 'the list, the splitter, then the detail')
            .toEqual([pane.getReference('mailbox-rows'), splitter, detail]);

        open(pane, 'MESSAGE:a');
        expect(detail.hidden).toBe(false);
        expect(splitter.hidden, 'the splitter opens with the detail').toBe(false);
        expect(detail.row.messageId).toBe('MESSAGE:a');
        expect(detail.entry, 'a pane is read-only unless its host owns the inbox').toBe('observer');
        expect(detail.viewerIdentity).toBe('@tobiu');
        expect(asked, 'opening reads; it writes nothing').toEqual(['MESSAGE:a']);

        pane.getReference('mailbox-rows').fire('deselect', {record: pane.store.get('MESSAGE:a')});
        expect(detail.hidden).toBe(true);
        expect(splitter.hidden, 'and closes with it').toBe(true);

        pane.destroy()
    });

    test('a retracted row opens to its placeholder and asks for no body', () => {
        const pane = createPane(), asked = [];

        pane.on('messageOpen', data => asked.push(data.messageId));
        pane.snapshot = wiredSnapshot([row({messageId: 'MESSAGE:r', status: 'retracted'})]);
        open(pane, 'MESSAGE:r');

        expect(pane.getReference('mailbox-detail').hidden).toBe(false);
        expect(asked).toEqual([]);

        pane.destroy()
    });

    test('older pages and first-page refreshes rebind selection without reading or writing the message again', () => {
        const pane  = createPane(), asked = [], writes = [],
              grid  = pane.getReference('mailbox-rows'),
              model = grid.view.rowSelectionModel;

        pane.on('messageOpen', data => asked.push(data.messageId));
        ['markReadRequest', 'replyRequest', 'resolveRequest'].forEach(name => pane.on(name, () => writes.push(name)));
        pane.snapshot = wiredSnapshot([row({messageId: 'MESSAGE:a'})], {limit: 50, offset: 0, count: 1, hasMore: true});
        const original = pane.store.get('MESSAGE:a');

        model.selectRow(grid.view.getRecordId(original));
        open(pane, 'MESSAGE:a');
        for (const offset of [50, 0]) {
            const previous = pane.store.get('MESSAGE:a'),
                  rows = offset ? [row({messageId: 'MESSAGE:b'})] :
                      [row({messageId: 'MESSAGE:a', status: 'read'}), row({messageId: 'MESSAGE:b'})];

            pane.snapshot = wiredSnapshot(rows, {limit: 50, offset, count: rows.length, hasMore: false});

            expect(pane.store.get('MESSAGE:a')).not.toBe(previous);
            expect(model.selectedRows).toHaveLength(1);
            expect(pane.store.get(model.selectedRows[0])).toBe(pane.store.get('MESSAGE:a'));
            expect(pane.getReference('mailbox-detail').row.messageId).toBe('MESSAGE:a');
            expect(asked).toEqual(['MESSAGE:a']);
            expect(writes).toEqual([])
        }

        pane.destroy()
    });

    test('the open message follows a refresh: its new status reaches the detail, and a refresh that drops it closes the detail', () => {
        const pane = createPane(), detail = pane.getReference('mailbox-detail');

        pane.snapshot = wiredSnapshot([row({messageId: 'MESSAGE:a'}), row({messageId: 'MESSAGE:b'})]);
        open(pane, 'MESSAGE:a');

        pane.snapshot = wiredSnapshot([row({messageId: 'MESSAGE:a', status: 'read'}), row({messageId: 'MESSAGE:b'})]);
        expect(detail.row.status, 'the re-read row, not the click, says read').toBe('read');

        pane.snapshot = wiredSnapshot([row({messageId: 'MESSAGE:b'})]);
        expect(detail.hidden).toBe(true);
        expect(pane.selectedMessageId).toBe(null);

        pane.destroy()
    });

    test('the owner-written read and outcome reach the detail, and the host\'s entry decides the strip', () => {
        const pane = createPane({detailEntry: 'own'}), detail = pane.getReference('mailbox-detail');

        pane.snapshot = wiredSnapshot([row({messageId: 'MESSAGE:a'})]);
        open(pane, 'MESSAGE:a');
        pane.messageRead   = {messageId: 'MESSAGE:a', state: 'ok', message: {messageId: 'MESSAGE:a', body: 'the full body'}};
        pane.actionOutcome = {messageId: 'MESSAGE:a', action: 'markRead', state: 'pending'};

        expect(detail.entry).toBe('own');
        expect(detail.getReference('detail-body').text).toBe('the full body');
        expect(detail.getReference('detail-outcome').text).toBe('Mark read…');
        expect(detail.getReference('detail-strip').hidden).toBe(false);

        pane.destroy()
    });

    test('the detail\'s intents leave through the pane, stamped with the pane as their source', () => {
        const pane = createPane({detailEntry: 'own'}), fired = [];

        ['markReadRequest', 'replyRequest', 'resolveRequest'].forEach(name => pane.on(name, data => fired.push([name, data.messageId, data.source === pane.id])));
        pane.snapshot = wiredSnapshot([row({messageId: 'MESSAGE:a'})]);
        open(pane, 'MESSAGE:a');
        pane.messageRead = {messageId: 'MESSAGE:a', state: 'ok', message: {messageId: 'MESSAGE:a', body: 'b', task: {state: 'InputRequired', assignee: '@tobiu'}}};

        const detail = pane.getReference('mailbox-detail');

        detail.onMarkReadClick();
        detail.onReplyClick();
        detail.onResolveClick();

        expect(fired).toEqual([
            ['markReadRequest', 'MESSAGE:a', true],
            ['replyRequest',    'MESSAGE:a', true],
            ['resolveRequest',  'MESSAGE:a', true]
        ]);

        pane.destroy()
    });
});

test.describe('operator mailbox — cadence, held wire and the real projection', () => {
    let Controller;
    const fixtures = [];

    test.beforeAll(async () => {
        Controller = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default
    });

    const fixture = (bridge, snapshot = wiredSnapshot([row()])) => {
        const host = Neo.create(OperatorMailbox, {appName, now: NOW, record: {agentIdentityNodeId: '@neo-opus-vega', githubUsername: 'neo-opus-vega'}, snapshot}),
              pane = host.getReference('operator-inbox-pane'),
              controller = Object.assign(Neo.create(Controller, {component: {
                  isConstructed: false, on() {}, getOperatorMailboxPane: () => host, livenessReadTimeout: 30,
                  livenessCadence: LivenessCadence.DEFAULT_INTERVALS, maxReadsInFlight: 2
              }}), {
                  operatorRecord: host.record, operatorProfileId: bridge.profileId ?? null,
                  operatorSnapshot: host.snapshot, operatorInboxReadGeneration: 0,
                  livenessHidden: false, isDestroyed: false,
                  livenessSchedule: Object.fromEntries(Object.keys(LivenessCadence.READS).map(key => [key, key === 'operatorInbox' ? 0 : Infinity])),
                  ensureViewerWakeStream() {}, tickSystemLane() {}
              });

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge};
        fixtures.push({controller, host});
        return {controller, host, pane}
    };

    test.afterEach(() => {
        fixtures.splice(0).forEach(({controller, host}) => {
            controller.isDestroyed || controller.destroy();
            host.destroy()
        });
        delete globalThis.AgentOS.fleet
    });

    test('a due cadence read exposes new mail through the host and Store without a page gesture', async () => {
        const calls = [], opens = [];
        let answer = wiredSnapshot([
            row({messageId: 'MESSAGE:new', sentAt: '2026-07-16T11:30:00.000Z'}), row(),
            row({messageId: 'MESSAGE:h', partOfThread: 'THREAD:x'}),
            row({messageId: 'MESSAGE:r', partOfThread: 'THREAD:x', sentAt: '2026-07-16T10:00:00.000Z'})
        ]);
        const {controller, pane} = fixture({fleetMailboxMirror: async params => {calls.push(params); return answer}}),
              grid = pane.getReference('mailbox-rows'), selection = grid.view.rowSelectionModel;
        pane.on('messageOpen', data => opens.push(data.messageId));
        selection.onRowClick({record: pane.store.get('MESSAGE:base'), data: {path: []}});
        const selected = pane.selectedMessageId;
        expect(selected).toBe('MESSAGE:base');

        controller.onLivenessTick(NOW);
        await expect.poll(() => pane.store.get('MESSAGE:new')?.messageId).toBe('MESSAGE:new');
        expect(calls).toEqual([{subjectAgentId: '@neo-opus-vega', offset: 0}]);
        expect(pane.selectedMessageId).toBe(selected);
        expect(selection.selectedRows.map(id => selection.getRowRecord(id)?.messageId)).toEqual(['MESSAGE:base']);
        expect(opens, 'rebinding a fresh record does not open the message again').toEqual(['MESSAGE:base']);
        expect(pane.getReference('mailbox-detail').hidden).toBe(false);
        expect(pane.store.get('MESSAGE:h').threadFacts).toMatchObject({isHead: true, collapsed: true, hiddenCount: 1});
        expect(pane.store.allItems.get('MESSAGE:r').threadFacts).toMatchObject({isHead: false, collapsed: true});
        expect(new Set(pane.store.allItems.items.map(record => record.messageId)).size).toBe(4);

        answer = wiredSnapshot([row({messageId: 'MESSAGE:new'})]);
        controller.onLivenessTick(NOW + 60000);
        await expect.poll(() => pane.selectedMessageId).toBe(null);
        expect(selection.selectedRows).toEqual([]);
        expect(pane.getReference('mailbox-detail').hidden).toBe(true);
        expect(opens).toEqual(['MESSAGE:base'])
    });

    test('every host config hook sees the complete successful read outcome', async () => {
        const publishedAt = NOW + 1000,
              answer = wiredSnapshot([row({messageId: 'MESSAGE:coherent'})]),
              {controller, host, pane} = fixture({fleetMailboxMirror: async () => answer}),
              samples = [], originalNow = Date.now;
        answer.capability.capturedAt = new Date(publishedAt).toISOString();
        host.readFailed = true;

        ['afterSetNow', 'afterSetReadFailed', 'afterSetSnapshot'].forEach(hook => {
            const original = host[hook];
            host[hook] = function(...args) {
                samples.push({hook, now: this.now, readFailed: this.readFailed,
                    capturedAt: this.snapshot?.capability?.capturedAt,
                    messageId: this.snapshot?.rows[0]?.messageId});
                return original.apply(this, args)
            }
        });

        Date.now = () => publishedAt;
        try {
            await controller.loadOperatorInbox();
            expect(samples.map(sample => sample.hook).sort()).toEqual(['afterSetNow', 'afterSetReadFailed', 'afterSetSnapshot']);
            samples.forEach(sample => expect(sample).toMatchObject({now: publishedAt, readFailed: false,
                capturedAt: answer.capability.capturedAt, messageId: 'MESSAGE:coherent'}));
            expect(pane.store.get('MESSAGE:coherent')).toBeTruthy()
        } finally {
            Date.now = originalNow
        }
    });

    test('timeout retains one actual wire while clock ticks age rows, then a later read recovers', async () => {
        let release, calls = 0;
        const recovered = wiredSnapshot([row({messageId: 'MESSAGE:recovered'})]),
              {controller, host, pane} = fixture({fleetMailboxMirror: () => {
                  calls++;
                  return calls === 1 ? new Promise(resolve => {release = resolve}) : Promise.resolve(recovered)
              }}), prior = pane.snapshot;
        await controller.refreshOperatorInbox();
        expect(host.readFailed).toBe(true);
        expect(pane.getReference('mailbox-freshness').cls).toContain('is-stale');
        [NOW + 60000, NOW + 120000, NOW + 180000].forEach(now => controller.onLivenessTick(now));
        expect(calls).toBe(1);
        expect(controller.operatorInboxReadInFlight).toBe(1);
        expect(pane.now).toBe(NOW + 180000);
        release(wiredSnapshot([row({messageId: 'MESSAGE:late'})]));
        await expect.poll(() => controller.operatorInboxReadInFlight).toBe(0);
        expect(pane.snapshot).toBe(prior);
        await controller.refreshOperatorInbox();
        expect(calls).toBe(2);
        expect(host.readFailed).toBe(false);
        expect(pane.store.get('MESSAGE:recovered')).toBeTruthy()
    });

    test('automatic refresh defers for a pending page, an older window or a scrolled grid', async () => {
        let calls = 0;
        const {controller, pane} = fixture({fleetMailboxMirror: async () => {calls++; return wiredSnapshot([row()])}}),
              prior = pane.snapshot, grid = pane.getReference('mailbox-rows');
        pane.pendingOffset = 50;
        await controller.refreshOperatorInbox();
        pane.pendingOffset = null;
        pane.snapshot = wiredSnapshot([row()], {limit: 50, offset: 50, count: 1});
        await controller.refreshOperatorInbox();
        pane.snapshot = prior;
        grid.body.scrollTop = 100;
        await controller.refreshOperatorInbox();
        expect(calls).toBe(0);
        await controller.loadOperatorInbox({offset: 0});
        expect(calls, 'an explicit first-page intent remains available').toBe(1)
    });

    test('scrolling during the wire defers its answer and preserves the displayed observation', async () => {
        let release;
        const {controller, pane} = fixture({fleetMailboxMirror: () => new Promise(resolve => {release = resolve})}),
              prior = pane.snapshot, priorOwner = controller.operatorSnapshot, read = controller.refreshOperatorInbox();
        await Promise.resolve();
        pane.getReference('mailbox-rows').body.scrollTop = 100;
        release(wiredSnapshot([row({messageId: 'MESSAGE:new'})]));
        await read;
        expect(pane.snapshot).toBe(prior);
        expect(controller.operatorSnapshot).toBe(priorOwner);
        expect(pane.store.get('MESSAGE:new')).toBeFalsy()
    });

    test('a recent transport failure retains rows with stale presentation; recovery clears it', async () => {
        let fail = true;
        const recent = wiredSnapshot([row()]);
        recent.capability.capturedAt = new Date().toISOString();
        const {controller, pane} = fixture({fleetMailboxMirror: async () => {
            if (fail) throw new Error('transport unavailable');
            return {...recent, capability: {...recent.capability, capturedAt: new Date().toISOString()}}
        }}, recent), prior = pane.snapshot;
        await controller.refreshOperatorInbox();
        expect(pane.store.getCount()).toBe(1);
        expect(pane.snapshot).toBe(prior);
        expect(pane.getReference('mailbox-freshness').cls).toContain('is-stale');
        fail = false;
        await controller.refreshOperatorInbox();
        expect(pane.getReference('mailbox-freshness').cls).toContain('is-fresh')
    });

    test('a revoked admission clears retained rows even after scrolling during the read', async () => {
        let release;
        const {controller, pane} = fixture({fleetMailboxMirror: () => new Promise(resolve => {release = resolve})}),
              read = controller.refreshOperatorInbox();
        await Promise.resolve();
        pane.getReference('mailbox-rows').body.scrollTop = 100;
        release({capability: {state: 'degraded'}, admission: {state: 'denied', subjectAgentId: '@neo-opus-vega'}, rows: [], page: {offset: 0}});
        await read;
        expect(pane.getPaneState()).toBe('denied');
        expect(pane.store.getCount()).toBe(0)
    });

    test('explicit requests coalesce behind one wire and only the latest page intent executes', async () => {
        let release;
        const calls = [], {controller, pane} = fixture({fleetMailboxMirror: params => {
            calls.push(params.offset);
            return calls.length === 1 ? new Promise(resolve => {release = resolve}) : Promise.resolve(wiredSnapshot([row()]))
        }}), read = controller.loadOperatorInbox();
        await Promise.resolve();
        const older = controller.loadOperatorInbox({offset: 50}), latest = controller.loadOperatorInbox({offset: 100});
        expect(calls).toEqual([0]);
        release(wiredSnapshot([row({messageId: 'MESSAGE:superseded'})]));
        await Promise.all([read, older, latest]);
        expect(calls).toEqual([0, 100]);
        expect(pane.store.get('MESSAGE:superseded')).toBeFalsy();
        expect(controller.operatorInboxReadInFlight).toBe(0)
    });

    test('a destroyed reader drops queued work and late answers without touching retained data', async () => {
        let release, calls = 0;
        const {controller, pane} = fixture({fleetMailboxMirror: () => {
            calls++;
            return new Promise(resolve => {release = resolve})
        }}), prior = pane.snapshot, read = controller.loadOperatorInbox();
        await Promise.resolve();
        const queued = controller.loadOperatorInbox({offset: 50});
        controller.destroy();
        release(wiredSnapshot([row({messageId: 'MESSAGE:late'})]));
        await Promise.all([read, queued]);
        controller.onLivenessTick(NOW + 120000);
        expect(calls).toBe(1);
        expect(pane.snapshot).toBe(prior)
    });

    test('a late rejection after real controller destruction retires quietly', async () => {
        let reject;
        const {controller, pane} = fixture({fleetMailboxMirror: () => new Promise((resolve, fail) => {reject = fail})}),
              prior = pane.snapshot, read = controller.loadOperatorInbox();
        await Promise.resolve();
        controller.destroy();
        expect(controller.component).toBeFalsy();
        reject(new Error('late transport failure'));
        await expect(read).resolves.toBeUndefined();
        expect(pane.snapshot).toBe(prior)
    });
});
