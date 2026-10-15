import Base                    from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import TargetBinding           from './TargetBinding.mjs';
import {FLEET_COCKPIT_SOURCES} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

/**
 * The observer selector each Activity mode sends, keyed by the provider's `activityMode`: D19440's All / involves
 * me. `all` asks for the team breadth explicitly, so a deployment that holds a narrower sharing policy answers
 * `clamped`. The `mailbox` mode sends none: it is the ordinary read of the viewer's own mailbox, whose first page
 * the Brain also lends the roster as its lane source, so it stays the default.
 * @type {Object}
 */
const ACTIVITY_OBSERVERS = Object.freeze({
    'involves-me': Object.freeze({scope: 'involves-me'}),
    all          : Object.freeze({memorySharing: 'team', scope: 'all'})
});

/**
 * @summary The Activity feed's observer modes, owner-side: the explicit All A2A and involves-me reads over the
 * Brain's canonical observer contract (`fleetActivity({observer})` with its `a2a.observation` admission and
 * `a2a.continuation`), beside the ordinary mailbox feed.
 *
 * What the store holds belongs to one admission: the viewer, plane, scope, policy and grants the Brain hashes into
 * `observation.admissionKey`. A live answer under another admission empties the feed before its page lands, so no
 * row, count, continuation or open message of the old one survives. An answer whose A2A half admitted nothing
 * empties the expansion and reads unavailable. Older pages follow the held continuation, never a count of retained
 * rows, and land only under the admission that issued it; one that reports another admission retires the feed and
 * reads it again. A live page that more arrivals outran reopens the rows below it from its own continuation. An open
 * message is read under the same selector and lands only while that admission holds.
 *
 * The cockpit controller owns the state (`activityAdmissionKey`, `activityContinuation`,
 * `activityMessageReadGeneration`). The provider owns the mode (`activityMode`) and the published observation
 * (`activityObservation`).
 * @class AgentOS.util.ActivityObserver
 * @extends Neo.core.Base
 */
