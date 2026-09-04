import AgentCard      from './card/Container.mjs';
import ComponentList  from '../../../../../node_modules/neo.mjs/src/list/Component.mjs';
import SelectionModel from './SelectionModel.mjs';

/**
 * The fleet roster as a real animated list — the store-driven replacement for the destroy/recreate
 * card rebuild: one {@link AgentOS.view.fleet.roster.card.Container AgentCard} INSTANCE per rendered
 * row, pooled by RECORD — a card's id and its `li`'s id derive from the record key, never from the
 * position, so the same DOM nodes survive a sort and the focus inside them survives with it. (The
 * base component list seats by index and renumbers on every rebuild — the calendar pattern — which
 * replaces the focused node the moment a joiner sorts ahead.) {@link Neo.list.plugin.Animate} owns
 * the geometry — a sort MOVES the surviving instances (translate transition), a filter fades rows
 * out and in, and the fluid column count derives from the list's own measured width
 * (`minItemWidth`), never the viewport.
 *
 * The card anatomy, its controller and the `lifecycleIntent` seam are untouched: this list only
 * changes WHO renders the rows. Selection is a first-class contract here
 * ({@link AgentOS.view.fleet.roster.SelectionModel}) — the item itself is the target, and a
 * lifecycle-control click is carved out of the selection path by that model, so operating an agent
 * never re-targets the cockpit's selection-driven panes.
 *
 * @class AgentOS.view.fleet.roster.List
 * @extends Neo.list.Component
 */
