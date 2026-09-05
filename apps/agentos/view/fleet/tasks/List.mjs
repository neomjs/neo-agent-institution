import BaseList   from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import NeoArray   from '../../../../../node_modules/neo.mjs/src/util/Array.mjs';
import ViewerTime from '../../../util/ViewerTime.mjs';

/**
 * @summary Provenance words per source axis — the pill every task row carries. Exported because
 * the owning {@link AgentOS.view.fleet.tasks.Container} meta line speaks the same vocabulary.
 * @type {Object}
 */
export const SOURCE_LABELS = Object.freeze({
    orchestrator: 'orchestrator',
    mc          : 'memory core',
    kb          : 'knowledge base'
});

/**
 * @summary The meta-line word for each source state the envelope can report — the Container's
 * `sourceLine` half of the shared vocabulary.
 * @type {Object}
 */
export const SOURCE_STATE_WORDS = Object.freeze({
    wired      : 'live',
    stale      : 'stale',
    degraded   : 'degraded',
    unavailable: 'unavailable',
    unwired    : 'not reachable'
});

/**
 * @summary The short label per starvation reason code and the row field that cause carries —
 * a lease hold names its owner, backpressure and a yield name the blocking task. Codes outside
 * this table render as themselves; a row without a code says its cause is unknown.
 * @type {Object}
 */
const CAUSE_WORDS = Object.freeze({
    'heavy-maintenance-lease-held'     : ['lease held by', 'leaseOwner'],
    'heavy-maintenance-backpressure'   : ['behind',        'blockingTaskName'],
    'heavy-maintenance-yield-to-waiter': ['yielded to',    'blockingTaskName']
});

/**
 * @summary Escape one wire string for an `html` node — task and owner names come from the plane.
 * @param {*} value
 * @returns {String}
 */
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);

/**
 * @summary Word a wait or a bound as text — hours and minutes ("2 h 43 min", "8 h"), minutes under
 * an hour ("45 min"), seconds under a minute. Text, never a bar: a wait is not completion, and the
 * completion-progress path would clamp it to the threshold.
 * @param {Number} ms
 * @returns {String}
 */
export function formatDuration(ms) {
    const
        totalMinutes = Math.floor(ms / 60_000),
        hours        = Math.floor(totalMinutes / 60),
        minutes      = totalMinutes % 60;

    if (totalMinutes < 1) return `${Math.floor(ms / 1000)} s`;
    if (hours < 1)        return `${totalMinutes} min`;

    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
}

/**
 * The tasks list — the WHAT surface's rows as a real `Neo.list.Base` (the base-class-first + suffix laws): the owning Container projects one `fleetTasks` envelope into the bound Store as
 * section-header records (`isHeader`, the `useHeaders` contract), the queued section's lease line,
 * task rows, and honest empty-line rows; this class renders each record kind under the one row
 * grammar the surface shipped with — `[time] [name] [state] [wait?] [cause?] [progress?] [flags?]
 * [provenance?]`, a determinate run as a native `progress` element PLUS its percentage text (the
 * bar is the glance, the text is the 1.4.1 channel), a backlog gauge labeled as a queue, a
 * starved waiter's wait as unclamped text beside its own cause. A section head carries its counts
 * (`starved` · `known` · `shown`, distinct) and, when every row shares one source, that source —
 * provenance once per homogeneous section, a row chip only where sources mix.
 *
 * The list renders; it never reads. The Store is the seam: a snapshot replace re-renders through
 * the list's own store listeners, and no method here touches an envelope or a bridge.
 *
 * @class AgentOS.view.fleet.tasks.List
 * @extends Neo.list.Base
 */
