import BaseList               from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import ObservatorySceneLayout from '../../../util/ObservatorySceneLayout.mjs';

/**
 * @summary The Observatory's nodes as a list: the path to the scene and its selection that needs no canvas.
 * Every node of the bounded read is a row, each naming its route rank or its distance from the route, its label and
 * its kind, and under the team lens what it is to its peer, in the peer's hue. The list leads with what changed
 * ({@link #orderOf}), its section's head names the order ({@link AgentOS.view.fleet.goldenpath.ObservatoryNodesHeadContainer}),
 * the arrow keys move the selection (`ArrowUp` at the top row returns focus to the head via `headFocus`), and `Enter`
 * or `Space` asks the pane to focus the selection's first action via `itemAction`. {@link #revealRecord} keeps a
 * selected row in view with one row of context below it. The owning
 * {@link AgentOS.view.fleet.goldenpath.ObservatoryContainer} seats the store, chooses the order and keeps the
 * selection in step with the canvas; this list renders.
 *
 * @class AgentOS.view.fleet.goldenpath.ObservatoryNodeList
 * @extends Neo.list.Base
 */
class ObservatoryNodeList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryNodeList'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryNodeList',
        /**
         * @member {String} ntype='fm-observatory-node-list'
         * @protected
         */
        ntype: 'fm-observatory-node-list',
        /**
         * @member {String[]} baseCls=['fm-observatory-node-list','neo-list']
         */
        baseCls: ['fm-observatory-node-list', 'neo-list'],
        /**
         * The pane owns the projection store and destroys it with itself.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * `Enter` and `Space` move focus to the selection's first action; `ArrowUp` on the first row returns to the head.
         * @member {Object} keys={Enter: 'onActionKey', Space: 'onActionKey', Up: 'onUpKey'}
         */
        keys: {Enter: 'onActionKey', Space: 'onActionKey', Up: 'onUpKey'},
        /**
         * A keyboard move selects the row it lands on, as a click does.
         * @member {Boolean} selectOnFocus=true
         */
        selectOnFocus: true
    }

    /**
     * {@link #revealRecord} owns row scrolling so a split selection keeps one row of context below the active row
     * and `Escape` returns focus without moving `scrollTop`; `Enter` and `Space` belong to {@link #keys}.
     * @member {Object} navigator={scrollIntoView: false, workerKeys: ['Enter', ' ']}
     */
    navigator = {scrollIntoView: false, workerKeys: ['Enter', ' ']}

    /**
     * @summary The order the list reads in. `changed` puts the nodes that changed within the attention window first,
     * counting only the kinds that carry attention ({@link AgentOS.util.ObservatorySceneLayout#heatEvents}), so a
     * message or a file never leads on a change alone, merged and closed work included; then every node by its last
     * activity, newest first. `relations` puts the nodes with the most relations in the read first. Ties keep the
     * scene's own order, the route's seeds first.
     * @param {Object} scene An {@link AgentOS.util.ObservatorySceneLayout#fromGraphScene} scene
     * @param {'changed'|'relations'} by
     * @param {Uint32Array|Number[]} relations Per node, its relations in the read
     * @param {Number} [now=Date.now()] Epoch ms
     * @returns {Number[]} The scene's node indices, in reading order
     */
    static orderOf(scene, by, relations, now = Date.now()) {
        const
            {heatEvents} = ObservatorySceneLayout,
            {windowMs}   = ObservatorySceneLayout.attention,
            {nodes}      = scene,
            at           = index => nodes[index].lastActivityAt ?? -Infinity,
            bearing      = index => heatEvents[nodes[index].kind] === true || heatEvents[nodes[index].kind] === 'open',
            changed      = index => bearing(index) && now - at(index) <= windowMs ? 1 : 0,
            indices      = nodes.map((node, index) => index);

        return by === 'relations'
            ? indices.sort((a, b) => relations[b] - relations[a] || a - b)
            : indices.sort((a, b) => changed(b) - changed(a) || at(b) - at(a) || a - b)
    }

    /**
     * @summary One row: the route rank or the hops from the route, the label, under the lens the node's role for
     * its peer in the peer's hue, and the kind.
     * @param {AgentOS.model.GraphSceneNode} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        const {hop, rank, role, roleHue} = record;

        return [
            {tag: 'span', cls: hop === 0 ? ['fm-observatory-row-place', 'is-route'] : ['fm-observatory-row-place'], text: hop === 0 ? `#${rank}` : hop === null ? '—' : `${hop} hop${hop === 1 ? '' : 's'}`},
            {tag: 'span', cls: ['fm-observatory-row-label'], text: record.label ?? record.id},
            ...(role ? [{tag: 'span', cls: ['fm-observatory-row-role'], style: {'--fm-peer-hue': String(roleHue)}, text: role}] : []),
            {tag: 'span', cls: ['fm-observatory-row-kind'],  text: record.kind ?? ''}
        ]
    }

    /**
     * @summary Enters the list from the `Nodes` head: focuses and selects the current selection when listed, else the
     * first row.
     * @param {String|null} [selectedId=null]
     * @returns {Promise<void>}
     */
    async enterFromHead(selectedId = null) {
        const me = this, record = (selectedId && me.store?.get(selectedId)) || me.store?.getAt(0);

        if (!record) {
            return
        }

        me.selectItem(record);
        !Neo.config.unitTestMode && me.mounted && await me.promiseUpdate();
        await me.updateItemFocus(record)
    }

    /**
     * @summary `Enter` or `Space` on a focused row asks the pane to move focus to the selection's first action.
     */
    onActionKey() {
        this.fire('itemAction')
    }

    /**
     * @summary `ArrowUp` on the first row returns focus to the `Nodes` head; lower rows belong to Navigator.
     * @param {Object} [data]
     */
    onUpKey(data) {
        const
            me     = this,
            itemId = data?.path?.find(entry => entry.cls?.includes('neo-list-item'))?.id ?? me.selectionModel?.items?.[0],
            record = itemId && me.store?.get(me.getItemRecordId(itemId));

        record && me.store.indexOf(record) === 0 && me.fire('headFocus')
    }

    /**
     * @summary Scrolls the list only as far as needed to keep `record` completely in view with one row of context
     * below it, without moving rows that already clear both bounds.
     * @param {AgentOS.model.GraphSceneNode|null} record
     * @returns {Promise<void>}
     */
    async revealRecord(record) {
        const me = this, {store} = me, index = record && store ? store.indexOf(record) : -1;

        if (index < 0 || !me.mounted || Neo.config.unitTestMode) {
            return
        }

        const
            itemId = me.getItemId(me.getRecordId(record)),
            next   = index + 1 < store.getCount() ? store.getAt(index + 1) : null,
            ids    = next ? [me.id, itemId, me.getItemId(me.getRecordId(next))] : [me.id, itemId],
            rects  = await Neo.main.DomAccess.getBoundingClientRect({id: ids, windowId: me.windowId}),
            [listRect, rowRect, nextRect] = Array.isArray(rects) ? rects : [];

        if (!listRect?.height || !rowRect?.height) {
            return
        }

        let delta = 0;

        if (rowRect.top < listRect.top) {
            delta = rowRect.top - listRect.top
        } else {
            const bottomEdge = (nextRect?.height ? nextRect : rowRect).bottom;

            if (bottomEdge > listRect.bottom) {
                delta = rowRect.height > listRect.height
                    ? rowRect.top - listRect.top
                    : Math.min(bottomEdge - listRect.bottom, rowRect.top - listRect.top)
            }
        }

        if (delta !== 0) {
            await Neo.main.DomAccess.scrollBy({behavior: 'instant', direction: 'top', id: me.id, value: delta, windowId: me.windowId})
        }
    }
}

export default Neo.setupClass(ObservatoryNodeList);
