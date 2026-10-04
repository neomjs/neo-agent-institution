import BaseList             from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import MemoryCandidateStore from '../../../store/MemoryCandidates.mjs';
import AddAgentFlow         from '../../../util/AddAgentFlow.mjs';
import ViewerTime           from '../../../util/ViewerTime.mjs';

/**
 * @class AgentOS.view.fleet.instances.MemoryCandidateList
 * @extends Neo.list.Base
 *
 * @summary The memory choice for an added seat, one row per option: each existing agent's memory, its name
 * first, then its note count and its newest change; then *Start with empty memory* as the group's last
 * row. The memory folder's path never rides a row; the form shows it under Details for the chosen
 * candidate. The list owns its {@link AgentOS.store.MemoryCandidates} Store, which the form fills from the
 * Fleet's read (`AddAgentFlow.memoryChoices`); a click chooses one row, and the form reads the choice.
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
     * @summary One row per option: a candidate's name, then `N notes · last changed <when>` in the viewer's
     * own time, with the exact instant on the line's title. The empty-memory row is its name alone.
     * @param {Object} record An {@link AgentOS.model.MemoryCandidate} record.
     * @returns {Object[]} vdom child nodes
     */
    createItemContent(record) {
        if (record.source === AddAgentFlow.MEMORY_IMPORT_NONE) {
            return [{cls: ['fm-memory-candidate-name', 'is-empty-memory'], text: record.name}]
        }

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
