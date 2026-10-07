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

    if (!origin || origin === HOME_ORIGIN) {
        return `#${number}`
    }

    // Own entries only: the map is a plain object, and a slug that happens to name an inherited
    // key (`constructor`, `toString`, `__proto__`) must render itself, never the prototype's value.
    return `${Object.hasOwn(SHORT_ORIGIN_NAMES, origin) ? SHORT_ORIGIN_NAMES[origin] : origin}#${number}`
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
 * @summary The words a pull request's row may use for its state, keyed by GitHub's enums. A value
 * outside these maps names nothing.
 * @type {Object}
 */
const PR_STATE_LABELS    = Object.freeze({CLOSED: 'closed', MERGED: 'merged'});
const PR_DECISION_LABELS = Object.freeze({
    APPROVED         : 'approved',
    CHANGES_REQUESTED: 'changes requested',
    REVIEW_REQUIRED  : 'review required'
});
const PR_TRANSITION_LABELS = Object.freeze({head: 'changes pushed', opened: 'opened'});

/**
 * @summary What one open-work transition did to its PR: a verdict reads its new decision, a push or an
 * opening its own word, a merge or a close the PR's state. Reviewers are named only when several moved a
 * verdict, since a single one is the row's actor. An unknown kind or decision names nothing.
 * @param {Object}      transition `{kind, to, by?}` from the Brain's PR lane.
 * @param {String|null} state
 * @returns {String|null}
 * @private
 */
function transitionStatus({kind, to, by}, state) {
    const
        [labels, key] = kind === 'verdict' ? [PR_DECISION_LABELS, to] : Object.hasOwn(PR_TRANSITION_LABELS, kind) ? [PR_TRANSITION_LABELS, kind] : [PR_STATE_LABELS, state],
        word          = Object.hasOwn(labels, key) ? labels[key] : null,
        names         = (Array.isArray(by) ? by : []).filter(name => typeof name === 'string' && name).map(name => name.replace(/^(?:@|login:|team:)/, ''));

    return word && names.length > 1 ? `${word} by ${names.join(', ')}` : word
}

/**
 * @summary Resolves the status a `pr-activity` row names, from the payload the Brain's PR adapter
 * already carries.
 *
 * An open-work transition names what it did ({@link transitionStatus}). Otherwise a merged or closed
 * PR names that. An open draft names `draft`. An open PR names GitHub's `reviewDecision`, and where
 * the repository computes none (no required reviews), the Brain's `humanGateState`, read from the
 * latest reviews. Anything else resolves `null`: a status is never guessed.
 * @param {Object} event Record or record-shaped object.
 * @returns {String|null}
 */
export function getPullRequestStatus(event) {
    if (event?.type !== 'pr-activity') {
        return null
    }

    const {humanGateState, isDraft, reviewDecision, state, transition} = event.payload || {};

    if (Neo.typeOf(transition) === 'Object') {
        return transitionStatus(transition, state)
    }

    if (Object.hasOwn(PR_STATE_LABELS, state)) {
        return PR_STATE_LABELS[state]
    }

    if (state !== 'OPEN') {
        return null
    }

    if (isDraft === true) {
        return 'draft'
    }

    if (Object.hasOwn(PR_DECISION_LABELS, reviewDecision)) {
        return PR_DECISION_LABELS[reviewDecision]
    }

    if (humanGateState?.changedRequested === true) {
        return PR_DECISION_LABELS.CHANGES_REQUESTED
    }

    return humanGateState?.approved === true ? PR_DECISION_LABELS.APPROVED : null
}

