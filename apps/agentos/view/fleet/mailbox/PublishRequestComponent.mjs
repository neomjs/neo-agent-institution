import Component     from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import OperatorInbox from '../../../util/OperatorInbox.mjs';
import PublishSwitch from '../../../util/PublishSwitch.mjs';
import ViewerTime    from '../../../util/ViewerTime.mjs';

const PUBLICATION_STATES = Object.freeze(['queued', 'publishing', 'unresolved', 'published', 'refused']);

/**
 * @summary Short 8-character lowercase hex prefix of a 64-character SHA-256 digest.
 * @param {String|null} digest
 * @returns {String}
 */
function shortDigestOf(digest) {
    return typeof digest === 'string' && digest.trim() ? digest.trim().slice(0, 8) : ''
}

/**
 * @summary Short `first4…last4` representation of a media SHA-256 hex digest.
 * @param {String|null} sha256
 * @returns {String}
 */
function shortShaOf(sha256) {
    if (typeof sha256 !== 'string' || !sha256.trim()) return 'no sha256';
    const clean = sha256.trim().toLowerCase();
    return clean.length > 12 ? `${clean.slice(0, 4)}…${clean.slice(-4)}` : clean
}

/**
 * @summary Whether a media URI is local (never a remote HTTP/HTTPS URL).
 * @param {String|null} uri
 * @returns {Boolean}
 */
