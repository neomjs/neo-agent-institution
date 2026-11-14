import BaseList from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';

/**
 * @summary The relations of the Observatory's selected node, grouped by type and direction: a header row per
 * group names the type exactly as the feed carried it (`unspecified` where the graph named none, never an
 * invented label), `to` or `from`, and how many relations the group holds, and each row under it names the node
 * at the other end. Choosing a row, by a click or Enter on the focused row, moves the selection to that node;
 * a header moves nothing. The arrow keys only move the focus, so reading down the list never leaves the node
 * being read.
 *
 * @class AgentOS.view.fleet.goldenpath.ObservatoryRelationList
 * @extends Neo.list.Base
 */
class ObservatoryRelationList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryRelationList'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryRelationList',
        /**
         * @member {String} ntype='fm-observatory-relation-list'
         * @protected
         */
        ntype: 'fm-observatory-relation-list',
        /**
         * @member {String[]} baseCls=['fm-observatory-relation-list','neo-list']
         */
        baseCls: ['fm-observatory-relation-list', 'neo-list'],
        /**
         * The pane owns the projection store and destroys it with itself.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * The projection store carries a header record per group.
         * @member {Boolean} useHeaders=true
         * @reactive
         */
        useHeaders: true
    }

    /**
     * @summary The relations of `selectedId` in `scene`, seen from it, up to `listBudget`: grouped by type (an
     * untyped one last) and direction (outgoing first), each group under a header that counts the group in the whole
     * read, and in the feed's order within a group.
     * @param {Object} pane The Observatory pane's state
     * @param {Number} pane.listBudget
     * @param {Object} pane.scene
     * @param {String|null} pane.selectedId
     * @returns {Object[]}
     */
    static rowsOf({listBudget, scene, selectedId}) {
        const
            index     = selectedId && Object.hasOwn(scene.index, selectedId) ? scene.index[selectedId] : -1,
            groupOf   = relation => `${relation.type ?? '\uffff'}\u0000${relation.direction === 'out' ? 0 : 1}`,
            counts    = new Map(),
            rows      = [],
            relations = index < 0 ? [] : scene.edges.flatMap((pair, edge) => {
                if (!pair.includes(index)) {
                    return []
                }

                const other = scene.nodes[pair[0] === index ? pair[1] : pair[0]];

                return [{direction: pair[0] === index ? 'out' : 'in', otherId: other.id, otherKind: other.kind, otherLabel: other.label, type: scene.edgeTypes[edge] ?? null}]
            });

        relations.forEach(relation => counts.set(groupOf(relation), (counts.get(groupOf(relation)) ?? 0) + 1));

        // the budget cuts in the feed's order; a stable sort keeps that order within each group
        relations.slice(0, listBudget).sort((a, b) => groupOf(a) < groupOf(b) ? -1 : groupOf(a) > groupOf(b) ? 1 : 0).forEach((relation, at, listed) => {
            if (at === 0 || groupOf(listed[at - 1]) !== groupOf(relation)) {
                rows.push({count: counts.get(groupOf(relation)), direction: relation.direction, isHeader: true, type: relation.type})
            }

            rows.push(relation)
        });

        return rows.map((row, position) => ({...row, position}))
    }

    /**
     * @summary The base hook turns the whole list into a definition list (`dl`, `dt`, `dd`). This list stays the
     * flat `ul` of `li` rows it always was, with its headers as rows too, like the Tasks list: only the header
     * records' semantics apply.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetUseHeaders(value, oldValue) {
        // intentionally empty, see the summary
    }

    /**
     * @summary One row per record, a header `li` keeping the base's `neo-list-header` class.
     * @param {AgentOS.model.GraphSceneRelation} record
     * @param {Number} index
     * @returns {Object|null}
     */
    createItem(record, index) {
        const item = super.createItem(record, index);

        item && (item.tag = 'li');

        return item
    }

    /**
     * @summary A header names its group's type, direction and count; a row the other node's label and kind.
     * @param {AgentOS.model.GraphSceneRelation} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        if (record.isHeader) {
            return [
                {tag: 'span', cls: ['fm-observatory-row-place', ...(record.type ? [] : ['is-unspecified'])], text: record.type ?? 'unspecified'},
                {tag: 'span', cls: ['fm-observatory-row-direction'], text: record.direction === 'out' ? 'to' : 'from'},
                {tag: 'span', cls: ['fm-observatory-row-count'],     text: String(record.count)}
            ]
        }

        return [
            {tag: 'span', cls: ['fm-observatory-row-label'], text: record.otherLabel ?? record.otherId},
            {tag: 'span', cls: ['fm-observatory-row-kind'],  text: record.otherKind ?? ''}
        ]
    }
}

export default Neo.setupClass(ObservatoryRelationList);
