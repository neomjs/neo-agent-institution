import BaseContainer                                  from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import Button                                         from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import FleetTasks                                     from '../../../store/FleetTasks.mjs';
import TasksController                                from './Controller.mjs';
import TasksList, {SOURCE_LABELS, SOURCE_STATE_WORDS} from './List.mjs';
import ViewerTime                                     from '../../../util/ViewerTime.mjs';

/**
 * @summary The three sections, in the order the operator asks: what is in flight, what comes
 * next, what just finished. Each carries the honest empty line it renders when a wired read
 * answered nothing for it.
 * @type {Object[]}
 */
const SECTIONS = Object.freeze([
    {id: 'running', label: 'Running',       empty: 'Nothing in flight.'},
    {id: 'queued',  label: 'Queued · next', empty: 'Nothing scheduled.'},
    {id: 'recent',  label: 'Recent',        empty: 'Nothing completed recently.'}
]);

/**
 * @summary Whether the watchdog's reading left part of the queue unobserved: unreadable ledger
 * entries, the `unknown` posture they produce, or a lease file the check could not read. An empty
 * visible queue under such a reading is not an absence — the writer's own contract keeps a corrupt
 * reading and a clean one apart, and the surface must too.
 * @param {Object|null} scheduler The envelope's scheduler summary.
 * @returns {Boolean}
 */
function isQueueUnobserved(scheduler) {
    return Boolean(scheduler) && (
        (Number.isInteger(scheduler.unreadableCount) && scheduler.unreadableCount > 0) ||
        scheduler.posture === 'unknown' ||
        scheduler.leaseStatus === 'unreadable' || scheduler.leaseStatus === 'malformed'
    )
}

/**
 * @summary The empty-queue line under an incomplete reading — what could not be read, in words,
 * never "nothing scheduled".
 * @param {Object} scheduler The envelope's scheduler summary.
 * @returns {String}
 */
function unobservedQueueLine(scheduler) {
    const count = scheduler.unreadableCount;

    return Number.isInteger(count) && count > 0
        ? `Queue not fully observed — ${count} ledger ${count === 1 ? 'entry' : 'entries'} unreadable.`
        : 'Queue not fully observed — the lease could not be read.'
}

/**
 * The resident Fleet tasks surface: WHAT the deployment is doing — running, queued / next, and
 * recently completed work — beside the roster that says WHO.
 *
 * @summary Projects one viewer-bound `fleetTasks` envelope into the bound Store as the exact
 * record set the {@link AgentOS.view.fleet.tasks.List tasks list} renders — section headers
 * (`isHeader`, the `useHeaders` contract), task rows, honest empty lines — without synthesizing,
 * ranking, or caching the envelope. The surface owns only this local projection Store plus the
 * honest chrome (meta line, refresh intent); its {@link AgentOS.view.fleet.tasks.Controller
 * controller} fires the read intent, and the owning FleetCockpit holds the authenticated bridge
 * and drives the read at boot and on every liveness tick.
 *
 * Honest states are first-class: the cold spine renders unanswered empty sections,
 * an unavailable read names its reason, a wired read with an empty section says so in words, a
 * run with no reported fraction carries its state word instead of a bar that would lie, and a
 * backlog gauge is labeled as a queue — never as progress.
 *
 * @class AgentOS.view.fleet.tasks.Container
 * @extends Neo.container.Base
 */
