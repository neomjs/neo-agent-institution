import BaseList from '../../../../node_modules/neo.mjs/src/list/Base.mjs';
import NeoArray from '../../../../node_modules/neo.mjs/src/util/Array.mjs';

const
    STATES = Object.freeze({
        copy     : 'copy and verify',
        done     : 'already at destination',
        pending  : 'move consented',
        rebind   : 'bind destination',
        relocate : 'verify copied destination',
        rebound  : 'bound at destination',
        moved    : 'copied and bound',
        untouched: 'not moving',
        unknown  : 'state unavailable'
    }),
    safeState = state => Object.hasOwn(STATES, state) ? state : 'unknown',
    valueOr = (value, fallback) => typeof value === 'string' && value.length ? value : fallback;

/**
 * @class AgentOS.view.system.SeatMoveList
 * @extends Neo.list.Base
 *
 * @summary Renders the shell's reviewed move rows. The text sink receives source and destination
 * paths as text; the list never acts on a seat or owns transition state.
 */
class SeatMoveList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.system.SeatMoveList'
         * @protected
         */
        className: 'AgentOS.view.system.SeatMoveList',
        /**
         * @member {String} ntype='fm-seat-move-list'
         * @protected
         */
        ntype: 'fm-seat-move-list',
        /** @member {String[]} baseCls=['fm-seat-move-list','neo-list'] */
        baseCls: ['fm-seat-move-list', 'neo-list'],
        /** @member {Boolean} autoDestroyStore=false */
        autoDestroyStore: false,
        /**
         * @member {Boolean} disableSelection=true
         * @reactive
         */
        disableSelection: true
    }

    /**
     * @summary Marks the row with its closed move-state class.
     * @param {Object} record
     * @param {Number} index
     * @returns {Object|null}
     */
    createItem(record, index) {
        const item = super.createItem(record, index);

        if (item) {
            NeoArray.add(item.cls, ['fm-seat-move-row', `is-${safeState(record.state)}`])
        }

        return item
    }

    /**
     * @summary Renders every path, state and reason as text from the plan record.
     * @param {Object} record
     * @param {Number} index
     * @returns {Object[]}
     */
    createItemContent(record, index) {
        const
            id    = this.getItemId(this.getRecordId(record)),
            state = safeState(record.state),
            children = [{
                tag: 'div',
                id : `${id}__head`,
                cls: ['fm-seat-move-head'],
                cn : [
                    {tag: 'span', id: `${id}__agent`, cls: ['fm-seat-move-agent'], text: valueOr(record.id, 'unknown seat')},
                    {tag: 'span', id: `${id}__state`, cls: ['fm-seat-move-state'], text: STATES[state]}
                ]
            }, {
                tag: 'dl',
                id : `${id}__paths`,
                cls: ['fm-seat-move-paths'],
                cn : [
                    {tag: 'dt', id: `${id}__from-label`, text: 'from'},
                    {tag: 'dd', id: `${id}__from`,       text: valueOr(record.seatHome, 'no recorded seat home')},
                    {tag: 'dt', id: `${id}__to-label`,   text: 'to'},
                    {tag: 'dd', id: `${id}__to`,         text: valueOr(record.destination, state === 'untouched' ? 'unchanged by this move' : 'no destination')}
                ]
            }];

        if (record.code) {
            children.push({
                tag: 'p',
                id : id + '__code',
                cls: ['fm-seat-move-code'],
                text: record.code
            })
        }

        if (record.reason) {
            children.push({
                tag: 'p',
                id : `${id}__reason`,
                cls: ['fm-seat-move-reason'],
                text: record.reason
            })
        }

        if (record.materialized) {
            children.push({
                tag: 'p',
                id : `${id}__materialized`,
                cls: ['fm-seat-move-materialized'],
                text: 'Fleet-provisioned home'
            })
        }

        return children
    }
}

export default Neo.setupClass(SeatMoveList);
