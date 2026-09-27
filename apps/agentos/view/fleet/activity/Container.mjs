import BufferedList from '../../../../../node_modules/neo.mjs/src/list/Buffered.mjs';
import Button       from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Component    from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import Container    from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import RowContainer from './RowContainer.mjs';
import ViewerTime   from '../../../util/ViewerTime.mjs';

const
    COUNT_SCOPES   = new Set(['last24h', 'total']),
    // a live feed whose newest event is older than this says so
    QUIET_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * @summary Formats only complete, source-qualified activity count rows.
 *
 * No aggregate is inferred. A mailbox total stays labelled `mailbox`; an absent/incomplete row
 * renders nothing. The full producer source and capture times remain in the title.
 * @param {Object[]} counts
 * @returns {{text:String,title:String}|null}
 */
export function describeActivityCounts(counts) {
    const complete = Array.isArray(counts) ? counts.filter(row =>
        typeof row?.source === 'string' && row.source
        && COUNT_SCOPES.has(row.scope)
        && row.complete === true
        && Number.isInteger(row.value) && row.value >= 0
        && !Number.isNaN(Date.parse(row.capturedAt))
    ) : [];

    if (!complete.length) {
        return null
    }

    const groups = new Map();

    complete.forEach(row => {
        const group = groups.get(row.source) || {};

        if (!group[row.scope] || Date.parse(row.capturedAt) >= Date.parse(group[row.scope].capturedAt)) {
            group[row.scope] = row;
            groups.set(row.source, group)
        }
    });

    const display = source => source === 'memory-core:mailbox' ? 'mailbox' : source;

    return {
        text: [...groups].map(([source, rows]) => {
            const values = [];

            rows.last24h && values.push(`${rows.last24h.value} / 24h`);
            rows.total   && values.push(`${rows.total.value} total`);

            return `${display(source)} · ${values.join(' · ')}`
        }).join('  |  '),
        title: complete
            .map(row => `${row.source} ${row.scope}=${row.value} captured ${row.capturedAt}`)
            .join('\n')
    }
}

/**
 * @summary States that a connected feed's newest event is old — a fact the connection word cannot carry.
 *
 * A successful read of old rows is still a live feed. The header cannot know whether the fleet was
 * quiet or a source stopped delivering, so it names the instant and both readings, and guesses neither.
 * The instant is absolute: a relative age would re-render every golden that shows this header.
 * @param {String|Number|Date|null} occurredAt The newest retained event's instant.
 * @param {Number} [now=Date.now()]
 * @returns {{text:String,title:String}|null} `null` for a fresh, absent or unparseable instant.
 */
export function describeQuietSince(occurredAt, now = Date.now()) {
    const stamp = ViewerTime.formatViewerTime(occurredAt, {now});

    if (!stamp || now - Date.parse(stamp.title) <= QUIET_AFTER_MS) {
        return null
    }

    return {
        text : `quiet since ${stamp.text}`,
        title: `The feed is connected, and its newest event is from ${stamp.title}: the fleet was quiet, or an activity source stopped delivering.`
    }
}

/**
 * @summary The Fleet cockpit's Store-backed, buffered activity history.
 *
 * The header, source counts and retention facts are stable chrome. The scroll seat is
 * {@link Neo.list.Buffered}: a fixed-height physical row pool over the provider-owned
 * {@link AgentOS.store.FleetActivityEvents} Store. New records at the leading edge preserve the
 * first visible record + pixel offset while history is being read and surface a `N new events`
 * affordance; at the top they arrive normally. Recycled history is excluded from the polite live
 * region, while one isolated announcer speaks only genuinely new producer ids.
 *
 * @class AgentOS.view.fleet.activity.Container
 * @extends Neo.container.Base
 */
