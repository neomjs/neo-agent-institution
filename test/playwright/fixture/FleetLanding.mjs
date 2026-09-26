import Base           from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import {isDescriptor} from '../../../node_modules/neo.mjs/src/core/ConfigSymbols.mjs';

/**
 * @summary The tests' fleet landing: loaded INTO the App worker through `Neo.worker.App.loadModule`,
 * it keeps one instance under a fixed id whose reactive configs a spec sets from the page through
 * `Neo.worker.App.setConfigs` — no remote of the App worker lands rows otherwise. A landed roster or
 * activity is handed to the liveness owner's own admission — `admitRoster` / `admitActivity`, the
 * methods its reads call after their fence and validation — as the answer of the bridge in hand, so
 * the owner's later reads treat it as the fleet's answer: a late seed `load` reconciles back to it, a
 * read that fails degrades it to `stale`, a profile switch retires it, and every step the admission
 * gains the landing gets. Every set lands — the configs compare nothing — so a spec re-lands the same
 * rows at will. Loading the module again (a fresh `t`) finds the instance and leaves it.
 *
 * @see apps/agentos/view/fleet/cockpit/LivenessController.mjs (`admitRoster`, `admitActivity`)
 */
class FleetLanding extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.test.FleetLanding'
         * @protected
         */
        className: 'AgentOS.test.FleetLanding',
        /**
         * The roster to land, `{rows}` shaped like the store's records.
         * @member {Object|null} roster_=null
         */
        roster_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * The activity to land, `{events}` shaped like the stream's snapshot.
         * @member {Object|null} activity_=null
         */
        activity_: {[isDescriptor]: true, value: null, isEqual: () => false}
    }

    /**
     * The mounted cockpit's liveness owner.
     * @member {AgentOS.view.fleet.cockpit.LivenessController} owner
     */
    get owner() {
        const owner = Neo.manager.Component.findFirst('ntype', 'fm-fleet-cockpit')?.getController();

        if (!owner) {
            throw new Error('FleetLanding: no fm-fleet-cockpit with its controller is mounted')
        }

        return owner
    }

    /**
     * @param {Object|null} value
     */
    afterSetActivity(value) {
        value && this.landActivity(value.events)
    }

    /**
     * @param {Object|null} value
     */
    afterSetRoster(value) {
        value && this.landRoster(value.rows)
    }

    /**
     * The events, admitted as a wired answer of the bridge in hand.
     * @param {Object[]} events
     */
    landActivity(events) {
        const {owner} = this;

        owner.admitActivity({events, profileId: owner.bridge?.profileId ?? null})
    }

    /**
     * The rows, admitted as an answer of the bridge in hand.
     * @param {Object[]} rows
     */
    landRoster(rows) {
        const {owner} = this;

        owner.admitRoster({profileId: owner.bridge?.profileId ?? null, rows})
    }
}

export default Neo.setupClass(FleetLanding);

Neo.get('fm-fleet-landing') || Neo.create(FleetLanding, {id: 'fm-fleet-landing'});
