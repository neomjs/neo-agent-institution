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

    test('the drain: row 51+ stays reachable — hasMore requests the next window, appends it, and stops at the honest end', () => {
        const
            fired    = [],
            firstWin = Array.from({length: 50}, (v, i) => row({
                messageId: `MESSAGE:${i}`, subject: `subject ${i}`,
                sentAt   : `2026-07-16T10:${String(59 - (i % 60)).padStart(2, '0')}:00.000Z`
            })),
            pane = createPane({
                snapshot : wiredSnapshot(firstWin, {limit: 50, offset: 0, count: 50, hasMore: true}),
                listeners: {pageRequest: data => fired.push(data.offset)}
            });

        // the construction-time snapshot already carried hasMore — exactly ONE drain request for
        // the next window, no chrome involved
        expect(fired).toEqual([50]);
        expect(pane.store.getCount()).toBe(50);

        // a freshness re-render must NOT re-request (the drain arms per SNAPSHOT, not per render)
        pane.now = NOW + 1000;
        expect(fired).toEqual([50]);

        // the follow-up window APPENDS — row 51+ is now genuinely present, not stranded
        pane.snapshot = wiredSnapshot(
            Array.from({length: 10}, (v, i) => row({messageId: `MESSAGE:5${i}`, subject: `late ${i}`, sentAt: `2026-07-16T09:0${i % 10}:00.000Z`})),
            {limit: 50, offset: 50, count: 10, hasMore: false}
        );

        expect(pane.store.getCount()).toBe(60);
        expect(pane.store.allItems.get('MESSAGE:55')).toBeTruthy();

        // hasMore: false is the honest end — no further request fired
        expect(fired).toEqual([50]);

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
