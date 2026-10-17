import Button         from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container      from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
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
            ntype: 'component', reference: 'runtime-control-feedback', cls: ['fm-runtime-feedback'], flex: 'none', hidden: true,
            vdom : {'aria-live': 'polite'}
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

    /** @summary Repaints same-record Store updates as well as selection changes. @param {Object|null} record */
    updateRecord(record) {
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
        const exitText = wired && record.state === 'off' && record.participationStatus !== 'operator_benched'
            ? SeatExitReason.detailText(record.exitReason) : null;
        const feedback = record.pendingAction ? 'Lifecycle request in progress…' : record.controlReason?.reason || record.launchRefusal || exitText || '';
        this.getReference('runtime-control-feedback').set({hidden: !feedback, text: feedback});
        const hasIdentities = Boolean(currentId || nextId || installedId);
        this.getReference('show-runtime-ids').set({hidden: !hasIdentities,
            text: this.detailsVisible ? 'Hide generation IDs' : 'Show generation IDs'});
        this.getReference('show-runtime-ids').changeVdomRootKey('aria-expanded', String(this.detailsVisible));
        this.getReference('runtime-identities').hidden = !this.detailsVisible || !hasIdentities;
        this.getReference('current-runtime-id').text = `${current?.pin === 'released' ? 'Last' : current?.pin === 'held' && wired ? 'Current' : 'Recorded'}: ${currentId ?? 'not observed'}`;
        this.getReference('next-runtime-id').text = `Next Start: ${nextId ?? 'not reported'}`;
        this.getReference('installed-runtime-id').text = `Installed: ${installedId ?? 'not verified'}`;
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
}

export default Neo.setupClass(SeatRuntimeContainer);
