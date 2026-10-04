import BaseList             from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import MemoryCandidateStore from '../../../store/MemoryCandidates.mjs';
import ViewerTime           from '../../../util/ViewerTime.mjs';

/**
 * @class AgentOS.view.fleet.instances.MemoryCandidateList
 * @extends Neo.list.Base
 *
 * @summary The existing agents' memory an added seat could continue, one row each: the agent's name first,
 * then its note count and its newest change. The memory folder's path never rides a row; the form shows it
 * under Details for the selected candidate. The list owns its {@link AgentOS.store.MemoryCandidates} Store,
 * which the form fills from the Fleet's read; a click selects one candidate, and the form reads the
 * selection.
 */
class MemoryCandidateList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.instances.MemoryCandidateList'
         * @protected
         */
        className: 'AgentOS.view.fleet.instances.MemoryCandidateList',
        /**
         * @member {String} ntype='fm-memory-candidate-list'
         * @protected
         */
        ntype: 'fm-memory-candidate-list',
        /**
         * @member {String[]} baseCls=['fm-memory-candidates','neo-list']
         */
        baseCls: ['fm-memory-candidates', 'neo-list'],
        /**
         * @member {Neo.data.Store} store=MemoryCandidateStore
         * @reactive
         */
        store: MemoryCandidateStore
    }

    /**
     * @summary One row per candidate: the name, then `N notes · last changed <when>` in the viewer's own
     * time, with the exact instant on the line's title.
     * @param {Object} record An {@link AgentOS.model.MemoryCandidate} record.
     * @returns {Object[]} vdom child nodes
     */
    createItemContent(record) {
        const
            changed = ViewerTime.formatViewerTime(record.lastChanged),
            notes   = `${record.notes} ${record.notes === 1 ? 'note' : 'notes'}`;

        return [
            {cls: ['fm-memory-candidate-name'], text: record.name || 'An unnamed agent'},
            {
                cls  : ['fm-memory-candidate-meta'],
                text : changed ? `${notes} · last changed ${changed.text}` : notes,
                title: changed?.title ?? null
            }
        ]
    }
}

export default Neo.setupClass(MemoryCandidateList);
