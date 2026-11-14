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
     * @summary Whether `filter` narrows the scene (`query` or `kind` non-empty).
     * @param {Object|null} filter
     * @returns {Boolean}
     */
    static hasFilter(filter) {
        return ObservatoryNodeList.normalizeFilter(filter).active
    }

    /**
     * @summary Sorted distinct `kind` values present in `scene.nodes`, retaining `selectedKind` when active so a view
     * toggle that hides a kind never invalidates the current choice.
     * @param {Object|null} scene
     * @param {String|null} [selectedKind=null]
     * @returns {String[]}
     */
    static kindsOf(scene, selectedKind = null) {
        const kinds = new Set();

        for (const node of scene?.nodes ?? []) {
            node?.kind && kinds.add(node.kind)
        }

        selectedKind && kinds.add(selectedKind);

        return [...kinds].sort((a, b) => a.localeCompare(b, 'en-US'))
    }

    /**
     * @summary Whether `node` satisfies `filter` (`kind` exact match intersected with case-insensitive `label` or `id`
     * substring). An empty filter matches every node.
     * @param {Object|null} node
     * @param {Object|null} filter
     * @returns {Boolean}
     */
    static matchesNode(node, filter) {
        const {active, kind, queryLower} = filter?.active !== undefined ? filter : ObservatoryNodeList.normalizeFilter(filter);

        if (!active) {
            return true
        }

        if (!node || (kind && node.kind !== kind)) {
            return false
        }

        if (!queryLower) {
            return true
        }

        return Boolean(
            (node.label && String(node.label).toLowerCase().includes(queryLower)) ||
            (node.id    && String(node.id).toLowerCase().includes(queryLower))
        )
    }

    /**
     * @summary Normalizes `{query, kind}` into `{active, kind, query, queryLower}`.
     * @param {Object|null} filter
     * @returns {{active: Boolean, kind: String|null, query: String, queryLower: String}}
     */
    static normalizeFilter(filter) {
        const
            query      = typeof filter?.query === 'string' ? filter.query.trim() : '',
            queryLower = query.toLowerCase(),
            kind       = typeof filter?.kind === 'string' && filter.kind ? filter.kind : null;

        return {active: Boolean(queryLower || kind), kind, query, queryLower}
    }

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
        const {nodes} = scene;

        return ObservatoryNodeList.sortIndices(nodes.map((node, index) => index), nodes, by, relations, now)
    }

    /**
     * @summary Filters `scene.nodes` by `{query, kind}`, sorts the matching indices in {@link #orderOf}'s reading
     * order, and slices at `budget`, returning `{indices, matched, total}`. Filtering runs before sorting so a
     * 150,000-node scene scans linearly and sorts only the matches; an empty filter equals {@link #orderOf}.
     * @param {Object} scene An {@link AgentOS.util.ObservatorySceneLayout#fromGraphScene} scene
     * @param {'changed'|'relations'} by
     * @param {Uint32Array|Number[]} relations Per node, its relations in the read
     * @param {Object|null} [filter=null] `{query, kind}`
     * @param {Number} [budget=Infinity] Maximum listed indices
     * @param {Number} [now=Date.now()] Epoch ms
     * @returns {{indices: Number[], matched: Number, total: Number}}
     */
    static projectOf(scene, by, relations, filter = null, budget = Infinity, now = Date.now()) {
        const
            nodes                      = scene?.nodes ?? [],
            total                      = nodes.length,
            {active, kind, queryLower} = ObservatoryNodeList.normalizeFilter(filter);

        if (!active) {
            const ordered = ObservatoryNodeList.orderOf(scene, by, relations, now);

            return {
                indices: budget < ordered.length ? ordered.slice(0, budget) : ordered,
                matched: total,
                total
            }
        }

        const matchedIndices = [];

        for (let i = 0; i < total; i++) {
            const node = nodes[i];

            if (kind && node.kind !== kind) {
                continue
            }

            if (queryLower) {
                const
                    labelHit = node.label ? String(node.label).toLowerCase().includes(queryLower) : false,
                    idHit    = labelHit || (node.id ? String(node.id).toLowerCase().includes(queryLower) : false);

                if (!idHit) {
                    continue
                }
            }

            matchedIndices.push(i)
        }

        ObservatoryNodeList.sortIndices(matchedIndices, nodes, by, relations, now);

        return {
            indices: budget < matchedIndices.length ? matchedIndices.slice(0, budget) : matchedIndices,
            matched: matchedIndices.length,
            total
        }
    }

    /**
     * @summary Per-node incident edge count across `scene.edges` (self-loops counted once).
     * @param {Object|null} scene
     * @returns {Uint32Array}
     */
    static relationsOf(scene) {
        const counts = new Uint32Array(scene?.nodes?.length ?? 0);

        scene?.edges?.forEach(([from, to]) => {
            counts[from]++;
            from !== to && counts[to]++
        });

        return counts
    }

    /**
     * @summary Sorts `indices` in place by {@link #orderOf}'s comparator (`changed` or `relations`, ties in layout order).
     * @param {Number[]} indices
     * @param {Object[]} nodes
     * @param {'changed'|'relations'} by
     * @param {Uint32Array|Number[]} relations
     * @param {Number} [now=Date.now()]
     * @returns {Number[]} `indices`
     */
    static sortIndices(indices, nodes, by, relations, now = Date.now()) {
        const
            {heatEvents} = ObservatorySceneLayout,
            {windowMs}   = ObservatorySceneLayout.attention,
            at           = index => nodes[index].lastActivityAt ?? -Infinity,
            bearing      = index => heatEvents[nodes[index].kind] === true || heatEvents[nodes[index].kind] === 'open',
            changed      = index => bearing(index) && now - at(index) <= windowMs ? 1 : 0;

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