class List extends ComponentList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.roster.List'
         * @protected
         */
        className: 'AgentOS.view.fleet.roster.List',
        /**
         * @member {String} ntype='fm-fleet-roster-list'
         * @protected
         */
        ntype: 'fm-fleet-roster-list',
        /**
         * Keeps the shipped region cls: the skin's card-area anchors carry over to the list root.
         * @member {String[]} baseCls=['fm-fleet-cards','neo-list']
         */
        baseCls: ['fm-fleet-cards', 'neo-list'],
        /**
         * The plugin owns move/fade geometry; created via the sanctioned `animate` seam with
         * {@link #pluginAnimateConfig} below.
         * @member {Boolean} animate=true
         * @reactive
         */
        animate: true,
        /**
         * The roster Store is provider-owned (the cockpit's `stores.fleetRoster`) and seated by the
         * owning {@link AgentOS.view.fleet.roster.Container} — an injected store is never destroyed
         * by its renderer.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * The measured card anatomy constant (the uniform 126px row the shipped grid rendered) —
         * the fixed row height the plugin's translate geometry requires.
         * @member {Number} itemHeight=126
         * @reactive
         */
        itemHeight: 126,
        /**
         * Fluid columns from the LIST's own rendered surface, preserving the pane-layout-blindness
         * contract: this leaf knows neither its dock placement nor the viewport. The
         * plugin derives the column count from `minItemWidth` and writes the fluid per-item width
         * back — one squeezed column on a narrow dock slot, two at the shipped default, three on
         * the wide fleet view.
         * @member {Object} pluginAnimateConfig={minItemWidth:410}
         */
        pluginAnimateConfig: {minItemWidth: 410},
        /**
         * Selection is the product contract (one selected resident drives detail + memories), with
         * the lifecycle-control carve-out.
         * @member {Neo.selection.ListModel} selectionModel=SelectionModel
         * @reactive
         */
        selectionModel: SelectionModel,
        /**
         * Items and cards key by the record's store key (`agentId`), the one id form every reader of
         * this list already speaks — the selection model, the animate plugin, the cockpit's
         * `getItemId(agentId)` calls. The base list's internal record ids would be a second form
         * for the same row, and record-keyed DOM ids need exactly one.
         * @member {Boolean} useInternalId=false
         */
        useInternalId: false
    }

    /**
     * The grid is row-major, so DOM-order ±1 IS the horizontal neighbour: the Navigator's bound
     * axis pair is pinned to Left/Right explicitly — its layout auto-detection would fall back to
     * Up/Down (absolute-positioned items read as a vertical stack), which is exactly the one-axis
     * feel this grid outgrew. The vertical axis (±columns) lives in the SelectionModel's key hooks.
     * @member {Object} navigator={previousKey:'ArrowLeft',nextKey:'ArrowRight'}
     */
    navigator = {previousKey: 'ArrowLeft', nextKey: 'ArrowRight'}

    /**
     * @summary One pooled AgentCard per RECORD, for the record's lifetime: the card seated on this
     * record if there is one, else a new one whose id derives from the record key. A card is never
     * re-keyed onto another record — re-keying a live component breaks its reference tree — so a
     * rebuild that moved the record re-seats the same instance under the same id, and the DOM node
     * with the focus inside it survives. A record that left the store leaves its card behind the
     * rendered seats. The pool is kept in store order by swapping, because the plugin's geometry and
     * every reader of `items` take position `index` as the card of record `index`. The
     * `lifecycleIntent` listener stays a string: it resolves up the controller chain at fire time
     * (card → roster controller → cockpit controller), exactly like the shipped card config did.
     * @param {Object} record
     * @param {Number} index
     * @returns {Object[]} The list item vdom children.
     */
    createItemContent(record, index) {
        let me   = this,
            pool = me.items || [],
            key  = me.getRecordId(record),
            card = pool.find(item => item.record && me.getRecordId(item.record) === key),
            seat;

        if (card) {
            card.setSilent({record});
            // explicit: a record MUTATION re-enters here with the SAME record instance, which the
            // config equality gate would silently drop — applyRecord() is idempotent and renders
            // both the reseat and the mutation (the old grid called it per recordChange too)
            card.applyRecord()
        } else {
            card = Neo.create({
                appName  : me.appName,
                id       : me.getCardId(record),
                module   : AgentCard,
                listeners: {lifecycleIntent: 'onAgentLifecycleIntent'},
                parentId : me.id,
                record,
                windowId : me.windowId
            });

            pool.push(card)
        }

        seat = pool.indexOf(card);

        if (seat !== index && index < pool.length) {
            [pool[index], pool[seat]] = [pool[seat], pool[index]]
        }

        me.items       = pool;
        me.updateDepth = -1;

        return [card.createVdomReference()]
    }

    /**
     * @summary A record key as a DOM-id fragment, reversibly: every code unit outside `[A-Za-z0-9-]`
     * — the underscore included, so the encoding never produces its own escape — becomes
     * `_` + four hex digits. Agent ids are whatever the Brain accepted (`a__component`, a space, a
     * non-Latin name), and a DOM id built from them must neither collide with the list's own
     * `__item-` / `__card-` namespaces nor lose the key on the way back.
     * @param {String|Number} key
     * @returns {String}
     */
    static encodeKey(key) {
        return String(key).replace(/[^A-Za-z0-9-]/g, char => `_${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
    }

    /**
     * @summary The exact inverse of {@link #encodeKey}.
     * @param {String} encoded
     * @returns {String}
     */
    static decodeKey(encoded) {
        return encoded.replace(/_([0-9a-f]{4})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
    }

    /**
     * @summary The card id keys by record, never by position: `<list>__card-<encoded key>` — its own
     * namespace beside the list item's `__item-`, so no two agent ids can meet on one DOM id.
     * @param {Object} record
     * @returns {String}
     */
    getCardId(record) {
        return `${this.id}__card-${List.encodeKey(this.getRecordId(record))}`
    }

    /**
     * @summary The list item's id keys by record id — `<list>__item-<encoded key>`, not the component
     * list's store index — so the `li` around a card keeps its node across a sort. A record resolves
     * to its key first, the way the base list reads it; the selection model hands either form.
     * @param {Object|String|Number} recordOrId
     * @returns {String}
     */
    getItemId(recordOrId) {
        return `${this.id}__item-${List.encodeKey(recordOrId?.isRecord ? this.getRecordId(recordOrId) : recordOrId)}`
    }

    /**
     * @summary The inverse of {@link #getItemId}: the record key decoded from the item namespace.
     * @param {String} vnodeId
     * @returns {String}
     */
    getItemRecordId(vnodeId) {
        return List.decodeKey(vnodeId.slice(this.id.length + '__item-'.length))
    }

    /**
     * @summary A rebuild, then the pool's retirement pass: a card whose record has left the whole
     * fleet — not merely the filtered view — is destroyed and dropped, so the pool and the instance
     * registry stay bounded by the fleet's current cardinality across any number of join/leave
     * cycles. A filtered-out record is still in the store's unfiltered projection, and its card
     * keeps its seat behind the rendered ones for the day the filter lifts.
     * @param {Boolean} silent=false
     */
    createItems(silent=false) {
        let me = this;

        super.createItems(silent);

        if (me.items) {
            const whole = me.store.allItems ?? me.store;

            me.items = me.items.filter(card => {
                const alive = card.record && whole.get(me.getRecordId(card.record));

                !alive && card.destroy();

                return alive
            })
        }
    }

    /**
     * @summary Reorders the pool to follow the sorted records — WITHOUT nulling the ids the way the
     * component list does. Record-keyed ids cannot collide, and nulling them is exactly what turned
     * the plugin's move into a node replacement on the rebuild that follows the transition. Cards
     * whose records are not in the sorted set (filtered out, not yet reused) keep their seats behind.
     * @param {Object}   data
     * @param {Object[]} data.items         The sorted records
     * @param {Object[]} data.previousItems The records in their previous order
     */
    sortItems(data) {
        let me = this;

        if (me.items) {
            // by key from the pool itself, never by position in `previousItems`: a store with an
            // unfiltered projection hands the event a previous list that is already sorted
            const
                pool   = me.items,
                cardOf = record => pool.find(card => card.record && me.getRecordId(card.record) === me.getRecordId(record)),
                sorted = data.items.map(cardOf).filter(Boolean);

            me.items       = sorted.concat(pool.filter(card => !sorted.includes(card)));
            me.updateDepth = -1
        }
    }
}

export default Neo.setupClass(List);