/**
 * @summary Resolves the producer-owned object/message carried by one activity event.
 *
 * Actor and recipient render in their own fixed cells, so this function never repeats them. PR,
 * issue, lane and stall payloads prefer their stable object reference + title; A2A and fixture
 * events use their bounded subject/text. Unknown shapes degrade to the event kind, never an object
 * stringification. A PR row ends with its {@link getPullRequestStatus status} when one resolves.
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
        if (event?.type === 'work-stall') {
            return `stalled · ${object}`
        }

        const status = getPullRequestStatus(event);

        return status ? `${object} · ${status}` : object
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
         * The record version {@link Neo.list.Buffered} stamps before every bind. A bind of the same
         * record at a new version never reaches {@link #afterSetRecord}, so this is how the row learns
         * its record changed in place: a PR approved, then merged.
         * @member {Number|null} lastRecordVersion_=null
         * @reactive
         */
        lastRecordVersion_: null,
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
         * pooled row is not a grid at paint time.
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
            module   : ActorChip,
            cls      : ['fm-ev-recipient'],
            reference: 'recipient'
        }, {
            module   : Component,
            cls      : ['fm-ev-object'],
            reference: 'object'
        }]
    }

    /**
     * The record version {@link #updateRow} last drew.
     * @member {Number|null} renderedVersion=null
     * @protected
     */
    renderedVersion = null

    /** @param {Object} value @param {Object} oldValue @protected */
    afterSetActorDirectory(value, oldValue) {
        this.isConstructed && this.updateRow()
    }

    /**
     * Redraws only when the record already shown has moved past the version it was drawn at; a bind
     * of another record arrives through {@link #afterSetRecord}.
     * @param {Number|null} value
     * @param {Number|null} oldValue
     * @protected
     */
    afterSetLastRecordVersion(value, oldValue) {
        this.isConstructed && this.record?.version === value && this.renderedVersion !== value && this.updateRow()
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
            me        = this,
            event     = me.record,
            agentId   = event?.agentId || null,
            facts     = me.getActorFacts(agentId),
            time      = ViewerTime.formatViewerTime(event?.occurredAt),
            recipient = me.getRecipient(event),
            toFacts   = me.getActorFacts(recipient?.to),
            timeCell  = me.getReference('time'),
            kindCell  = me.getReference('kind'),
            actorCell = me.getReference('actor'),
            toCell    = me.getReference('recipient'),
            textCell  = me.getReference('object'),
            text      = getActivityObjectText(event);

        if (!timeCell || !kindCell || !actorCell || !toCell || !textCell) {
            return
        }

        me.renderedVersion = event?.version ?? null;

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

        toCell.setSilent({
            agentId  : recipient?.title ?? null,
            avatarUrl: toFacts.avatarUrl ?? null,
            cls      : ['fm-ev-recipient', recipient?.broadcast ? 'is-broadcast' : 'is-direct', ...(!recipient ? ['is-empty'] : [])],
            hidden   : false,
            label    : !recipient ? null : recipient.broadcast ? 'fleet' : toFacts.displayName ?? recipient.to.replace(/^@/, ''),
            lead     : recipient?.lead ?? null
        });

        textCell.vdom.title = getActivityObjectTitle(event);
        textCell.setSilent({text});

        me.vdom['aria-label'] = [time?.text, event?.type, agentId, recipient?.text, text].filter(Boolean).join(' · ');
        me.updateDepth = 2;
        me.update()
    }

    /**
     * @summary The roster facts the actor directory holds for an id, `@`-form or bare.
     * @param {String|null} id
     * @returns {Object} The facts, or `{}` when the directory has none.
     * @protected
     */
    getActorFacts(id) {
        return id ? this.actorDirectory?.[id] ?? this.actorDirectory?.[String(id).replace(/^@/, '')] ?? {} : {}
    }

    /**
     * @summary Resolves the optional A2A recipient cell without deriving identity: a direct
     * recipient is a chip like the sender's, a broadcast is the fleet.
     * @param {Object|null} event
     * @returns {Object|null} `{broadcast, lead, text, title, to}`, or null for no recipient.
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
            lead : broadcast ? '⇒' : '→',
            text : broadcast ? '⇒ fleet' : `→ ${to}`,
            title: to ?? 'AGENT:*',
            to   : broadcast ? null : to
        }
    }
}

export default Neo.setupClass(RowContainer);
