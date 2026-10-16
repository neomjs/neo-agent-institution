import BaseRowModel from '../../../../../node_modules/neo.mjs/src/selection/grid/RowModel.mjs';

/**
 * The memories registers' row selection model: row selection drives the pane's reading surface
 * ({@link AgentOS.view.fleet.memories.ReadingController#syncReader}) in the same synchronous turn,
 * which batches the pane's `.is-reading` class, the list rail width, the splitter, the reader, and
 * the register's `rail` lattice (`row.update(true, true)`) into one pane-level VDOM update.
 *
 * Both {@link #onRowClick} and {@link #onNavKeyRow} pass `silent = true` to the base selection
 * mutations (`toggleRowSelection` / `selectRow`) while still firing the View's `select` / `deselect`
 * events. Without `silent = true`, the clicked row dispatches its own standalone `row.update()`
 * flight BEFORE the pane enters `silentVdomUpdate = true`, causing `VDomUpdate` to defer the pane
 * batch behind the in-flight descendant so the selection paint and rail re-norm land on separate
 * frames.
 *
 * @class AgentOS.view.fleet.memories.RowModel
 * @extends Neo.selection.grid.RowModel
 */
class RowModel extends BaseRowModel {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.RowModel'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.RowModel',
        /**
         * @member {String} ntype='fm-memories-row-model'
         * @protected
         */
        ntype: 'fm-memories-row-model'
    }

    /**
     * @summary Step the selected row by `step` without dispatching a standalone row flight before
     * the pane's batched reading update ({@link AgentOS.view.fleet.memories.ReadingController#syncReader}).
     * @param {Number} step
     */
    onNavKeyRow(step) {
        const
            me           = this,
            {view}       = me,
            {store}      = view,
            countRecords = store.getCount(),
            firstId      = me.selectedRows[0] || view.getRecordId(store.getAt(0)),
            current      = me.getRowRecord(firstId),
            index        = store.indexOf(current);

        let newIndex = (index + step) % countRecords;

        while (newIndex < 0) {
            newIndex += countRecords
        }

        const record = store.getAt(newIndex);

        if (me.hasAnnotations(record)) {
            me.updateAnnotations(record)
        } else {
            const recordId = view.getRecordId(record);

            if (recordId) {
                me.selectRow(recordId, true);

                view.scrollByRows(index, step);
                view.fire('select', {record});
                me.fireRowSelectionChange()
            }
        }
    }

    /**
     * @summary Toggle the clicked row's selection silently so the row's own flight does not precede
     * the pane's batched reading update ({@link AgentOS.view.fleet.memories.ReadingController#syncReader}).
     * @param {Object} event
     */
    onRowClick(event) {
        const
            me     = this,
            {view} = me,
            {data} = event,
            record = event.record || me.getRecord(data.path);

        if (record) {
            if (me.hasAnnotations(record)) {
                me.updateAnnotations(record)
            } else {
                const recordId = view.getRecordId(record);

                me.toggleRowSelection(recordId, true);

                view.fire(me.isSelectedRow(recordId) ? 'select' : 'deselect', {record});
                me.fireRowSelectionChange()
            }
        }
    }
}

export default Neo.setupClass(RowModel);
