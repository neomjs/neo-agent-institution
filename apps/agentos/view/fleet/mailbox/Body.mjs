import GridBody from '../../../../../node_modules/neo.mjs/src/grid/Body.mjs';

/**
 * The mailbox grid's body: the engine's `Neo.grid.Body` plus the one thing the pane needs to know
 * and the engine does not yet say — when the mounted window reaches the end of the loaded rows.
 *
 * @summary Fires `scrollEdge` once per entry into the store's last `bufferRowRange` rows, from the
 * same pass that computes the mounted and visible windows ({@link #updateMountedAndVisibleRows}),
 * so scrolling, a resize and a store change all reach it. The announcement is re-armed only by a
 * change of the store's size — its visible count OR its total behind the filter: a viewport parked
 * at the edge does not fire on every scroll tick, an append that leaves it at the new edge fires
 * once more, an append the collapse filter hides entirely (fifty replies under one collapsed
 * thread head) still fires, because the corpus moved even though no row did, and a store shorter
 * than one window fires on its first layout, so a short first page still reaches its consumer. The
 * pane turns the announcement into a window request under its own gate (`page.hasMore`, one
 * request in flight); this body decides nothing about data.
 *
 * Interim by design: the engine's own body is to publish the same event, and the pin that carries
 * it retires this class; the grid's relay and the pane's handler stay as they are.
 *
 * @class AgentOS.view.fleet.mailbox.Body
 * @extends Neo.grid.Body
 */
class Body extends GridBody {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.mailbox.Body'
         * @protected
         */
        className: 'AgentOS.view.fleet.mailbox.Body',
        /**
         * @member {String} ntype='fm-mailbox-body'
         * @protected
         */
        ntype: 'fm-mailbox-body'
    }

    /**
     * The store size the edge was last announced for, `visible/total`; `null` while the window is
     * away from the edge. The re-arm is a size change, never a scroll tick; the total is in the key
     * so a window the filter hides entirely still re-arms it.
     * @member {String|null} edgeAnnouncedFor=null
     * @protected
     */
    edgeAnnouncedFor = null

    /**
     * @summary After the engine's window math: at the edge and not yet announced for this count,
     * fire `scrollEdge`; away from the edge, re-arm.
     * @protected
     */
    updateMountedAndVisibleRows() {
        super.updateMountedAndVisibleRows();

        let me               = this,
            {store}          = me,
            count            = store?.count ?? 0,
            total            = store?.allItems?.getCount?.() ?? count,
            size             = `${count}/${total}`,
            [start, endIndex] = me.visibleRows,
            atEdge           = count > 0 && endIndex + me.bufferRowRange >= count;

        if (!atEdge) {
            me.edgeAnnouncedFor = null
        } else if (me.edgeAnnouncedFor !== size) {
            me.edgeAnnouncedFor = size;
            me.fire('scrollEdge', {count, endIndex, startIndex: start, total})
        }
    }
}

export default Neo.setupClass(Body);
