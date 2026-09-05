import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

const
    SECTIONS = new Set(['running', 'queued', 'recent']),
    SOURCES  = new Set(['orchestrator', 'mc', 'kb']);

/**
 * @class AgentOS.model.FleetTask
 * @extends Neo.data.Model
 *
 * @summary One view-projection record in the Fleet Tasks pane: a single row of the `fleetTasks`
 * envelope as the source reduced it — a running, queued, or recently completed unit of work with
 * its governing instant, its state word, its optional progress fact, and the source it came from.
 * The model is intentionally thin: it stores projection input and derives no second truth. The
 * converts are the rendering guards — an unknown section or source becomes `null` and the pane
 * names it rather than mis-filing the row, and a progress fact survives only when both counts are
 * real integers.
 */
class FleetTask extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.FleetTask'
         * @protected
         */
        className: 'AgentOS.model.FleetTask',
        /**
         * @member {String} keyProperty='id'
         * @reactive
         */
        keyProperty: 'id',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'id',
            type: 'String'
        }, {
            name        : 'section',
            type        : 'String',
            convert     : value => SECTIONS.has(value) ? value : null,
            defaultValue: null
        }, {
            name        : 'name',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'source',
            type        : 'String',
            convert     : value => SOURCES.has(value) ? value : null,
            defaultValue: null
        }, {
            name        : 'state',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'at',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'progressKind',
            type        : 'String',
            convert     : value => value === 'determinate' || value === 'backlog' ? value : null,
            defaultValue: null
        }, {
            name        : 'progressDone',
            type        : 'Integer',
            convert     : value => Number.isInteger(value) && value >= 0 ? value : null,
            defaultValue: null
        }, {
            name        : 'progressTotal',
            type        : 'Integer',
            convert     : value => Number.isInteger(value) && value > 0 ? value : null,
            defaultValue: null
        }, {
            name        : 'detail',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            // ── projection-row vocabulary: the pane's Store is a PROJECTION of one
            // envelope into exactly what the tasks list renders, so the record set carries the
            // list's own structural rows — section headers and honest empty lines — beside the
            // task rows. `isHeader` is the list.Base `useHeaders` contract field.
            name        : 'isHeader',
            type        : 'Boolean',
            defaultValue: false
        }, {
            // `meta` is the queued section's lease line — a structural row like the header
            name        : 'rowKind',
            type        : 'String',
            convert     : value => value === 'header' || value === 'empty' || value === 'meta' ? value : 'task',
            defaultValue: 'task'
        }, {
            // header rows: the section label · empty rows: the honest empty sentence
            name        : 'label',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            // header rows only: the freshness pill word (`sample` · `live` · `unavailable`)
            name        : 'pill',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            // cold-spine rows render the `sample` pill instead of a source claim
            name        : 'sample',
            type        : 'Boolean',
            defaultValue: false
        }, {
            // ── the heavy-maintenance queue (#113): a starved waiter's own facts as the producer's
            // receipt carries them — the wait as numbers (rendered as TEXT, never a bar: a wait is
            // not completion), the row's own cause fields, the two flags; `null` where the wire
            // sent none, never inferred from the section's lease holder
            name        : 'waitMs',
            type        : 'Integer',
            convert     : value => Number.isInteger(value) && value >= 0 ? value : null,
            defaultValue: null
        }, {
            name        : 'thresholdMs',
            type        : 'Integer',
            convert     : value => Number.isInteger(value) && value > 0 ? value : null,
            defaultValue: null
        }, {
            // the watchdog's check-time instant — the only clock the waiting facts move on
            name        : 'checkedAt',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'reasonCode',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'blockingTaskName',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'leaseOwner',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'priorityZero',
            type        : 'Boolean',
            defaultValue: false
        }, {
            name        : 'bootstrapCritical',
            type        : 'Boolean',
            defaultValue: false
        }, {
            // ── section facts. Header rows: the pre-cap totals (`starved` and `known` distinct from
            // `shown`) and the provenance chip hoisted from rows that all share one source. Task
            // rows: `sourceShown` is true only in a section that mixes sources. Meta rows: the lease
            // summary — holder, status, posture, unreadable count, with `checkedAt` / `thresholdMs`
            // above as the watchdog's clock and bound.
            name        : 'starvedTotal',
            type        : 'Integer',
            convert     : value => Number.isInteger(value) && value >= 0 ? value : null,
            defaultValue: null
        }, {
            name        : 'knownCount',
            type        : 'Integer',
            convert     : value => Number.isInteger(value) && value >= 0 ? value : null,
            defaultValue: null
        }, {
            name        : 'shownCount',
            type        : 'Integer',
            convert     : value => Number.isInteger(value) && value >= 0 ? value : null,
            defaultValue: null
        }, {
            name        : 'sourceShown',
            type        : 'Boolean',
            defaultValue: true
        }, {
            name        : 'leaseHolder',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'leaseStatus',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'posture',
            type        : 'String',
            convert     : value => typeof value === 'string' && value ? value : null,
            defaultValue: null
        }, {
            name        : 'unreadableCount',
            type        : 'Integer',
            convert     : value => Number.isInteger(value) && value >= 0 ? value : null,
            defaultValue: null
        }, {
            // motion follows new evidence only: set by the projection when what this row shows
            // changed against the previous projection (a wait that grew under a new stamp, a state
            // that moved) — the list renders one transition on it, and reduced motion removes it
            name        : 'changed',
            type        : 'Boolean',
            defaultValue: false
        }]
    }
}

export default Neo.setupClass(FleetTask);
