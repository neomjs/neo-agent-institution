import BufferedList    from '../../../../../node_modules/neo.mjs/src/list/Buffered.mjs';
import Button          from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Component       from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import Container       from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import DetailContainer from '../mailbox/DetailContainer.mjs';
import RowContainer    from './RowContainer.mjs';
import SelectionModel  from './SelectionModel.mjs';
import Splitter        from '../../../../../node_modules/neo.mjs/src/component/Splitter.mjs';
import ViewerTime      from '../../../util/ViewerTime.mjs';
import {FLEET_COCKPIT_SOURCES} from '../../../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

const
    COUNT_SCOPES   = new Set(['last24h', 'total']),
    // a live feed whose newest event is older than this says so
    QUIET_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * @summary The Activity modes in the head's order, each with the word its chip and the source line use: the
 * viewer's own `mailbox`, or the observer reads `involves me` and `all A2A` ({@link AgentOS.util.ActivityObserver}).
 * @type {Object}
 */
export const ACTIVITY_MODE_LABELS = Object.freeze({mailbox: 'mailbox', 'involves-me': 'involves me', all: 'all A2A'});

/**
 * @summary Formats only complete, source-qualified activity count rows.
 *
 * No aggregate is inferred. A mailbox total stays labelled with the population it counts (`mailbox`, or
 * the observer mode's word); an absent/incomplete row renders nothing. The full producer source and
 * capture times remain in the title.
 * @param {Object[]} counts
 * @param {String} [mailboxLabel='mailbox'] The word for the mailbox source's population
 * @returns {{text:String,title:String}|null}
 */
export function describeActivityCounts(counts, mailboxLabel = 'mailbox') {
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

    const display = source => source === FLEET_COCKPIT_SOURCES.a2a ? mailboxLabel : source;

    return {
        text: [...groups].map(([source, rows]) => {
            const values = [];

            rows.last24h && values.push(`${rows.last24h.value.toLocaleString('en-US')} / 24h`);
            rows.total   && values.push(`${rows.total.value.toLocaleString('en-US')} total`);

            return `${display(source)} · ${values.join(' · ')}`
        }).join('  |  '),
        title: complete
            .map(row => `${row.source} ${row.scope}=${row.value} captured ${row.capturedAt}`)
            .join('\n')
    }
}

/**
 * @summary States what an observer mode's read could not admit, or the sharing policy that bounds it. The
 * policy line names the limit and never a count of what it hides; a successful empty read needs no line,
 * since its source count reads zero.
 * @param {String} mode The Activity mode
 * @param {Object|null} observation `{clamped, policy, reason, state}` as the provider holds it
 * @returns {{cls:String,text:String,title:String|null}|null} `null` for the mailbox mode and for a team read
 */
export function describeActivityObservation(mode, observation) {
    const label = ACTIVITY_MODE_LABELS[mode];

    if (mode === 'mailbox' || !label) {
        return null
    }

    if (observation?.state === 'unavailable') {
        return {cls: 'is-unavailable', text: `${label} unavailable · ${observation.reason}`, title: null}
    }

    if (observation?.state === 'admitted' && mode === 'all' && observation.policy !== 'team') {
        return {
            cls  : 'is-limited',
            text : `${label} · ${observation.policy} sharing policy: only messages you may already read`,
            title: observation.clamped ? `The team breadth was asked; this deployment answers with its ${observation.policy} policy.` : null
        }
    }

    return null
}

/**
 * @summary States what the feed itself holds: its newest rows, and whether older ones are reachable.
 * A source's population is never this statement; the source line under the head carries those.
 * @param {Object} options
 * @param {Number} options.retained Rows the store holds.
 * @param {Number} [options.dropped=0] Rows the store's ring evicted.
 * @param {Boolean} [options.exhausted=false] The mailbox answered an older page with no row.
 * @param {Boolean} [options.full=false] The ring holds its maximum, so no older page is asked.
 * @returns {String} Empty while no row is held.
 */
