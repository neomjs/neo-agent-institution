import ActorChip  from './ActorChipComponent.mjs';
import Component  from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import Container  from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import EventChip  from './EventChipComponent.mjs';
import ViewerTime from '../../../util/ViewerTime.mjs';

/**
 * @summary The home repository whose conversations render bare (`#N`).
 *
 * Mirrors the Brain's `CORPUS_PROJECTION_ORIGIN`; the cockpit consumes the DTO's `repoSlug` field and
 * never derives an origin itself. A row without the field is a home row by the same contract.
 * @type {String}
 */
export const HOME_ORIGIN = 'neo';

/**
 * @summary The one declared map from a corpus origin slug to the short name a 20 px row can afford.
 *
 * GitHub's own convention, compressed: bare `#N` inside the home repository, `<short>#N` across
 * repositories, the full `neomjs/<repoSlug>#N` in the row title. An unknown slug renders itself,
 * never nothing — a new origin is legible on the day it joins the corpus.
 * @type {Object}
 */
export const SHORT_ORIGIN_NAMES = Object.freeze({
    'devindex'             : 'devindex',
    'neo-agent-brain'      : 'brain',
    'neo-agent-institution': 'institution',
    'neo-agent-skills'     : 'skills'
});

/**
 * @summary Formats a conversation reference for the row: `#N` at home, `<short>#N` elsewhere.
 * @param {String|null} repoSlug The conversation's origin repository slug; absent means home.
 * @param {Number|String} number The conversation number inside that origin.
 * @returns {String}
 */
export function formatConversationRef(repoSlug, number) {
    const origin = normalizeOrigin(repoSlug);

    return origin && origin !== HOME_ORIGIN ? `${SHORT_ORIGIN_NAMES[origin] ?? origin}#${number}` : `#${number}`
}

/**
 * @summary Resolves the full `neomjs/<repoSlug>#N` a row's object cell carries as its title, so hover
 * answers what the short reference compresses. Rows without a conversation number carry none.
 * @param {Object} event Record or record-shaped object.
 * @returns {String|null}
 */
export function getActivityObjectTitle(event) {
    const
        payload = event?.payload || {},
        subject = Neo.typeOf(payload.subject) === 'Object' ? payload.subject : null,
        number  = payload.number ?? payload.issueNumber ?? subject?.number ?? null,
        origin  = normalizeOrigin(payload.repoSlug ?? subject?.repoSlug) ?? HOME_ORIGIN;

    return number !== null ? `neomjs/${origin}#${number}` : null
}

