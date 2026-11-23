import Button         from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container      from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import SeatCredential from '../../../util/SeatCredential.mjs';
import SeatExitReason from '../../../util/SeatExitReason.mjs';
import SourceHealth   from '../../../util/SourceHealth.mjs';

/**
 * @class AgentOS.view.fleet.detail.SeatRuntimeContainer
 * @extends Neo.container.Base
 * @summary Shows a selected seat's reported binding beside the connected Fleet's next Start and
 * independently observed installed package. An exact restart is an intent, never optimistic migration.
 */
class SeatRuntimeContainer extends Container {
    static config = {
        /** @member {String} className='AgentOS.view.fleet.detail.SeatRuntimeContainer' @protected */
        className: 'AgentOS.view.fleet.detail.SeatRuntimeContainer',
        /** @member {String[]} baseCls=['fm-seat-runtime'] */
        baseCls: ['fm-seat-runtime'],
        /** @member {String[]} additionalThemeFiles */
        additionalThemeFiles: ['AgentOS.view.fleet.mailbox.Chips'],
        /** @member {Object|null} record_=null @reactive */
        record_: null,
        /** @member {Number|null} now_=null @reactive */
        now_: null,
        /** @member {Boolean} detailsVisible_=false @reactive */
        detailsVisible_: false,
        /** @member {Object} layout @reactive */
        layout: {ntype: 'vbox', align: 'stretch'},
        /** @member {Object[]} items */
        items: [{
            ntype: 'component', cls: ['fm-runtime-heading'], flex: 'none', text: 'Runtime'
        }, {
            ntype: 'component', reference: 'current-runtime', flex: 'none'
        }, {
            ntype: 'component', reference: 'next-runtime', flex: 'none'
        }, {
            ntype: 'component', reference: 'installed-runtime', flex: 'none'
        }, {
            ntype: 'container', cls: ['fm-runtime-actions'], flex: 'none', layout: {ntype: 'hbox', wrap: 'wrap'},
            items: [{
                module: Button, reference: 'restart-runtime', cls: ['fm-chip'], hidden: true,
                text  : 'Restart on installed generation', handler: 'up.onRestartClick'
            }, {
                module: Button, reference: 'show-runtime-ids', ui: 'ghost',
                text  : 'Show generation IDs', handler: 'up.onToggleIds'
            }]
        }, {
            ntype: 'component', reference: 'native-wake-description', flex: 'none', hidden: true
        }, {
            module: Button, reference: 'native-wake-setup', cls: ['fm-chip'], hidden: true,
            text: 'Set up native message delivery', handler: 'up.onNativeWakeClick'
        }, {
            ntype: 'component', reference: 'native-wake-feedback', flex: 'none', hidden: true, vdom: {'aria-live': 'polite'}
        }, {
            ntype: 'component', reference: 'runtime-control-feedback', cls: ['fm-runtime-feedback'], flex: 'none', hidden: true,
            vdom : {'aria-live': 'polite'}
        }, {
            module: Button, reference: 'runtime-replace-token', cls: ['fm-chip'], flex: 'none', hidden: true,
            text  : SeatCredential.ACTION_LABEL, handler: 'up.onReplaceTokenClick'
        }, {
            ntype : 'container', reference: 'runtime-identities', cls: ['fm-runtime-identities'], flex: 'none', hidden: true,
            layout: {ntype: 'vbox', align: 'stretch'},
            items : ['current', 'next', 'installed'].map(key => ({
                ntype: 'component', reference: `${key}-runtime-id`, flex: 'none'
            }))
        }]
    }