class Container extends BaseContainer {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.tasks.Container'
         * @protected
         */
        className: 'AgentOS.view.fleet.tasks.Container',
        /**
         * @member {String} ntype='fm-tasks-pane'
         * @protected
         */
        ntype: 'fm-tasks-pane',
        /**
         * @member {String[]} baseCls=['fm-tasks-pane']
         */
        baseCls: ['fm-tasks-pane'],
        /**
         * @member {Neo.controller.Component} controller=TasksController
         * @reactive
         */
        controller: TasksController,
        /**
         * Latest tasks envelope. `null` is unobserved, never empty.
         * @member {Object|null} snapshot_=null
         * @reactive
         */
        snapshot_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-tasks-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype: 'component',
                cls  : ['fm-tasks-title'],
                flex : 1,
                text : 'What is running'
            }, {
                ntype: 'component',
                cls  : ['fm-tasks-authority'],
                text : 'orchestrator · memory core · knowledge base · query-time'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-tasks-meta'],
            flex     : 'none',
            reference: 'tasks-meta',
            text     : 'Tasks not observed yet'
        }, {
            module   : TasksList,
            flex     : 1,
            reference: 'tasks-list'
        }, {
            ntype : 'container',
            cls   : ['fm-tasks-actions'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype: 'component',
                flex : 1
            }, {
                module   : Button,
                reference: 'tasks-refresh',
                text     : 'Refresh',
                iconCls  : 'fa fa-rotate',
                ui       : 'ghost',
                handler  : 'onRefreshClick'
            }]
        }]
    }

    /** @member {AgentOS.store.FleetTasks|null} taskStore=null */
    taskStore = null

    /**
     * What each task row showed in the previous projection (`id` → `{state, waitMs}`), so the
     * next projection can mark the rows whose facts moved — motion follows new evidence only.
     * @member {Map|null} previousFacts=null
     */
    previousFacts = null

    /**
     * @summary Create the pane-local projection Store, seat it on the list, and render held owner
     * state. No read fires here: the cockpit drives the tasks read at boot and on its liveness
     * tick, so a resident tab constructs on the owner-held snapshot and never queries the plane
     * on its own.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        let me = this;

        me.taskStore = Neo.create(FleetTasks);
        me.getReference('tasks-list').store = me.taskStore;
        me.applySnapshot()
    }

    /** @param {...*} args */
    destroy(...args) {
        this.taskStore?.destroy();
        this.taskStore = null;
        super.destroy(...args)
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetSnapshot(value, oldValue) {
        this.isConstructed && this.applySnapshot()
    }

    /**
     * @summary Project the latest envelope into the Store as the full render set — one header
     * record per section under its freshness pill and its counts, the queued section's lease line
     * when the envelope carries the scheduler summary, then mapped envelope rows or the
     * honest empty line. A
     * replace is wholesale — rows are a glance at one instant, never an accumulation — and the
     * meta line names every source axis by its own state word, so a partial read is readable as
     * exactly that. Provenance rides once per homogeneous section: the source chip sits on the
     * head when every row shares it, and a row carries its own only where a section mixes sources.
     * A row is marked `changed` only when
     * what it shows moved against the previous projection — a wait that grew under a new watchdog
     * stamp, a state that changed — so neither the liveness tick nor a re-fetched envelope with the
     * same stamp animates anything.
     */
    applySnapshot() {
        const
            me       = this,
            snapshot = me.snapshot,
            metaEl   = me.getReference('tasks-meta'),
            state    = snapshot?.capability?.state,
            wired    = state === 'wired' || state === 'partial',
            // Null means no read has answered. A transport fallback is an unavailable answer even
            // when it carries no source axes; neither state can supply a task row.
            cold     = !snapshot;

        if (!me.taskStore) return;

        const
            pill      = cold ? 'cold' : wired ? 'live' : 'unavailable',
            scheduler = wired && snapshot.scheduler && typeof snapshot.scheduler === 'object' ? snapshot.scheduler : null,
            counts    = wired && snapshot.counts && typeof snapshot.counts === 'object' ? snapshot.counts : null,
            previous  = me.previousFacts,
            facts     = new Map(),
            wiredRows = wired
                ? ['running', 'queued', 'recent']
                    .flatMap(section => Array.isArray(snapshot[section]) ? snapshot[section] : [])
                    .filter(row => typeof row?.id === 'string' && row.id)
                    .map(row => ({
                        id               : row.id,
                        section          : row.section,
                        name             : row.name,
                        source           : row.source,
                        state            : row.state,
                        at               : row.at ?? null,
                        progressKind     : row.progress?.kind  ?? null,
                        progressDone     : row.progress?.done  ?? null,
                        progressTotal    : row.progress?.total ?? null,
                        detail           : row.detail ?? null,
                        waitMs           : row.waitMs ?? null,
                        thresholdMs      : row.thresholdMs ?? null,
                        checkedAt        : row.checkedAt ?? null,
                        reasonCode       : row.reasonCode ?? null,
                        blockingTaskName : row.blockingTaskName ?? null,
                        leaseOwner       : row.leaseOwner ?? null,
                        priorityZero     : row.priorityZero === true,
                        bootstrapCritical: row.bootstrapCritical === true
                    }))
                : [],
            records   = SECTIONS.flatMap(section => {
                const
                    queued  = section.id === 'queued',
                    rows    = wiredRows.filter(row => row.section === section.id),
                    sources = new Set(rows.map(row => row.source ?? 'unknown')),
                    hoisted = rows.length > 0 && sources.size === 1 ? [...sources][0] : null,
                    header  = {
                        id          : `header:${section.id}`,
                        isHeader    : true,
                        rowKind     : 'header',
                        section     : section.id,
                        label       : section.label,
                        pill,
                        starvedTotal: queued ? (scheduler?.starvedTotal ?? null) : null,
                        knownCount  : queued ? (counts?.queuedKnown ?? null) : null,
                        shownCount  : counts?.[section.id] ?? null,
                        source      : hoisted && hoisted !== 'unknown' ? hoisted : null
                    },
                    meta    = queued && scheduler ? [{
                        id             : 'meta:queued',
                        rowKind        : 'meta',
                        section        : 'queued',
                        leaseHolder    : scheduler.leaseHolder ?? null,
                        leaseStatus    : scheduler.leaseStatus ?? null,
                        posture        : scheduler.posture ?? null,
                        checkedAt      : scheduler.checkedAt ?? null,
                        thresholdMs    : scheduler.degradeAfterMs ?? null,
                        unreadableCount: scheduler.unreadableCount ?? null
                    }] : [];

                rows.forEach(row => {
                    const prev = previous?.get(row.id);

                    row.sourceShown = hoisted === null;
                    row.changed     = Boolean(prev) && (prev.state !== row.state || prev.waitMs !== (row.waitMs ?? null));
                    facts.set(row.id, {state: row.state, waitMs: row.waitMs ?? null})
                });

                return [
                    header,
                    ...meta,
                    ...(rows.length > 0 ? rows : [{
                        id     : `empty:${section.id}`,
                        rowKind: 'empty',
                        section: section.id,
                        label  : cold
                            ? 'Tasks not answered yet.'
                            : !wired
                                ? 'The task sources did not answer. Nothing here claims to be the deployment.'
                                : queued && isQueueUnobserved(scheduler) ? unobservedQueueLine(scheduler) : section.empty
                    }])
                ]
            });

        me.previousFacts = facts;
        me.taskStore.clear();
        me.taskStore.add(records);

        if (metaEl) {
            metaEl.text = !snapshot
                ? 'Tasks not observed yet'
                : wired
                    ? `captured ${me.formatStamp(snapshot.capability.capturedAt)} · ${me.sourceLine(snapshot.sources)}`
                    : `Tasks unavailable · ${snapshot.capability?.reason || 'unknown reason'}`;

            // T5 receipt; falsy removes, so the unobserved and unavailable branches — which render
            // no stamp — cannot leave a previous read's instant hovering behind their copy
            metaEl.changeVdomRootKey('title', wired ? ViewerTime.viewerTimeTitle(snapshot.capability.capturedAt) : null)
        }
    }

    /**
     * @summary One clause per source axis, each under its own state word — the meta line's
     * honest half: "orchestrator live · memory core live · knowledge base not reachable".
     * @param {Object|null} sources The envelope's `sources` block.
     * @returns {String}
     */
    sourceLine(sources) {
        return Object.entries(SOURCE_LABELS)
            .map(([key, label]) => {
                const axis = sources?.[key === 'orchestrator' ? 'deployment' : key === 'mc' ? 'rem' : 'ingestion'];

                return `${label} ${SOURCE_STATE_WORDS[axis?.state] ?? 'unobserved'}`
            })
            .join(' · ')
    }

    /**
     * @summary Viewer-local rendering of the envelope's capture instant for the meta line.
     * @param {String|null} value
     * @returns {String}
     */
    formatStamp(value) {
        return value ? (ViewerTime.formatViewerTime(value)?.text ?? 'unknown time') : '—'
    }
}

export default Neo.setupClass(Container);