class List extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.tasks.List'
         * @protected
         */
        className: 'AgentOS.view.fleet.tasks.List',
        /**
         * @member {String} ntype='fm-tasks-list'
         * @protected
         */
        ntype: 'fm-tasks-list',
        /**
         * @member {String[]} baseCls=['fm-tasks-list','neo-list']
         */
        baseCls: ['fm-tasks-list', 'neo-list'],
        /**
         * The projection Store is created, seated and destroyed by the owning Container — this
         * list must never destroy an injected store it does not own.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * Task rows are a glance surface, not a selection surface.
         * @member {Boolean} disableSelection=true
         * @reactive
         */
        disableSelection: true,
        /**
         * The projection Store carries the section-header records this contract renders.
         * @member {Boolean} useHeaders=true
         * @reactive
         */
        useHeaders: true
    }

    /**
     * @summary The base `useHeaders` hook switches the whole list to the definition-list shape
     * (`dl` root, `dd` items, `dt` headers). This surface's declared contract is the FLAT `ul/li`
     * list — headers are ordinary `li` rows too — so the base switch is deliberately not applied:
     * the root stays `ul` and `itemTagName` stays `li`; only the header-record semantics of
     * `useHeaders` (the `isHeader` branch in `createItem`) are consumed.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetUseHeaders(value, oldValue) {
        // intentionally empty — see summary
    }

    /**
     * @summary One list item per projection record, styled by its record kind. The base `isHeader`
     * branch emits `dt` nodes; inside this flat `ul` every row — header, task, empty — is a real
     * `li`, so the tag is normalized here and the header keeps its `neo-list-header` marker class.
     * @param {Object} record
     * @param {Number} index
     * @returns {Object|null} The list item vdom object.
     */
    createItem(record, index) {
        const item = super.createItem(record, index);

        if (!item) {
            return item
        }

        item.tag = 'li';

        NeoArray.add(item.cls, record.isHeader
            ? ['fm-tasks-section-head', `is-${record.section ?? 'unknown'}`]
            : record.rowKind === 'empty'
                ? ['fm-tasks-empty-row', `is-${record.section ?? 'unknown'}`]
                : record.rowKind === 'meta'
                    ? ['fm-tasks-section-meta', `is-${record.section ?? 'unknown'}`]
                    // `is-changed` runs the one state-change pass (reduced motion removes it)
                    : ['fm-task-row', `is-${record.section ?? 'unknown'}`, ...(record.changed ? ['is-changed'] : [])]);

        return item
    }

    /**
     * @summary The one row grammar, per record kind: a header renders its section label, its counts
     * (`starved` · `known` · `shown`), a hoisted source chip when the section is homogeneous, and the
     * freshness pill; a meta row the queued section's lease line; an empty row its honest sentence;
     * a task row `[time] [name] [state] [wait?] [cause?] [progress?] [flags?] [provenance?]` with the
     * exact ISO instant riding the time cell's `title` (T5), a `detail` riding the name cell's, and
     * the raw reason code riding the cause cell's.
     * @param {Object} record
     * @param {Number} index
     * @returns {Object[]} The item vdom children.
     */
    createItemContent(record, index) {
        const me = this,
              id = me.getItemId(me.getRecordId(record));

        if (record.isHeader) {
            const counts = me.countText(record);

            return [
                {tag: 'span', id: `${id}__label`, cls: ['fm-tasks-section-label'], text: record.label ?? record.section},
                ...(counts ? [{tag: 'span', id: `${id}__count`, cls: ['fm-tasks-section-count'], html: counts}] : []),
                ...(record.source ? [{tag: 'span', id: `${id}__source`, cls: ['fm-freshness', `is-source-${record.source}`], text: SOURCE_LABELS[record.source] ?? record.source}] : []),
                {tag: 'span', id: `${id}__pill`,  cls: ['fm-freshness', `is-${record.pill ?? 'unknown'}`], text: record.pill ?? 'unknown'}
            ]
        }

        if (record.rowKind === 'meta') {
            return [
                {tag: 'span', id: `${id}__lease`, cls: ['fm-tasks-lease'], html: me.leaseLine(record)}
            ]
        }

        if (record.rowKind === 'empty') {
            return [
                {tag: 'span', id: `${id}__empty`, cls: ['fm-tasks-empty'], text: record.label ?? ''}
            ]
        }

        const
            progress = record.progressKind && Number.isInteger(record.progressDone) && Number.isInteger(record.progressTotal) && record.progressTotal > 0
                ? {kind: record.progressKind, done: Math.min(record.progressDone, record.progressTotal), total: record.progressTotal}
                : null,
            title    = ViewerTime.viewerTimeTitle(record.at),
            starved  = record.state === 'starved',
            cn       = [{
                tag : 'span',
                id  : `${id}__time`,
                cls : ['fm-task-time'],
                text: me.formatStamp(record.at),
                ...(title ? {title} : {})
            }, {
                tag : 'span',
                id  : `${id}__name`,
                cls : ['fm-task-name'],
                text: record.name ?? 'Unnamed task',
                ...(record.detail ? {title: record.detail} : {})
            }, {
                tag : 'span',
                id  : `${id}__state`,
                // the wedged ink for a starved waiter or an unanchored lane — the receipt's word, not a diagnosis
                cls : ['fm-task-state', ...(starved || record.state === 'unanchored' ? [`is-${record.state}`] : [])],
                text: record.state ?? 'unknown'
            }];

        // the wait as TEXT in the detail role (never a bar: a wait is not completion), the bound
        // beside it; the row's own cause with the raw code riding its title
        if (Number.isInteger(record.waitMs)) {
            cn.push({
                tag: 'span',
                id : `${id}__wait`,
                cls: ['fm-task-wait'],
                cn : [
                    {tag: 'span', id: `${id}__wait-value`, text: `waiting ${formatDuration(record.waitMs)}`},
                    ...(Number.isInteger(record.thresholdMs) ? [{tag: 'span', id: `${id}__threshold`, cls: ['threshold'], text: `threshold ${formatDuration(record.thresholdMs)}`}] : [])
                ]
            })
        }

        if (starved) {
            const cause = me.describeCause(record);

            cn.push({
                tag  : 'span',
                id   : `${id}__cause`,
                cls  : ['fm-task-cause', ...(cause.absent ? ['absent'] : [])],
                html : cause.html,
                title: cause.title
            })
        }

        if (progress) {
            const label = progress.kind === 'determinate'
                ? `${Math.round(progress.done / progress.total * 100)}%`
                : `${progress.done} / ${progress.total}`;

            cn.push({
                tag: 'span',
                id : `${id}__progress`,
                cls: ['fm-task-progress', `is-${progress.kind}`],
                cn : [{
                    tag         : 'progress',
                    id          : `${id}__bar`,
                    cls         : ['fm-task-bar'],
                    value       : progress.done,
                    max         : progress.total,
                    'aria-label': `${record.name ?? 'task'} ${progress.kind === 'backlog' ? 'backlog' : 'progress'}`
                }, {
                    tag : 'span',
                    id  : `${id}__progress-text`,
                    cls : ['fm-task-progress-text'],
                    text: label
                }]
            })
        }

        // the two flags as pills — facts the receipt carries, not hues
        record.priorityZero      && cn.push({tag: 'span', id: `${id}__priority-zero`,      cls: ['fm-freshness', 'is-flag'], text: 'priority zero'});
        record.bootstrapCritical && cn.push({tag: 'span', id: `${id}__bootstrap-critical`, cls: ['fm-freshness', 'is-flag'], text: 'bootstrap critical'});

        // provenance once per homogeneous section: the chip rides the row only where sources mix
        if (record.sourceShown) {
            cn.push({
                tag : 'span',
                id  : `${id}__source`,
                cls : ['fm-freshness', record.sample ? 'is-sample' : `is-source-${record.source ?? 'unknown'}`],
                text: record.sample ? 'sample' : (SOURCE_LABELS[record.source] ?? 'unknown source')
            })
        }

        return cn
    }

    /**
     * @summary The section head's counts, each number distinct: the pre-cap `starved` and `known`
     * beside the post-cap `shown` — an older Brain that reports no totals yields the shown count
     * alone, never a claim it cannot make.
     * @param {Object} record The header record.
     * @returns {String|null} Html with the numbers in `b`, or `null` when no count is known.
     */
    countText(record) {
        const bits = [];

        Number.isInteger(record.starvedTotal) && bits.push(`<b>${record.starvedTotal}</b> starved`);
        Number.isInteger(record.knownCount)   && bits.push(`<b>${record.knownCount}</b> known`);
        Number.isInteger(record.shownCount)   && bits.push(`<b>${record.shownCount}</b> shown`);

        return bits.length > 0 ? bits.join(' · ') : null
    }

    /**
     * @summary The queued section's lease line — the watchdog's check-time facts in words: the
     * holder (or that there is none), its status, the posture with its own tone, the unreadable
     * count when there is one, the check instant, the bound. No "since": the receipt records no
     * acquisition time, so none is invented.
     * @param {Object} record The meta record.
     * @returns {String} Html.
     */
    leaseLine(record) {
        const
            me      = this,
            posture = record.posture,
            count   = record.unreadableCount;

        return [
            'maintenance lease',
            record.leaseHolder ? `<b>${escapeHtml(record.leaseHolder)}</b>` : 'no active holder',
            record.leaseStatus ? escapeHtml(record.leaseStatus) : null,
            posture ? `posture <span class="is-${escapeHtml(posture)}">${escapeHtml(posture)}</span>` : null,
            Number.isInteger(count) && count > 0 ? `<b>${count}</b> ${count === 1 ? 'entry' : 'entries'} unreadable` : null,
            record.checkedAt ? `checked <b>${escapeHtml(me.formatStamp(record.checkedAt))}</b>` : null,
            Number.isInteger(record.thresholdMs) ? `threshold ${formatDuration(record.thresholdMs)}` : null
        ].filter(Boolean).join(' · ')
    }

    /**
     * @summary A starved row's own cause: the short label per reason code with the field that cause
     * carries, the raw code as the diagnostic title. A code this table does not know renders as
     * itself; a row without a code says so — the section's lease holder is never borrowed as a
     * waiter's cause.
     * @param {Object} record The task record.
     * @returns {{html: String, title: String, absent: Boolean}}
     */
    describeCause(record) {
        const code = record.reasonCode;

        if (!code) {
            return {html: 'cause unknown', title: 'the receipt carried no reason code for this waiter', absent: true}
        }

        const
            words = CAUSE_WORDS[code],
            field = words ? record[words[1]] : null,
            title = [
                code,
                record.leaseOwner       ? `leaseOwner: ${record.leaseOwner}`             : null,
                record.blockingTaskName ? `blockingTaskName: ${record.blockingTaskName}` : null
            ].filter(Boolean).join(' · ');

        return {
            html  : words ? `${words[0]} <b>${escapeHtml(field ?? 'unknown')}</b>` : escapeHtml(code),
            title,
            absent: false
        }
    }

    /**
     * @summary Viewer-local rendering of one wire instant, or the honest dash for a row with no
     * governing time (a frozen collection, a queue fact without a cycle).
     * @param {String|null} value
     * @returns {String}
     */
    formatStamp(value) {
        return value ? (ViewerTime.formatViewerTime(value)?.text ?? 'unknown time') : '—'
    }
}

export default Neo.setupClass(List);
