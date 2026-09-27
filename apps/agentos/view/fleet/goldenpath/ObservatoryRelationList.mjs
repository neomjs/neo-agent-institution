import BaseList from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';

/**
 * @summary The relations of the Observatory's selected node, one row each: the type exactly as the feed
 * carried it (`unspecified` where the graph named none, never an invented label), the direction, and the
 * node at the other end. Choosing a row — a click, or Enter on the focused row — moves the selection to that
 * node. The arrow keys only move the focus, so reading down the list never leaves the node being read.
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
        autoDestroyStore: false
    }

    /**
     * @summary One row: the relation type, `to` or `from`, and the other node's label and kind.
     * @param {AgentOS.model.GraphSceneRelation} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        return [
            {tag: 'span', cls: ['fm-observatory-row-place', ...(record.type ? [] : ['is-unspecified'])], text: record.type ?? 'unspecified'},
            {tag: 'span', cls: ['fm-observatory-row-direction'], text: record.direction === 'out' ? 'to' : 'from'},
            {tag: 'span', cls: ['fm-observatory-row-label'],     text: record.otherLabel ?? record.otherId},
            {tag: 'span', cls: ['fm-observatory-row-kind'],      text: record.otherKind ?? ''}
        ]
    }
}

export default Neo.setupClass(ObservatoryRelationList);
