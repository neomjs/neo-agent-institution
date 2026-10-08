import Button              from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container           from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField           from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';
import SeatModel           from '../../../util/SeatModel.mjs';
import SeatMemoryContainer from './SeatMemoryContainer.mjs';

/**
 * The Seat group's two rows, each with the record field it declares.
 * @type {Object[]}
 */
const FIELDS = [{field: 'model', label: 'model'}, {field: 'reasoningEffort', label: 'reasoning effort'}];

/**
 * @summary One row: its label beside the actions its state offers, and its line beneath at the group's whole width,
 * so both values stay readable in the narrowest inspector.
 * @param {String} field
 * @param {String} label
 * @returns {Object}
 */
const seatRow = (field, label) => ({
    ntype    : 'container',
    cls      : ['fm-seat-model-row'],
    flex     : 'none',
    layout   : {ntype: 'vbox', align: 'stretch'},
    reference: `${field}-row`,
    items    : [{
        ntype : 'container',
        cls   : ['fm-seat-model-row-head'],
        flex  : 'none',
        layout: {ntype: 'hbox', align: 'center'},
        items : [
            {ntype: 'component', cls: ['fm-seat-model-label'], flex: 1, text: label},
            // Adopt is the quieter second action, a text link named by the value it declares
            ...['change', 'adopt'].map(action => ({
                module   : Button,
                cls      : action === 'change' ? ['fm-chip', 'fm-seat-model-change'] : ['fm-seat-model-adopt'],
                flex     : 'none',
                handler  : 'up.onActionClick',
                hidden   : true,
                reference: `${field}-${action}`,
                text     : action === 'change' ? 'Change' : 'Adopt'
            }))
        ]
    }, {
        ntype    : 'component',
        cls      : ['fm-seat-model-line'],
        flex     : 'none',
        reference: `${field}-line`
    }]
});

/**
 * @class AgentOS.view.fleet.detail.SeatModelContainer
 * @extends Neo.container.Base
 *
 * @summary Agent Detail › Configuration's Seat group: the model and reasoning effort declared for the seat's harness,
 * beside what its config is set to, in {@link AgentOS.util.SeatModel}'s words. Change offers only what the harness
 * itself names: a Codex seat's catalog, `claude-code`'s effort levels, and a model id for `claude-code`, which takes
 * any it accepts. Claude Desktop offers the explicit Max/default effort choice without pretending to enumerate
 * its unsupported catalog. Its model stays read-only; a declaration is not an effective-session measurement.
 *
 * Like the commit-identity row it changes nothing itself. It fires `readSeatCatalog` for the values to offer, and
 * `declareSeatModel` with `{field, value}` (`null` hands the field back to the harness); its owner runs the round-trip
 * and sets `catalog`, `seat` and `status` back. The group's last row, {@link AgentOS.view.fleet.detail.SeatMemoryContainer},
 * holds the seat's memory consent and talks to the same owner.
 */
class SeatModelContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.SeatModelContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.SeatModelContainer',
        /**
         * @member {String} ntype='fm-seat-model'
         * @protected
         */
        ntype: 'fm-seat-model',
        /**
         * @member {String[]} baseCls=['fm-seat-model']
         */
        baseCls: ['fm-seat-model'],
        /**
         * The actions wear the shared chip skin, which loads as a shared partial.
         * @member {String[]} additionalThemeFiles=['AgentOS.view.fleet.mailbox.Chips']
         */
        additionalThemeFiles: ['AgentOS.view.fleet.mailbox.Chips'],
        /**
         * What the seat's harness offers, the Fleet's `fleetSeatModelCatalog` answer; `null` before a read.
         * @member {Object|null} catalog_=null
         * @reactive
         */
        catalog_: null,
        /**
         * What the harness's config is set to now, `{model, reasoningEffort}`; `null` where unread.
         * @member {Object|null} configured_=null
         * @reactive
         */
        configured_: null,
        /**
         * The field whose values are open, `model` or `reasoningEffort`; `null` while closed.
         * @member {String|null} editing_=null
         * @reactive
         */
        editing_: null,
        /**
         * What a seat whose harness chooses for itself reported, `{model, reasoningEffort}`; `null` before it did.
         * @member {Object|null} observed_=null
         * @reactive
         */
        observed_: null,
        /**
         * Why the Fleet refused the seat's latest start for its declaration, in the Fleet's words; `null` otherwise.
         * The row the card sends the operator to says it.
         * @member {String|null} refusal_=null
         * @reactive
         */
        refusal_: null,
        /**
         * The seat's definition, `{id, harnessType, model, reasoningEffort}`; `null` without one.
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
         * Heading · the two rows · the values on offer · status line · the memory row. Skin in `SeatModelContainer.scss`.
         * @member {Object[]} items
         */
        items: [
            {ntype: 'component', cls: ['fm-seat-model-heading'], flex: 'none', text: 'Seat'},
            ...FIELDS.map(({field, label}) => seatRow(field, label)),
            {
                ntype    : 'container',
                cls      : ['fm-seat-model-offer'],
                flex     : 'none',
                hidden   : true,
                layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
                reference: 'offer'
            }, {
                ntype    : 'container',
                cls      : ['fm-seat-model-free'],
                flex     : 'none',
                hidden   : true,
                layout   : {ntype: 'hbox', align: 'center'},
                reference: 'free',
                items    : [{
                    module       : TextField,
                    flex         : 1,
                    labelPosition: 'inline',
                    labelText    : 'Model id or alias',
                    reference    : 'free-model'
                }, {
                    module   : Button,
                    cls      : ['fm-chip', 'fm-seat-model-save'],
                    flex     : 'none',
                    handler  : 'up.onFreeSave',
                    reference: 'free-save',
                    text     : 'Save model'
                }]
            }, {
                ntype    : 'component',
                cls      : ['fm-seat-model-status', 'is-idle'],
                flex     : 'none',
                reference: 'status-line'
            }, {
                module   : SeatMemoryContainer,
                flex     : 'none',
                reference: 'seat-memory'
            }
        ]
    }

    /**
     * What the chips on offer were built for, `[field, values, declared]` as JSON; `null` while closed.
     * @member {String|null} offerKey=null
     * @protected
     */
    offerKey = null

    /** @param {...*} args */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.syncSeat()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetCatalog(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetConfigured(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
    }

    /** @param {String|null} value @param {String|null} oldValue */
    afterSetEditing(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetObserved(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
    }

    /** @param {String|null} value @param {String|null} oldValue */
    afterSetRefusal(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
    }

    /**
     * A new definition closes the values on offer and clears what belonged to the last one. A catalog belongs to a
     * seat's harness, so another seat or another harness on the same seat drops it.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetSeat(value, oldValue) {
        if (oldValue !== undefined) {
            const rebound = value?.id !== oldValue?.id || value?.harnessType !== oldValue?.harnessType;

            this.set({catalog: rebound ? null : this.catalog, editing: null, status: {state: 'idle', reason: ''}});
            this.syncSeat()
        }
    }

    /** @param {Object} value @param {Object} oldValue */
    afterSetStatus(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
    }

    /**
     * @summary The values a field offers. Desktop's Max preset needs no catalog or prior Start. For catalog-backed
     * fields, a Codex model's efforts belong to the
     * declared model, else to the configured one, else to the catalog's default. A model value names its entry by id
     * or slug ({@link AgentOS.util.SeatModel.findModel}).
     * @param {String} field
     * @returns {String[]|null} `null` where the harness names none (a `claude-code` model), or before a read
     */
    offered(field) {
        const {catalog, configured, seat} = this;

        if (seat?.harnessType === 'claude-desktop') {
            return field === 'reasoningEffort' && SeatModel.declarable(seat.harnessType, field) ? ['max'] : null
        }

        if (!catalog || catalog.state === 'unsupported' || catalog.state === 'unavailable' && !catalog.models?.length) return null;

        if (Array.isArray(catalog.efforts)) {
            return field === 'reasoningEffort' ? catalog.efforts : null
        }

        const declared = SeatModel.findModel(catalog, seat?.model);

        if (field === 'model') return catalog.models.filter(model => !model.hidden || model === declared).map(model => model.id);

        const model = (seat?.model ? declared : SeatModel.findModel(catalog, configured?.model)) ?? catalog.models.find(entry => entry.isDefault);

        return model?.efforts ?? null
    }

    /**
     * @summary Render the rows, the values on offer and the feedback from the current configs.
     */
    syncSeat() {
        const
            me      = this,
            seat    = me.seat,
            pending = me.status?.state === 'pending';

        // a refusal names the whole declaration, so it reads once: on the model row, or on the effort row alone
        const refusedField = seat?.model ? 'model' : 'reasoningEffort';

        for (const {field} of FIELDS) {
            const row = SeatModel.row({
                field,
                harnessType: seat?.harnessType ?? null,
                declared   : seat?.[field] ?? null,
                configured : me.configured,
                observed   : me.observed?.[field] ?? null,
                refused    : field === refusedField ? me.refusal : null
            });

            me.getReference(`${field}-line`).text = row.text;

            const adopts = row.actions.includes('adopt');

            me.getReference(`${field}-change`).set({disabled: pending, hidden: !row.actions.includes('change'), text: me.editing === field ? 'Close' : 'Change'});
            // a hidden link keeps its last words: renaming it while the row's other action leaves the DOM would race
            // that removal's update
            me.getReference(`${field}-adopt`).set({disabled: pending, hidden: !adopts, ...(adopts ? {text: `Adopt ${me.configured[field]}`} : {})})
        }

        const
            values        = me.editing ? me.offered(me.editing) : null,
            desktopEffort = seat?.harnessType === 'claude-desktop' && me.editing === 'reasoningEffort',
            free          = me.editing === 'model' && seat?.harnessType === 'claude-code',
            offer         = me.getReference('offer'),
            // a model declared by its slug presses the chip of the entry it names
            declared = me.editing === 'model' ? SeatModel.findModel(me.catalog, seat?.model)?.id ?? seat?.model ?? null : me.editing ? seat?.[me.editing] ?? null : null,
            // the chips are rebuilt only when what they offer changes: never under a click still being handled
            offerKey = me.editing && !free ? JSON.stringify([me.editing, values, declared]) : null;

        offer.hidden = !offerKey;

        if (offerKey && offerKey !== me.offerKey) {
            offer.removeAll();
            // the declared value, or the harness default where nothing is declared, is the pressed chip
            offer.add([
                ...(values ?? []).map(value => ({
                    module : Button,
                    cls    : ['fm-chip', 'fm-seat-model-value', declared === value ? 'is-selected' : 'is-selectable'],
                    handler: () => me.declare(me.editing, value),
                    text   : desktopEffort ? 'Max' : value
                })),
                {
                    module : Button,
                    cls    : ['fm-chip', 'fm-seat-model-default', declared ? 'is-selectable' : 'is-selected'],
                    handler: () => me.declare(me.editing, null),
                    text   : desktopEffort ? 'Use app default' : 'Use the harness default'
                }
            ]).forEach(chip => chip.changeVdomRootKey('aria-pressed', String(chip.cls.includes('is-selected'))))
        }

        me.offerKey = offerKey;
        offer.items.forEach(chip => chip.disabled = pending);

        me.getReference('free').hidden = !free;

        // open values the harness has not answered with: the line says why, in the read's own state
        const reading = me.editing && !values && !free;

        me.getReference('status-line').set({
            cls : ['fm-seat-model-status', `is-${reading ? me.catalog ? 'unavailable' : 'pending' : me.status?.state ?? 'idle'}`],
            text: reading ? me.catalog?.reason ?? 'Reading what the harness offers…' : pending ? me.status.reason || 'Saving…' : me.status?.reason ?? ''
        })
    }

    /**
     * @summary Hand a value to the owner, which declares it and sets the seat back; `null` hands the field back.
     * @param {String}      field
     * @param {String|null} value
     */
    declare(field, value) {
        this.fire('declareSeatModel', {field, value})
    }

    /**
     * @summary One click on a row's action: Change opens or closes its values, asking the owner for the catalog the
     * first time; Adopt declares what the config is set to.
     * @param {Object} data
     */
    onActionClick(data) {
        const
            me              = this,
            [field, action] = data.component.reference.split('-');

        if (action === 'change') {
            me.editing = me.editing === field ? null : field;
            me.editing && !me.catalog && !me.offered(me.editing) && me.fire('readSeatCatalog')
        } else {
            me.declare(field, me.configured?.[field] ?? null)
        }
    }

    /** @summary Declare the typed model id of a harness that takes any it accepts. */
    onFreeSave() {
        const value = String(this.getReference('free-model').value ?? '').trim();

        value && this.declare('model', value)
    }
}

export default Neo.setupClass(SeatModelContainer);
