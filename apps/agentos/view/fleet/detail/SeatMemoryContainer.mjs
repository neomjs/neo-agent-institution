import Button              from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container           from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import AddAgentFlow        from '../../../util/AddAgentFlow.mjs';
import MemoryCandidateList from '../instances/MemoryCandidateList.mjs';

/**
 * @class AgentOS.view.fleet.detail.SeatMemoryContainer
 * @extends Neo.container.Base
 *
 * @summary The Seat group's Memory row: the memory-import choice recorded for the seat, an existing agent's memory to
 * import or none. It shows what was chosen, never what the seat's home holds: a seat added before Add Agent asked has
 * no choice recorded, and the Fleet imports nothing for it. This row offers the choice Add makes, from the same
 * helpers: the Fleet's candidates ({@link AgentOS.util.AddAgentFlow#readMemoryCandidates}) in the same list, then
 * *Start with empty memory*, with the chosen candidate's folder under Details. The Fleet takes a choice only before
 * the seat's first Start. Its refusal shows on the row in its own words, and only its code for a closed choice
 * ({@link AgentOS.util.AddAgentFlow#MEMORY_IMPORT_CLOSED}) withdraws the offer.
 *
 * Like the model row it changes nothing itself. It fires `readSeatMemory` for the candidates and `declareSeatMemory`
 * with `{memoryImport}`; its owner runs both and sets `discovery`, `seat`, `status` and `closed` back.
 */
class SeatMemoryContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.SeatMemoryContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.SeatMemoryContainer',
        /**
         * @member {String} ntype='fm-seat-memory'
         * @protected
         */
        ntype: 'fm-seat-memory',
        /**
         * One of the Seat group's rows, in its row skin (`SeatModelContainer.scss`).
         * @member {String[]} baseCls=['fm-seat-model-row','fm-seat-memory']
         */
        baseCls: ['fm-seat-model-row', 'fm-seat-memory'],
        /**
         * The offered row the operator chose, its `source` (`'none'` for the empty row); `null` before a choice.
         * @member {String|null} choice_=null
         * @reactive
         */
        choice_: null,
        /**
         * Whether the Fleet closed this seat's choice: the seat runs, or already holds its memory. The Fleet's reason
         * stays on the status line, and the row offers the choice no more.
         * @member {Boolean} closed_=false
         * @reactive
         */
        closed_: false,
        /**
         * The Fleet's answer on existing memory, `{state: 'reading'}` while it is asked; `null` while the choice is closed.
         * @member {Object|null} discovery_=null
         * @reactive
         */
        discovery_: null,
        /**
         * Whether the choice is open.
         * @member {Boolean} editing_=false
         * @reactive
         */
        editing_: false,
        /**
         * The seat's definition, `{id, memoryImport}`; `null` without one.
         * @member {Object|null} seat_=null
         * @reactive
         */
        seat_: null,
        /**
         * Ephemeral round-trip feedback, `{state: 'idle'|'pending'|'rejected'|'superseded', reason}`.
         * @member {Object} status_={state:'idle',reason:''}
         * @reactive
         */
        status_: {state: 'idle', reason: ''},
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * Label and action · the consent's line · the choice, open · status line.
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-seat-model-row-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [
                {ntype: 'component', cls: ['fm-seat-model-label'], flex: 1, text: 'memory'},
                {module: Button, cls: ['fm-chip', 'fm-seat-memory-change'], flex: 'none', handler: 'up.onChangeClick', hidden: true, reference: 'memory-change'}
            ]
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-model-line'],
            flex     : 'none',
            reference: 'memory-line'
        }, {
            ntype    : 'container',
            cls      : ['fm-seat-memory-offer'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'vbox', align: 'stretch'},
            reference: 'memory-offer',
            items    : [{
                ntype    : 'component',
                cls      : ['fm-seat-memory-lead'],
                flex     : 'none',
                reference: 'memory-lead'
            }, {
                module   : MemoryCandidateList,
                flex     : 'none',
                listeners: {itemClick: 'up.onCandidateClick'},
                reference: 'memory-list'
            }, {
                ntype    : 'component',
                cls      : ['fm-seat-memory-note'],
                flex     : 'none',
                reference: 'memory-note',
                text     : AddAgentFlow.MEMORY_COPY_NOTE
            }, {
                ntype    : 'component',
                cls      : ['fm-seat-memory-details'],
                flex     : 'none',
                hidden   : true,
                reference: 'memory-details',
                vdom     : {tag: 'details', cn: [{tag: 'summary', text: 'Details'}, {cls: ['fm-seat-memory-source']}]}
            }, {
                ntype : 'container',
                cls   : ['fm-seat-memory-actions'],
                flex  : 'none',
                layout: {ntype: 'hbox', align: 'center', wrap: 'wrap'},
                items : [
                    {module: Button, cls: ['fm-chip', 'fm-seat-memory-save'], handler: 'up.onSaveClick', reference: 'memory-save', text: 'Save'},
                    {module: Button, cls: ['fm-chip'], handler: 'up.onRetryClick', hidden: true, reference: 'memory-retry', text: 'Retry'}
                ]
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-model-status', 'is-idle'],
            flex     : 'none',
            reference: 'memory-status'
        }]
    }

    /** @param {...*} args */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.sync()
    }

    /** @param {String|null} value @param {String|null} oldValue */
    afterSetChoice(value, oldValue) {
        oldValue !== undefined && this.syncChoice()
    }

    /** @param {Boolean} value @param {Boolean} oldValue */
    afterSetClosed(value, oldValue) {
        oldValue !== undefined && this.sync()
    }

    /**
     * A new answer refills the list and starts a new choice: the recorded consent where the answer offers it, else
     * the one candidate an answer holds ({@link AgentOS.util.AddAgentFlow#preselectedMemory}).
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetDiscovery(value, oldValue) {
        if (oldValue !== undefined) {
            const
                me      = this,
                rows    = AddAgentFlow.memoryChoices(value),
                consent = me.seat?.memoryImport ?? null;

            me.choice = null;
            me.getReference('memory-list').store.data = rows;
            me.choice = rows.some(row => row.source === consent) ? consent : AddAgentFlow.preselectedMemory(value);
            me.sync()
        }
    }

    /** @param {Boolean} value @param {Boolean} oldValue */
    afterSetEditing(value, oldValue) {
        oldValue !== undefined && this.sync()
    }

    /**
     * Another seat closes the choice and clears what belonged to the last one, a closed choice included.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetSeat(value, oldValue) {
        if (oldValue !== undefined) {
            value?.id !== oldValue?.id && this.set({closed: false, discovery: null, editing: false, status: {state: 'idle', reason: ''}});
            this.sync()
        }
    }

    /** @param {Object} value @param {Object} oldValue */
    afterSetStatus(value, oldValue) {
        oldValue !== undefined && this.sync()
    }

    /**
     * @summary What the row's line says: the choice on record, never the memory the seat's home holds or whether an
     * import ran. That is the folder whose memory is to be imported, no import, or no choice recorded.
     * @param {String|null} consent The definition's `memoryImport`.
     * @returns {String}
     */
    static lineFor(consent) {
        if (consent === AddAgentFlow.MEMORY_IMPORT_NONE) return 'recorded: import no memory';

        return consent ? `recorded: import the memory at ${consent}` : 'no import choice recorded'
    }

    /**
     * @summary Render the line, the action, the open choice and the feedback from the current configs.
     */
    sync() {
        const
            me        = this,
            consent   = me.seat?.memoryImport ?? null,
            discovery = me.editing ? me.discovery : null,
            reading   = me.editing && (!discovery || discovery.state === 'reading'),
            pending   = me.status?.state === 'pending',
            rows      = discovery && !reading ? AddAgentFlow.memoryChoices(discovery) : [],
            asks      = discovery?.state === 'unavailable' || discovery?.state === 'offline';

        me.getReference('memory-line').text = SeatMemoryContainer.lineFor(consent);
        me.getReference('memory-change').set({disabled: pending, hidden: !me.seat || me.closed, text: me.editing ? 'Close' : consent ? 'Change' : 'Choose'});

        const offer = me.getReference('memory-offer');

        offer.hidden = !me.editing || reading || me.closed;
        offer[asks ? 'addCls' : 'removeCls']('is-unavailable');

        if (discovery && !reading) {
            // a fleet that answers with no candidates leaves one honest choice: the empty row, nothing to import
            me.getReference('memory-lead').text = discovery.state === 'none'
                ? 'No other agent\'s memory is on this machine, so there is nothing to import.'
                : discovery.state === 'offline' ? discovery.reason : AddAgentFlow.memoryLead(discovery);

            me.getReference('memory-list').hidden  = rows.length === 0;
            me.getReference('memory-note').hidden  = discovery.state !== 'candidates';
            me.getReference('memory-retry').hidden = !asks;
            me.getReference('memory-save').set({disabled: pending || discovery.state === 'offline'})
        }

        me.getReference('memory-status').set({
            cls : ['fm-seat-model-status', `is-${reading ? 'pending' : me.status?.state ?? 'idle'}`],
            text: reading ? 'Looking for existing memory…' : pending ? me.status.reason || 'Saving…' : me.status?.reason ?? ''
        });

        me.syncChoice()
    }

    /**
     * @summary Mark the operator's choice in the list; Details follows it.
     */
    syncChoice() {
        const
            me     = this,
            list   = me.getReference('memory-list'),
            record = me.choice ? list.store.get(me.choice) : null;

        record ? list.selectItem(record) : list.selectionModel?.deselectAll();
        me.syncDetails()
    }

    /**
     * @summary Details holds what the rows leave out ({@link AgentOS.util.AddAgentFlow#memoryDetail}), so two
     * candidates that read alike are told apart before Save. With nothing to detail, it hides.
     */
    syncDetails() {
        const
            me      = this,
            details = me.getReference('memory-details'),
            text    = me.editing ? AddAgentFlow.memoryDetail({discovery: me.discovery, choice: me.choice}) : null;

        details.vdom.cn[1].text = text ?? '';
        details.hidden          = !text;
        details.update()
    }

    /**
     * @summary A row is the operator's choice: an agent's memory to continue, or the empty row.
     * @param {Object} data
     * @param {Object} data.record
     */
    onCandidateClick({record}) {
        this.choice = record.source
    }

    /**
     * @summary Choose or Change opens the choice and asks the owner for the Fleet's candidates; Close closes it.
     */
    onChangeClick() {
        const me = this;

        me.editing = !me.editing;
        me.editing && me.fire('readSeatMemory')
    }

    /**
     * @summary *Retry* asks the Fleet again after a check that could not answer.
     */
    onRetryClick() {
        this.fire('readSeatMemory')
    }

    /**
     * @summary Save hands the consent the choice makes to the owner, or names what the choice still lacks.
     */
    onSaveClick() {
        const
            me      = this,
            verdict = AddAgentFlow.memoryImportFor({discovery: me.discovery, choice: me.choice});

        verdict.valid
            ? me.fire('declareSeatMemory', {memoryImport: verdict.memoryImport})
            : me.status = {state: 'rejected', reason: verdict.reason}
    }
}

export default Neo.setupClass(SeatMemoryContainer);
