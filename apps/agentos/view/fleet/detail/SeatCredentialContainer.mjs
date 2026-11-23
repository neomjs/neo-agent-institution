import Button         from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container      from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import SeatCredential from '../../../util/SeatCredential.mjs';

/**
 * @class AgentOS.view.fleet.detail.SeatCredentialContainer
 * @extends Neo.container.Base
 *
 * @summary Agent Detail › Configuration's GitHub token group: offers `"Replace token"` only for a
 * stopped seat (explaining `cause: 'seat-running'` when running), reads `getAgent(id).planeCredential`
 * on click to offer the uncommitted two-scope choice for `'same-as-forge'` and `'distinct'` (or
 * GitHub-only replacement for `'none'`, `'unreadable'`, and failed reads), surfaces `"Replace token"`
 * next steps (including re-running incomplete replacement receipts with `receipt.scope`), and renders
 * `tokenExpiresAt` when reported.
 *
 * Credential bytes never enter this view: `SeatCredential.replace` forwards only `{id, scope}` to the
 * shell-owned `replaceSeatCredential` prompt.
 */
class SeatCredentialContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.SeatCredentialContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.SeatCredentialContainer',
        /**
         * @member {String} ntype='fm-seat-credential'
         * @protected
         */
        ntype: 'fm-seat-credential',
        /**
         * @member {String[]} baseCls=['fm-seat-credential']
         */
        baseCls: ['fm-seat-credential'],
        /**
         * @member {String[]} additionalThemeFiles=['AgentOS.view.fleet.mailbox.Chips']
         */
        additionalThemeFiles: ['AgentOS.view.fleet.mailbox.Chips'],
        /**
         * Optional test seam resolving the Fleet registry bridge (`() => bridge`).
         * @member {Function|null} bridgeResolver=null
         */
        bridgeResolver: null,
        /**
         * Injected wall clock (epoch ms) for `tokenExpiresAt` 7-day evaluation; `null` uses `Date.now()`.
         * @member {Number|null} now_=null
         * @reactive
         */
        now_: null,
        /**
         * Copy explaining the Agent OS credential relationship (`'same-as-forge'`, `'distinct'`,
         * `'unreadable'`, or why a failed `getAgent` read omitted the Agent OS choice).
         * @member {String|null} note_=null
         * @reactive
         */
        note_: null,
        /**
         * Active scope-choice state (`'same-as-forge' | 'distinct' | null`). Only those two states reveal
         * the Agent OS scope buttons, always with `selectedScope === null` (nothing pre-selected).
         * @member {String|null} planeChoice_=null
         * @reactive
         */
        planeChoice_: null,
        /**
         * Latest non-secret replacement receipt (`{nextStep, scope, ...}`) for the displayed seat.
         * @member {Object|null} receipt_=null
         * @reactive
         */
        receipt_: null,
        /**
         * Reason accompanying an incomplete replacement receipt, if any.
         * @member {String|null} receiptReason_=null
         * @reactive
         */
        receiptReason_: null,
        /**
         * The drilled-in `FleetAgent` record (or plain field bag).
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * Explicit operator scope selection while a replacement prompt is in flight; `null` initially
         * so neither scope option is ever pre-selected.
         * @member {String|null} selectedScope_=null
         * @reactive
         */
        selectedScope_: null,
        /**
         * Ephemeral round-trip feedback `{state: 'idle'|'pending'|'accepted'|'rejected', reason}`.
         * @member {Object} status_={state:'idle',reason:''}
         * @reactive
         */
        status_: {state: 'idle', reason: ''},
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype: 'component',
            cls  : ['fm-seat-credential-heading'],
            flex : 'none',
            text : 'GitHub token'
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-credential-line'],
            flex     : 'none',
            reference: 'credential-line'
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-credential-expiry'],
            flex     : 'none',
            hidden   : true,
            reference: 'credential-expiry'
        }, {
            module   : Button,
            cls      : ['fm-chip', 'fm-seat-credential-replace'],
            flex     : 'none',
            handler  : 'up.onReplaceClick',
            hidden   : true,
            reference: 'replace-token-button',
            text     : SeatCredential.ACTION_LABEL
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-credential-note'],
            flex     : 'none',
            hidden   : true,
            reference: 'credential-note'
        }, {
            ntype    : 'container',
            cls      : ['fm-seat-credential-offer'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'scope-offer',
            items    : [{
                module   : Button,
                cls      : ['fm-chip', 'fm-seat-credential-scope', 'is-selectable'],
                flex     : 'none',
                handler  : 'up.onScopeForgeClick',
                reference: 'scope-forge',
                text     : 'GitHub only',
                vdom     : {'aria-pressed': 'false'}
            }, {
                module   : Button,
                cls      : ['fm-chip', 'fm-seat-credential-scope', 'is-selectable'],
                flex     : 'none',
                handler  : 'up.onScopePlaneClick',
                reference: 'scope-forge-and-bound-plane',
                text     : 'GitHub and the connected Agent OS',
                vdom     : {'aria-pressed': 'false'}
            }, {
                module   : Button,
                cls      : ['fm-chip', 'fm-seat-credential-cancel'],
                flex     : 'none',
                handler  : 'up.onCancelScopeClick',
                reference: 'scope-cancel',
                text     : 'Cancel'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-credential-status', 'is-idle'],
            flex     : 'none',
            reference: 'credential-status',
            vdom     : {'aria-live': 'polite'}
        }]
    }

    /**
     * Monotonic fence for async `getAgent` / `replaceSeatCredential` calls on this component.
     * @member {Number} credentialRequest=0
     * @protected
     */
    credentialRequest = 0

    /** @param {...*} args */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.syncCredential()
    }

    /** @param {Number|null} value @param {Number|null} oldValue @protected */
    afterSetNow(value, oldValue) {
        oldValue !== undefined && this.isConstructed && this.syncCredential()
    }

    /** @param {String|null} value @param {String|null} oldValue @protected */
    afterSetNote(value, oldValue) {
        oldValue !== undefined && this.isConstructed && this.syncCredential()
    }

    /** @param {String|null} value @param {String|null} oldValue @protected */
    afterSetPlaneChoice(value, oldValue) {
        oldValue !== undefined && this.isConstructed && this.syncCredential()
    }

    /** @param {Object|null} value @param {Object|null} oldValue @protected */
    afterSetReceipt(value, oldValue) {
        oldValue !== undefined && this.isConstructed && this.syncCredential()
    }

    /** @param {String|null} value @param {String|null} oldValue @protected */
    afterSetReceiptReason(value, oldValue) {
        oldValue !== undefined && this.isConstructed && this.syncCredential()
    }

    /**
     * Re-seating onto another resident clears any earlier scope prompt, note, receipt, and round-trip feedback.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        if (oldValue !== undefined) {
            if (value?.agentId !== oldValue?.agentId) {
                this.credentialRequest++;
                this.set({
                    note         : null,
                    planeChoice  : null,
                    receipt      : null,
                    receiptReason: null,
                    selectedScope: null,
                    status       : {state: 'idle', reason: ''}
                })
            } else if (!SeatCredential.availability(value).canReplace && this.planeChoice) {
                this.credentialRequest++;
                this.set({
                    planeChoice  : null,
                    selectedScope: null,
                    status       : {state: 'idle', reason: ''}
                })
            }

            this.isConstructed && this.syncCredential()
        }
    }

    /** @param {String|null} value @param {String|null} oldValue @protected */
    afterSetSelectedScope(value, oldValue) {
        oldValue !== undefined && this.isConstructed && this.syncCredential()
    }

    /** @param {Object} value @param {Object} oldValue @protected */
    afterSetStatus(value, oldValue) {
        oldValue !== undefined && this.isConstructed && this.syncCredential()
    }

    /**
     * @summary Repaints in-place mutations on the same `FleetAgent` record as well as record swaps.
     * @param {Object|null} record
     * @param {Number|null} [now=this.now]
     */
    updateRecord(record, now = this.now) {
        if (now !== this.now) {
            this.now = now
        }

        if (this.record === record) {
            if (!SeatCredential.availability(record).canReplace && this.planeChoice) {
                this.credentialRequest++;
                this.set({planeChoice: null, selectedScope: null, status: {state: 'idle', reason: ''}})
            }
            this.syncCredential()
        } else {
            this.record = record
        }
    }

    /**
     * @summary Resolve the active Fleet registry bridge.
     * @returns {Object|null}
     * @protected
     */
    resolveBridge() {
        return this.bridgeResolver ? this.bridgeResolver() : (globalThis.AgentOS?.fleet?.registryBridge ?? null)
    }

    /**
     * @summary Render the token line, expiry, `"Replace token"` button, scope choice, and status line.
     */
    syncCredential() {
        const
            me           = this,
            record       = me.record,
            agentId      = typeof record?.agentId === 'string' ? record.agentId.trim() : '',
            availability = SeatCredential.availability(record),
            pending      = me.status?.state === 'pending',
            clock        = Number.isFinite(me.now) ? me.now : Date.now(),
            expiry       = record ? SeatCredential.describeExpiry(record.tokenExpiresAt ?? null, clock) : null,
            next         = record ? SeatCredential.nextStep(record, {receipt: me.receipt, reason: me.receiptReason}) : null;

        me.hidden = !agentId;

        if (!agentId) {
            return
        }

        const line = me.getReference('credential-line');

        if (!availability.canReplace && availability.cause === 'seat-running') {
            line.set({
                cls : ['fm-seat-credential-line', 'is-running'],
                text: availability.reason
            })
        } else if (next) {
            line.set({
                cls : ['fm-seat-credential-line', 'is-refused'],
                text: `${next.reason} · Next step: ${next.actionLabel}`
            })
        } else {
            line.set({
                cls : ['fm-seat-credential-line'],
                text: 'Stored in encrypted Fleet custody; replaced only through the shell prompt.'
            })
        }

        const showScopeOffer = availability.canReplace && (me.planeChoice === 'same-as-forge' || me.planeChoice === 'distinct');

        me.getReference('credential-expiry').set({
            cls   : ['fm-seat-credential-expiry', ...(expiry?.expiringSoon ? ['is-expiring'] : [])],
            hidden: !expiry,
            text  : expiry
                ? showScopeOffer
                    ? `${expiry.cardClause} (${expiry.tokenExpiresAt})`
                    : expiry.detailText
                : ''
        });

        // "Replace token" is offered only when the seat is stopped and folds while the scope choice is open.
        me.getReference('replace-token-button').set({
            disabled: pending,
            hidden  : !availability.canReplace || showScopeOffer,
            text    : SeatCredential.ACTION_LABEL
        });

        me.getReference('credential-note').set({
            hidden: !me.note,
            text  : me.note ?? ''
        });

        me.getReference('scope-offer').hidden = !showScopeOffer;

        for (const [scope, ref] of [['forge', 'scope-forge'], ['forge-and-bound-plane', 'scope-forge-and-bound-plane']]) {
            const
                chip       = me.getReference(ref),
                isSelected = me.selectedScope === scope;

            chip.set({
                cls     : ['fm-chip', 'fm-seat-credential-scope', isSelected ? 'is-selected' : 'is-selectable'],
                disabled: pending
            });
            chip.changeVdomRootKey('aria-pressed', String(isSelected))
        }

        me.getReference('scope-cancel').disabled = pending;

        me.getReference('credential-status').set({
            cls : ['fm-seat-credential-status', `is-${me.status?.state ?? 'idle'}`],
            text: me.status?.reason ?? ''
        })
    }

    /**
     * @summary Handle `"Replace token"`: re-runs directly with `receipt.scope` when recovering an incomplete
     * replacement (`nextStep: 'replace-seat-credential'`), else reads `getAgent(id).planeCredential` to
     * either open the uncommitted Agent OS scope choice (`'same-as-forge' | 'distinct'`) or replace for
     * GitHub only (`'none' | 'unreadable'` or failed read).
     * @returns {Promise<Object|null>}
     */
    async onReplaceClick() {
        const
            me           = this,
            availability = SeatCredential.availability(me.record);

        if (!availability.canReplace || me.status?.state === 'pending') {
            return null
        }

        if (me.receipt?.nextStep === 'replace-seat-credential' && SeatCredential.SCOPES.includes(me.receipt.scope)) {
            return me.submitScope(me.receipt.scope)
        }

        const
            agentId = me.record.agentId.trim(),
            request = ++me.credentialRequest;

        me.set({
            note         : null,
            planeChoice  : null,
            selectedScope: null,
            status       : {state: 'pending', reason: 'Checking Agent OS credential binding…'}
        });

        const planeRead = await SeatCredential.readPlaneCredential(me.resolveBridge(), agentId);

        if (request !== me.credentialRequest || me.isDestroyed || me.record?.agentId?.trim() !== agentId) {
            return null
        }

        if (!SeatCredential.availability(me.record).canReplace) {
            me.set({planeChoice: null, selectedScope: null, status: {state: 'idle', reason: ''}});
            return null
        }

        if (planeRead.needsChoice) {
            me.set({
                note         : planeRead.note,
                planeChoice  : planeRead.planeCredential,
                selectedScope: null,
                status       : {state: 'idle', reason: ''}
            });
            return planeRead
        }

        me.note = planeRead.note;
        return me.submitScope('forge', request)
    }

    /** @summary Choose `"GitHub only"` (`scope: 'forge'`). @returns {Promise<Object|null>} */
    onScopeForgeClick() {
        return this.submitScope('forge')
    }

    /** @summary Choose `"GitHub and the connected Agent OS"` (`scope: 'forge-and-bound-plane'`). @returns {Promise<Object|null>} */
    onScopePlaneClick() {
        return this.submitScope('forge-and-bound-plane')
    }

    /** @summary Close the scope choice without sending a replacement intent. */
    onCancelScopeClick() {
        if (this.status?.state === 'pending') {
            return
        }

        this.credentialRequest++;
        this.set({
            note         : null,
            planeChoice  : null,
            selectedScope: null,
            status       : {state: 'idle', reason: ''}
        })
    }

    /**
     * @summary Submit `{id, scope}` through `SeatCredential.replace` and reconcile receipt/refusal state.
     * @param {'forge'|'forge-and-bound-plane'} scope
     * @param {Number|null} [existingRequest=null]
     * @returns {Promise<Object|null>}
     */
    async submitScope(scope, existingRequest = null) {
        const
            me           = this,
            availability = SeatCredential.availability(me.record);

        if (!availability.canReplace) {
            me.set({
                planeChoice  : null,
                selectedScope: null,
                status       : {state: 'rejected', reason: availability.reason || 'Stop the seat before replacing its token.'}
            });
            return null
        }

        const
            agentId = me.record.agentId.trim(),
            request = existingRequest ?? ++me.credentialRequest;

        me.set({
            selectedScope: scope,
            status       : {state: 'pending', reason: 'Waiting for the new GitHub token…'}
        });

        const outcome = await SeatCredential.replace(me.resolveBridge(), {id: agentId, scope});

        if (request !== me.credentialRequest || me.isDestroyed || me.record?.agentId?.trim() !== agentId) {
            return outcome
        }

        if (outcome.ok) {
            if (SeatCredential.isStartCredentialRefusal(me.record.controlReason)) {
                typeof me.record.set === 'function'
                    ? me.record.set({controlReason: null})
                    : (me.record.controlReason = null)
            }

            me.set({
                note         : null,
                planeChoice  : null,
                receipt      : outcome.receipt,
                receiptReason: null,
                selectedScope: null,
                status       : {state: 'accepted', reason: 'GitHub token replaced. Start the seat when ready.'}
            });

            me.fire('seatCredentialReplaced', {
                agentId,
                receipt: outcome.receipt,
                scope  : outcome.scope
            });

            return outcome
        }

        if (outcome.receipt?.nextStep === 'replace-seat-credential') {
            me.set({
                planeChoice  : null,
                receipt      : outcome.receipt,
                receiptReason: outcome.reason,
                selectedScope: null,
                status       : {state: 'rejected', reason: outcome.reason}
            });
            return outcome
        }

        me.set({
            planeChoice  : outcome.cause === 'seat-running' ? null : me.planeChoice,
            receipt      : outcome.receipt,
            receiptReason: null,
            selectedScope: null,
            status       : {state: 'rejected', reason: outcome.reason}
        });

        return outcome
    }
}

export default Neo.setupClass(SeatCredentialContainer);
