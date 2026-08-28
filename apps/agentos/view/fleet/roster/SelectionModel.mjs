import ListModel from '../../../../../node_modules/neo.mjs/src/selection/ListModel.mjs';

/**
 * The roster's selection semantics: single-select (one detail pane, one memories target — the
 * product contract), with the lifecycle-control carve-out — a click that lands inside a card's
 * control cluster (start/stop/restart) operates the agent and MUST NOT re-target the cockpit's
 * selection-driven panes, so those clicks never reach the base selection path. Keyboard: all four
 * arrows move item focus across the grid — Left/Right through the list's Navigator subscription
 * (the row-major flat order), Up/Down through this model's row hooks (±columns, live plugin
 * truth) — and Enter selects the focused row.
 *
 * @class AgentOS.view.fleet.roster.SelectionModel
 * @extends Neo.selection.ListModel
 */
class SelectionModel extends ListModel {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.roster.SelectionModel'
         * @protected
         */
        className: 'AgentOS.view.fleet.roster.SelectionModel',
        /**
         * @member {String} ntype='fm-roster-selection-model'
         * @protected
         */
        ntype: 'fm-roster-selection-model',
        /**
         * One selected resident at a time — multi-select has no product meaning here (one detail
         * inspector, one memories target).
         * @member {Boolean} singleSelect=true
         */
        singleSelect: true
    }

    /**
     * @summary The control-cluster carve-out: when the click path reaches a card's lifecycle
     * control cluster BEFORE the list item (i.e. the click landed inside the controls), the click
     * belongs to the lifecycle seam (`lifecycleIntent`) and selection stays untouched. Every other
     * item click selects through the base path.
     * @param {Object} data The delegated list click; `data.path` is the DOM path, innermost first.
     */
    onListClick(data) {
        const
            path         = data.path || [],
            {itemCls}    = this.view,
            controlIndex = path.findIndex(node => node.cls?.includes('fm-card-control-verbs')),
            itemIndex    = path.findIndex(node => node.cls?.includes(itemCls));

        if (controlIndex > -1 && (itemIndex === -1 || controlIndex < itemIndex)) {
            return
        }

        super.onListClick(data)
    }

    /**
     * @summary Enter selects the row the Navigator's item focus sits on (`view.focusIndex` is kept
     * current by the base `onListNavigate`). A no-op without a focused row.
     * @param {Object} data The key event.
     */
    onKeyDownEnter(data) {
        const {focusIndex} = this.view;

        Neo.isNumber(focusIndex) && focusIndex > -1 && this.selectAt(focusIndex)
    }

    /**
     * @summary ArrowDown moves item focus one visual ROW down (+columns in the row-major flat
     * order) — the grid's vertical axis, complementing the Navigator's horizontal pair.
     * @param {Object} data The key event.
     */
    onKeyDownDown(data) {
        this.navigateRow(1)
    }

    /**
     * @summary ArrowUp moves item focus one visual ROW up (−columns).
     * @param {Object} data The key event.
     */
    onKeyDownUp(data) {
        this.navigateRow(-1)
    }

    /**
     * @summary Move item focus by whole visual rows, through the ONE focus authority.
     *
     * The column count is live plugin truth — {@link Neo.list.plugin.Animate} re-derives it from
     * the list's own measured width on every resize — so vertical steps stay visually true through
     * every reflow; without the plugin (or at one column) the step degrades to the flat order.
     * Vertical edges are hard stops: a step that would leave the grid is a no-op, never a wrap and
     * never a column jump (the Navigator's own horizontal pair owns wrap semantics).
     *
     * The move DELEGATES to the list's own {@link Neo.list.Base#updateItemFocus}, which owns the
     * complete Navigator envelope: the top-level `windowId` the remote layer routes multi-window
     * calls by (a nested-only id would silently route a popped-out roster's focus to the main
     * window), the enriched subscription data block, headerless index translation, and the
     * not-yet-mounted replay.
     * @param {Number} step ±1 visual row.
     * @protected
     */
    navigateRow(step) {
        const
            {view}  = this,
            columns = view.getPlugin('plugin-list-animate')?.columns || 1,
            count   = view.store?.getCount() ?? 0,
            current = Neo.isNumber(view.focusIndex) ? view.focusIndex : -1,
            target  = current === -1 ? 0 : current + step * columns;

        if (count < 1 || (current !== -1 && (target < 0 || target >= count))) {
            return
        }

        view.updateItemFocus(target)
    }
}

export default Neo.setupClass(SelectionModel);