function normalizeOrigin(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * @summary Resolves the producer-owned object/message carried by one activity event.
 *
 * Actor and recipient render in their own fixed cells, so this function never repeats them. PR,
 * issue, lane and stall payloads prefer their stable object reference + title; A2A and fixture
 * events use their bounded subject/text. Unknown shapes degrade to the event kind, never an object
 * stringification.
 * @param {Object} event Record or record-shaped object.
 * @returns {String}
 */
export function getActivityObjectText(event) {
    const
        payload = event?.payload || {},
        subject = Neo.typeOf(payload.subject) === 'Object' ? payload.subject : null,
        number  = payload.number ?? payload.issueNumber ?? subject?.number ?? null,
        id      = number === null ? (subject?.id ?? null) : null,
        ref     = number !== null ? formatConversationRef(payload.repoSlug ?? subject?.repoSlug, number) : id,
        title   = payload.title ?? payload.issueTitle ?? subject?.title ?? null,
        object  = [ref, title].filter(value => typeof value === 'string' && value || typeof value === 'number').join(' · '),
        text    = [payload.text, payload.summary, typeof payload.subject === 'string' ? payload.subject : null, payload.reason]
            .find(value => typeof value === 'string' && value.trim());

    if (object) {
        return event?.type === 'work-stall' ? `stalled · ${object}` : object
    }

    if (text) {
        return text
    }

    if (event?.type === 'work-stall') {
        return `stalled · ${payload.findingClass || 'work item'}`
    }

    return event?.type || 'fleet event'
}

/**
 * @summary One physically pooled activity row with a stable five-cell child tree.
 *
 * {@link Neo.list.Buffered} recycles this component by assigning {@link #record}. Every recycle
 * updates the existing time, kind, actor, recipient and object component roots in place; empty
 * optional cells stay mounted and visually inert. The producer record remains the only event truth.
 * @class AgentOS.view.fleet.activity.RowContainer
 * @extends Neo.container.Base
 */
class RowContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.activity.RowContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.activity.RowContainer',
        /**
         * @member {String} ntype='fm-activity-row'
         * @protected
         */
        ntype: 'fm-activity-row',
        /**
         * @member {String[]} baseCls=['fm-activity-row']
         */
        baseCls: ['fm-activity-row'],
        /**
         * Roster facts supplied by the cockpit owner; missing facts keep the canonical handle.
         * @member {Object} actorDirectory_={}
         * @reactive
         */
        actorDirectory_: {},
        /**
         * The current Store record assigned to this physical pool slot.
         * @member {Neo.data.Record|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * The row is a CSS grid (`RowContainer.scss` owns the five columns and centers the cells),
         * so it declares the Engine's base layout instead of the container default `vbox`: a
         * flexbox layout would stamp `neo-flex-align-stretch` on the row — outranking the grid's
         * `align-items: center` and stretching every cell to the pool height — and write
         * `flex: 1 1 0%` onto each cell, which stretches a kind chip to the row width whenever a
         * pooled row is not a grid at paint time (#63).
         * @member {Object} layout={ntype: 'layout-base'}
         */
        layout: {ntype: 'layout-base'},
        /**
         * The fixed child anatomy. CSS changes only the grid placement at narrow widths; the
         * component and DOM tree never changes shape.
         * @member {Object[]}
         */
        items: [{
            module   : Component,
            cls      : ['fm-ev-time'],
            reference: 'time'
        }, {
            module   : EventChip,
            reference: 'kind'
        }, {
            module   : ActorChip,
            reference: 'actor'
        }, {
            module   : Component,
            cls      : ['fm-ev-recipient'],
            reference: 'recipient'
        }, {
            module   : Component,
            cls      : ['fm-ev-object'],
            reference: 'object'
        }]
    }

    /** @param {Object} value @param {Object} oldValue @protected */
    afterSetActorDirectory(value, oldValue) {
        this.isConstructed && this.updateRow()
    }

    /** @param {Neo.data.Record|null} value @param {Neo.data.Record|null} oldValue @protected */
    afterSetRecord(value, oldValue) {
        this.isConstructed && this.updateRow()
    }

    /** @param {...*} args */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.updateRow()
    }

    /**
     * @summary Rebinds the stable child cells to the current producer record.
     * @protected
     */
    updateRow() {
        const
            me      = this,
            event   = me.record,
            agentId = event?.agentId || null,
            facts   = agentId
                ? me.actorDirectory?.[agentId] ?? me.actorDirectory?.[String(agentId).replace(/^@/, '')] ?? {}
                : {},
            time      = ViewerTime.formatViewerTime(event?.occurredAt),
            recipient = me.getRecipient(event),
            timeCell  = me.getReference('time'),
            kindCell  = me.getReference('kind'),
            actorCell = me.getReference('actor'),
            toCell    = me.getReference('recipient'),
            textCell  = me.getReference('object'),
            text      = getActivityObjectText(event);

        if (!timeCell || !kindCell || !actorCell || !toCell || !textCell) {
            return
        }

        timeCell.vdom.title = time?.title ?? null;
        timeCell.setSilent({text: time?.text ?? '—'});

        kindCell.setSilent({kind: event?.type || 'unknown'});

        actorCell.setSilent({
            agentId,
            avatarUrl: facts.avatarUrl ?? null,
            cls      : ['fm-actor-chip', ...(!agentId ? ['is-empty'] : [])],
            hidden   : false,
            label    : facts.displayName ?? null
        });

        toCell.vdom.title = recipient?.title ?? null;
        toCell.setSilent({
            cls   : ['fm-ev-recipient', recipient?.broadcast ? 'is-broadcast' : 'is-direct', ...(!recipient ? ['is-empty'] : [])],
            hidden: false,
            text  : recipient?.text ?? ''
        });

        textCell.vdom.title = getActivityObjectTitle(event);
        textCell.setSilent({text});

        me.vdom['aria-label'] = [time?.text, event?.type, agentId, recipient?.text, text].filter(Boolean).join(' · ');
        me.updateDepth = 2;
        me.update()
    }

    /**
     * @summary Resolves the optional A2A recipient cell without deriving identity.
     * @param {Object|null} event
     * @returns {Object|null}
     * @protected
     */
    getRecipient(event) {
        const
            payload   = event?.payload || {},
            isA2A     = event?.type === 'a2a-activity' || event?.type === 'lane-claim',
            to        = typeof payload.to === 'string' && payload.to ? payload.to : null,
            broadcast = payload.recipientClass === 'broadcast';

        if (!isA2A || (!to && !broadcast)) {
            return null
        }

        return {
            broadcast,
            text : broadcast ? '⇒ fleet' : `→ ${to}`,
            title: to ?? 'AGENT:*'
        }
    }
}

export default Neo.setupClass(RowContainer);
