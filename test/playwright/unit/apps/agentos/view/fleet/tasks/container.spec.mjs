import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'TasksPaneTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import TasksPane      from '../../../../../../../../apps/agentos/view/fleet/tasks/Container.mjs';

/**
 * @summary Build one envelope in the exact `fleetTasks` contract shape.
 * @param {Object} [overrides]
 * @returns {Object}
 */
function envelope(overrides = {}) {
    return {
        capability: {state: 'wired', capturedAt: '2026-08-22T12:30:00.000Z'},
        viewer    : '@e2e-operator',
        sources   : {
            deployment: {state: 'wired', reason: null, observedAt: '2026-08-22T12:29:30.000Z'},
            rem       : {state: 'wired', reason: null},
            ingestion : {state: 'unwired', reason: 'ingestion-verb-unreachable-from-this-process', scope: null}
        },
        running: [
            {id: 'kb:ingestion:run', section: 'running', name: 'KB ingestion', source: 'kb', state: 'embedding', at: '2026-08-22T12:25:00.000Z', progress: {kind: 'determinate', done: 100, total: 400}, detail: 'this-process-only'}
        ],
        queued: [
            {id: 'orchestrator:tenant-sync:cbff435fe549', section: 'queued', name: 'Repo sync · cbff435f', source: 'orchestrator', state: 'due', at: '2026-08-22T12:34:23.859Z', progress: null, detail: 'rev d8ae9ff'},
            {id: 'mc:rem:digest', section: 'queued', name: 'REM digest', source: 'mc', state: 'backlog', at: null, progress: {kind: 'backlog', done: 1040, total: 2000}, detail: '960 undigested · 1040 digested'}
        ],
        recent: [
            {id: 'orchestrator:tenant-sync:last', section: 'recent', name: 'Tenant repo sync', source: 'orchestrator', state: 'completed', at: '2026-08-22T12:11:42.269Z', progress: null, detail: '0 synced · 3 not due · 0 failed'}
        ],
        counts: {running: 1, queued: 2, recent: 1},
        ...overrides
    }
}

/**
 * @summary Create the pane with captured `tasksRequest` intents.
 * @param {Object} [config]
 * @returns {{pane: Object, requests: Object[]}}
 */
function createPane(config = {}) {
    const requests = [],
          pane     = Neo.create(TasksPane, {
              listeners: {tasksRequest: data => {
                  const {source, ...params} = data;
                  requests.push(params)
              }},
              ...config
          });

    return {pane, requests}
}

// The list renders the projection Store into a flat vdom of section-header, task and empty-line
// items — the render truth lives in the list's vdom nodes, the projection truth in the
// Store records. Both are asserted.
const
    nodesOf   = pane => pane.getReference('tasks-list').getVdomRoot().cn.filter(Boolean),
    headersOf = pane => nodesOf(pane).filter(node => node.cls?.includes('fm-tasks-section-head')),
    labelOf   = header => header.cn[0],
    // the pill is the head's LAST cell — the counts and a hoisted source chip may sit before it
    pillOf    = header => header.cn.at(-1),
    countOf   = header => header.cn.find(cell => cell.cls?.includes('fm-tasks-section-count')),
    chipOf    = header => header.cn.find(cell => cell.cls?.some(cls => cls.startsWith('is-source-'))),
    metaIn    = (pane, section) => nodesOf(pane).find(node => node.cls?.includes('fm-tasks-section-meta') && node.cls?.includes(`is-${section}`))?.cn[0],
    rowsIn    = (pane, section) => nodesOf(pane).filter(node => node.cls?.includes('fm-task-row') && node.cls?.includes(`is-${section}`)),
    emptyIn   = (pane, section) => nodesOf(pane).find(node => node.cls?.includes('fm-tasks-empty-row') && node.cls?.includes(`is-${section}`))?.cn[0],
    cellsOf   = row => row.cn,
    cellOf    = (row, cls) => row.cn.find(cell => cell.cls?.includes(cls)),
    taskCount = pane => pane.taskStore.items.filter(record => record.rowKind === 'task' && !record.sample).length;