class ActivityObserver extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.ActivityObserver'
         * @protected
         */
        className: 'AgentOS.util.ActivityObserver'
    }

    /**
     * @summary Admit the metadata of an older observer page. The page lands only under the admission that
     * issued the continuation, and the continuation then advances to the page's own. A page reaches here only
     * while the feed that asked for it holds, so one that reports another valid admission means the admission
     * moved under the held rows: the feed is retired like a live answer's would be, and read again.
     * @param {Object} owner    The cockpit controller
     * @param {Object} answer   The page's answer, `{a2a}`
     * @param {Object} selector The selector the read sent
     * @returns {Boolean} Whether the page may land
     */
    static admitHistory(owner, {a2a}, selector) {
        const observation = ActivityObserver.observationOf(a2a, selector);

        if (observation?.admissionKey !== owner.activityAdmissionKey) {
            if (observation) {
                TargetBinding.clearActivity(owner, {rows: false});
                owner.loadActivity()
            }

            return false
        }

        owner.activityContinuation = a2a.continuation ?? null;
        owner.component.getStateProvider()?.setData({streamHistoryExhausted: !owner.activityContinuation});

        return true
    }

    /**
     * @summary Admit the A2A half of one live observer answer before its page lands, and return what may land.
     * Under the held admission the page merges, and the held continuation keeps the reader's place unless more
     * arrived than the page carries ({@link #reachesHeldRows}). Under another admission, or the first, the feed is
     * retired so the page replaces it in one transaction ({@link AgentOS.util.TargetBinding#clearActivity}), and the
     * answer's continuation becomes the held one. Without a valid observation of the requested scope (a refused or
     * failed A2A read, or a plane that answers no observer read) the expansion goes the same way, only the
     * other sources' facts land, and the A2A half reads unavailable.
     * @param {Object}      owner          The cockpit controller
     * @param {Object}      answer
     * @param {Object|null} answer.a2a     The answer's A2A metadata
     * @param {Object[]}    answer.counts
     * @param {Object[]}    answer.events
     * @param {String|null} answer.reason  The safe reason of a degraded answer
     * @param {Object}      selector       The selector the read sent
     * @returns {{counts: Object[], events: Object[]}}
     */
    static admitLive(owner, {a2a, counts, events, reason}, selector) {
        const
            provider    = owner.component.getStateProvider(),
            observation = ActivityObserver.observationOf(a2a, selector);

        if (!observation) {
            const other = item => item?.source !== FLEET_COCKPIT_SOURCES.a2a;

            TargetBinding.clearActivity(owner, {rows: false});
            provider?.setData({activityObservation: {clamped: false, policy: null, reason: reason || 'the plane answered no observer read', state: 'unavailable'}});

            return {counts: counts.filter(other), events: events.filter(other)}
        }

        if (observation.admissionKey !== owner.activityAdmissionKey) {
            TargetBinding.clearActivity(owner, {rows: false});
            owner.activityAdmissionKey = observation.admissionKey;
            owner.activityContinuation = a2a.continuation ?? null
        } else if (!ActivityObserver.reachesHeldRows(owner, events)) {
            owner.activityContinuation = a2a.continuation ?? null
        }

        provider?.setData({
            activityObservation   : {clamped: observation.clamped === true, policy: observation.policy, reason: null, state: 'admitted'},
            streamHistoryExhausted: !owner.activityContinuation
        });

        return {counts, events}
    }

    /**
     * @summary The older-page request the held continuation names, or `null` once the population has ended.
     * @param {Object} owner          The cockpit controller
     * @param {Object} options
     * @param {Number} options.limit  Rows per page
     * @param {Object} options.selector
     * @returns {Object|null} `{limit, observer, slots, offset}`
     */
    static historyRequest(owner, {limit, selector}) {
        const continuation = owner.activityContinuation;

        return continuation ? {limit, observer: selector, ...continuation} : null
    }

    /**
     * @summary The answer's admission, when it is a valid observation of the requested scope.
     * @param {Object|null} a2a      An answer's A2A metadata
     * @param {Object}      selector The selector the read sent
     * @returns {Object|null} The observation `{admissionKey, clamped, planeId, policy, scope, viewer}`
     * @protected
     */
    static observationOf(a2a, selector) {
        const observation = a2a?.observation;

        return observation?.scope === selector.scope && typeof observation.admissionKey === 'string' && observation.admissionKey
            ? observation
            : null
    }

    /**
     * @summary READ: one admitted message in full, read-only (`fleetOwnMessage` with the mode's selector, which
     * writes no receipt). The detail shows `loading` first. The answer lands only while the admission it was asked
     * under still holds and no later open superseded it, so an answer under another admission never shows its body.
     * A bridge without the verb reads `unavailable`, never an empty body.
     * @param {Object} owner          The cockpit controller
     * @param {Object} data
     * @param {String} data.messageId
     * @returns {Promise<void>}
     */
    static async open(owner, {messageId}) {
        const
            {bridge}   = owner,
            selector   = ActivityObserver.selectorOf(owner),
            key        = owner.activityAdmissionKey,
            generation = ++owner.activityMessageReadGeneration,
            write      = read => {
                const stream = owner.getReference('activity-stream');

                !owner.isDestroyed && generation === owner.activityMessageReadGeneration && owner.activityAdmissionKey === key &&
                    stream && (stream.messageRead = read)
            };

        if (!selector || !key) {
            return
        }

        write({messageId, state: 'loading'});

        if (typeof bridge?.fleetOwnMessage !== 'function') {
            write({messageId, reason: 'fleet: the message read is not wired', state: 'unavailable'});
            return
        }

        try {
            const answer = await bridge.fleetOwnMessage({messageId, observer: selector});

            if (answer?.messageId !== messageId) {
                write({code: answer?.code ?? null, messageId, reason: answer?.reason || 'the message read answered no message',
                    state: answer?.status === 'rejected' ? 'refused' : 'unavailable'})
            } else if (answer.observation?.admissionKey === key) {
                write({message: answer, messageId, state: 'ok'})
            } else {
                // the viewer, plane or policy moved under the open rows: the live read that empties them follows
                write({messageId, reason: 'the admission changed while the message was read', state: 'refused'});
                owner.loadActivity()
            }
        } catch (error) {
            write({code: error?.code ?? null, messageId, reason: error?.message || 'the message could not be read',
                state: error?.code === 'MAILBOX_OBSERVER_NOT_ADMITTED' || error?.fleetConnectionState === 'refused' ? 'refused' : 'unavailable'})
        }
    }

    /**
     * @summary Whether a live page under the held admission reaches the rows the feed already holds. When it
     * does, the held continuation still follows on from them, and arrivals shift in only rows that ids dedupe.
     * When none of its A2A rows is held, more arrived than one page carries, and the rows between the page and
     * the held ones are reachable only from the page's own continuation.
     * @param {Object}   owner  The cockpit controller
     * @param {Object[]} events The live page
     * @returns {Boolean}
     * @protected
     */
    static reachesHeldRows(owner, events) {
        const
            store = owner.resolveFleetActivityEventsStore(),
            rows  = events.filter(event => event?.source === FLEET_COCKPIT_SOURCES.a2a);

        return !rows.length || rows.some(event => store?.get(event.eventId))
    }

    /**
     * @summary The observer selector the provider's Activity mode sends, or `null` in the mailbox mode.
     * @param {Object} owner The cockpit controller
     * @returns {Object|null} A fresh `{scope, memorySharing?}`
     */
    static selectorOf(owner) {
        const mode = owner.component.getStateProvider()?.getData('activityMode');

        return Object.hasOwn(ACTIVITY_OBSERVERS, mode) ? {...ACTIVITY_OBSERVERS[mode]} : null
    }

    /**
     * @summary Switch the feed to another mode and read it at once. The feed is retired, so the old mode's rows
     * leave the view, and the new mode's first page replaces them in the store.
     * @param {Object} owner The cockpit controller
     * @param {String} mode  `mailbox`, `involves-me` or `all`
     * @returns {Boolean} Whether the mode changed
     */
    static switchMode(owner, mode) {
        const provider = owner.component.getStateProvider();

        if (!provider || (mode !== 'mailbox' && !Object.hasOwn(ACTIVITY_OBSERVERS, mode)) || provider.getData('activityMode') === mode) {
            return false
        }

        TargetBinding.clearActivity(owner, {rows: false});
        provider.setData({activityMode: mode});
        owner.loadActivity();

        return true
    }
}

export default Neo.setupClass(ActivityObserver);
