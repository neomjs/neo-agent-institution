import BaseList               from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import ObservatorySceneLayout from '../../../util/ObservatorySceneLayout.mjs';

/**
 * @summary The Observatory's nodes as a list: the path to the scene and its selection that needs no canvas.
 * Every node of the bounded read is a row, each naming its route rank or its distance from the route, its label and
 * its kind, and under the team lens what it is to its peer, in the peer's hue. The list leads with what changed
 * ({@link #orderOf}), its section's head names the order ({@link AgentOS.view.fleet.goldenpath.ObservatoryNodesHeadContainer}),
 * and the arrow keys move the selection. The owning
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
         * A keyboard move selects the row it lands on, as a click does.
         * @member {Boolean} selectOnFocus=true
         */
        selectOnFocus: true
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
}

export default Neo.setupClass(ObservatoryNodeList);
