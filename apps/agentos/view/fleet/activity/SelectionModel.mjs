import ListModel              from '../../../../../node_modules/neo.mjs/src/selection/ListModel.mjs';
import {FLEET_COCKPIT_SOURCES} from '../../../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

/**
 * The stream's open message is its list's one selection, so the row the detail reads wears the
 * cockpit's selection paint and `aria-selected`, which the buffered pool re-applies on recycle. Only a
 * message row takes it, and a click on the open row closes it. Keyboard: the list's Navigator moves
 * row focus with the arrows and turns Enter into a click on the focused row, so the keys open exactly
 * what the pointer opens; Escape closes. The mailbox mode opens nothing here: the stream disables the
 * list's selection while it reads it.
 *
 * @class AgentOS.view.fleet.activity.SelectionModel
 * @extends Neo.selection.ListModel
 */
class SelectionModel extends ListModel {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.activity.SelectionModel'
         * @protected
         */
        className: 'AgentOS.view.fleet.activity.SelectionModel',
        /**
         * @member {String} ntype='fm-activity-selection-model'
         * @protected
         */
        ntype: 'fm-activity-selection-model',
        /**
         * One open message beside the list.
         * @member {Boolean} singleSelect=true
         */
        singleSelect: true
    }

    /**
     * @summary Closes the open message: the selection clears, and the view hears the empty `select`
     * envelope the roster's model emits (`{records: [], selection}`), so the stream reads a close through
     * the seam it reads an open. A no-op with nothing open.
     */
    close() {
        const me = this;

        if (me.hasSelection()) {
            me.deselectAll();
            me.view.fire('select', {records: [], selection: me.items})
        }
    }

    /**
     * @summary A message row opens and the open one closes; a click on any other row leaves the open
     * message as it is.
     * @param {Object} data The delegated list click
     */
    onListClick(data) {
        const
            me     = this,
            {view} = me,
            record = view.store.get(view.getItemRecordId(data.currentTarget));

        if (view.disableSelection || record?.source !== FLEET_COCKPIT_SOURCES.a2a || !record.payload?.messageId) {
            return
        }

        me.isSelected(me.getSelectionItemId(record)) ? me.close() : me.select(record)
    }

    /**
     * @summary Escape closes the open message.
     * @param {Object} data The key event
     */
    onKeyDownEscape(data) {
        this.close()
    }
}

export default Neo.setupClass(SelectionModel);
