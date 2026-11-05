import BaseList from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';

/**
 * @summary The Observatory's wells as a list: the path to a well's name that needs no canvas. Each row names a
 * well, counts its nodes and says `full` when the strategic walk's cap stopped it; the largest well leads. A click
 * or the arrow keys turn the camera to that well ({@link AgentOS.view.fleet.goldenpath.ObservatoryCanvas#flyTo});
 * no node moves and the graph selection stays. The owning
 * {@link AgentOS.view.fleet.goldenpath.ObservatoryWellsContainer} seats the store and reports the row; this list renders.
 *
 * @class AgentOS.view.fleet.goldenpath.ObservatoryWellList
 * @extends Neo.list.Base
 */
class ObservatoryWellList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryWellList'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryWellList',
        /**
         * @member {String} ntype='fm-observatory-well-list'
         * @protected
         */
        ntype: 'fm-observatory-well-list',
        /**
         * @member {String[]} baseCls=['fm-observatory-well-list','neo-list']
         */
        baseCls: ['fm-observatory-well-list', 'neo-list'],
        /**
         * The pane owns the projection store and destroys it with itself.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * A keyboard move clicks the row it lands on, so the camera follows the keys as it follows a click.
         * @member {Boolean} selectOnFocus=true
         */
        selectOnFocus: true
    }

    /**
     * @summary One row: the well's name, its node count, and `full` when the cap stopped it.
     * @param {AgentOS.model.GraphSceneWell} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        const {full, size} = record;

        return [
            {tag: 'span', cls: ['fm-observatory-row-label'], text: record.label ?? record.id},
            {tag: 'span', cls: ['fm-observatory-row-kind'],  text: `${size} node${size === 1 ? '' : 's'}`},
            ...(full ? [{tag: 'span', cls: ['fm-observatory-row-kind'], text: 'full'}] : [])
        ]
    }
}

export default Neo.setupClass(ObservatoryWellList);
