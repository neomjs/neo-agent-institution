import RowModel from '../../../../../node_modules/neo.mjs/src/selection/grid/RowModel.mjs';

/**
 * @summary The mailbox grid's row selection: a click, or Up/Down, selects the message whose detail
 * opens under the list. A click on a thread head's toggle selects nothing, because that toggle is
 * display state only (the design page's interaction contract).
 * @class AgentOS.view.fleet.mailbox.RowModel
 * @extends Neo.selection.grid.RowModel
 */
class MailboxRowModel extends RowModel {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.mailbox.RowModel'
         * @protected
         */
        className: 'AgentOS.view.fleet.mailbox.RowModel'
    }

    /**
     * @param {Object} event The grid's `rowClick`
     */
    onRowClick(event) {
        const onToggle = (event.data?.path || []).some(node => node.cls?.includes('fm-mail-thread-toggle'));

        onToggle || super.onRowClick(event)
    }
}

export default Neo.setupClass(MailboxRowModel);
