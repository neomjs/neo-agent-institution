import Button    from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';
import SeatModel from '../../../util/SeatModel.mjs';

/**
 * The Seat group's two rows, each with the record field it declares.
 * @type {Object[]}
 */
const FIELDS = [{field: 'model', label: 'model'}, {field: 'reasoningEffort', label: 'reasoning effort'}];

/**
 * @summary One row: its label, its line, and the actions its state offers.
 * @param {String} field
 * @param {String} label
 * @returns {Object}
 */
const seatRow = (field, label) => ({
    ntype    : 'container',
    cls      : ['fm-seat-model-row'],
    flex     : 'none',
    layout   : {ntype: 'hbox', align: 'center'},
    reference: `${field}-row`,
    items    : [
        {ntype: 'component', cls: ['fm-seat-model-label'], flex: 'none', text: label},
        {ntype: 'component', cls: ['fm-seat-model-line'],  flex: 1,      reference: `${field}-line`},
        ...['change', 'reapply', 'adopt'].map(action => ({
            module   : Button,
            cls      : ['fm-chip', `fm-seat-model-${action}`],
            flex     : 'none',
            handler  : 'up.onActionClick',
            hidden   : true,
            reference: `${field}-${action}`,
            text     : {change: 'Change', reapply: 'Re-apply', adopt: 'Adopt'}[action]
        }))
    ]
});

/**
 * @class AgentOS.view.fleet.detail.SeatModelContainer
 * @extends Neo.container.Base
 *
 * @summary Agent Detail › Configuration's Seat group: the model and reasoning effort declared for the seat's harness,
 * beside what its config is set to, in {@link AgentOS.util.SeatModel}'s words. Change offers only what the harness
 * itself names: a Codex seat's catalog, `claude-code`'s effort levels, and a model id for `claude-code`, which takes
 * any it accepts. A seat whose harness chooses both itself, the Claude app, offers no action.
 *
 * Like the commit-identity row it changes nothing itself. It fires `readSeatCatalog` for the values to offer, and
 * `declareSeatModel` with `{field, value}` (`null` hands the field back to the harness); its owner runs the round-trip
 * and sets `catalog`, `seat` and `status` back.
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
         * The fields whose drift the operator chose to keep the declaration for: the next Start writes it again.
         * @member {String[]} acknowledged_=[]
         * @reactive
         */
        acknowledged_: [],
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
         * Whether the seat's harness is running, so a difference reads as drift rather than as what Start applies.
         * @member {Boolean} running_=false
         * @reactive
         */
        running_: false,
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
         * Heading · the two rows · the values on offer · status line. Skin in `SeatModelContainer.scss`.
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
            }
        ]
    }

    /** @param {...*} args */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.syncSeat()
    }

    /** @param {String[]} value @param {String[]} oldValue */
    afterSetAcknowledged(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
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

    /** @param {Boolean} value @param {Boolean} oldValue */
    afterSetRunning(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
    }

    /**
     * A new definition closes the values on offer and clears what belonged to the last one.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetSeat(value, oldValue) {
        if (oldValue !== undefined) {
            const another = value?.id !== oldValue?.id;

            this.set({acknowledged: another ? [] : this.acknowledged, catalog: another ? null : this.catalog, editing: null, status: {state: 'idle', reason: ''}});
            this.syncSeat()
        }
    }

    /** @param {Object} value @param {Object} oldValue */
    afterSetStatus(value, oldValue) {
        oldValue !== undefined && this.syncSeat()
    }

    /**
     * @summary The values a field offers, from the catalog the harness answered: a Codex model's efforts belong to the
     * declared model, else to the configured one, else to the catalog's default.
     * @param {String} field
     * @returns {String[]|null} `null` where the harness names none (a `claude-code` model), or before a read
     */
    offered(field) {
        const {catalog, configured, seat} = this;

        if (!catalog || catalog.state === 'unsupported' || catalog.state === 'unavailable' && !catalog.models?.length) return null;

        if (Array.isArray(catalog.efforts)) {
            return field === 'reasoningEffort' ? catalog.efforts : null
        }

        const visible = catalog.models.filter(model => !model.hidden || model.id === seat?.model);

        if (field === 'model') return visible.map(model => model.id);

        const model = catalog.models.find(entry => entry.id === (seat?.model ?? configured?.model)) ?? catalog.models.find(entry => entry.isDefault);

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

        for (const {field} of FIELDS) {
            const
                acknowledged = me.acknowledged.includes(field),
                row          = SeatModel.row({
                    field,
                    harnessType: seat?.harnessType ?? null,
                    declared   : seat?.[field] ?? null,
                    configured : me.configured,
                    observed   : me.observed?.[field] ?? null,
                    running    : me.running && !acknowledged
                }),
                text = acknowledged && row.actions.includes('change') && seat?.[field] ? `declared ${seat[field]} · applies at next start` : row.text;

            me.getReference(`${field}-line`).text = text;

            for (const action of ['change', 'reapply', 'adopt']) {
                me.getReference(`${field}-${action}`).set({
                    disabled: pending,
                    hidden  : !row.actions.includes(action),
                    text    : action === 'change' && me.editing === field ? 'Close' : {change: 'Change', reapply: 'Re-apply', adopt: 'Adopt'}[action]
                })
            }
        }

        const
            values = me.editing ? me.offered(me.editing) : null,
            free   = me.editing === 'model' && seat?.harnessType === 'claude-code',
            offer  = me.getReference('offer');

        offer.hidden = !me.editing || free;

        if (me.editing && !free) {
            offer.removeAll();
            offer.add([
                ...(values ?? []).map(value => ({
                    module : Button,
                    cls    : ['fm-chip', 'fm-seat-model-value', ...(seat?.[me.editing] === value ? ['is-declared'] : [])],
                    handler: () => me.declare(me.editing, value),
                    text   : value
                })),
                {
                    module : Button,
                    cls    : ['fm-chip', 'fm-seat-model-default'],
                    handler: () => me.declare(me.editing, null),
                    text   : 'Use the harness default'
                }
            ])
        }

        me.getReference('free').hidden = !free;

        me.getReference('status-line').set({
            cls : ['fm-seat-model-status', `is-${me.status?.state ?? 'idle'}`],
            text: me.editing && !values && !free ? me.catalog?.reason ?? 'Reading what the harness offers…' : pending ? me.status.reason || 'Saving…' : me.status?.reason ?? ''
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
     * first time; Re-apply keeps the declaration for the next Start; Adopt declares what the config is set to.
     * @param {Object} data
     */
    onActionClick(data) {
        const
            me              = this,
            [field, action] = data.component.reference.split('-');

        if (action === 'change') {
            me.editing = me.editing === field ? null : field;
            me.editing && !me.catalog && me.fire('readSeatCatalog')
        } else if (action === 'reapply') {
            me.acknowledged = [...me.acknowledged, field]
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
