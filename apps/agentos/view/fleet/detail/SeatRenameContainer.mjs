import Button    from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';

/**
 * @class AgentOS.view.fleet.detail.SeatRenameContainer
 * @extends Neo.container.Base
 * @summary Inline Selected-Agent flow for reviewing and applying a stopped seat's durable Fleet-id
 * transition. Renders the proposed `from -> to` plan rows as
 * inert `text` VDOM nodes, gates the confirm action on a valid 64-hex plan fingerprint while the
 * seat remains stopped, and displays the settled outcome or refusal inline.
 */
class SeatRenameContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.SeatRenameContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.SeatRenameContainer',
        /**
         * @member {String} ntype='fm-seat-rename-container'
         * @protected
         */
        ntype: 'fm-seat-rename-container',
        /**
         * @member {String[]} baseCls=['fm-seat-rename']
         */
        baseCls: ['fm-seat-rename'],
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-seat-rename-controls'],
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                module         : TextField,
                clearable      : false,
                cls            : ['fm-seat-rename-input'],
                flex           : 1,
                labelText      : 'New id',
                listeners      : {change: 'up.onNewIdChange'},
                placeholderText: 'e.g. neo-gemini-julia',
                reference      : 'seat-rename-input'
            }, {
                module   : Button,
                cls      : ['fm-chip', 'fm-seat-rename-review'],
                disabled : true,
                flex     : 'none',
                handler  : 'up.onReviewRename',
                reference: 'review-seat-rename-button',
                text     : 'Review rename'
            }, {
                module   : Button,
                cls      : ['fm-chip', 'fm-seat-rename-confirm'],
                disabled : true,
                flex     : 'none',
                handler  : 'up.onConfirmRename',
                reference: 'confirm-seat-rename-button',
                text     : 'Rename seat'
            }, {
                module   : Button,
                cls      : ['fm-chip', 'fm-seat-rename-cancel'],
                flex     : 'none',
                handler  : 'up.onCancelRename',
                reference: 'cancel-seat-rename-button',
                text     : 'Cancel'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-rename-plan'],
            hidden   : true,
            reference: 'seat-rename-plan',
            vdom     : {tag: 'div', cn: []}
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-rename-status'],
            hidden   : true,
            reference: 'seat-rename-status'
        }]
    }

    /**
     * @member {String|null} agentId=null
     */
    agentId = null
    /**
     * @member {Boolean} busy=false
     */
    busy = false
    /**
     * @member {Boolean} canRename=false
     */
    canRename = false
    /**
     * @member {Object|null} plan=null
     */
    plan = null
    /**
     * @member {String} proposedId=''
     */
    proposedId = ''
    /**
     * @member {Object|null} settledOutcome=null
     */
    settledOutcome = null

    /**
     * @summary Opens the inline rename section for the given stopped seat.
     * @param {String} agentId
     */
    openForSeat(agentId) {
        const
            me    = this,
            input = me.getReference('seat-rename-input');

        me.agentId        = agentId ?? null;
        me.busy           = false;
        me.plan           = null;
        me.settledOutcome = null;
        me.hidden         = false;

        if (input) {
            me.proposedId = (input.value ?? '').trim()
        }

        me.renderPlan(null);
        me.renderStatus(null);
        me.syncButtons()
    }

    /**
     * @summary Resets and hides the inline rename section.
     */
    reset() {
        const me = this;

        me.agentId        = null;
        me.busy           = false;
        me.canRename      = false;
        me.plan           = null;
        me.proposedId     = '';
        me.settledOutcome = null;
        me.hidden         = true;
        me.renderPlan(null);
        me.renderStatus(null);
        me.syncButtons()
    }

    /**
     * @summary Syncs the section with the currently selected seat and its stopped state.
     * @param {Object} data
     * @param {String|null} data.agentId
     * @param {Boolean} data.canRename
     */
    updateSeat({agentId, canRename}) {
        const me = this;

        me.canRename = Boolean(canRename);

        if (me.settledOutcome && me.settledOutcome.to === agentId) {
            me.agentId = agentId;
            me.hidden  = false;
            me.syncButtons();
            return
        }

        if (me.agentId && me.agentId !== agentId) {
            me.reset();
            return
        }

        me.agentId = agentId ?? null;

        if (!me.hidden && !me.canRename) {
            me.plan = null;
            me.renderPlan(null);
            me.renderStatus({tone: 'refused', text: 'stop the seat to change its id'})
        }

        me.syncButtons()
    }

    /**
     * @summary Tracks edits to the proposed seat id and invalidates any stale plan.
     * @param {Object} data
     */
    onNewIdChange({value}) {
        const
            me   = this,
            next = typeof value === 'string' ? value.trim() : '';

        me.proposedId = next;

        if (me.plan && me.plan.to !== next) {
            me.plan = null;
            me.renderPlan(null)
        }

        me.syncButtons()
    }

    /**
     * @summary Requests a dry-run rename plan from the shell broker.
     */
    onReviewRename() {
        const me = this;

        if (!me.canRename || !me.agentId || !me.proposedId || me.busy) return;

        me.busy           = true;
        me.plan           = null;
        me.settledOutcome = null;
        me.renderPlan(null);
        me.renderStatus({tone: 'pending', text: `Reviewing rename ${me.agentId} → ${me.proposedId}…`});
        me.syncButtons();
        me.fire('requestSeatRenamePlan', {id: me.agentId, to: me.proposedId})
    }

    /**
     * @summary Confirms and applies the reviewed plan with its SHA-256 fingerprint.
     */
    onConfirmRename() {
        const me = this;

        if (!me.canRename || !me.plan?.fingerprint || me.busy) return;

        me.busy = true;
        me.renderStatus({tone: 'pending', text: `Renaming ${me.plan.id} → ${me.plan.to}…`});
        me.syncButtons();
        me.fire('requestSeatRenameApply', {
            fingerprint: me.plan.fingerprint,
            id         : me.plan.id,
            to         : me.plan.to
        })
    }

    /**
     * @summary Closes the inline rename section without applying changes.
     */
    onCancelRename() {
        this.reset()
    }

    /**
     * @summary Receives the broker's `seatRenamePlan` result.
     * @param {Object} result
     */
    applyPlanResult(result) {
        const me = this;

        me.busy = false;

        if (!result || result.state !== 'planned' || !result.plan) {
            me.plan = null;
            me.renderPlan(null);
            me.renderStatus({
                tone: 'refused',
                text: me.formatRefusal(result)
            });
            me.syncButtons();
            return
        }

        const plan = {...result.plan, fingerprint: result.fingerprint ?? result.plan.fingerprint ?? null};

        if (!me.canRename || (me.proposedId && plan.to !== me.proposedId)) {
            me.plan = null;
            me.renderPlan(null);
            me.renderStatus({
                tone: 'refused',
                text: !me.canRename
                    ? 'stop the seat to change its id'
                    : 'the proposed id changed while the plan was loading; review it again'
            });
            me.syncButtons();
            return
        }

        me.plan = plan;
        me.renderPlan(plan);
        me.renderStatus(null);
        me.syncButtons()
    }

    /**
     * @summary Receives the broker's `seatRenameApply` result and formats the settled status text,
     * appending `plan.sessions.nextStep` when the harness requires a follow-up step.
     * @param {Object} result
     */
    applyRenameResult(result) {
        const me = this;

        me.busy = false;

        if (!result || result.state !== 'renamed' || !result.plan) {
            me.renderStatus({
                tone: 'refused',
                text: me.formatRefusal(result)
            });
            me.syncButtons();
            return
        }

        const
            plan            = result.plan,
            from            = plan.id ?? me.agentId,
            to              = plan.to ?? me.proposedId,
            carriedSessions = me.countCarriedSessions(plan) ?? 0,
            retiredSeatHome = plan.retiredSeatHome ?? 'none',
            nextStep        = typeof plan.sessions?.nextStep === 'string' && plan.sessions.nextStep.trim()
                ? plan.sessions.nextStep.trim()
                : null,
            nextStepSuffix  = nextStep ? ` · next: ${nextStep}` : '';

        me.plan           = null;
        me.agentId        = to;
        me.settledOutcome = {from, to, carriedSessions, retiredSeatHome, nextStep};
        me.renderPlan(null);
        me.renderStatus({
            tone: 'settled',
            text: `Renamed ${from} → ${to} · carried ${carriedSessions} sessions · retired ${retiredSeatHome}${nextStepSuffix}`
        });
        me.syncButtons()
    }

    /**
     * @summary Extracts the carried session count from Brain's `renameSeat` plan or outcome,
     * preferring `plan.sessions.count` when finite and falling back to legacy fields only when `count` is absent.
     * @param {Object|null} plan
     * @returns {Number|null}
     */
    countCarriedSessions(plan) {
        const sessions = plan?.sessions;
        if (Number.isFinite(sessions?.count)) return sessions.count;
        if (Number.isFinite(plan?.carriedSessions)) return plan.carriedSessions;
        if (!sessions || typeof sessions !== 'object') return null;
        if (Array.isArray(sessions.transcripts)) return sessions.transcripts.length;
        if (Number.isFinite(sessions.threads)) return sessions.threads;
        if ('project' in sessions) return sessions.project === 'repointed' || sessions.project === true ? 1 : 0;
        return null
    }

    /**
     * @summary Formats a broker refusal with its stage and reason.
     * @param {Object|null} result
     * @returns {String}
     */
    formatRefusal(result) {
        const
            stage  = result?.stage ? `${result.stage}: ` : '',
            reason = result?.reason || result?.code || 'seat rename was refused';

        return `${stage}${reason}`
    }

    /**
     * @summary Renders the reviewed plan rows from Brain's `renameSeat` dry run as inert `text` VDOM nodes,
     * surfacing `sessions.conversations`, `sessions.nextStep`, or `sessions.records` on the `Harness state` row.
     * @param {Object|null} plan
     */
    renderPlan(plan) {
        const
            box = this.getReference('seat-rename-plan');

        if (!box) return;

        if (!plan) {
            box.hidden  = true;
            box.vdom.cn = [];
            box.update();
            return
        }

        const
            unmaterialized = plan.materialized === false,
            carried        = this.countCarriedSessions(plan),
            retiredCopy    = plan.retiredSeatHome ?? (unmaterialized ? 'none' : 'counted when applied'),
            records        = Array.isArray(plan.planeCredentials) || plan.windowRecord
                ? `registry (1) · plane credentials (${plan.planeCredentials?.length ?? 0}) · window (${plan.windowRecord ?? 'absent'})`
                : 'registry (1) · plane credentials and window record counted when applied',
            sessionsText   = carried !== null
                ? `${carried} sessions`
                : (unmaterialized ? '0 sessions' : 'counted when applied'),
            sessionParts   = [
                plan.sessions?.conversations,
                plan.sessions?.nextStep ? `next: ${plan.sessions.nextStep}` : null
            ].filter(Boolean),
            harnessState   = sessionParts.length > 0
                ? sessionParts.join(' · ')
                : Number.isFinite(plan.sessions?.records)
                    ? `${plan.sessions.records} records repointed`
                    : plan.sessions?.note
                        ? plan.sessions.note
                        : plan.sessions?.presets
                            ? 'Claude Desktop presets repointed'
                            : (plan.sessions && typeof plan.sessions === 'object') || unmaterialized
                                ? 'none'
                                : 'counted when applied',
            worktrees      = Array.isArray(plan.links?.worktrees)
                ? String(plan.links.worktrees.length)
                : (Number.isFinite(plan.worktrees) ? String(plan.worktrees) : (unmaterialized ? '0' : 'counted when applied')),
            rows           = [
                ['Id', `${plan.id} → ${plan.to}`],
                ['Folder', `${plan.seatHome ?? 'unmaterialized'} → ${plan.destination ?? 'unmaterialized'} (${plan.state ?? 'copy'})`],
                ['Retired copy', retiredCopy],
                ['Records', records],
                ['Sessions carried', sessionsText],
                ['Harness state', harnessState],
                ['Worktrees repaired', worktrees],
                ['Execution', 'Quiesces the Fleet registry writer during apply, then restarts it']
            ];

        box.hidden  = false;
        box.vdom.cn = rows.map(([label, value]) => ({
            tag: 'div',
            cls: ['fm-seat-rename-row'],
            cn : [
                {tag: 'span', cls: ['fm-seat-rename-label'], text: label},
                {tag: 'span', cls: ['fm-seat-rename-value'], text: value}
            ]
        }));
        box.update()
    }

    /**
     * @summary Renders the status or outcome line as inert text.
     * @param {{tone: String, text: String}|null} status
     */
    renderStatus(status) {
        const line = this.getReference('seat-rename-status');

        if (!line) return;

        if (!status?.text) {
            line.hidden = true;
            line.text   = '';
            return
        }

        line.cls    = ['fm-seat-rename-status', `is-${status.tone || 'info'}`];
        line.hidden = false;
        line.text   = status.text
    }

    /**
     * @summary Synchronizes button disabled states and labels.
     */
    syncButtons() {
        const
            me         = this,
            reviewBtn  = me.getReference('review-seat-rename-button'),
            confirmBtn = me.getReference('confirm-seat-rename-button'),
            hasNewId   = Boolean(me.proposedId && me.agentId && me.proposedId !== me.agentId),
            canConfirm = Boolean(me.canRename && !me.busy && me.plan?.fingerprint && me.plan.to === me.proposedId);

        if (reviewBtn) {
            reviewBtn.disabled = !me.canRename || me.busy || !hasNewId
        }

        if (confirmBtn) {
            confirmBtn.disabled = !canConfirm;
            confirmBtn.text     = me.plan?.to ? `Rename seat to ${me.plan.to}` : 'Rename seat'
        }
    }
}

export default Neo.setupClass(SeatRenameContainer);
