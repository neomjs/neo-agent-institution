import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary The Fleet cockpit's per-read liveness cadence: which wire reads one pass of the cadence
 * owner launches, and when each comes due again.
 *
 * Each read has its own interval because each answers a question that changes on its own scale — the
 * roster and the activity stream within a minute, the tasks, the deployment picture and the Brain's
 * health over minutes. Every one of them is a Memory Core call behind the fleet server, so one
 * shared fast tick made an open cockpit the plane's heaviest caller, and a slow plane then queued
 * every other seat behind it.
 *
 * A due read still launches while an earlier one of its wires hangs, up to the in-flight cap: that
 * probe is what notices a recovered transport. The bounded read window is far shorter than any
 * interval, so by the time a read comes due again its previous attempt has already been reported.
 *
 * The schedule is plain data and every method is pure: the controller holds the state, this class
 * decides.
 * @class AgentOS.util.LivenessCadence
 * @extends Neo.core.Base
 */
class LivenessCadence extends Base {
    /**
     * The interval (ms) each read comes due on.
     * @type {Object<String, Number>}
     */
    static DEFAULT_INTERVALS = Object.freeze({
        activity       : 60000,
        roster         : 60000,
        brainHealth    : 120000,
        tasks          : 120000,
        deploymentState: 120000
    })

    /**
     * The cadence owner's pass interval (ms): how often it checks which reads are due. A due read
     * launches on the first pass at or after its due time, so it can wait up to one pass past its
     * interval; a pass that launches nothing costs the fleet bridge nothing.
     * @type {Number}
     */
    static DEFAULT_PASS = 15000

    /**
     * Each liveness read: the controller method that launches it and the controller counter of its
     * unsettled wire reads.
     * @type {Object<String, {load: String, inFlight: String}>}
     */
    static READS = Object.freeze({
        activity       : Object.freeze({load: 'loadActivity',        inFlight: 'streamReadInFlight'}),
        roster         : Object.freeze({load: 'loadRoster',          inFlight: 'gridReadInFlight'}),
        brainHealth    : Object.freeze({load: 'loadBrainHealth',     inFlight: 'brainHealthReadInFlight'}),
        tasks          : Object.freeze({load: 'loadTasks',           inFlight: 'tasksReadInFlight'}),
        deploymentState: Object.freeze({load: 'loadDeploymentState', inFlight: 'deploymentStateReadInFlight'})
    })

    static config = {
        /**
         * @member {String} className='AgentOS.util.LivenessCadence'
         * @protected
         */
        className: 'AgentOS.util.LivenessCadence'
    }

    /**
     * @summary When each read comes due, starting from `now`. The cockpit issues every read at
     * mount, so none of them is due again before its interval.
     * @param {Number} now Epoch ms.
     * @param {Object<String, Number>} intervals Per-read intervals, keyed like {@link #READS}.
     * @returns {Object<String, Number>} Epoch ms per read key.
     */
    static create(now, intervals) {
        return Object.fromEntries(Object.keys(LivenessCadence.READS).map(key => [key, now + intervals[key]]))
    }

    /**
     * @summary Decide one pass of the cadence owner. A read that is due comes due again one interval
     * from `now`, and launches unless its unsettled wires already fill the cap.
     * @param {Object<String, Number>} dueAt The current schedule.
     * @param {Object} options
     * @param {Number} options.cap The in-flight cap per read.
     * @param {Function} options.inFlight `key => Number`: the read's unsettled wire reads.
     * @param {Object<String, Number>} options.intervals Per-read intervals, keyed like {@link #READS}.
     * @param {Number} options.now Epoch ms.
     * @returns {{launch: String[], dueAt: Object<String, Number>}} The read keys to launch now, and the next schedule.
     */
    static plan(dueAt, {cap, inFlight, intervals, now}) {
        const
            launch = [],
            next   = {...dueAt};

        Object.keys(LivenessCadence.READS).forEach(key => {
            if (now < next[key]) return;

            next[key] = now + intervals[key];
            inFlight(key) < cap && launch.push(key)
        });

        return {launch, dueAt: next}
    }
}

export default Neo.setupClass(LivenessCadence);
