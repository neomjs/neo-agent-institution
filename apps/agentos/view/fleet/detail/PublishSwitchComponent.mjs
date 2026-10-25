import Component     from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import PublishSwitch from '../../../util/PublishSwitch.mjs';

/**
 * @summary The per-peer × per-channel outbound publication gate switch view.
 *
 * Rendered inside {@link AgentOS.view.fleet.detail.Container}'s `Configuration` tab as the **Publishing**
 * section:
 * - One row per channel (`x`, `linkedin`) with the four gate states (`approve each` · `approve the batch` ·
 *   `auto-approve after a cross-family review attestation` · `auto-approve`), collapsing to a native
 *   `<select>` at narrow rail/vessel widths (`314px`).
 * - One-click downgrade at any time (`rank < currentRank`).
 * - Promote (`rank > currentRank`) requires inline confirmation naming `from → to`, a non-empty operator
 *   reason, and `expectedFrom` so concurrent switch movement refuses cleanly (`switch-moved`).
 * - Renders the last audit line (`who · when · from → to · reason`), full audit trail behind disclosure,
 *   and any recorded agent proposal (`proposed by …`).
 *
 * Security boundary (AC-4): authoritative state lives in private `#fleetSwitches`, populated only through
 * {@link #applyFleetSwitches} from the operator-authenticated Fleet bridge. External property writes (including
 * Neural Link `set_instance_properties`) never invoke `setPublishSwitch`, immediately restore from
 * `#fleetSwitches`, and trigger a fresh `readPublishSwitches` read.
 *
 * @class AgentOS.view.fleet.detail.PublishSwitchComponent
 * @extends Neo.component.Base
 */
