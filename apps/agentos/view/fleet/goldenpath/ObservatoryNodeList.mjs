import BaseList from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';

/**
 * @summary The Observatory's nodes as a list: the path to the scene and its selection that needs no canvas.
 * Every node of the bounded read is a row, the seeds first in route order, each naming its route rank or its
 * distance from the route, its label and its kind. The arrow keys move the selection. The owning
 * {@link AgentOS.view.fleet.goldenpath.ObservatoryContainer} seats the store and keeps the selection in step
 * with the canvas; this list renders.
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
         * A keyboard move selects the row it lands on, as a click does.
         * @member {Boolean} selectOnFocus=true
         */
        selectOnFocus: true
    }

    /**
     * @summary One row: the route rank or the hops from the route, the label, the kind.
     * @param {AgentOS.model.GraphSceneNode} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        const {hop, rank} = record;

        return [
            {tag: 'span', cls: ['fm-observatory-row-place'], text: hop === 0 ? `#${rank}` : hop === null ? '—' : `${hop} hop${hop === 1 ? '' : 's'}`},
            {tag: 'span', cls: ['fm-observatory-row-label'], text: record.label ?? record.id},
            {tag: 'span', cls: ['fm-observatory-row-kind'],  text: record.kind ?? ''}
        ]
    }
}

export default Neo.setupClass(ObservatoryNodeList);
