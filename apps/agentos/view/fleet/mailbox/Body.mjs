import GridBody from '../../../../../node_modules/neo.mjs/src/grid/Body.mjs';

/**
 * The mailbox grid's body: the engine's `Neo.grid.Body` plus the one thing the pane needs to know
 * and the engine does not yet say — when the mounted window reaches the end of the loaded rows.
 *
 * @summary Fires `scrollEdge` once per entry into the store's last `bufferRowRange` rows, from the
 * same pass that computes the mounted and visible windows ({@link #updateMountedAndVisibleRows}),
 * so scrolling, a resize and a store change all reach it. The announcement is re-armed only by a
 * change of the VISIBLE count, the rows the viewport can reach: a viewport parked at the edge does
 * not fire on every scroll tick, an append that leaves it at the new edge fires once more, and a
 * store shorter than one window fires on its first layout, so a short first page still reaches its
 * consumer. An append the collapse filter hides entirely (fifty replies under one collapsed thread
 * head) does NOT re-arm it, deliberately: the viewport saw nothing move, and re-arming on the total
 * behind the filter would let a collapsed inbox walk itself window by window with no gesture — the
 * boot drain this seam exists to end, under another projection. The total travels on the event as
 * information. The pane turns the announcement into a window request under its own gate
 * (`page.hasMore`, one request in flight); this body decides nothing about data.
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
     * The visible count the edge was last announced for; `null` while the window is away from the
     * edge. The re-arm is a visible change, never a scroll tick and never the total behind the
     * filter.
     * @member {Number|null} edgeAnnouncedFor=null
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
            [start, endIndex] = me.visibleRows,
            atEdge           = count > 0 && endIndex + me.bufferRowRange >= count;

        if (!atEdge) {
            me.edgeAnnouncedFor = null
        } else if (me.edgeAnnouncedFor !== count) {
            me.edgeAnnouncedFor = count;
            me.fire('scrollEdge', {count, endIndex, startIndex: start, total: store?.allItems?.getCount?.() ?? count})
        }
    }
}

export default Neo.setupClass(Body);