class PublishSwitchComponent extends Component {
    /**
     * Authoritative Fleet-admitted switch state, mutated only by {@link #applyFleetSwitches}.
     * @type {Object|null}
     */
    #fleetSwitches = null
    /**
     * Re-entrancy guard while {@link #applyFleetSwitches} synchronizes public read-only mirrors.
     * @type {Boolean}
     */
    #applyingFleetTruth = false

    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.PublishSwitchComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.PublishSwitchComponent',
        /**
         * @member {String} ntype='fm-publish-switch-container'
         * @protected
         */
        ntype: 'fm-publish-switch-container',
        /**
         * @member {String[]} baseCls=['fm-publish-switches']
         * @protected
         */
        baseCls: ['fm-publish-switches'],
        /**
         * The inspected seat record (`{agentId, githubUsername}`).
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * Public mirror of the channel switches. Writing this property directly via `set()` or
         * `set_instance_properties` never mutates Fleet state; it restores from `#fleetSwitches`
         * and requests a fresh Fleet read.
         * @member {Object|null} switches_=null
         * @reactive
         */
        switches_: null,
        /**
         * Public mirror of the `x` channel switch state (guarded against direct mutation).
         * @member {String|null} xState_=null
         * @reactive
         */
        xState_: null,
        /**
         * Public mirror of the `linkedin` channel switch state (guarded against direct mutation).
         * @member {String|null} linkedinState_=null
         * @reactive
         */
        linkedinState_: null,
        /**
         * @member {Object} _vdom
         */
        _vdom: {
            tag: 'section',
            cls: ['fm-publish-switches'],
            cn : []
        }
    }

    /**
     * Per-channel pending promotion draft (`{from, to, reason, error}`), keyed by channel.
     * @member {Object} pendingPromotes={}
     * @protected
     */
    pendingPromotes = {}
    /**
     * Per-channel audit trail disclosure state (`Boolean`), keyed by channel.
     * @member {Object} expandedAudit={}
     * @protected
     */
    expandedAudit = {}
    /**
     * Per-channel settled/pending/refused write outcome, keyed by channel.
     * @member {Object} channelOutcomes={}
     * @protected
     */
    channelOutcomes = {}

    /**
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const me = this;

        me.#fleetSwitches = PublishSwitch.normalizePeerSwitches(null, me.peerId);
        me.syncPublicMirrors();

        me.addDomListeners([
            {click : me.onStateChipClick,       delegate: '.fm-publish-switch-chip',            scope: me},
            {change: me.onStateSelectChange,    delegate: '.fm-publish-switch-select',          scope: me},
            {input : me.onPromoteReasonInput,   delegate: '.fm-publish-switch-promote-reason',  scope: me},
            {click : me.onConfirmPromoteClick,  delegate: '.fm-publish-switch-promote-confirm', scope: me},
            {click : me.onCancelPromoteClick,   delegate: '.fm-publish-switch-promote-cancel',  scope: me},
            {click : me.onAuditToggleClick,     delegate: '.fm-publish-switch-audit-toggle',    scope: me}
        ]);

        me.renderRows()
    }

    /**
     * @summary Canonical `@`-prefixed peer id for the inspected seat.
     * @returns {String|null}
     */
    get peerId() {
        return PublishSwitch.peerIdOf(this.record)
    }

    /**
     * @summary Override `set()` so external mutations (`set_instance_properties` on `switches`, `xState`,
     * `linkedinState`, or `state`) never write to Fleet state, restore from `#fleetSwitches`, and trigger
     * a fresh `readPublishSwitches` read from the Fleet bridge (AC-4).
     * @param {Object} values
     * @param {Boolean} [silent=false]
     */
    set(values, silent = false) {
        const
            me              = this,
            attemptedSwitch = values && typeof values === 'object' && !me.#applyingFleetTruth && (
                'switches'      in values ||
                'xState'        in values ||
                'linkedinState' in values ||
                'state'         in values
            );

        super.set(values, silent);

        if (attemptedSwitch && me.isConstructed) {
            me.syncPublicMirrors();
            me.renderRows();
            me.peerId && me.fire('readPublishSwitches', {peer: me.peerId})
        }
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        if (!this.isConstructed) return;

        const
            me     = this,
            peerId = me.peerId;

        if (PublishSwitch.peerIdOf(oldValue) !== peerId) {
            me.pendingPromotes = {};
            me.expandedAudit   = {};
            me.channelOutcomes = {};
            me.#fleetSwitches  = PublishSwitch.normalizePeerSwitches(null, peerId);
            me.syncPublicMirrors()
        }

        me.renderRows()
    }

    /**
     * @param {Object|null} value
     * @protected
     */
    afterSetSwitches(value) {
        if (this.isConstructed && !this.#applyingFleetTruth) {
            this.syncPublicMirrors();
            this.renderRows()
        }
    }

    /**
     * @param {String|null} value
     * @protected
     */
    afterSetXState(value) {
        if (this.isConstructed && !this.#applyingFleetTruth) {
            this.syncPublicMirrors();
            this.renderRows()
        }
    }

    /**
     * @param {String|null} value
     * @protected
     */
    afterSetLinkedinState(value) {
        if (this.isConstructed && !this.#applyingFleetTruth) {
            this.syncPublicMirrors();
            this.renderRows()
        }
    }

    /**
     * @summary Synchronize public read-only mirrors from `#fleetSwitches` without triggering the external
     * write-attempt guard.
     * @protected
     */
    syncPublicMirrors() {
        const
            me    = this,
            truth = me.#fleetSwitches || PublishSwitch.normalizePeerSwitches(null, me.peerId);

        me.#applyingFleetTruth = true;
        try {
            me.switches      = structuredClone(truth.channels);
            me.xState        = truth.channels?.x?.state        || 'approve each';
            me.linkedinState = truth.channels?.linkedin?.state || 'approve each'
        } finally {
            me.#applyingFleetTruth = false
        }
    }

    /**
     * @summary Admit an operator-authenticated `readPublishSwitches` or `setPublishSwitch` snapshot from
     * the Fleet bridge. This is the ONLY entry point that updates `#fleetSwitches`.
     * @param {Object|null} answer
     */
    applyFleetSwitches(answer) {
        const me = this;

        me.#fleetSwitches = PublishSwitch.normalizePeerSwitches(answer, me.peerId);
        me.syncPublicMirrors();
        me.isConstructed && me.renderRows()
    }

    /**
     * @summary Record the outcome of an operator-initiated `setPublishSwitch` call for a channel.
     * @param {String} channel
     * @param {Object|null} outcome `{state: 'pending'|'ok'|'refused', reason?, switch?}`
     */
    applyChannelOutcome(channel, outcome) {
        const me = this;

        if (!PublishSwitch.CHANNELS.includes(channel)) return;

        me.channelOutcomes = {...me.channelOutcomes, [channel]: outcome};

        if (outcome?.state === 'ok') {
            const next = {...me.pendingPromotes};
            delete next[channel];
            me.pendingPromotes = next;

            if (outcome.switch && typeof outcome.switch === 'object') {
                const current = me.#fleetSwitches || PublishSwitch.normalizePeerSwitches(null, me.peerId);
                me.#fleetSwitches = PublishSwitch.normalizePeerSwitches({
                    ...current,
                    channels: {
                        ...current.channels,
                        [channel]: outcome.switch
                    }
                }, me.peerId);
                me.syncPublicMirrors()
            }
        }

        me.isConstructed && me.renderRows()
    }

    /**
     * @summary Focus/highlight a specific channel row when the operator clicks the effective switch chip
     * on a `PublishRequestComponent`.
     * @param {String} channel
     */
    focusChannel(channel) {
        if (!PublishSwitch.CHANNELS.includes(channel)) return;
        this.focusedChannel = channel;
        this.isConstructed && this.renderRows()
    }

    /**
     * @summary Build the VDOM for the Publishing section and its `x` and `linkedin` channel rows.
     * @protected
     */
    renderRows() {
        const
            me    = this,
            truth = me.#fleetSwitches || PublishSwitch.normalizePeerSwitches(null, me.peerId);

        me.vdom.cn = [{
            tag: 'div',
            cls: ['fm-detail-section-header', 'fm-publish-switches-header'],
            cn : [{
                tag : 'span',
                cls : ['fm-detail-section-title'],
                text: 'Publishing'
            }, {
                tag : 'span',
                cls : ['fm-publish-switches-sub'],
                text: me.peerId ? `${me.peerId} · per-channel outbound gate` : 'per-channel outbound gate'
            }]
        }, {
            tag: 'div',
            cls: ['fm-publish-switch-list'],
            cn : PublishSwitch.CHANNELS.map(channel => me.renderChannelRow(channel, truth.channels?.[channel]))
        }];

        me.update()
    }

    /**
     * @summary Render a single channel row (`x` or `linkedin`): state strip + narrow `<select>`, inline
     * promote confirmation bar when pending, outcome notice, last audit line + disclosure trail, and
     * recorded proposal line.
     * @param {String} channel
     * @param {Object} channelModel
     * @returns {Object}
     * @protected
     */
    renderChannelRow(channel, channelModel) {
        const
            me             = this,
            normalized     = PublishSwitch.normalizeChannelSwitch(channelModel, me.peerId, channel),
            currentState   = normalized.state,
            pendingPromote = me.pendingPromotes[channel] || null,
            expanded       = Boolean(me.expandedAudit[channel]),
            outcome        = me.channelOutcomes[channel] || null,
            audit          = normalized.audit || [],
            lastAuditText  = PublishSwitch.formatAuditLine(normalized.lastAudit),
            proposalText   = PublishSwitch.formatProposalLine(normalized.proposal),
            isFocused      = me.focusedChannel === channel;

        return {
            tag : 'div',
            cls : ['fm-publish-switch-row', `is-channel-${channel}`, ...(isFocused ? ['is-focused'] : [])],
            data: {channel},
            cn  : [{
                tag: 'div',
                cls: ['fm-publish-switch-row-head'],
                cn : [{
                    tag : 'span',
                    cls : ['fm-publish-switch-channel'],
                    text: channel
                }, {
                    tag : 'span',
                    cls : ['fm-publish-switch-current'],
                    text: currentState
                }]
            }, {
                tag : 'div',
                cls : ['fm-publish-switch-chips'],
                role: 'group',
                cn  : PublishSwitch.STATES.map(state => ({
                    tag : 'button',
                    type: 'button',
                    cls : [
                        'fm-publish-switch-chip',
                        ...(state === currentState ? ['is-active'] : []),
                        ...(PublishSwitch.isPromotion(currentState, state) ? ['is-promote'] : []),
                        ...(PublishSwitch.isDowngrade(currentState, state) ? ['is-downgrade'] : [])
                    ],
                    data: {channel, state},
                    text: state
                }))
            }, {
                tag : 'select',
                cls : ['fm-publish-switch-select'],
                data: {channel},
                cn  : PublishSwitch.STATES.map(state => ({
                    tag     : 'option',
                    value   : state,
                    selected: state === currentState,
                    text    : state
                }))
            }, {
                tag      : 'div',
                cls      : ['fm-publish-switch-promote-box'],
                removeDom: !pendingPromote,
                cn       : pendingPromote ? [{
                    tag : 'div',
                    cls : ['fm-publish-switch-promote-title'],
                    text: `Promote ${channel}: ${pendingPromote.from} → ${pendingPromote.to}`
                }, {
                    tag        : 'input',
                    type       : 'text',
                    cls        : ['fm-publish-switch-promote-reason'],
                    data       : {channel},
                    placeholder: 'Reason required to promote switch…',
                    value      : pendingPromote.reason || ''
                }, {
                    tag      : 'div',
                    cls      : ['fm-publish-switch-promote-error'],
                    removeDom: !pendingPromote.error,
                    text     : pendingPromote.error || ''
                }, {
                    tag: 'div',
                    cls: ['fm-publish-switch-promote-actions'],
                    cn : [{
                        tag : 'button',
                        type: 'button',
                        cls : ['fm-publish-switch-btn', 'fm-publish-switch-promote-confirm'],
                        data: {channel},
                        text: 'Confirm promote'
                    }, {
                        tag : 'button',
                        type: 'button',
                        cls : ['fm-publish-switch-btn', 'fm-publish-switch-promote-cancel'],
                        data: {channel},
                        text: 'Cancel'
                    }]
                }] : []
            }, {
                tag      : 'div',
                cls      : ['fm-publish-switch-outcome', ...(outcome?.state === 'refused' ? ['is-refused'] : [])],
                removeDom: !outcome || outcome.state === 'ok',
                text     : outcome?.state === 'pending'
                    ? 'Updating switch…'
                    : outcome?.state === 'refused'
                        ? `Switch change refused: ${outcome.reason || 'refused'}`
                        : ''
            }, {
                tag: 'div',
                cls: ['fm-publish-switch-audit'],
                cn : [{
                    tag : 'span',
                    cls : ['fm-publish-switch-audit-last'],
                    text: lastAuditText
                }, {
                    tag      : 'button',
                    type     : 'button',
                    cls      : ['fm-publish-switch-audit-toggle'],
                    data     : {channel},
                    removeDom: audit.length < 1,
                    text     : expanded ? 'Hide history' : `History (${audit.length})`
                }]
            }, {
                tag      : 'div',
                cls      : ['fm-publish-switch-audit-trail'],
                removeDom: !expanded || audit.length < 1,
                cn       : [...audit].reverse().map(entry => ({
                    tag : 'div',
                    cls : ['fm-publish-switch-audit-item'],
                    text: PublishSwitch.formatAuditLine(entry)
                }))
            }, {
                tag : 'div',
                cls : ['fm-publish-switch-proposal', ...(!normalized.proposal ? ['is-absent'] : [])],
                text: proposalText
            }]
        }
    }

    /**
     * @summary Handle a click on one of the 4 state chips or a `<select>` change: one-click downgrade
     * fires immediately; promote opens the inline confirmation box requiring a reason.
     * @param {String} channel
     * @param {String} targetState
     * @protected
     */
    selectChannelState(channel, targetState) {
        const
            me           = this,
            truth        = me.#fleetSwitches || PublishSwitch.normalizePeerSwitches(null, me.peerId),
            currentState = truth.channels?.[channel]?.state || 'approve each';

        if (!PublishSwitch.CHANNELS.includes(channel) || !PublishSwitch.STATES.includes(targetState) || targetState === currentState) {
            return
        }

        if (PublishSwitch.isDowngrade(currentState, targetState)) {
            const next = {...me.pendingPromotes};
            delete next[channel];
            me.pendingPromotes = next;

            me.fire('setPublishSwitch', {
                peer        : me.peerId,
                channel,
                to          : targetState,
                expectedFrom: currentState,
                reason      : 'operator downgrade'
            });
            return
        }

        if (PublishSwitch.isPromotion(currentState, targetState)) {
            me.pendingPromotes = {
                ...me.pendingPromotes,
                [channel]: {
                    from  : currentState,
                    to    : targetState,
                    reason: '',
                    error : null
                }
            };
            me.renderRows()
        }
    }

    /**
     * @param {Object} data
     * @protected
     */
    onStateChipClick(data) {
        const
            target  = data.path?.find(el => el.cls?.includes('fm-publish-switch-chip')),
            channel = target?.data?.channel,
            state   = target?.data?.state;

        channel && state && this.selectChannelState(channel, state)
    }

    /**
     * @param {Object} data
     * @protected
     */
    onStateSelectChange(data) {
        const
            target  = data.path?.find(el => el.cls?.includes('fm-publish-switch-select')),
            channel = target?.data?.channel,
            state   = data.value ?? target?.value;

        channel && state && this.selectChannelState(channel, state)
    }

    /**
     * @param {Object} data
     * @protected
     */
    onPromoteReasonInput(data) {
        const
            target  = data.path?.find(el => el.cls?.includes('fm-publish-switch-promote-reason')),
            channel = target?.data?.channel,
            pending = channel ? this.pendingPromotes[channel] : null;

        if (pending) {
            this.pendingPromotes = {
                ...this.pendingPromotes,
                [channel]: {
                    ...pending,
                    reason: data.value ?? target?.value ?? '',
                    error : null
                }
            }
        }
    }

    /**
     * @param {Object} data
     * @protected
     */
    onConfirmPromoteClick(data) {
        const
            me      = this,
            target  = data.path?.find(el => el.cls?.includes('fm-publish-switch-promote-confirm')),
            channel = target?.data?.channel,
            pending = channel ? me.pendingPromotes[channel] : null;

        if (!pending) return;

        const reason = String(pending.reason || '').trim();

        if (!reason) {
            me.pendingPromotes = {
                ...me.pendingPromotes,
                [channel]: {
                    ...pending,
                    error: 'Promote requires a reason.'
                }
            };
            me.renderRows();
            return
        }

        me.fire('setPublishSwitch', {
            peer        : me.peerId,
            channel,
            to          : pending.to,
            expectedFrom: pending.from,
            reason
        })
    }

    /**
     * @param {Object} data
     * @protected
     */
    onCancelPromoteClick(data) {
        const
            target  = data.path?.find(el => el.cls?.includes('fm-publish-switch-promote-cancel')),
            channel = target?.data?.channel;

        if (channel && this.pendingPromotes[channel]) {
            const next = {...this.pendingPromotes};
            delete next[channel];
            this.pendingPromotes = next;
            this.renderRows()
        }
    }

    /**
     * @param {Object} data
     * @protected
     */
    onAuditToggleClick(data) {
        const
            target  = data.path?.find(el => el.cls?.includes('fm-publish-switch-audit-toggle')),
            channel = target?.data?.channel;

        if (channel) {
            this.expandedAudit = {
                ...this.expandedAudit,
                [channel]: !this.expandedAudit[channel]
            };
            this.renderRows()
        }
    }
}

export default Neo.setupClass(PublishSwitchComponent);
