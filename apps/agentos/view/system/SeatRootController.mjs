import ComponentController from '../../../../node_modules/neo.mjs/src/controller/Component.mjs';

const
    outcomeCanPlan = outcome => outcome?.state === 'none' || outcome?.state === 'refused',
    hasRoot = root => typeof root === 'string' ? !!root : typeof root?.root === 'string' && !!root.root,
    isAbsolutePath = value => typeof value === 'string' && (
        value.startsWith('/') || /^[A-Z]:[\\/]/i.test(value) || /^\\\\/.test(value)
    ),
    PLAN_ROW_STATES = new Set(['copy', 'relocate', 'rebind', 'done', 'untouched']),
    MOVABLE_STATES = new Set(['copy', 'relocate', 'rebind']),
    optionalText = value => value === undefined || value === null || typeof value === 'string';

/**
 * @class AgentOS.view.system.SeatRootController
 * @extends Neo.controller.Component
 *
 * @summary Owns the shell calls for the local seat-root section. The System view receives only
 * answer data, and every mutation sends the fingerprint of the plan the operator saw.
 */
class SeatRootController extends ComponentController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.system.SeatRootController'
         * @protected
         */
        className: 'AgentOS.view.system.SeatRootController'
    }

    /**
     * @member {Number} requestId=0
     * @protected
     */
    requestId = 0

    /** @member {Object|null} settlementTimer=null */
    settlementTimer = null

    /**
     * @summary Whether a plan response carries a complete, renderable row census. Refused responses
     * may contain only a reason; planned responses need both roots, the fingerprint and valid rows.
     * @param {Object} answer
     * @returns {Boolean}
     */
    static isPlanResponse(answer) {
        if (!answer || !['planned', 'refused'].includes(answer.state) || !optionalText(answer.code) || !optionalText(answer.reason)) {
            return false
        }

        if (answer.state === 'refused' && !Array.isArray(answer.rows)) return true;
        if (!isAbsolutePath(answer.from) || !isAbsolutePath(answer.to) || !Array.isArray(answer.rows)) return false;
        if (answer.fingerprint != null && !/^[a-f0-9]{64}$/.test(answer.fingerprint)) return false;
        if (answer.state === 'planned' && !/^[a-f0-9]{64}$/.test(answer.fingerprint ?? '')) return false;

        return answer.rows.every(row => row &&
            typeof row.id === 'string' && row.id.length > 0 &&
            (row.seatHome == null || isAbsolutePath(row.seatHome)) &&
            isAbsolutePath(row.destination) &&
            PLAN_ROW_STATES.has(row.state) &&
            typeof row.materialized === 'boolean' &&
            optionalText(row.code) && optionalText(row.reason))
    }

    /**
     * @summary Whether a validated planned response has at least one seat to move.
     * @param {Object} plan
     * @returns {Boolean}
     */
    static isConsentablePlan(plan) {
        return SeatRootController.isPlanResponse(plan) && plan.state === 'planned' &&
            plan.rows.some(row => MOVABLE_STATES.has(row.state))
    }

    /**
     * @summary Wire the local intents and read status once, so a relaunched shell reports its
     * boot outcome immediately. Mount never plans or consents to a move.
     */
    onComponentConstructed() {
        this.component.on({
            seatRootStatusRequest : this.readStatus,
            seatRootPlanRequest   : this.reviewMove,
            seatRootConsentRequest: this.consentMove,
            scope                 : this
        });
        this.readStatus()
    }

    /**
     * @summary Invalidate pending replies and detach the System section's intents.
     * @param {...*} args
     */
    destroy(...args) {
        const component = this.component;

        clearTimeout(this.settlementTimer);
        this.requestId++;
        component?.un({
            seatRootStatusRequest : this.readStatus,
            seatRootPlanRequest   : this.reviewMove,
            seatRootConsentRequest: this.consentMove,
            scope                 : this
        });
        super.destroy(...args)
    }

    /**
     * @summary Read the installation's root, consent record and latest boot outcome. A refused or
     * incomplete reply stays unknown; it never becomes an empty installation.
     * @returns {Promise<void>}
     */
    async readStatus() {
        const
            me        = this,
            component = me.component,
            requestId = ++me.requestId;

        clearTimeout(me.settlementTimer);
        me.settlementTimer = null;
        component.set({busy: 'status', feedback: null, plan: null});

        const reply = await me.callShell('seatRootStatus');

        if (!me.isCurrent(requestId)) return;

        const
            outcome = reply?.outcome ?? null,
            details = {
                packaged: reply?.packaged,
                root    : reply?.root ?? null,
                pending : reply?.pending ?? null,
                outcome,
                code    : reply?.code,
                reason  : reply?.reason
            };

        if (reply?.state === 'refused') {
            component.set({
                busy    : null,
                snapshot: {...details, state: 'refused', reason: reply.reason ?? 'the shell refused the status read'}
            });
            return
        }

        if (reply?.packaged !== true) {
            component.set({
                busy    : null,
                snapshot: {
                    ...details,
                    state : 'unavailable',
                    reason: reply?.reason ?? (reply?.packaged === false ? 'seat-root moves require the installed shell' : 'the shell did not report its packaged state')
                }
            });
            return
        }

        if (!reply || !Object.hasOwn(reply, 'root') || !Object.hasOwn(reply, 'pending') || !Object.hasOwn(reply, 'outcome')) {
            component.set({
                busy    : null,
                snapshot: {...details, state: 'unavailable', reason: reply?.reason ?? 'the shell returned no seat-root status'}
            });
            return
        }

        component.set({
            busy    : null,
            snapshot: {...details, state: 'available'}
        });

        // Window creation precedes boot settlement. Re-read only that unfinished move; a
        // settled outcome or unavailable read stops the timer without retrying an effect.
        if (outcome === null && Array.isArray(reply.pending?.rows)) {
            me.settlementTimer = setTimeout(() => {
                me.isCurrent(requestId) && me.readStatus()
            }, 2000)
        }
    }

    /**
     * @summary Ask the shell for a fresh plan only from readable, settled installation state.
     * @returns {Promise<void>}
     */
    async reviewMove() {
        const
            me        = this,
            component = me.component;

        if (component.busy || !component.canReviewMove()) return;

        const requestId = ++me.requestId;

        component.set({busy: 'plan', feedback: null, plan: null});

        const reply = await me.callShell('seatRootPlan');

        if (!me.isCurrent(requestId)) return;

        if (SeatRootController.isPlanResponse(reply)) {
            component.set({
                busy    : null,
                plan    : reply,
                feedback: reply.state === 'refused' ? {
                    state : 'refused',
                    code  : reply.code,
                    reason: reply.reason ?? 'the move plan was refused'
                } : null,
                ...(reply.state === 'refused' ? {snapshot: {...component.snapshot, refreshRequired: true}} : {})
            });
            return
        }

        component.set({
            busy    : null,
            plan    : null,
            feedback: {state: 'refused', code: reply?.code, reason: reply?.reason ?? 'the shell returned an invalid move plan'},
            snapshot: {...component.snapshot, refreshRequired: true}
        })
    }

    /**
     * @summary Consent to only the visible plan fingerprint; paths and rows never cross back as
     * renderer authority.
     * @returns {Promise<void>}
     */
    async consentMove() {
        const
            me        = this,
            component = me.component,
            fingerprint = component.plan?.fingerprint;

        if (component.busy || !component.canConsentMove() || typeof fingerprint !== 'string') return;

        const requestId = ++me.requestId;

        component.set({busy: 'consent', feedback: null});

        const reply = await me.callShell('seatRootConsent', {fingerprint});

        if (!me.isCurrent(requestId)) return;

        if (reply?.state === 'consented') {
            component.set({
                busy    : null,
                plan    : null,
                feedback: {state: 'consented', reason: 'Consent saved. The shell will relaunch to move these seats.'},
                snapshot: {...component.snapshot, refreshRequired: true}
            });
            return
        }

        component.set({
            busy    : null,
            plan    : null,
            feedback: {state: 'refused', code: reply?.code, reason: reply?.reason ?? 'the shell refused the move consent'},
            snapshot: {...component.snapshot, refreshRequired: true}
        })
    }

    /**
     * @summary Send one named ShellPlane capability, with its window context, or return a named
     * no-shell refusal. Errors remain plain text for the component's text sink.
     * @param {String} name
     * @param {Object} [request={}]
     * @returns {Promise<Object>}
     * @private
     */
    async callShell(name, request = {}) {
        const shell = globalThis.Neo?.main?.addon?.ShellPlane;

        if (typeof shell?.[name] !== 'function') {
            return {state: 'refused', reason: 'no-shell'}
        }

        try {
            return await shell[name]({...request, windowId: this.windowId ?? this.component?.windowId})
        } catch (error) {
            return {state: 'refused', reason: error?.message ?? 'the shell did not answer'}
        }
    }

    /**
     * @summary Whether a reply still belongs to this live view's latest request.
     * @param {Number} requestId
     * @returns {Boolean}
     */
    isCurrent(requestId) {
        return requestId === this.requestId && !this.isDestroyed && !this.component?.isDestroyed
    }
}

export default Neo.setupClass(SeatRootController);