class ActivityStream extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.activity.Container'
         * @protected
         */
        className: 'AgentOS.view.fleet.activity.Container',
        /**
         * @member {String} ntype='fm-activity-stream'
         * @protected
         */
        ntype: 'fm-activity-stream',
        /**
         * @member {String[]} baseCls=['fm-activity-stream']
         */
        baseCls: ['fm-activity-stream'],
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * Feed liveness: `cold`, `live`, `partial` answered data, or `stale` last-known data.
         * @member {String} adapterState_='cold'
         * @reactive
         */
        adapterState_: 'cold',
        /**
         * Roster facts supplied by the cockpit owner.
         * @member {Object} actorDirectory_={}
         * @reactive
         */
        actorDirectory_: {},
        /**
         * Producer-owned count rows. Incomplete rows remain absent from the header.
         * @member {Object[]} counts_=[]
         * @reactive
         */
        counts_: [],
        /**
         * Fixed pooled-row height in both wide and narrow grammar. 32 is the density contract the
         * stream's goldens pin: one line in the wide grammar, two 13px lines in the narrow one —
         * both grammars must fit INSIDE this pool height, since the buffered pool cannot vary
         * per-breakpoint without a resize-driven itemHeight update.
         * @member {Number} itemHeight=32
         */
        itemHeight: 32,
        /**
         * Provider-owned activity Store shared across pane projections.
         * @member {AgentOS.store.FleetActivityEvents|null} store_=null
         * @reactive
         */
        store_: null
    }

    /** @member {Boolean} hasObservedStore=false @protected */
    hasObservedStore = false
    /** @member {Set<String>} knownEventIds @protected */
    knownEventIds = new Set()
    /** @member {Number} pendingNewEventCount=0 @protected */
    pendingNewEventCount = 0
    /** @member {Number} announcementSequence=0 @protected */
    announcementSequence = 0

    /**
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        const me = this;

        me.add([{
            module   : Container,
            cls      : ['fm-stream-head'],
            flex     : 'none',
            // Without an explicit layout the container default (vbox) stamps neo-flex-direction-column
            // onto the element, which outranks the stylesheet's initial row direction — the header is
            // a single chrome BAR by contract: label left, counts/retention/state trailing.
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'header',
            items    : [{
                module   : Component,
                cls      : ['fm-stream-label'],
                flex     : 1,
                reference: 'label',
                text     : 'Live activity'
            }, {
                module   : Component,
                cls      : ['fm-stream-counts', 'is-empty'],
                reference: 'counts'
            }, {
                module   : Component,
                cls      : ['fm-stream-retention'],
                reference: 'retention'
            }, {
                module   : Component,
                cls      : ['fm-stream-state'],
                reference: 'state'
            }]
        }, {
            module   : Component,
            cls      : ['fm-stream-empty'],
            hidden   : true,
            reference: 'empty-note',
            text     : 'no activity yet'
        }, {
            module          : BufferedList,
            autoDestroyStore: false,
            bufferRowRange  : 4,
            cls             : ['fm-activity-list'],
            disableSelection: true,
            flex            : 1,
            itemConfig      : () => ({module: RowContainer, actorDirectory: me.actorDirectory}),
            itemHeight      : me.itemHeight,
            itemsFocusable  : false,
            reference       : 'list',
            useInternalId   : false,
            vdom            : {'aria-label': 'Fleet activity history', 'aria-live': 'off'}
        }, {
            module   : Button,
            cls      : ['fm-stream-new-events'],
            handler  : me.onNewEventsClick.bind(me),
            hidden   : true,
            reference: 'new-events'
        }, {
            module   : Component,
            cls      : ['fm-stream-announcer'],
            reference: 'announcer',
            role     : 'status',
            vdom     : {'aria-atomic': 'true', 'aria-live': 'polite'}
        }])
    }

    /** @param {String} value @param {String} oldValue @protected */
    afterSetAdapterState(value, oldValue) {
        this.isConstructed && this.updateHeader()
    }

    /** @param {Object} value @param {Object} oldValue @protected */
    afterSetActorDirectory(value, oldValue) {
        if (this.isConstructed) {
            this.getReference('list')?.items?.filter(Boolean).forEach(row => {
                row.actorDirectory = value
            })
        }
    }

    /** @param {Object[]} value @param {Object[]} oldValue @protected */
    afterSetCounts(value, oldValue) {
        this.isConstructed && this.updateHeader()
    }

    /**
     * @summary Binds the provider-owned Store into the buffered projection without transferring
     * ownership; the same Store survives pane retirement and re-projection.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetStore(value, oldValue) {
        const me = this;

        oldValue?.un('load', me.onActivityStoreLoad, me);
        value?.on('load', me.onActivityStoreLoad, me);

        if (me.isConstructed) {
            const list = me.getReference('list');

            list && (list.store = value);
            me.syncKnownEventIds(false);
            me.updateHeader()
        }
    }

    /** @param {Object[]} value @returns {Object[]} @protected */
    beforeSetCounts(value) {
        return Array.isArray(value) ? value : []
    }

    /**
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const me   = this,
              list = me.getReference('list');

        Object.assign(me.vdom, {'aria-label': 'Live fleet activity', role: 'log', tabIndex: 0});

        list?.on('createItems', me.onListCreateItems, me);
        list && (list.store = me.store);

        me.syncKnownEventIds(false);
        me.updateHeader()
    }

    /**
     * @summary Tracks genuinely new producer ids and keeps recycled history out of announcements.
     * @protected
     */
    onActivityStoreLoad() {
        this.syncKnownEventIds(true);
        this.updateHeader()
    }

    /**
     * @summary Clears the pending-new affordance when the operator returns to the leading edge.
     * @protected
     */
    onListCreateItems() {
        const list = this.getReference('list');

        if (list?.scrollTop === 0 && this.pendingNewEventCount > 0) {
            this.pendingNewEventCount = 0;
            this.updateNewEventsButton()
        }
    }

    /**
     * @summary Returns the buffered list to newest-first index zero.
     * @protected
     */
    onNewEventsClick() {
        const list = this.getReference('list');

        list?.scrollToIndex(0);
        this.pendingNewEventCount = 0;
        this.updateNewEventsButton()
    }

    /**
     * @summary Reconciles Store membership identity into announcement and history-anchor state.
     * @param {Boolean} announce
     * @protected
     */
    syncKnownEventIds(announce) {
        const
            me      = this,
            nextIds = new Set((me.store?.items || []).map(record => record.eventId)),
            newIds  = [...nextIds].filter(eventId => !me.knownEventIds.has(eventId)),
            list    = me.getReference('list');

        if (announce && me.hasObservedStore && newIds.length > 0) {
            const noun = newIds.length === 1 ? 'event' : 'events';

            if ((list?.scrollTop || 0) > 0) {
                me.pendingNewEventCount += newIds.length
            }

            // Alternate an invisible separator so equal-sized consecutive arrivals remain distinct
            // live-region mutations without changing the spoken sentence.
            me.announcementSequence++;
            me.getReference('announcer').text = `${newIds.length} new fleet activity ${noun}${me.announcementSequence % 2 ? '\u200b' : ''}`
        }

        me.knownEventIds  = nextIds;
        me.hasObservedStore = true;
        me.updateNewEventsButton()
    }

    /**
     * @summary Updates stable header components from liveness, source-count and local-retention truth.
     * A live feed over an old newest event says so beside its connection word ({@link describeQuietSince}).
     * @protected
     */
    updateHeader() {
        const
            me         = this,
            header     = me.getReference('header'),
            countsCell = me.getReference('counts'),
            stateCell  = me.getReference('state'),
            retained   = me.store?.count ?? 0,
            dropped    = me.store?.droppedCount ?? 0,
            countView  = describeActivityCounts(me.counts),
            stateWord  = {cold: 'not answered yet', partial: 'partial — some sources unavailable',
                stale: retained ? 'stale — reconnecting' : 'unavailable'}[me.adapterState],
            stateCls   = {cold: 'is-cold', partial: 'is-partial', stale: 'is-stale'}[me.adapterState] ?? 'is-live',
            // cold and stale already say their rows are not current; only a live feed can mislead
            quiet      = stateWord ? null : describeQuietSince(me.store?.getAt(0)?.occurredAt),
            stateText  = stateWord ?? (quiet ? `● streaming · ${quiet.text}` : '● streaming');

        if (!header || !countsCell || !stateCell) {
            return
        }

        header.cls = ['fm-stream-head', stateCls, ...(quiet ? ['is-quiet'] : [])];

        // the feed's own empty state: an ANSWER with no events says so in the list region; a cold
        // feed (no answer yet) leaves the region quiet — the head already says "not answered yet"
        me.getReference('empty-note').set({
            hidden: me.adapterState === 'cold' || retained > 0,
            text  : me.adapterState === 'live' ? 'no activity yet' : 'Activity unavailable'
        });

        countsCell.vdom.title = countView?.title ?? null;
        countsCell.set({
            cls : ['fm-stream-counts', ...(!countView ? ['is-empty'] : [])],
            text: countView?.text ?? ''
        });

        me.getReference('retention').text = `${retained} retained${dropped ? ` · ${dropped} dropped` : ''}`;

        stateCell.vdom.title = quiet?.title ?? null;
        stateCell.text       = stateText
    }

    /**
     * @summary Renders the history-reading affordance without stealing the viewport.
     * @protected
     */
    updateNewEventsButton() {
        const button = this.getReference('new-events'),
              count  = this.pendingNewEventCount;

        button?.set({
            hidden: count === 0,
            text  : count === 1 ? '1 new event ↑' : `${count} new events ↑`
        })
    }

    /**
     * @param {...*} args
     */
    destroy(...args) {
        const me = this;

        me.store?.un('load', me.onActivityStoreLoad, me);
        me.getReference('list')?.un('createItems', me.onListCreateItems, me);

        super.destroy(...args)
    }
}

export default Neo.setupClass(ActivityStream);
