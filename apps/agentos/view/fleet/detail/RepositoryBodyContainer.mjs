import Container         from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import RepositoryList    from './RepositoryList.mjs';
import SeatDependencies  from '../../../util/SeatDependencies.mjs';
import SeatRepositories  from '../../../store/SeatRepositories.mjs';
import SeatSessionFolder from '../../../util/SeatSessionFolder.mjs';

/**
 * @class AgentOS.view.fleet.detail.RepositoryBodyContainer
 * @extends Neo.container.Base
 *
 * @summary The body of Agent Detail's Repository pane: the seat's working repository, its whole clone path and
 * where a desktop session opened against it, then each checkout's preparation at the latest start. The checkouts
 * are {@link AgentOS.model.SeatRepository} records in the Accounts card's {@link AgentOS.view.fleet.detail.RepositoryList},
 * read-only here. Every line reads the roster record; the owning detail keeps the path's Copy action beside this body.
 */
class RepositoryBodyContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.RepositoryBodyContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.RepositoryBodyContainer',
        /**
         * @member {String} ntype='fm-detail-repository-body'
         * @protected
         */
        ntype: 'fm-detail-repository-body',
        /**
         * The body stacks its lines as a grid, so its children take no flex box.
         * @member {Object} layout={ntype:'base'}
         */
        layout: {ntype: 'base'},
        /**
         * The drilled-in resident's roster record ({@link AgentOS.model.FleetAgent}) or a field bag with its keys.
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * The facts read from the record, then the checkouts' list, hidden while no start reported one.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-detail-repo-facts'],
            reference: 'repo-facts'
        }, {
            module   : RepositoryList,
            editable : false,
            hidden   : true,
            reference: 'repo-checkouts',
            store    : {module: SeatRepositories}
        }]
    }

    /**
     * Triggered after the record config changed: a re-seat onto another resident re-renders.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        this.refresh()
    }

    /**
     * @summary Re-derive the body from the CURRENT record data. Public on purpose: a roster read changes the
     * record's fields without changing its identity, so the owning detail calls `refresh()` on every render.
     */
    refresh() {
        const
            me    = this,
            facts = me.getReference('repo-facts'),
            list  = me.getReference('repo-checkouts');

        // the record config applies before the items exist
        if (!facts) return;

        const
            {record}  = me,
            repoPath  = typeof record?.repoPath === 'string' && record.repoPath ? record.repoPath : null,
            session   = record ? SeatSessionFolder.paneText(record.sessionFolder, repoPath) : null,
            checkouts = record ? SeatDependencies.checkouts(record.dependencyOutcomes, record.repoOutcomes) : [];

        facts.vdom.cn = record ? [
            {tag: 'span', cls: ['fm-detail-repo-slug'], text: record.repoSlug || 'no repository declared'},
            ...(repoPath ? [{tag: 'span', cls: ['fm-detail-repo-path'], text: repoPath}] : []),
            ...(session  ? [{tag: 'span', cls: ['fm-detail-repo-session', `is-${record.sessionFolder.state}`], text: session}] : []),
            // an install still running belongs to the start pending now, every other row to the last one
            ...(checkouts.length ? [{
                tag : 'span',
                cls : ['fm-detail-repo-prep-head'],
                text: checkouts.some(row => row.state === 'installing') ? 'Preparation · this start' : 'Preparation · last start'
            }] : [])
        ] : [];
        facts.update();

        list.store.data = checkouts;
        list.hidden     = !checkouts.length
    }
}

export default Neo.setupClass(RepositoryBodyContainer);
