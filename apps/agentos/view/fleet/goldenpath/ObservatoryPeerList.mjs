import BaseList from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';

/**
 * @summary The team lens's peers as a list of checks: each peer the Team section offers (the team, or everyone
 * the read attributes nodes to) is a row with its hue, its identity and how many of the read's nodes carry it,
 * busiest first. The rows are the engine's multi-select list:
 * a click checks a peer and a second click unchecks it, and the checked rows are the lens. The owning
 * {@link AgentOS.view.fleet.goldenpath.ObservatoryTeamContainer} seats the store, reads the selection and restores it
 * on a new read; this list renders.
 *
 * @class AgentOS.view.fleet.goldenpath.ObservatoryPeerList
 * @extends Neo.list.Base
 */
class ObservatoryPeerList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryPeerList'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryPeerList',
        /**
         * @member {String} ntype='fm-observatory-peer-list'
         * @protected
         */
        ntype: 'fm-observatory-peer-list',
        /**
         * @member {String[]} baseCls=['fm-observatory-peer-list','neo-list']
         */
        baseCls: ['fm-observatory-peer-list', 'neo-list'],
        /**
         * The pane owns the projection store and destroys it with itself.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * Several peers at once, and a click on a checked peer unchecks it.
         * @member {Object} selectionModel={ntype: 'selection-listmodel', singleSelect: false, toggleOnClick: true}
         * @reactive
         */
        selectionModel: {ntype: 'selection-listmodel', singleSelect: false, toggleOnClick: true},
        /**
         * The check in front of each row is the row's selection.
         * @member {Boolean} useCheckBoxes=true
         * @reactive
         */
        useCheckBoxes: true
    }

    /**
     * @summary One row: the peer's hue, its identity, the count of the read's nodes that carry it.
     * @param {AgentOS.model.GraphScenePeer} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        const {hue, id, nodes} = record;

        return [
            {tag: 'span', cls: ['fm-observatory-peer-swatch'], style: {'--fm-peer-hue': String(hue)}, 'aria-hidden': 'true'},
            {tag: 'span', cls: ['fm-observatory-row-label'],   text: id},
            {tag: 'span', cls: ['fm-observatory-row-kind'],    text: `${nodes} node${nodes === 1 ? '' : 's'}`}
        ]
    }
}

export default Neo.setupClass(ObservatoryPeerList);
