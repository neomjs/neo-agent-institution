import RowsGrid from './RowsGrid.mjs';
import TurnRowComponent from './TurnRowComponent.mjs';

/**
 * The drill register: one session's authored turn records through the buffered grid — the depth
 * below {@link AgentOS.view.fleet.memories.SummaryGrid}, same #40/#41 pattern (#44).
 *
 * @summary A headerless single-component-column grid of pooled
 * {@link AgentOS.view.fleet.memories.TurnRowComponent} cells. Derives nothing (turn rows carry no
 * grouping facts) and delegates nothing (the drill's back affordance is pane chrome, not a cell
 * control) — the base's one data path is the whole contract here.
 *
 * @class AgentOS.view.fleet.memories.TurnGrid
 * @extends AgentOS.view.fleet.memories.RowsGrid
 */
class TurnGrid extends RowsGrid {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.TurnGrid'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.TurnGrid',
        /**
         * @member {String} ntype='fm-memories-turn-grid'
         * @protected
         */
        ntype: 'fm-memories-turn-grid',
        /**
         * Keeps the memories skin anchors on the grid root; the SCSS collapses the header
         * toolbar — a headerless designed list, not a data table.
         * @member {String[]} baseCls=['fm-memories-turn-grid','neo-grid-container']
         */
        baseCls: ['fm-memories-turn-grid', 'neo-grid-container'],
        /**
         * Height-normed with `.fm-memories-turn-cell` (`fleet/memories/Container.scss`) — the fixed
         * row lattice contract; see {@link AgentOS.view.fleet.memories.SummaryGrid#rowHeight}.
         * @member {Number} rowHeight=104
         * @reactive
         */
        rowHeight: 104
    }

    /**
     * @summary One headerless component column: the designed turn row IS the cell. The factory
     * builds a FRESH `rowData` bag per call (the pooled-cell contract — see
     * {@link AgentOS.view.fleet.memories.TurnRowComponent}).
     */
    onConstructed() {
        this.columns = [{
            dataField: 'response',
            flex     : 1,
            component: ({record}) => ({
                module : TurnRowComponent,
                rowData: {
                    agentIdentity  : record.agentIdentity,
                    amountToolCalls: record.amountToolCalls,
                    miniSummary    : record.miniSummary,
                    prompt         : record.prompt,
                    response       : record.response,
                    timestamp      : record.timestamp
                }
            })
        }];

        super.onConstructed()
    }
}

export default Neo.setupClass(TurnGrid);