/**
 * @summary The live plane read at 2026-09-05T12:49:36Z as the `fleetTasks` producer emits it
 * since its starvation reducer landed: three starved waiters behind the `summary` lease, the backup lane exhausted,
 * a queued repo and the REM backlog beside them — with two rows carrying reason codes so the
 * cause vocabulary renders (the running plane's writer sends none; the newer one does).
 * @param {Object} [overrides]
 * @returns {Object}
 */
function starvedEnvelope(overrides = {}) {
    const checkedAt = '2026-09-05T12:49:36.362Z';

    return envelope({
        capability: {state: 'wired', capturedAt: '2026-09-05T12:50:00.000Z'},
        sources   : {
            deployment: {state: 'wired', reason: null, observedAt: '2026-09-05T12:47:55.668Z'},
            rem       : {state: 'wired', reason: null},
            ingestion : {state: 'unwired', reason: 'ingestion-verb-unreachable-from-this-process', scope: null}
        },
        scheduler: {leaseHolder: 'summary', leaseStatus: null, checkedAt, degradeAfterMs: 3600000, posture: 'degraded', starvedTotal: 3, unreadableCount: 0},
        running  : [],
        queued   : [
            {id: 'orchestrator:starvation:message-concept-harvest', section: 'queued', name: 'message-concept-harvest', source: 'orchestrator', state: 'starved', at: '2026-09-05T06:13:43.059Z', progress: null, detail: null, waitMs: 23753303, thresholdMs: 3600000, checkedAt, reasonCode: null, blockingTaskName: null, leaseOwner: null, priorityZero: false, bootstrapCritical: false},
            {id: 'orchestrator:starvation:dream',                   section: 'queued', name: 'dream',                   source: 'orchestrator', state: 'starved', at: '2026-09-05T10:05:51.967Z', progress: null, detail: 'heavy-maintenance-lease-held · lease owner summary · priority zero', waitMs: 9824395, thresholdMs: 3600000, checkedAt, reasonCode: 'heavy-maintenance-lease-held', blockingTaskName: null, leaseOwner: 'summary', priorityZero: true, bootstrapCritical: false},
            {id: 'orchestrator:starvation:kbSync',                  section: 'queued', name: 'kbSync',                  source: 'orchestrator', state: 'starved', at: '2026-09-05T11:29:12.439Z', progress: null, detail: 'heavy-maintenance-yield-to-waiter · behind dream', waitMs: 4823923, thresholdMs: 3600000, checkedAt, reasonCode: 'heavy-maintenance-yield-to-waiter', blockingTaskName: 'dream', leaseOwner: null, priorityZero: false, bootstrapCritical: false},
            {id: 'orchestrator:tenant-sync:cbff435fe549', section: 'queued', name: 'Repo sync · cbff435f', source: 'orchestrator', state: 'scheduled', at: '2026-09-05T13:10:00.000Z', progress: null, detail: null},
            {id: 'orchestrator:maintenance:backup',       section: 'queued', name: 'Backup lane',          source: 'orchestrator', state: 'exhausted', at: new Date(1788626336430).toISOString(), progress: null, detail: 'off host durability unmet · backup retry exhausted · backup never succeeded · 0 retries remaining'},
            {id: 'mc:rem:digest', section: 'queued', name: 'REM digest', source: 'mc', state: 'backlog', at: null, progress: {kind: 'backlog', done: 1040, total: 2000}, detail: '960 undigested · 1040 digested'}
        ],
        recent: [],
        counts: {running: 0, queued: 6, recent: 0, queuedKnown: 6},
        ...overrides
    })
}

