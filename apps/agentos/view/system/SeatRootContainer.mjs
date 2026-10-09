import Button         from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container      from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import SeatMoves      from '../../store/SeatMoves.mjs';
import SeatMoveList   from './SeatMoveList.mjs';
import SeatRootController from './SeatRootController.mjs';

const
    rootPath       = root => typeof root === 'string' ? root : root?.root,
    unreadable     = value => value && typeof value === 'object' && typeof value.unreadable === 'string',
    outcomeCanPlan = outcome => outcome?.state === 'none' || outcome?.state === 'refused',
    hasRoot        = root => typeof root === 'string' ? !!root : typeof root?.root === 'string' && !!root.root;

/**
 * @class AgentOS.view.system.SeatRootContainer
 * @extends Neo.container.Base
 *
 * @summary The installation-scoped seat-home transition beside System's connected-plane diagnostics.
 * Status is pulled on request; the reviewed fingerprint is the only consent input.
 */
class SeatRootContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.system.SeatRootContainer'
         * @protected
         */
        className: 'AgentOS.view.system.SeatRootContainer',
        /**
         * @member {String} ntype='fm-seat-root'
         * @protected
         */
        ntype: 'fm-seat-root',
        /** @member {String[]} baseCls=['fm-seat-root'] */
        baseCls: ['fm-seat-root'],
        /**
         * @member {Neo.controller.Component} controller=SeatRootController
         * @reactive
         */
        controller: SeatRootController,
        /**
         * The last pull-shaped shell answer. `unobserved` is not an empty or clear state.
         * @member {Object} snapshot_={state:'unobserved'}
         * @reactive
         */
        snapshot_: {state: 'unobserved', root: null, pending: null, outcome: null},
        /**
         * @member {Object|null} plan_=null
         * @reactive
         */
        plan_: null,
        /**
         * @member {Object|null} feedback_=null
         * @reactive
         */
        feedback_: null,
        /**
         * @member {String|null} busy_=null
         * @reactive
         */
        busy_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /** @member {Object[]} items */
        items: [{
            ntype : 'container',
            cls   : ['fm-seat-root-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype: 'component',
                tag  : 'h3',
                cls  : ['fm-seat-root-title'],
                text : 'This installation'
            }, {
                ntype: 'component',
                cls  : ['fm-seat-root-scope'],
                text : 'seat home'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-root-line'],
            reference: 'root-line',
            flex     : 'none',
            text     : 'Seat-root status has not been checked.'
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-root-status'],
            reference: 'status-line',
            flex     : 'none',
            text     : 'Check status before reviewing a move.'
        }, {
            ntype    : 'container',
            cls      : ['fm-seat-root-plan'],
            flex     : 'none',
            hidden   : true,
            reference: 'plan-summary',
            items    : [{
                ntype    : 'component',
                cls      : ['fm-seat-root-plan-line'],
                reference: 'plan-line'
            }, {
                ntype: 'component',
                cls  : ['fm-seat-root-copy-note'],
                text : 'The shell copies and checks each seat home before changing the root. This needs free space and can take time; original folders stay in an archive for rollback.'
            }, {
                module   : SeatMoveList,
                reference: 'move-list',
                flex     : 'none'
            }]
        }, {
            ntype : 'container',
            cls   : ['fm-seat-root-actions'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                module   : Button,
                reference: 'recheck',
                cls      : ['fm-chip', 'fm-seat-root-recheck'],
                text     : 'Check status',
                handler  : 'up.onRecheckClick'
            }, {
                module   : Button,
                reference: 'review',
                cls      : ['fm-chip', 'fm-seat-root-review'],
                text     : 'Review move',
                hidden   : true,
                handler  : 'up.onReviewClick'
            }, {
                module   : Button,
                reference: 'consent',
                cls      : ['fm-chip', 'fm-seat-root-consent'],
                text     : 'Move seats and relaunch',
                hidden   : true,
                handler  : 'up.onConsentClick'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-seat-root-feedback'],
            flex     : 'none',
            hidden   : true,
            reference: 'feedback'
        }]
    }

    /** @member {AgentOS.store.SeatMoves|null} moveStore=null */
    moveStore = null

    /**
     * @summary Create the panel-owned row Store and render the initial unobserved state.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.moveStore = Neo.create(SeatMoves);
        this.getReference('move-list').store = this.moveStore;
        this.syncRows();
        this.sync()
    }

    /**
     * @summary Release the view-owned projection before its list is destroyed.
     * @param {...*} args
     */
    destroy(...args) {
        this.moveStore?.destroy();
        this.moveStore = null;
        super.destroy(...args)
    }

    /**
     * @summary Refresh the projected rows and status after a shell observation.
     * @param {Object} value
     * @param {Object} oldValue
     */
    afterSetSnapshot(value, oldValue) {
        if (oldValue !== undefined) {
            this.syncRows();
            this.sync()
        }
    }

    /**
     * @summary Render the reviewed plan and its consent availability together.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetPlan(value, oldValue) {
        if (oldValue !== undefined) {
            this.syncRows();
            this.sync()
        }
    }

    /**
     * @summary Render the latest action outcome.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetFeedback(value, oldValue) {
        oldValue !== undefined && this.sync()
    }

    /**
     * @summary Keep action availability synchronized with the active request.
     * @param {String|null} value
     * @param {String|null} oldValue
     */
    afterSetBusy(value, oldValue) {
        oldValue !== undefined && this.sync()
    }

    /**
     * @summary The installation has a settled, readable root and no outstanding transition.
     * An unreadable or missing field never acts as an empty record.
     * @returns {Boolean}
     */
    canReviewMove() {
        const
            snapshot = this.snapshot,
            outcome  = snapshot?.outcome;

        return !this.busy && snapshot?.state === 'available' &&
            snapshot.packaged === true &&
            !snapshot.refreshRequired &&
            hasRoot(snapshot.root) &&
            !unreadable(snapshot.root) &&
            !unreadable(snapshot.pending) &&
            !snapshot.pending &&
            outcomeCanPlan(outcome) &&
            snapshot.root?.origin !== 'moved'
    }

    /**
     * @summary Consent is enabled only for a fresh, complete plan with at least one seat to move.
     * @returns {Boolean}
     */
    canConsentMove() {
        return !this.busy && this.canReviewMove() && SeatRootController.isConsentablePlan(this.plan)
    }

    /**
     * @summary Project either the freshly reviewed plan or the shell's consented input rows into the Store.
     */
    syncRows() {
        if (!this.moveStore) return;

        const
            snapshot = this.snapshot,
            pending  = snapshot?.pending,
            source   = Array.isArray(this.plan?.rows)
                ? this.plan.rows
                : Array.isArray(pending?.rows) ? pending.rows.map(row => ({...row, state: 'pending'})) : [],
            rows     = source.map(row => ({
                id          : row.id,
                seatHome    : row.seatHome ?? row.from ?? null,
                destination : row.destination ?? row.to ?? null,
                state       : row.state ?? 'unknown',
                materialized: row.materialized === true,
                code        : row.code ?? null,
                reason      : row.reason ?? null
            }));

        if (!Array.isArray(this.plan?.rows) && Array.isArray(pending?.outOfScope)) {
            rows.push(...pending.outOfScope.map(row => ({
                id          : row.id,
                seatHome    : row.seatHome ?? null,
                destination : null,
                state       : 'untouched',
                materialized: false,
                reason      : row.reason ?? 'outside this move'
            })))
        }

        this.moveStore.clear();
        rows.length && this.moveStore.add(rows)
    }

    /**
     * @summary Render shell status, plan, and copy-only outcome text. All untrusted text reaches a text sink.
     * The plan box (its line, the copy-note and the rows) is the operator's decision, so it shows only while
     * there is one: a reviewed plan, or consented rows whose boot has not committed. A committed move keeps
     * just its receipt on the status line, even though the consent record still carries the rows.
     */
    sync() {
        const
            me         = this,
            snapshot   = me.snapshot,
            outcome    = snapshot?.outcome,
            pending    = snapshot?.pending,
            root       = snapshot?.root,
            rootLine   = me.getReference('root-line'),
            statusLine = me.getReference('status-line'),
            planBox    = me.getReference('plan-summary'),
            planLine   = me.getReference('plan-line'),
            recheck    = me.getReference('recheck'),
            review     = me.getReference('review'),
            consent    = me.getReference('consent'),
            feedback   = me.getReference('feedback'),
            plan       = me.plan;

        rootLine.text = unreadable(root)
            ? `Installed seat root is unreadable: ${root.unreadable}`
            : hasRoot(root) ? `Seat root · ${rootPath(root)}` :
                snapshot?.state === 'available' ? 'No seat root is recorded.' : 'Installed seat root is not available.';

        if (outcome?.state === 'held') {
            statusLine.text = `Move and Fleet start held · ${outcome.reason ?? 'the transition could not settle'}`
        } else if (outcome?.state === 'committed') {
            const retirement = outcome.retirement;
            statusLine.text = retirement?.state === 'held'
                ? `Root move committed · Fleet start held; old folders were not all archived: ${retirement.reason ?? 'retirement is held'}`
                : `Root move committed · ${rootPath(root) ?? 'destination root'}`
        } else if (snapshot?.state === 'refused' || snapshot?.state === 'unavailable') {
            statusLine.text = `Seat-root status unavailable · ${[snapshot.code, snapshot.reason].filter(Boolean).join(' · ') || 'the shell did not answer'}`
        } else if (unreadable(pending)) {
            statusLine.text = `Consent record is unreadable · ${pending.unreadable}`
        } else if (pending) {
            statusLine.text = outcome === null
                ? 'A move is consented; this boot has not reported its outcome yet.'
                : `A move is pending · ${pending.from ?? 'current root'} → ${pending.to ?? 'destination root'}`
        } else if (outcome === null || outcome === undefined) {
            statusLine.text = 'Boot outcome is not observed. Recheck before reviewing a move.'
        } else if (outcome.state === 'refused') {
            statusLine.text = `The last move did not complete · ${outcome.reason ?? 'review the status before proceeding'}`
        } else if (outcome.state === 'none') {
            statusLine.text = 'No move is consented.'
        } else {
            statusLine.text = `Boot outcome · ${outcome.state ?? 'unobserved'}`
        }

        const planVisible = outcome?.state !== 'committed' && (!!plan || Array.isArray(pending?.rows));
        planBox.hidden = !planVisible;
        planLine.text = plan
            ? `Reviewed move · ${plan.from ?? 'current root'} → ${plan.to ?? 'destination root'}`
            : pending ? `Consented move · ${pending.from ?? 'current root'} → ${pending.to ?? 'destination root'}` : '';

        recheck.text    = snapshot?.state === 'unobserved' ? 'Check status' : 'Recheck status';
        recheck.disabled = !!me.busy;
        review.hidden    = !me.canReviewMove();
        review.disabled  = !!me.busy;
        consent.hidden   = !me.canConsentMove();
        consent.disabled = !!me.busy;

        feedback.hidden = !me.feedback;
        feedback.text   = [me.feedback?.code, me.feedback?.reason].filter(Boolean).join(' · ')
    }

    /**
     * @summary Request a fresh observation of this installation.
     * @param {Object} data Button event data.
     */
    onRecheckClick(data) {
        this.fire('seatRootStatusRequest', {})
    }

    /**
     * @summary Request a dry-run plan for review.
     * @param {Object} data Button event data.
     */
    onReviewClick(data) {
        this.fire('seatRootPlanRequest', {})
    }

    /**
     * @summary Submit the operator's consent intent to the controller.
     * @param {Object} data Button event data.
     */
    onConsentClick(data) {
        this.fire('seatRootConsentRequest', {})
    }
}

export default Neo.setupClass(SeatRootContainer);