export function describeActivityRetention({retained, dropped = 0, exhausted = false, full = false}) {
    if (!retained) {
        return ''
    }

    const text = exhausted && !dropped
        ? `all ${retained.toLocaleString('en-US')} shown`
        : `newest ${retained.toLocaleString('en-US')} · ${full ? 'older not kept' : exhausted ? 'no older events' : 'older on scroll'}`;

    return dropped ? `${text} · ${dropped.toLocaleString('en-US')} dropped` : text
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
 * The head's chips choose the A2A population the feed reads, the provider-owned {@link #mode}: the
 * viewer's own mailbox, or the observer reads involves me and all A2A. A chip only asks; the owner
 * switches the mode and retires the old population. In an observer mode a message row opens beside
 * the list in the mailbox's shared {@link AgentOS.view.fleet.mailbox.DetailContainer}, entered as
 * `observer`, so it is read-only. The open message is the list's one selection
 * ({@link AgentOS.view.fleet.activity.SelectionModel}), opened by a click or by Enter on the focused row
 * and closed by Escape. The owner reads the body and writes it back as {@link #messageRead}; the detail
 * closes when its row leaves the store, which every change of authority empties.
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
         * @member {String[]} baseCls=['fm-activity-stream','fm-pane']
         */
        baseCls: ['fm-activity-stream', 'fm-pane'],
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
         * Producer-owned count rows. Incomplete rows remain absent from the source line.
         * @member {Object[]} counts_=[]
         * @reactive
         */
        counts_: [],
        /**
         * Partial-feed guidance derived once from `capability.slots` by admission and bound from the provider.
         * @member {Object|null} guidance_=null
         * @reactive
         */
        guidance_: null,
        /**
         * Whether the mailbox answered an older page with no row: the stream then stops asking.
         * @member {Boolean} historyExhausted_=false
         * @reactive
         */
        historyExhausted_: false,
        /**
         * Fixed pooled-row height in both wide and narrow grammar. 32 is the density contract the
         * stream's goldens pin: one line in the wide grammar, two 13px lines in the narrow one —
         * both grammars must fit INSIDE this pool height, since the buffered pool cannot vary
         * per-breakpoint without a resize-driven itemHeight update.
         * @member {Number} itemHeight=32
         */
        itemHeight: 32,
        /**
         * The owner's body read of the open message, passed to the detail. Owner-written, never fetched here.
         * @member {Object|null} messageRead_=null
         * @reactive
         */
        messageRead_: null,
        /**
         * The A2A population the feed reads ({@link ACTIVITY_MODE_LABELS}), bound from the provider.
         * @member {'mailbox'|'involves-me'|'all'} mode_='mailbox'
         * @reactive
         */
        mode_: 'mailbox',
        /**
         * What the observer read answered, bound from the provider: `{clamped, policy, reason, state}`.
         * @member {Object|null} observation_=null
         * @reactive
         */
        observation_: null,
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
            cls      : ['fm-pane-head', 'fm-stream-head'],
            flex     : 'none',
            // Without an explicit layout the container default (vbox) stamps neo-flex-direction-column
            // onto the element, which outranks the stylesheet's initial row direction — the header is
            // a single chrome BAR by contract: label left, counts/retention/state trailing.
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'header',
            items    : [{
                module   : Component,
                cls      : ['fm-pane-title'],
                flex     : 1,
                reference: 'label',
                text     : 'Live activity'
            }, {
                module   : Component,
                cls      : ['fm-stream-retention'],
                reference: 'retention'
            }, {
                module   : Component,
                cls      : ['fm-stream-state'],
                reference: 'state'
            }, {
                // the A2A population the feed reads: the shell's ghost chips, the pressed one in view
                module   : Container,
                cls      : ['fm-pane-actions', 'fm-stream-modes'],
                flex     : 'none',
                layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
                reference: 'modes',
                items    : Object.entries(ACTIVITY_MODE_LABELS).map(([mode, text]) => ({
                    module         : Button,
                    cls            : ['fm-stream-mode-chip'],
                    handler        : me.onModeClick.bind(me, mode),
                    reference      : `mode-${mode}`,
                    text,
                    ui             : 'ghost',
                    useRippleEffect: false
                }))
            }]
        }, {
            // the sources' own populations, below the head: never the feed's count
            module   : Component,
            cls      : ['fm-pane-meta', 'fm-stream-sources', 'is-empty'],
            flex     : 'none',
            reference: 'counts'
        }, {
            // what an observer read could not admit, or the policy bounding it
            module   : Component,
            cls      : ['fm-pane-meta', 'fm-stream-observer'],
            flex     : 'none',
            hidden   : true,
            reference: 'observer-note'
        }, {
            module   : Component,
            cls      : ['fm-stream-empty'],
            hidden   : true,
            reference: 'empty-note',
            text     : 'no activity yet'
        }, {
            // the rows beside the open message, the mailbox's reading split: the list two shares, the detail one
            module   : Container,
            cls      : ['fm-stream-body'],
            flex     : 1,
            layout   : {ntype: 'hbox', align: 'stretch'},
            reference: 'stream-body',
            items    : [{
                module          : BufferedList,
                autoDestroyStore: false,
                bufferRowRange  : 4,
                cls             : ['fm-activity-list'],
                disableSelection: me.mode === 'mailbox',
                flex            : 2,
                itemConfig      : () => ({module: RowContainer, actorDirectory: me.actorDirectory}),
                itemHeight      : me.itemHeight,
                reference       : 'list',
                selectionModel  : SelectionModel,
                useInternalId   : false,
                vdom            : {'aria-label': 'Fleet activity history', 'aria-live': 'off'}
            }, {
                module      : Splitter,
                cls         : ['fm-stream-splitter'],
                hidden      : true,
                reference   : 'stream-splitter',
                resizeTarget: 'previous'
            }, {
                module   : DetailContainer,
                flex     : 1,
                hidden   : true,
                reference: 'stream-detail'
            }]
        }, {
            module   : Button,
            cls      : ['fm-stream-new-events'],
            handler  : me.onNewEventsClick.bind(me),
            hidden   : true,
            reference: 'new-events',
            ui       : 'ghost'
        }, {
            module   : Component,
            cls      : ['fm-stream-announcer'],
            reference: 'announcer',
            role     : 'status',
            vdom     : {'aria-atomic': 'true', 'aria-live': 'polite'}
        }])
    }

    /**
     * Triggered after the feed's liveness changed. A cold feed was retired or never answered: it shows no
     * row ({@link #updateHeader}), so nothing it held stays open.
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetAdapterState(value, oldValue) {
        const me = this;

        if (me.isConstructed) {
            value === 'cold' && me.getReference('list').selectionModel.deselectAll();
            me.applyDetail();
            me.updateHeader()
        }
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

    /** @param {Boolean} value @param {Boolean} oldValue @protected */
    afterSetHistoryExhausted(value, oldValue) {
        this.isConstructed && this.updateHeader()
    }

    /** @param {Object|null} value @param {Object|null} oldValue @protected */
    afterSetMessageRead(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * Triggered after the provider's mode changed. The new population's first page is this stream's
     * baseline, never news: no announcement, no pending pill, no open message of the old one, and the
     * list reads it from its newest row. The mailbox opens nothing here, so it reads with selection off.
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetMode(value, oldValue) {
        const me = this;

        me.toggleCls('is-observing', value !== 'mailbox');

        if (me.isConstructed) {
            const list = me.getReference('list');

            list.selectionModel.deselectAll();
            list.disableSelection = value === 'mailbox';
            list.scrollToIndex(0);
            me.hasObservedStore     = false;
            me.pendingNewEventCount = 0;
            me.updateNewEventsButton();
            me.applyDetail();
            me.updateHeader()
        }
    }

    /** @param {Object|null} value @param {Object|null} oldValue @protected */
    afterSetGuidance(value, oldValue) {
        this.isConstructed && this.updateHeader()
    }

    /** @param {Object|null} value @param {Object|null} oldValue @protected */
    afterSetObservation(value, oldValue) {
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

        list?.on({createItems: me.onListCreateItems, select: me.onListSelect, scope: me});
        list && (list.store = me.store);

        me.syncKnownEventIds(false);
        me.updateHeader()
    }

    /**
     * @summary Tracks genuinely new producer ids and keeps recycled history out of announcements; an open
     * message whose row left the store closes.
     * @protected
     */
    onActivityStoreLoad() {
        this.syncKnownEventIds(true);
        this.applyDetail();
        this.updateHeader()
    }

    /**
     * @summary Hand the detail the open message row as the store holds it now, or close it: in the mailbox
     * mode, and once the store no longer holds the row, whose selection then goes with it.
     * @protected
     */
    applyDetail() {
        const
            me       = this,
            list     = me.getReference('list'),
            detail   = me.getReference('stream-detail'),
            splitter = me.getReference('stream-splitter');

        if (!list || !detail || !splitter) {
            return
        }

        const
            {selectionModel} = list,
            [itemId]         = selectionModel.items,
            record           = me.mode !== 'mailbox' && itemId ? me.store?.get(list.getItemRecordId(itemId)) ?? null : null;

        !record && itemId && selectionModel.deselectAll();

        splitter.hidden = !record;

        detail.set({
            entry : 'observer',
            hidden: !record,
            read  : me.messageRead,
            row   : record ? me.rowOf(record) : null
        })
    }

    /**
     * @summary The list's open message changed: the detail follows it, and the owner is asked for a newly
     * opened message's body. A retracted message has no body to ask for.
     * @param {Object} data `{records}`: the opened row, none when the open message closed
     * @protected
     */
    onListSelect({records}) {
        const [record] = records;

        this.applyDetail();

        record && record.payload.status !== 'retracted' && this.fire('messageOpen', {messageId: record.payload.messageId})
    }

    /**
     * @summary Ask the owner to switch the A2A population; the provider's mode answers through the binding.
     * @param {String} mode
     * @protected
     */
    onModeClick(mode) {
        mode !== this.mode && this.fire('modeChange', {mode})
    }

    /**
     * @summary The plain row the detail renders, from an A2A activity record's producer payload.
     * @param {Object} record
     * @returns {Object}
     * @protected
     */
    rowOf(record) {
        const {from, messageId, priority, relatedTickets, status, subject, taskState} = record.payload;

        return {from, messageId, priority, relatedTickets, sentAt: record.occurredAt, status, subject, taskState}
    }

    /**
     * @summary Clears the pending-new affordance when the operator returns to the leading edge, and
     * asks for older events once the last held row is mounted: scrolled to, or a pane taller than
     * its rows. The owner decides whether a page is due (one in flight, the ring full, the mailbox
     * exhausted), so asking again on every rebuild is cheap.
     * @protected
     */
    onListCreateItems() {
        const
            me    = this,
            list  = me.getReference('list'),
            count = me.store?.count ?? 0;

        if (list?.scrollTop === 0 && me.pendingNewEventCount > 0) {
            me.pendingNewEventCount = 0;
            me.updateNewEventsButton()
        }

        if (count > 0 && !me.historyExhausted && list?.mountedRange[1] >= count && ['live', 'partial'].includes(me.adapterState)) {
            me.fire('historyRequest')
        }
    }

    /**
     * @summary Records the ids an older page is about to land, so the store's next load reads them as
     * history: they never count toward the new-events affordance and never reach the announcer.
     * @param {String[]} eventIds
     */
    acceptHistory(eventIds) {
        eventIds.forEach(eventId => this.knownEventIds.add(eventId))
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
     * The pressed chip is the mode in view, the mailbox count is labelled with its population, and an
     * observer read's limit or refusal takes its own line ({@link describeActivityObservation}).
     * @protected
     */
    updateHeader() {
        const
            me         = this,
            header     = me.getReference('header'),
            countsCell = me.getReference('counts'),
            stateCell  = me.getReference('state'),
            noteCell   = me.getReference('observer-note'),
            note       = describeActivityObservation(me.mode, me.observation),
            // a cold feed shows no row (Container.scss): rows a retired authority left for its successor's replace are not held
            retained   = me.adapterState === 'cold' ? 0 : me.store?.count ?? 0,
            dropped    = me.store?.droppedCount ?? 0,
            countView  = describeActivityCounts(me.counts, ACTIVITY_MODE_LABELS[me.mode]),
            stateWord  = {cold: 'not answered yet',
                partial: (typeof me.guidance?.head === 'string' && me.guidance.head.trim()) || 'partial — some sources unavailable',
                stale: retained ? 'stale — reconnecting' : 'unavailable'}[me.adapterState],
            stateCls   = {cold: 'is-cold', partial: 'is-partial', stale: 'is-stale'}[me.adapterState] ?? 'is-live',
            // cold and stale already say their rows are not current; only a live feed can mislead
            quiet      = stateWord ? null : describeQuietSince(me.store?.getAt(0)?.occurredAt),
            stateText  = stateWord ?? (quiet ? `● streaming · ${quiet.text}` : '● streaming');

        if (!header || !countsCell || !stateCell || !noteCell) {
            return
        }

        header.cls = ['fm-pane-head', 'fm-stream-head', stateCls, ...(quiet ? ['is-quiet'] : [])];

        Object.keys(ACTIVITY_MODE_LABELS).forEach(mode => {
            me.getReference(`mode-${mode}`).pressed = mode === me.mode
        });

        noteCell.vdom.title = note?.title ?? null;
        noteCell.set({
            cls   : ['fm-pane-meta', 'fm-stream-observer', ...(note ? [note.cls] : [])],
            hidden: !note,
            text  : note?.text ?? ''
        });

        // the feed's own empty state: an ANSWER with no events says so in the list region; a cold
        // feed (no answer yet) leaves the region quiet — the head already says "not answered yet"
        me.getReference('empty-note').set({
            hidden: me.adapterState === 'cold' || retained > 0,
            text  : me.adapterState === 'live' ? 'no activity yet' : 'Activity unavailable'
        });

        countsCell.vdom.title = countView?.title ?? null;
        countsCell.set({
            cls : ['fm-pane-meta', 'fm-stream-sources', ...(!countView ? ['is-empty'] : [])],
            text: countView ? `sources · ${countView.text}` : ''
        });

        me.getReference('retention').text = describeActivityRetention({
            dropped,
            exhausted: me.historyExhausted,
            full     : retained >= (me.store?.maxRecords ?? Infinity),
            retained
        });

        const
            headTitle    = typeof me.guidance?.headTitle === 'string' && me.guidance.headTitle.trim(),
            recheck      = typeof me.guidance?.recheck === 'string' && me.guidance.recheck.trim(),
            partialTitle = headTitle || (recheck ? `${recheck} · Recheck now is in the banner · no direct producer repair here` : null);

        stateCell.vdom.title = me.adapterState === 'partial'
            ? partialTitle
            : (quiet?.title ?? null);
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
        me.getReference('list')?.un({createItems: me.onListCreateItems, select: me.onListSelect, scope: me});

        super.destroy(...args)
    }
}

export default Neo.setupClass(ActivityStream);