function isLocalMediaUri(uri) {
    if (typeof uri !== 'string' || !uri.trim()) return false;
    const trimmed = uri.trim();
    if (/^https?:\/\//i.test(trimmed) || /^\/\//.test(trimmed)) return false;
    return trimmed.startsWith('file://') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('data:')
}

/**
 * @summary Canonical receipt href for a published post's `providerId` when it is not already a URL.
 * @param {String} channel
 * @param {String} account
 * @param {String} providerId
 * @returns {String}
 */
function receiptHrefFor(channel, account, providerId) {
    if (!providerId) return '';
    if (/^https?:\/\//i.test(providerId)) return providerId;
    const cleanAccount = String(account || '').replace(/^@/, '');
    if (channel === 'x') {
        return cleanAccount ? `https://x.com/${cleanAccount}/status/${providerId}` : `https://x.com/i/web/status/${providerId}`
    }
    if (channel === 'linkedin') {
        return `https://www.linkedin.com/feed/update/${providerId}`
    }
    return `#${providerId}`
}

/**
 * @class AgentOS.view.fleet.mailbox.PublishRequestComponent
 * @extends Neo.component.Base
 * @summary Renders a `requestPublish` Task in the operator's inbox:
 * 1. Post as it will appear (`channel · account · format` chip, verbatim text in `52ch`/`62ch`, local sha256-verified media strip, reply target).
 * 2. Gate line (`rev N · <short>`, cross-family attestation chip, effective switch chip, approval chip, gate notice).
 * 3. Hypothesis line (always visible).
 * 4. Actions (`Approve rev N · <short>`, `Edit & approve`, `Drop` with required reason).
 * 5. Outcome line (`queued · publishing · unresolved · published · refused`; generic Task `Completed` never renders as a receipt).
 */
class PublishRequestComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.mailbox.PublishRequestComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.mailbox.PublishRequestComponent',
        /**
         * @member {String} ntype='fm-publish-request-card'
         * @protected
         */
        ntype: 'fm-publish-request-card',
        /**
         * @member {String[]} baseCls=['fm-publish-request-card','fm-publish-card']
         * @protected
         */
        baseCls: ['fm-publish-request-card', 'fm-publish-card'],
        /**
         * Draft media array while inline Edit is open.
         * @member {Object[]|null} draftMedia_=null
         * @reactive
         */
        draftMedia_: null,
        /**
         * Draft post text while inline Edit is open.
         * @member {String} draftText_=''
         * @reactive
         */
        draftText_: '',
        /**
         * Whether the inline Drop reason bar is open.
         * @member {Boolean} dropping_=false
         * @reactive
         */
        dropping_: false,
        /**
         * Current reason typed into the inline Drop bar.
         * @member {String} dropReason_=''
         * @reactive
         */
        dropReason_: '',
        /**
         * Whether the inline Edit panel is open.
         * @member {Boolean} editing_=false
         * @reactive
         */
        editing_: false,
        /**
         * Notice shown after an inline Edit creates revision `N+1`.
         * @member {String} editingNotice_=''
         * @reactive
         */
        editingNotice_: '',
        /**
         * Detail entry when hosted inside `DetailContainer`.
         * @member {Object|null} entry_=null
         * @reactive
         */
        entry_: null,
        /**
         * Raw or normalized `requestPublish` message record (from contract fixtures or `read.message`).
         * @member {Object|null} message_=null
         * @reactive
         */
        message_: null,
        /**
         * Optional clock override for deterministic timestamps in tests.
         * @member {Number|null} now_=null
         * @reactive
         */
        now_: null,
        /**
         * Latest action outcome `{action, state, reason, code}`.
         * @member {Object|null} outcome_=null
         * @reactive
         */
        outcome_: null,
        /**
         * Effective `(peer, channel)` switch state override.
         * @member {String|null} switchState_=null
         * @reactive
         */
        switchState_: null,
        /**
         * @member {Object} _vdom
         */
        _vdom: {
            tag: 'section',
            cls: ['fm-publish-request-card'],
            cn : []
        }
    }

    /**
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);
        const me = this;

        me.addDomListeners([
            {click: me.onApproveClick,      delegate: '.fm-publish-approve',            scope: me},
            {click: me.onToggleEdit,        delegate: '.fm-publish-edit',               scope: me},
            {click: me.onSaveEditClick,     delegate: '.fm-publish-edit-save',          scope: me},
            {click: me.onCancelEditClick,   delegate: '.fm-publish-edit-cancel',        scope: me},
            {click: me.onRemoveMediaClick,  delegate: '.fm-publish-edit-media-remove',  scope: me},
            {click: me.onToggleDrop,        delegate: '.fm-publish-drop',               scope: me},
            {click: me.onConfirmDropClick,  delegate: '.fm-publish-drop-confirm',       scope: me},
            {click: me.onCancelDropClick,   delegate: '.fm-publish-drop-cancel',        scope: me},
            {click: me.onSwitchChipClick,   delegate: '.fm-publish-switch-chip',        scope: me},
            {input: me.onDraftTextInput,    delegate: '.fm-publish-edit-textarea',      scope: me},
            {input: me.onDropReasonInput,   delegate: '.fm-publish-drop-input',         scope: me}
        ]);

        me.renderCard()
    }

    /** @protected */
    afterSetDraftMedia()    { this.isConstructed && this.renderCard() }
    /** @protected */
    afterSetDraftText()     { this.isConstructed && this.editing && this.renderCard() }
    /** @protected */
    afterSetDropping()      { this.isConstructed && this.renderCard() }
    /** @protected */
    afterSetDropReason()    { this.isConstructed && this.dropping && this.renderCard() }
    /** @protected */
    afterSetEditing()       { this.isConstructed && this.renderCard() }
    /** @protected */
    afterSetEditingNotice() { this.isConstructed && this.renderCard() }
    /** @protected */
    afterSetEntry(val, old) {
        if (val?.messageId && old?.messageId && val.messageId !== old.messageId) {
            this.editing       = false;
            this.dropping      = false;
            this.editingNotice = ''
        }
        this.isConstructed && this.renderCard()
    }
    /** @protected */
    afterSetMessage(val, old) {
        const newId = val?.messageId ?? val?.id ?? null,
              oldId = old?.messageId ?? old?.id ?? null;
        if (newId && oldId && newId !== oldId) {
            this.editing       = false;
            this.dropping      = false;
            this.editingNotice = ''
        }
        this.isConstructed && this.renderCard()
    }
    /** @protected */
    afterSetNow()         { this.isConstructed && this.renderCard() }
    /** @protected */
    afterSetOutcome()     { this.isConstructed && this.renderCard() }
    /** @protected */
    afterSetSwitchState() { this.isConstructed && this.renderCard() }

    /**
     * @summary Extracts the normalized `requestPublish` view model from `message` or `entry`, never inventing missing fields.
     * @returns {Object}
     */
    resolveModel() {
        const rawSource = this.message ?? this.entry ?? {},
              raw       = rawSource.message && typeof rawSource.message === 'object' ? {...rawSource, ...rawSource.message} : rawSource,
              task      = raw.task && typeof raw.task === 'object' ? raw.task : {},
              revisions = Array.isArray(raw.revisions) ? raw.revisions : (Array.isArray(task.revisions) ? task.revisions : []),
              latestRev = revisions.at(-1) ?? null,
              revision  = raw.revision ?? task.revision ?? latestRev ?? null,
              payload   = revision?.payload ?? raw.requestPublish ?? task.requestPublish ?? latestRev?.payload ?? {},
              pub       = raw.publication ?? task.publication ?? raw.publicationState ?? task.publicationState ?? null;

        const channel    = typeof payload.channel === 'string' && payload.channel.trim() ? payload.channel.trim() : null,
              account    = typeof payload.account === 'string' && payload.account.trim() ? payload.account.trim() : null,
              format     = typeof payload.format === 'string' && payload.format.trim() ? payload.format.trim() : null,
              text       = typeof payload.text === 'string' && payload.text.length > 0 ? payload.text : null,
              hypothesis = typeof payload.hypothesis === 'string' && payload.hypothesis.trim() ? payload.hypothesis.trim() : null,
              inReplyTo  = typeof payload.inReplyTo === 'string' && payload.inReplyTo.trim() ? payload.inReplyTo.trim() : null,
              media      = Array.isArray(payload.media) ? payload.media : [];

        const hasFullPayload = Boolean(channel && account && format && text !== null),
              revisionNumber = Number.isInteger(revision?.revisionNumber) ? revision.revisionNumber : (revisions.length > 0 ? revisions.length : 1),
              revisionDigest = revision?.revisionDigest ?? raw.revisionDigest ?? pub?.currentRevisionDigest ?? pub?.revisionDigest ??
                  (hasFullPayload ? OperatorInbox.computeRevisionDigest({account, channel, format, inReplyTo, media, text}) : null);

        const rawAttestation = revision?.attestation ?? task.revision?.attestation ?? raw.attestation ?? payload.attestation ?? null,
              attestation    = (rawAttestation && typeof rawAttestation === 'object' &&
                  (!rawAttestation.revisionDigest || !revisionDigest || rawAttestation.revisionDigest === revisionDigest) &&
                  (rawAttestation.reviewer || rawAttestation.from || rawAttestation.reviewerMessageId))
                  ? rawAttestation : null;

        const rawApproval = revision?.approval ?? task.revision?.approval ?? raw.approval ?? null,
              approval    = (rawApproval && typeof rawApproval === 'object' &&
                  (!rawApproval.revisionDigest || !revisionDigest || rawApproval.revisionDigest === revisionDigest) &&
                  (!rawApproval.revisionNumber || rawApproval.revisionNumber === revisionNumber))
                  ? rawApproval : null;

        const peer             = raw.from ?? raw.requester ?? raw.sender ?? null,
              switchState      = this.switchState ?? raw.switchState ?? revision?.releaseState ?? PublishSwitch.DEFAULT_STATE,
              rawPubState      = pub?.state ?? null,
              publicationState = PUBLICATION_STATES.includes(rawPubState) ? rawPubState : 'queued',
              providerId       = (publicationState === 'published' && typeof pub?.providerId === 'string' && pub.providerId.trim()) ? pub.providerId.trim() : null,
              refusalReason    = pub?.refusalReason ?? pub?.reason ?? null,
              stateTimestamp   = pub?.readbackAt ?? pub?.reservedAt ?? pub?.reservation?.reservedAt ?? revision?.createdAt ?? raw.sentAt ?? null,
              taskState        = task.state ?? raw.taskState ?? null,
              replyTargetText  = raw.inReplyToText ?? raw.replyTargetText ?? payload.inReplyToText ?? null;

        return {
            account, approval, attestation, channel, format, hypothesis, inReplyTo, media,
            messageId  : raw.messageId ?? raw.taskId ?? raw.id ?? null,
            peer, providerId, publicationState, refusalReason, replyTargetText,
            revisionDigest, revisionNumber,
            shortDigest: shortDigestOf(revisionDigest),
            stateTimestamp, switchState, taskState, text
        }
    }

    /**
     * @summary Builds the VDOM for all five sections of the `requestPublish` card.
     */
    renderCard() {
        const me    = this,
              model = me.resolveModel(),
              chipParts = [model.channel ?? 'no channel', model.account ?? 'no account', model.format ?? 'no format'];

        const replyText = model.inReplyTo
            ? (model.replyTargetText ? `in reply to “${model.replyTargetText}” (${model.inReplyTo})` : `in reply to ${model.inReplyTo}`)
            : 'no reply target';

        const attText = model.attestation
            ? `${model.attestation.reviewer ?? model.attestation.from ?? model.attestation.reviewerMessageId ?? 'reviewer'} · ${model.attestation.family ?? model.attestation.reviewerFamily ?? 'cross-family'} · attests rev ${model.attestation.revisionNumber ?? model.revisionNumber}`
            : 'no cross-family attestation';

        const approver = model.approval ? (model.approval.approvedBy ?? model.approval.who ?? '@tobiu') : null;
        const gateNoticeText = me.editingNotice
            ? me.editingNotice
            : (model.switchState === 'auto-approve after a cross-family review attestation' && !model.attestation && !model.approval)
                ? 'waiting for a cross-family attestation — or your approval'
                : '';

        const terminalOrInFlight = ['publishing', 'published', 'unresolved'].includes(model.publicationState) ||
                                   model.taskState === 'Rejected' ||
                                   me.outcome?.state === 'pending';

        me.vdom.cls = ['fm-publish-request-card', 'fm-publish-card', `is-channel-${model.channel || 'x'}`];
        me.vdom.cn = [{
            tag: 'div',
            cls: ['fm-publish-post', 'fm-publish-card-post'],
            cn : [{
                tag: 'div',
                cls: ['fm-publish-post-head', 'fm-publish-card-post-head'],
                cn : [{
                    tag : 'span',
                    cls : ['fm-publish-channel-chip', 'fm-publish-card-channel-chip', ...(model.channel ? [`is-${model.channel}`] : ['is-absent'])],
                    text: chipParts.join(' · ')
                }]
            }, {
                tag: 'div',
                cls: ['fm-publish-post-row'],
                cn : [{
                    tag : 'div',
                    cls : ['fm-publish-text', 'fm-publish-card-text', 'fm-publish-post-text', model.channel === 'linkedin' ? 'is-channel-linkedin' : 'is-channel-x', ...(model.text === null ? ['is-absent'] : [])],
                    text: model.text ?? 'no text'
                }, {
                    tag : 'div',
                    cls : ['fm-publish-reply-target', 'fm-publish-card-reply-target', ...(model.inReplyTo ? [] : ['is-absent'])],
                    text: replyText
                }]
            }, me.buildMediaStripVdom(model.media)]
        }, {
            tag: 'div',
            cls: ['fm-publish-body-grid', 'fm-publish-card-gate'],
            cn : [{
                tag: 'div',
                cls: ['fm-publish-gate-line', 'fm-publish-card-gate-chips'],
                cn : [{
                    tag  : 'span',
                    cls  : ['fm-publish-chip', 'fm-publish-revision-chip', 'fm-publish-card-rev-chip', ...(model.revisionDigest ? [] : ['is-absent'])],
                    title: model.revisionDigest || '',
                    text : model.revisionDigest ? `rev ${model.revisionNumber} · ${model.shortDigest}` : 'no revision digest'
                }, {
                    tag : 'span',
                    cls : ['fm-publish-chip', 'fm-publish-attestation-chip', 'fm-publish-card-attestation-chip', model.attestation ? 'is-attested' : 'is-absent'],
                    text: attText
                }, {
                    tag  : 'button',
                    type : 'button',
                    cls  : ['fm-publish-chip', 'fm-publish-switch-chip', 'fm-publish-card-switch-chip'],
                    title: `Open Publishing switch for ${model.peer || 'peer'} × ${model.channel || 'channel'}`,
                    text : model.switchState || PublishSwitch.DEFAULT_STATE
                }, {
                    tag      : 'span',
                    cls      : ['fm-publish-chip', 'fm-publish-approval-chip', 'fm-publish-card-approval-chip', approver ? 'is-approved' : 'is-absent'],
                    removeDom: !approver,
                    text     : approver ? `approved by ${approver} · rev ${model.revisionNumber}` : 'no approval'
                }]
            }, {
                tag      : 'div',
                cls      : ['fm-publish-gate-notice', 'fm-publish-card-gate-notice'],
                removeDom: !gateNoticeText,
                text     : gateNoticeText
            }, {
                tag : 'div',
                cls : ['fm-publish-hypothesis', 'fm-publish-card-hypothesis', ...(model.hypothesis ? [] : ['is-absent'])],
                text: model.hypothesis ? `Hypothesis: ${model.hypothesis}` : 'no hypothesis'
            }]
        }, {
            tag: 'div',
            cls: ['fm-publish-actions', 'fm-publish-card-actions'],
            cn : [{
                tag     : 'button',
                type    : 'button',
                cls     : ['fm-publish-action', 'fm-publish-approve', 'fm-publish-card-btn', 'is-primary'],
                disabled: terminalOrInFlight || me.editing || !model.revisionDigest,
                text    : model.revisionDigest ? `Approve rev ${model.revisionNumber} · ${model.shortDigest}` : `Approve rev ${model.revisionNumber}`
            }, {
                tag     : 'button',
                type    : 'button',
                cls     : ['fm-publish-action', 'fm-publish-edit', 'fm-publish-card-btn'],
                disabled: terminalOrInFlight,
                text    : me.editing ? 'Cancel edit' : 'Edit & approve'
            }, {
                tag     : 'button',
                type    : 'button',
                cls     : ['fm-publish-action', 'fm-publish-drop', 'fm-publish-card-btn', 'is-danger'],
                disabled: terminalOrInFlight,
                text    : me.dropping ? 'Cancel drop' : 'Drop'
            }]
        }, {
            tag      : 'div',
            cls      : ['fm-publish-edit-panel', 'fm-publish-card-edit-box'],
            removeDom: !me.editing,
            cn       : me.editing ? [{
                tag : 'div',
                cls : ['fm-publish-edit-hint'],
                text: 'Edit text or remove media only — saving creates a new revision without prior attestation or approval.'
            }, {
                tag  : 'textarea',
                cls  : ['fm-publish-edit-textarea', 'fm-publish-card-edit-textarea'],
                rows : 3,
                value: me.draftText ?? ''
            }, {
                tag: 'div',
                cls: ['fm-publish-edit-media'],
                cn : (Array.isArray(me.draftMedia) ? me.draftMedia : []).map((item, index) => ({
                    tag : 'button',
                    type: 'button',
                    cls : ['fm-publish-edit-media-remove', 'fm-publish-card-btn'],
                    data: {index: String(index)},
                    text: `Remove ${item.uri || `media ${index + 1}`}`
                }))
            }, {
                tag: 'div',
                cls: ['fm-publish-edit-buttons', 'fm-publish-card-edit-actions'],
                cn : [{
                    tag : 'button',
                    type: 'button',
                    cls : ['fm-publish-action', 'fm-publish-edit-save', 'fm-publish-card-btn', 'is-primary'],
                    text: 'Save revision'
                }, {
                    tag : 'button',
                    type: 'button',
                    cls : ['fm-publish-action', 'fm-publish-edit-cancel', 'fm-publish-card-btn'],
                    text: 'Cancel'
                }]
            }] : []
        }, {
            tag      : 'div',
            cls      : ['fm-publish-drop-panel', 'fm-publish-card-drop-box'],
            removeDom: !me.dropping,
            cn       : me.dropping ? [{
                tag        : 'input',
                type       : 'text',
                cls        : ['fm-publish-drop-input', 'fm-publish-card-drop-input'],
                placeholder: 'Reason for dropping this publish request (required)',
                value      : me.dropReason ?? ''
            }, {
                tag: 'div',
                cls: ['fm-publish-drop-buttons', 'fm-publish-card-drop-actions'],
                cn : [{
                    tag : 'button',
                    type: 'button',
                    cls : ['fm-publish-action', 'fm-publish-drop-confirm', 'fm-publish-card-btn', 'is-danger'],
                    text: 'Drop request'
                }, {
                    tag : 'button',
                    type: 'button',
                    cls : ['fm-publish-action', 'fm-publish-drop-cancel', 'fm-publish-card-btn'],
                    text: 'Cancel'
                }]
            }] : []
        }, me.buildOutcomeLineVdom(model), {
            tag      : 'div',
            cls      : ['fm-publish-action-status', 'fm-publish-card-drop-error', ...(me.outcome?.state === 'refused' ? ['is-refused'] : [])],
            removeDom: !(me.outcome?.state === 'refused' && me.outcome.reason),
            text     : me.outcome?.state === 'refused' ? (me.outcome.reason || '') : ''
        }];

        me.update()
    }

    /**
     * @summary Builds the media strip VDOM without ever issuing a remote fetch.
     * @param {Object[]} media
     * @returns {Object}
     */
    buildMediaStripVdom(media = []) {
        if (!Array.isArray(media) || media.length === 0) {
            return {
                tag: 'div',
                cls: ['fm-publish-media-strip', 'fm-publish-card-media-strip', 'is-absent'],
                cn : [{tag: 'span', cls: ['fm-publish-media-empty'], text: 'no media'}]
            }
        }

        return {
            tag: 'div',
            cls: ['fm-publish-media-strip', 'fm-publish-card-media-strip'],
            cn : media.map((item, index) => {
                const uri      = typeof item?.uri === 'string' ? item.uri : '',
                      mimeType = typeof item?.mimeType === 'string' ? item.mimeType : 'unknown-type',
                      sha256   = typeof item?.sha256 === 'string' ? item.sha256 : '',
                      verified = isLocalMediaUri(uri) && item?.verified === true && /^[0-9a-f]{64}$/i.test(sha256);

                if (verified) {
                    return {
                        tag: 'div',
                        cls: ['fm-publish-media-item', 'fm-publish-card-media-item', 'is-verified'],
                        cn : [{
                            tag: 'img',
                            alt: `Media attachment ${index + 1}`,
                            cls: ['fm-publish-media-thumb', 'fm-publish-card-media-thumb'],
                            src: item.thumbnailUrl || uri
                        }, {
                            tag : 'span',
                            cls : ['fm-publish-media-meta', 'fm-publish-card-media-meta'],
                            text: `${mimeType} · sha256: ${shortShaOf(sha256)}`
                        }]
                    }
                }

                return {
                    tag: 'div',
                    cls: ['fm-publish-media-item', 'fm-publish-card-media-item', 'is-unverified'],
                    cn : [{
                        tag : 'span',
                        cls : ['fm-publish-media-unverified'],
                        text: `${uri || 'no uri'} · ${mimeType} · unverified`
                    }, ...(sha256 ? [{
                        tag : 'span',
                        cls : ['fm-publish-media-meta', 'fm-publish-card-media-meta'],
                        text: `sha256: ${shortShaOf(sha256)}`
                    }] : [])]
                }
            })
        }
    }

    /**
     * @summary Builds the publication outcome line VDOM (`queued · publishing · unresolved · published · refused`).
     * @param {Object} model
     * @returns {Object}
     */
    buildOutcomeLineVdom(model) {
        const state     = model.publicationState,
              whenLabel = model.stateTimestamp ? (ViewerTime.formatViewerTime(model.stateTimestamp, {now: this.now})?.text || model.stateTimestamp) : null,
              timePart  = whenLabel ? ` · ${whenLabel}` : '';

        if (model.taskState === 'Rejected' && state === 'queued') {
            const dropWhy = this.dropReason || model.refusalReason || 'rejected by operator';
            return {
                tag: 'div',
                cls: ['fm-publish-outcome', 'fm-publish-card-outcome', 'is-dropped'],
                cn : [{tag: 'span', cls: ['fm-publish-outcome-text'], text: `dropped · Rejected — ${dropWhy}${timePart}`}]
            }
        }

        if (state === 'published' && model.providerId) {
            return {
                tag: 'div',
                cls: ['fm-publish-outcome', 'fm-publish-card-outcome', 'is-published'],
                cn : [{
                    tag : 'span',
                    cls : ['fm-publish-outcome-state'],
                    text: `published${timePart} · `
                }, {
                    tag   : 'a',
                    cls   : ['fm-publish-receipt-link', 'fm-publish-card-outcome-receipt'],
                    href  : receiptHrefFor(model.channel, model.account, model.providerId),
                    rel   : 'noopener noreferrer',
                    target: '_blank',
                    text  : model.providerId
                }]
            }
        }

        if (state === 'unresolved') {
            return {
                tag: 'div',
                cls: ['fm-publish-outcome', 'fm-publish-card-outcome', 'is-unresolved'],
                cn : [{tag: 'span', cls: ['fm-publish-outcome-text'], text: `unresolved${timePart} — ${model.refusalReason || 'outcome unknown after reservation — reconciliation required'}`}]
            }
        }

        if (state === 'refused') {
            return {
                tag: 'div',
                cls: ['fm-publish-outcome', 'fm-publish-card-outcome', 'is-refused'],
                cn : [{tag: 'span', cls: ['fm-publish-outcome-text'], text: `refused${timePart} — ${model.refusalReason || 'publication refused'}`}]
            }
        }

        return {
            tag: 'div',
            cls: ['fm-publish-outcome', 'fm-publish-card-outcome', `is-${state}`],
            cn : [{tag: 'span', cls: ['fm-publish-outcome-text'], text: `${state}${timePart}`}]
        }
    }

    /** @summary Fires `approvePublishRequest` bound strictly to the currently displayed revision digest. */
    onApproveClick() {
        const model = this.resolveModel();
        if (!model.revisionDigest) return;

        this.fire('approvePublishRequest', {
            messageId     : model.messageId,
            revisionDigest: model.revisionDigest,
            revisionNumber: model.revisionNumber
        })
    }

    /** @summary Opens or closes the inline `Edit & approve` editor. */
    onToggleEdit() {
        const me = this;
        if (me.editing) {
            me.editing = false;
            return
        }
        const model = me.resolveModel();
        me.set({
            dropping  : false,
            draftMedia: model.media.map(item => ({...item})),
            draftText : model.text ?? '',
            editing   : true
        })
    }

    /** @summary Cancels the inline `Edit & approve` editor. */
    onCancelEditClick() {
        this.editing = false
    }

    /** @param {Object} data */
    onDraftTextInput(data) {
        if (typeof data?.value === 'string') {
            this.draftText = data.value
        }
    }

    /** @param {Object} data */
    onRemoveMediaClick(data) {
        const target = data.path?.find(el => el.cls?.includes('fm-publish-edit-media-remove')),
              index  = Number(target?.data?.index);
        Number.isInteger(index) && this.removeDraftMediaAt(index)
    }

    /** @param {Number} index */
    removeDraftMediaAt(index) {
        const current = Array.isArray(this.draftMedia) ? [...this.draftMedia] : [];
        if (index >= 0 && index < current.length) {
            current.splice(index, 1);
            this.draftMedia = current
        }
    }

    /**
     * @summary Saves the inline Edit (`text` and/or removed `media` items only), creating revision `N+1` with a new
     * `revisionDigest` and clearing `approval` and `attestation`.
     * @param {Object} [overridePatch]
     * @returns {Object|null}
     */
    applyEdit(overridePatch = null) {
        const me        = this,
              model     = me.resolveModel(),
              nextText  = typeof overridePatch?.text === 'string' ? overridePatch.text : me.draftText,
              nextMedia = Array.isArray(overridePatch?.media)
                  ? overridePatch.media.map(item => ({...item}))
                  : (Array.isArray(me.draftMedia) ? me.draftMedia.map(item => ({...item})) : model.media.map(item => ({...item})));

        const trimmedText = String(nextText ?? '');
        if (!trimmedText.trim()) {
            me.outcome = {action: 'editPublish', reason: 'Post text cannot be empty.', state: 'refused'};
            return null
        }

        const nextPayload = {
            account      : model.account ?? '',
            channel      : model.channel ?? 'x',
            format       : model.format ?? 'post',
            hypothesis   : model.hypothesis ?? '',
            inReplyTo    : model.inReplyTo ?? null,
            media        : nextMedia,
            schemaVersion: 1,
            text         : trimmedText
        };

        const nextRevisionNumber = model.revisionNumber + 1,
              nextRevisionDigest = OperatorInbox.computeRevisionDigest(nextPayload),
              nextRevision       = {
                  approval      : null,
                  attestation   : null,
                  payload       : nextPayload,
                  revisionDigest: nextRevisionDigest,
                  revisionNumber: nextRevisionNumber
              };

        const baseRecord    = me.message ?? me.entry ?? {},
              updatedRecord = {
                  ...baseRecord,
                  approval      : null,
                  attestation   : null,
                  requestPublish: nextPayload,
                  revision      : nextRevision,
                  revisionDigest: nextRevisionDigest,
                  publication   : {
                      ...(baseRecord.publication ?? {}),
                      currentRevisionDigest: nextRevisionDigest,
                      currentRevisionNumber: nextRevisionNumber,
                      revisionDigest       : nextRevisionDigest,
                      revisionNumber       : nextRevisionNumber,
                      state                : 'queued',
                      textAsRequested      : trimmedText
                  }
              };

        me.set({
            editing      : false,
            editingNotice: `new revision ${nextRevisionNumber} — attestation and approval cleared`,
            ...(me.message ? {message: updatedRecord} : {entry: updatedRecord})
        });

        const patch = {media: nextMedia, text: trimmedText};
        me.fire('editPublishRequest', {
            messageId     : model.messageId,
            patch,
            revisionDigest: nextRevisionDigest,
            revisionNumber: nextRevisionNumber
        });

        return {patch, revisionDigest: nextRevisionDigest, revisionNumber: nextRevisionNumber}
    }

    /** @summary Click handler for `Save revision`. */
    onSaveEditClick() {
        this.applyEdit()
    }

    /** @summary Opens or closes the inline `Drop` reason bar. */
    onToggleDrop() {
        const me = this;
        if (me.dropping) {
            me.dropping = false;
            return
        }
        me.set({dropping: true, dropReason: '', editing: false})
    }

    /** @summary Cancels the inline `Drop` bar. */
    onCancelDropClick() {
        this.dropping = false
    }

    /** @param {Object} data */
    onDropReasonInput(data) {
        if (typeof data?.value === 'string') {
            this.dropReason = data.value
        }
    }

    /**
     * @summary Submits a Drop action with the required operator reason (`newState: 'Rejected'`).
     * @param {String} [reasonOverride]
     * @returns {Boolean}
     */
    submitDrop(reasonOverride) {
        const me            = this,
              model         = me.resolveModel(),
              trimmedReason = String(reasonOverride !== undefined ? reasonOverride : me.dropReason ?? '').trim();

        if (!trimmedReason) {
            me.outcome = {
                action: 'dropPublish',
                reason: 'A reason is required to drop a publish request.',
                state : 'refused'
            };
            return false
        }

        me.set({dropping: false, dropReason: trimmedReason, outcome: null});

        me.fire('dropPublishRequest', {
            expectedCurrentState: model.taskState,
            messageId           : model.messageId,
            newState            : 'Rejected',
            reason              : trimmedReason
        });

        return true
    }

    /** @summary Click handler for `Drop request`. */
    onConfirmDropClick() {
        this.submitDrop()
    }

    /** @summary Click handler for the effective switch chip. */
    onSwitchChipClick() {
        const model = this.resolveModel();
        this.fire('openPublishSwitch', {
            channel    : model.channel ?? 'x',
            peer       : model.peer,
            switchState: model.switchState
        })
    }
}

export default Neo.setupClass(PublishRequestComponent);