test.describe('AgentOS tasks surface — the WHAT view as a store-driven list', () => {

    test('the list keeps the flat ul/li contract — the base dl/dt/dd switch is not applied', () => {
        const {pane} = createPane(),
              list   = pane.getReference('tasks-list');

        expect(list.vdom.tag, 'the root stays ul').toBe('ul');
        expect(list.itemTagName, 'the base useHeaders hook must not flip li to dd').toBe('li');

        const nodes = nodesOf(pane);

        expect(nodes.length).toBeGreaterThan(0);
        nodes.forEach(node => expect(node.tag, `${node.id} must be an li`).toBe('li'));

        pane.destroy()
    });

    test('the cold spine renders sample-labeled rows per section — shape, never a claim; the sample pill sits once on the head, and the queue teaches its starved shape', () => {
        const {pane}  = createPane(),
              headers = headersOf(pane);

        expect(pane.getReference('tasks-meta').text).toContain('not observed yet');
        expect(headers).toHaveLength(3);
        expect(headers.map(header => labelOf(header).text)).toEqual(['Running', 'Queued · next', 'Recent']);

        for (const header of headers) {
            expect(pillOf(header).text).toBe('sample');
            expect(pillOf(header).cls).toContain('is-sample');
            expect(chipOf(header), 'the sample pill IS the section\'s provenance — no second chip').toBeUndefined()
        }

        // provenance once per homogeneous section: the sample word sits on the head, never repeated per row
        for (const [section, count] of [['running', 1], ['queued', 2], ['recent', 1]]) {
            const rows = rowsIn(pane, section);

            expect(rows, section).toHaveLength(count);
            rows.forEach(row => expect(cellOf(row, 'is-sample'), 'no row repeats the sample pill').toBeUndefined())
        }

        // the running sample carries the determinate idiom: a native progress element PLUS the text
        const progress = cellsOf(rowsIn(pane, 'running')[0]).find(cell => cell.cls?.includes('fm-task-progress'));

        expect(progress.cn[0]).toMatchObject({tag: 'progress', value: 42, max: 100});
        expect(progress.cn[1].text).toBe('42%');

        // the queue's starved sample: the wait as text with its bound, the cause from its own code
        const starved = rowsIn(pane, 'queued')[1];

        expect(cellOf(starved, 'fm-task-state').text).toBe('starved');
        expect(cellOf(starved, 'fm-task-state').cls).toContain('is-starved');
        expect(cellOf(starved, 'fm-task-wait').cn[0].text).toBe('waiting 11 h 45 min');
        expect(cellOf(starved, 'fm-task-wait').cn[1].text).toBe('threshold 1 h');
        expect(cellOf(starved, 'fm-task-cause').html).toBe('lease held by <b>summary</b>');

        // the lease line is part of the shape too — labeled sample by the head above it
        expect(metaIn(pane, 'queued').html).toContain('maintenance lease · <b>summary</b> · active · posture <span class="is-degraded">degraded</span>');

        // the Store is the full render projection now — sample rows enter LABELED (`sample: true`,
        // the pill word), never as deployment claims: zero unlabeled task records on the cold spine
        expect(taskCount(pane), 'no record claims to be the deployment').toBe(0);
        expect(pane.taskStore.items.filter(record => record.sample && record.rowKind === 'task')).toHaveLength(4);

        pane.destroy()
    });

    test('a transport-level fallback (no bridge, unwired verb, thrown read) is the cold spine — the labeled sample stays, the reason is named', () => {
        const {pane} = createPane({snapshot: {capability: {state: 'unavailable', reason: 'fleet tasks verb not wired'}, viewer: null, sources: {}, running: [], queued: [], recent: [], counts: {running: 0, queued: 0, recent: 0}}});

        const meta = pane.getReference('tasks-meta');

        expect(meta.text).toContain('fleet tasks verb not wired');
        expect(meta.text).toContain('show the shape, not the deployment');
        expect(meta.vdom.title, 'no stamp hovers behind an unavailable read').toBeFalsy();

        for (const header of headersOf(pane)) {
            expect(pillOf(header).text).toBe('sample')
        }

        for (const [section, count] of [['running', 1], ['queued', 2], ['recent', 1]]) {
            expect(rowsIn(pane, section)).toHaveLength(count);
            rowsIn(pane, section).forEach(row => expect(cellOf(row, 'is-sample')).toBeUndefined())
        }

        expect(taskCount(pane)).toBe(0);

        pane.destroy()
    });

    test('a source-level unavailable read (the source answered, every axis failed) renders the honest empty lines under the reason', () => {
        const {pane} = createPane({snapshot: {
            capability: {state: 'unavailable', reason: 'no-task-source-answered', capturedAt: '2026-08-22T12:30:00.000Z'},
            viewer    : '@e2e-operator',
            sources   : {deployment: {state: 'unavailable', reason: 'deployment-read-failed'}, rem: {state: 'unavailable', reason: 'rem-read-failed'}, ingestion: {state: 'unwired'}},
            running   : [], queued: [], recent: [], counts: {running: 0, queued: 0, recent: 0}
        }});

        expect(pane.getReference('tasks-meta').text).toBe('Tasks unavailable · no-task-source-answered');

        for (const header of headersOf(pane)) {
            expect(pillOf(header).text).toBe('unavailable')
        }

        for (const section of ['running', 'queued', 'recent']) {
            expect(rowsIn(pane, section)).toHaveLength(0);
            expect(emptyIn(pane, section).text).toContain('did not answer')
        }

        pane.destroy()
    });

    test('a wired envelope projects into the Store and renders the one row grammar per section', () => {
        const {pane} = createPane({snapshot: envelope()}),
              meta   = pane.getReference('tasks-meta');

        expect(taskCount(pane)).toBe(4);
        expect(meta.text).toContain('captured');
        expect(meta.text).toContain('orchestrator live · memory core live · knowledge base not reachable');
        expect(meta.vdom.title, 'T5: the exact wire instant rides the title').toContain('2026-08-22T12:30:00.000Z');

        for (const header of headersOf(pane)) {
            expect(pillOf(header).text).toBe('live')
        }

        // an older Brain reports no totals: each head counts what it can see — shown only, no lease line
        const [runningHead, queuedHead, recentHead] = headersOf(pane);

        expect(countOf(runningHead).html).toBe('<b>1</b> shown');
        expect(countOf(queuedHead).html).toBe('<b>2</b> shown');
        expect(metaIn(pane, 'queued'), 'no scheduler summary → no lease line').toBeUndefined();

        // running: time · name · state word · determinate bar + percent — the one source rides the head
        const run = cellsOf(rowsIn(pane, 'running')[0]);

        expect(run[1].text).toBe('KB ingestion');
        expect(run[1].title, 'the detail rides the name\'s title').toBe('this-process-only');
        expect(run[2].text).toBe('embedding');
        expect(run[3].cn[0]).toMatchObject({tag: 'progress', value: 100, max: 400});
        expect(run[3].cn[1].text).toBe('25%');
        expect(run[4], 'a homogeneous section hoists its provenance to the head').toBeUndefined();
        expect(chipOf(runningHead).text).toBe('knowledge base');
        expect(chipOf(runningHead).cls).toContain('is-source-kb');
        expect(chipOf(recentHead).text).toBe('orchestrator');
        expect(chipOf(queuedHead), 'a mixed section keeps its chips on the rows').toBeUndefined();

        // queued: the due repo (no bar) and the backlog gauge under its own word — a MIXED section, chips on the rows
        const [due, backlog] = rowsIn(pane, 'queued').map(cellsOf);

        expect(due[1].text).toBe('Repo sync · cbff435f');
        expect(due[2].text).toBe('due');
        expect(due.find(cell => cell.cls?.includes('fm-task-progress'))).toBeUndefined();
        expect(due.at(-1).text).toBe('orchestrator');

        expect(backlog[0].text, 'no instant → the honest dash').toBe('—');
        expect(backlog[2].text).toBe('backlog');
        expect(backlog[3].cls).toContain('is-backlog');
        expect(backlog[3].cn[0]).toMatchObject({tag: 'progress', value: 1040, max: 2000});
        expect(backlog[3].cn[1].text).toBe('1040 / 2000');
        expect(backlog.at(-1).text).toBe('memory core');

        // recent
        const done = cellsOf(rowsIn(pane, 'recent')[0]);

        expect(done[1].text).toBe('Tenant repo sync');
        expect(done[2].text).toBe('completed');

        pane.destroy()
    });

    test('a partial envelope is readable as exactly that — the failed axis in words, its rows absent', () => {
        const snapshot = envelope({
            capability: {state: 'partial', capturedAt: '2026-08-22T12:30:00.000Z'},
            sources   : {deployment: {state: 'wired', reason: null}, rem: {state: 'unavailable', reason: 'rem-read-failed'}, ingestion: {state: 'unwired'}},
            queued    : [{id: 'orchestrator:tenant-sync:cbff435fe549', section: 'queued', name: 'Repo sync · cbff435f', source: 'orchestrator', state: 'due', at: '2026-08-22T12:34:23.859Z', progress: null, detail: null}]
        });

        const {pane} = createPane({snapshot});

        expect(pane.getReference('tasks-meta').text).toContain('memory core unavailable');
        expect(rowsIn(pane, 'queued')).toHaveLength(1);

        pane.destroy()
    });

    test('a wired section with no rows says so in words, and a fresh snapshot REPLACES rows — never accumulates', () => {
        const {pane} = createPane({snapshot: envelope()});

        expect(taskCount(pane)).toBe(4);

        pane.snapshot = envelope({
            running: [],
            queued : [],
            recent : [{id: 'orchestrator:tenant-sync:last', section: 'recent', name: 'Tenant repo sync', source: 'orchestrator', state: 'completed', at: '2026-08-22T12:41:00.000Z', progress: null, detail: null}],
            counts : {running: 0, queued: 0, recent: 1}
        });

        expect(taskCount(pane)).toBe(1);
        expect(rowsIn(pane, 'running')).toHaveLength(0);
        expect(emptyIn(pane, 'running').text).toBe('Nothing in flight.');
        expect(emptyIn(pane, 'queued').text).toBe('Nothing scheduled.');
        expect(rowsIn(pane, 'recent')).toHaveLength(1);

        pane.destroy()
    });

    test('the heavy-maintenance queue: one row per starved waiter with its wait as text and its own cause, the lease line under the head, counts starved · known · shown', () => {
        const {pane} = createPane({snapshot: starvedEnvelope()}),
              head   = headersOf(pane)[1];

        expect(countOf(head).html).toBe('<b>3</b> starved · <b>6</b> known · <b>6</b> shown');
        expect(pillOf(head).text).toBe('live');

        const lease = metaIn(pane, 'queued').html;

        expect(lease).toContain('maintenance lease · <b>summary</b> · posture <span class="is-degraded">degraded</span> · checked <b>');
        expect(lease).toContain('· threshold 1 h');
        expect(lease, 'no acquisition time exists in the receipt, so no "since"').not.toContain('since');

        const [harvest, dream, kbSync, repo, backup, digest] = rowsIn(pane, 'queued');

        // the row's own cause: absent on the plane whose writer sends no code — said, never borrowed from the lease holder
        expect(cellOf(harvest, 'fm-task-state').text).toBe('starved');
        expect(cellOf(harvest, 'fm-task-state').cls).toContain('is-starved');
        expect(cellOf(harvest, 'fm-task-wait').cn[0].text).toBe('waiting 6 h 35 min');
        expect(cellOf(harvest, 'fm-task-wait').cn[1].text).toBe('threshold 1 h');
        expect(cellOf(harvest, 'fm-task-cause').html).toBe('cause unknown');
        expect(cellOf(harvest, 'fm-task-cause').cls).toContain('absent');
        expect(cellOf(harvest, 'fm-task-progress'), 'a wait is never a bar').toBeUndefined();

        // a lease hold names its owner; the priority flag rides as a pill; the raw code rides the title
        expect(cellOf(dream, 'fm-task-wait').cn[0].text).toBe('waiting 2 h 43 min');
        expect(cellOf(dream, 'fm-task-cause').html).toBe('lease held by <b>summary</b>');
        expect(cellOf(dream, 'fm-task-cause').title).toBe('heavy-maintenance-lease-held · leaseOwner: summary');
        expect(cellsOf(dream).find(cell => cell.cls?.includes('is-flag')).text).toBe('priority zero');

        // a yield names the task it yielded to
        expect(cellOf(kbSync, 'fm-task-wait').cn[0].text).toBe('waiting 1 h 20 min');
        expect(cellOf(kbSync, 'fm-task-cause').html).toBe('yielded to <b>dream</b>');

        // the backup lane and the repo carry no wait and no cause; the mixed section keeps its chips
        expect(cellOf(backup, 'fm-task-state').text).toBe('exhausted');
        expect(cellOf(backup, 'fm-task-wait')).toBeUndefined();
        expect(cellOf(backup, 'fm-task-cause')).toBeUndefined();
        expect(cellOf(backup, 'fm-task-name').title).toContain('backup never succeeded');
        expect(cellsOf(repo).at(-1).text).toBe('orchestrator');
        expect(cellsOf(digest).at(-1).text).toBe('memory core');

        pane.destroy()
    });

    test('control (a): a fresh envelope with the same watchdog stamp changes nothing on screen; a new stamp with grown waits marks exactly the rows that moved', () => {
        // the projection replaces the Store wholesale, so the list's internal record ids move on
        // every envelope; what is rendered must not — compare the nodes with those ids normalized
        const rendered = pane => nodesOf(pane).map(node => JSON.stringify(node).replace(/neo-record-\d+/g, 'neo-record'));

        const {pane} = createPane({snapshot: starvedEnvelope()}),
              before = rendered(pane);

        pane.snapshot = starvedEnvelope({capability: {state: 'wired', capturedAt: '2026-09-05T12:51:00.000Z'}});

        expect(rendered(pane), 'byte-identical rows and lease line').toEqual(before);
        expect(pane.taskStore.items.some(record => record.changed)).toBe(false);

        const later = starvedEnvelope({capability: {state: 'wired', capturedAt: '2026-09-05T12:52:00.000Z'}});

        later.scheduler.checkedAt = '2026-09-05T12:51:36.362Z';
        later.queued.forEach(row => { if (row.state === 'starved') { row.waitMs += 120_000; row.checkedAt = later.scheduler.checkedAt } });
        pane.snapshot = later;

        const changed = pane.taskStore.items.filter(record => record.changed).map(record => record.id);

        expect(changed).toEqual(['orchestrator:starvation:message-concept-harvest', 'orchestrator:starvation:dream', 'orchestrator:starvation:kbSync']);
        expect(rowsIn(pane, 'queued')[0].cls).toContain('is-changed');
        expect(rowsIn(pane, 'queued')[4].cls, 'the backup lane did not move').not.toContain('is-changed');
        expect(cellOf(rowsIn(pane, 'queued')[0], 'fm-task-wait').cn[0].text).toBe('waiting 6 h 37 min');

        pane.destroy()
    });

    test('control (b): no active holder keeps the readable breaches and says so; an unknown posture with unreadable entries says exactly that — never "no waiting work"', () => {
        const holderless = starvedEnvelope();

        holderless.scheduler.leaseHolder = null;

        const {pane} = createPane({snapshot: holderless});

        expect(metaIn(pane, 'queued').html).toContain('maintenance lease · no active holder · posture <span class="is-degraded">degraded</span>');
        expect(rowsIn(pane, 'queued').filter(row => cellOf(row, 'fm-task-state').text === 'starved')).toHaveLength(3);

        pane.snapshot = starvedEnvelope({
            scheduler: {leaseHolder: null, leaseStatus: null, checkedAt: '2026-09-05T12:49:36.362Z', degradeAfterMs: 3600000, posture: 'unknown', starvedTotal: 0, unreadableCount: 2},
            queued   : starvedEnvelope().queued.filter(row => row.state !== 'starved'),
            counts   : {running: 0, queued: 3, recent: 0, queuedKnown: 3}
        });

        expect(countOf(headersOf(pane)[1]).html).toBe('<b>0</b> starved · <b>3</b> known · <b>3</b> shown');
        expect(metaIn(pane, 'queued').html).toContain('posture <span class="is-unknown">unknown</span> · <b>2</b> entries unreadable');
        expect(rowsIn(pane, 'queued').filter(row => cellOf(row, 'fm-task-state').text === 'starved')).toHaveLength(0);
        expect(emptyIn(pane, 'queued'), 'three rows remain — the queue is not empty').toBeUndefined();

        pane.destroy()
    });

    test('the refresh affordance fires the read INTENT through the controller — the surface never touches a bridge', () => {
        const {pane, requests} = createPane({snapshot: envelope()});

        pane.getController().onRefreshClick({});

        expect(requests).toEqual([{}]);

        pane.destroy()
    });

    test('destroy releases the pane-local Store through exactly ONE owner', () => {
        const {pane} = createPane(),
              store  = pane.taskStore,
              orig   = store.destroy.bind(store);

        let destroys = 0;

        store.destroy = (...args) => {
            destroys++;
            return orig(...args)
        };

        pane.destroy();

        // the Container is the single destruction owner: the list carries autoDestroyStore: false,
        // so an injected store is never double-destroyed — one invocation, terminally destroyed,
        // gone from the pane (core destroy releases the instance's own keys)
        expect(destroys).toBe(1);
        expect(pane.taskStore).toBeFalsy();
        expect(store.isDestroyed).toBe(true)
    })
});