    /** @summary Renders after the referenced anatomy exists. */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.applyRecord();
    }

    /** @summary A new selection closes its predecessor's identity expansion. */
    afterSetRecord(value, oldValue) {
        if (value?.agentId !== oldValue?.agentId) this.detailsVisible = false;
        this.isConstructed && this.applyRecord();
    }

    /** @summary Reflects the explicit full-identity disclosure. */
    afterSetDetailsVisible() {
        this.isConstructed && this.applyRecord();
    }

    /** @summary Re-evaluates time-relative token-expiry guidance when `now` advances. */
    afterSetNow() {
        this.isConstructed && this.applyRecord();
    }

    /** @summary Repaints same-record Store updates as well as selection changes. @param {Object|null} record @param {Number|null} [now=this.now] */
    updateRecord(record, now = this.now) {
        if (now !== this.now) this.now = now;
        if (this.record === record) this.applyRecord();
        else this.record = record;
    }

    /** @summary Keeps unknown and stale facts separate from current use and installed identity. */
    applyRecord() {
        const record = this.record;
        this.hidden = !record;
        if (!record) return;
        const validId     = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
        const current     = record.runtimeGeneration, next = record.nextRuntimeGeneration, installed = record.installedGeneration;
        const currentId   = validId(current?.id), nextId = validId(next?.id);
        const installedId = installed?.state === 'observed' ? validId(installed.id) : null;
        const wired       = SourceHealth.normalizeFleetSources(record.sources).runtime.state === 'wired';
        const matched     = Boolean(nextId && installedId === nextId);
        let   currentText = 'Seat generation not reported.';
        if (current) {
            currentText = !wired ? 'Last reported seat generation; runtime status is unavailable.'
                : current.pin === 'released' ? 'Last runtime is released; the next Start selects its generation.'
                    : current.pin !== 'held' || !currentId ? 'The seat’s runtime binding is not verified.'
                        : matched && currentId === nextId ? 'Running on the installed generation.'
                            : nextId && currentId !== nextId ? 'Current runtime differs from Next Start.'
                                : `Current runtime: ${currentId.slice(0, 12)}.`;
        }
        this.getReference('current-runtime').text = currentText;
        this.getReference('next-runtime').text = nextId
            ? `Next Start${wired ? '' : ' (last reported)'}: ${nextId.slice(0, 12)}${matched ? ' (installed)' : ''}.`
            : 'Next Start is not reported by this Fleet.';
        const installedLine = this.getReference('installed-runtime');
        installedLine.hidden = matched;
        installedLine.text = installedId ? `Installed${wired ? '' : ' (last reported)'}: ${installedId.slice(0, 12)}.${nextId ? ' Next Start differs from this package.' : ''}`
            : installed ? 'The installed package could not be verified.' : 'Installed generation not reported.';

        const restart = this.getReference('restart-runtime');
        restart.set({hidden: !matched || record.state === 'off' || current?.pin === 'released' || currentId === nextId && current?.pin === 'held',
            disabled: !wired || !record.agentId || Boolean(record.pendingAction) || record.controlReason?.kind === 'unauthorized' ||
                record.launchable === false || Boolean(record.launchRefusal)});
        const capability = record.nativeWakeSetup, family = record.harnessType;
        const eligible = wired && record.state === 'ok' && !record.launchRefusal &&
            ['codex-desktop', 'antigravity'].includes(family) && typeof capability?.expectedStartedAt === 'string' &&
            Boolean(capability.expectedStartedAt);
        const nextStep = family === 'antigravity'
            ? 'Start a new main Antigravity session.'
            : 'If prompted, review this seat’s Hooks settings, then send an ordinary message in the seat.';
        const hasCurrentOutcome = eligible && record.nativeWakeOutcomeStartedAt === capability?.expectedStartedAt && Boolean(record.nativeWakeOutcome);
        this.getReference('native-wake-description').set({hidden: !eligible || hasCurrentOutcome && family === 'codex-desktop', text: family === 'antigravity'
            ? 'This configures a shared Antigravity sidecar for this macOS user; other Antigravity instances may load it.'
            : `This prepares native delivery for this managed Codex seat. ${nextStep}`});
        this.getReference('native-wake-setup').set({hidden: !eligible, disabled: Boolean(record.pendingAction) || record.controlReason?.kind === 'unauthorized'});
        const feedbackText = {
            ready        : `Native route ready. ${nextStep} Delivery is not yet confirmed.`,
            'not-ready'  : 'Native route is not ready. Retry setup; delivery is not confirmed.',
            'seat-changed': 'The seat stopped or restarted. Refresh and try again.',
            'next-managed-start': 'Keep this chat running. After the next planned managed Start, review Neo Codex wake admission ' +
                'in this seat’s Settings → Hooks if prompted, then send an ordinary message.',
            'bridge-unavailable': 'Fleet bridge is unavailable. Connect or reconnect Fleet, then retry setup. No delivery was requested.',
            unconfirmed  : 'Native delivery setup could not be confirmed. Retry setup; delivery is not confirmed.'
        }[hasCurrentOutcome ? record.nativeWakeOutcome : null] || '';
        this.getReference('native-wake-feedback').set({hidden: !feedbackText, text: feedbackText});
        const exitText = wired && record.state === 'off' && record.participationStatus !== 'operator_benched'
            ? SeatExitReason.detailText(record.exitReason) : null;
        const clock = Number.isFinite(this.now) ? this.now : Date.now();
        const expiry = !record.pendingAction && !record.controlReason && !record.launchRefusal
            ? SeatCredential.recordExpiry(record, clock)
            : null;
        const credentialBlocking = !record.pendingAction && !record.controlReason && !record.launchRefusal
            ? SeatCredential.nextStep(record) ?? (expiry?.expired ? {reason: expiry.detailText} : null)
            : null;
        const credentialExpiring = !record.pendingAction && !record.controlReason && !record.launchRefusal &&
            !credentialBlocking && expiry?.expiringSoon
            ? {reason: expiry.detailText}
            : null;
        const startCredentialRefusal = !record.pendingAction && SeatCredential.isStartCredentialRefusal(record.controlReason);
        const showReplace = SeatCredential.availability(record).canReplace &&
            (startCredentialRefusal || Boolean(credentialBlocking || credentialExpiring));
        const stateOrExpiry = [exitText, credentialExpiring?.reason].filter(Boolean).join(' · ');
        const feedback = record.pendingAction
            ? 'Lifecycle request in progress…'
            : record.controlReason?.reason || record.launchRefusal || credentialBlocking?.reason || stateOrExpiry || '';
        this.getReference('runtime-control-feedback').set({hidden: !feedback, text: feedback});
        this.getReference('runtime-replace-token').set({hidden: !showReplace, disabled: Boolean(record.pendingAction)});
        const hasIdentities = Boolean(currentId || nextId || installedId);
        this.getReference('show-runtime-ids').set({hidden: !hasIdentities,
            text: this.detailsVisible ? 'Hide generation IDs' : 'Show generation IDs'});
        this.getReference('show-runtime-ids').changeVdomRootKey('aria-expanded', String(this.detailsVisible));
        this.getReference('runtime-identities').hidden = !this.detailsVisible || !hasIdentities;
        this.getReference('current-runtime-id').text = `${current?.pin === 'released' ? 'Last' : current?.pin === 'held' && wired ? 'Current' : 'Recorded'}: ${currentId ?? 'not observed'}`;
        this.getReference('next-runtime-id').text = `Next Start: ${nextId ?? 'not reported'}`;
        this.getReference('installed-runtime-id').text = `Installed: ${installedId ?? 'not verified'}`;
    }

    /** @summary Requests setup for the exact running process shown to the operator. */
    onNativeWakeClick() {
        if (!this.record) return;
        this.applyRecord();
        const button = this.getReference('native-wake-setup');
        if (button.hidden || button.disabled) return;
        this.fire('lifecycleIntent', {action: 'setupNativeWake', agentId: this.record.agentId,
            expectedStartedAt: this.record.nativeWakeSetup.expectedStartedAt});
    }

    /** @summary Opens the complete IDs in the reading surface, rather than a tooltip. */
    onToggleIds() {
        this.detailsVisible = !this.detailsVisible;
    }

    /** @summary Emits the displayed exact target; the serving owner validates it before Stop. */
    onRestartClick() {
        if (!this.record) return;
        this.applyRecord();
        const button = this.getReference('restart-runtime');
        if (button.hidden || button.disabled) return;
        this.fire('lifecycleIntent', {action: 'restart', agentId: this.record.agentId,
            expectedRuntimeGeneration: this.record.nextRuntimeGeneration.id});
    }

    /** @summary Routes the Status-tab `"Replace token"` next step to Configuration's token group. */
    onReplaceTokenClick() {
        if (!this.record) return;
        this.applyRecord();
        const button = this.getReference('runtime-replace-token');
        if (button.hidden || button.disabled) return;
        this.fire('replaceTokenIntent', {agentId: this.record.agentId});
    }
}

export default Neo.setupClass(SeatRuntimeContainer);
