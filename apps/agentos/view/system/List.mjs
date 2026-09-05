import BaseList                     from '../../../../node_modules/neo.mjs/src/list/Base.mjs';
import NeoArray                     from '../../../../node_modules/neo.mjs/src/util/Array.mjs';
import AgentFreshness               from '../../util/AgentFreshness.mjs';
import {labelForDeploymentService}  from '../../config/deploymentServiceLabels.mjs';

/**
 * @summary The card's state word and mark per folded status — the closed set from the design sketch:
 * the writer already folds sustained memory saturation into `degraded`, so no fourth word exists.
 * @type {Object}
 */
const STATE_WORDS = Object.freeze({
    available: {word: 'serving',    cls: 'is-serving'},
    degraded : {word: 'degraded',   cls: 'is-degraded'}
});

/**
 * The plane cards — one `Neo.list.Base` item per {@link AgentOS.model.DeploymentService service record}
 * of the connected instance's deployment-state picture. The list renders; it never reads: the owning
 * {@link AgentOS.view.system.Container} projects the picture into the bound store and the list re-renders
 * through its own store listeners.
 *
 * @summary One card grammar: `[name] [compose id] [state word] [observed age]` over three facts (memory ·
 * class · restart churn) and the orchestrator's diagnosis line. Every word is the snapshot's own —
 * `status`, `disposition`, `serviceClass`, `recoveryClass` — spelled for a reader; an absent field renders
 * its honest absence ("not measured", "not classified", "no decision"), never a guessed state. The left
 * mark rebinds one custom property per state (the chip idiom); no card carries a control verb.
 *
 * @class AgentOS.view.system.List
 * @extends Neo.list.Base
 */
class List extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.system.List'
         * @protected
         */
        className: 'AgentOS.view.system.List',
        /**
         * @member {String} ntype='fm-plane-list'
         * @protected
         */
        ntype: 'fm-plane-list',
        /**
         * @member {String[]} baseCls=['fm-plane-list','neo-list']
         */
        baseCls: ['fm-plane-list', 'neo-list'],
        /**
         * The projection store is created, seated and destroyed by the owning Container.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * Plane cards are a glance surface, not a selection surface.
         * @member {Boolean} disableSelection=true
         * @reactive
         */
        disableSelection: true
    }

    /**
     * @summary One list item per service record, marked by its folded state.
     * @param {Object} record
     * @param {Number} index
     * @returns {Object|null} The list item vdom object.
     */
    createItem(record, index) {
        const item = super.createItem(record, index);

        if (!item) {
            return item
        }

        NeoArray.add(item.cls, ['fm-plane-card', STATE_WORDS[record.status]?.cls ?? 'is-unobserved']);

        return item
    }

    /**
     * @summary The card grammar: head line, three facts, the diagnosis line.
     * @param {Object} record
     * @param {Number} index
     * @returns {Object[]} The item vdom children.
     */
    createItemContent(record, index) {
        const
            me    = this,
            id    = me.getItemId(me.getRecordId(record)),
            label = labelForDeploymentService(record.serviceKey),
            state = STATE_WORDS[record.status],
            head  = [{tag: 'span', id: `${id}__key`, cls: ['fm-plane-key'], text: label}];

        if (label !== record.serviceKey) {
            head.push({tag: 'span', id: `${id}__id`, cls: ['fm-plane-id'], text: record.serviceKey})
        }

        head.push(
            {tag: 'span', id: `${id}__word`, cls: ['fm-plane-word'], text: state?.word ?? 'unobserved'},
            {tag: 'span', id: `${id}__seen`, cls: ['fm-plane-seen'], text: me.observedLine(record)}
        );

        return [{
            tag: 'div',
            id : `${id}__head`,
            cls: ['fm-plane-head'],
            cn : head
        }, {
            tag: 'dl',
            id : `${id}__facts`,
            cls: ['fm-plane-facts'],
            cn : [
                {tag: 'dt', id: `${id}__memory-k`, text: 'memory'},
                {tag: 'dd', id: `${id}__memory`,   cls: record.memoryDisposition === 'at-cap' ? ['is-hot'] : record.memoryDisposition ? [] : ['is-quiet'], text: me.memoryLine(record)},
                {tag: 'dt', id: `${id}__class-k`,  text: 'class'},
                {tag: 'dd', id: `${id}__class`,    cls: record.serviceClass ? [] : ['is-quiet'], text: me.classLine(record)},
                {tag: 'dt', id: `${id}__churn-k`,  text: 'restart churn'},
                {tag: 'dd', id: `${id}__churn`,    cls: record.churnDetecting ? [] : ['is-quiet'], text: me.churnLine(record)}
            ]
        }, {
            tag: 'p',
            id : `${id}__diag`,
            cls: ['fm-plane-diag'],
            cn : [
                {tag: 'span', id: `${id}__diag-k`, cls: ['fm-plane-diag-key'], text: 'diagnosis'},
                {tag: 'span', id: `${id}__diag-v`, cls: record.recoveryClass ? [] : ['is-quiet'], text: me.diagnosisLine(record)}
            ]
        }]
    }

    /**
     * @summary "observed 12s ago", from the row's own age; a row without an observation says so.
     * @param {Object} record
     * @returns {String}
     */
    observedLine(record) {
        return Number.isFinite(record.observedAgeMs) ? `observed ${AgentFreshness.formatAge(record.observedAgeMs)}` : 'no observation'
    }

    /**
     * @summary The memory-pressure reading — the disposition and, when the writer named one, its reason.
     * @param {Object} record
     * @returns {String}
     */
    memoryLine(record) {
        const {memoryDisposition, memoryReason} = record;

        if (!memoryDisposition) return 'not measured';

        return memoryReason ? `${memoryDisposition} · ${memoryReason}` : memoryDisposition
    }

    /**
     * @summary The service class with its applied threshold and sample count.
     * @param {Object} record
     * @returns {String}
     */
    classLine(record) {
        const {serviceClass, memoryThreshold, sampleCount} = record;

        if (!serviceClass) return 'not classified';

        const parts = [serviceClass];

        Number.isFinite(memoryThreshold) && parts.push(`threshold ${memoryThreshold}%`);
        Number.isFinite(sampleCount)     && parts.push(`${sampleCount} ${sampleCount === 1 ? 'sample' : 'samples'}`);

        return parts.join(' · ')
    }

    /**
     * @summary The restart-churn detector's baseline and whether it is detecting.
     * @param {Object} record
     * @returns {String}
     */
    churnLine(record) {
        const {churnBaseline, churnDetecting} = record;

        if (!churnBaseline && churnDetecting === null) return 'not detecting';

        return `baseline ${churnBaseline ?? 'unknown'} · ${churnDetecting ? 'detecting' : 'not detecting'}`
    }

    /**
     * @summary The container-health decision, as the orchestrator concluded it.
     * @param {Object} record
     * @returns {String}
     */
    diagnosisLine(record) {
        const {diagnosisStatus, actionClass, recoveryClass, confidence} = record;

        if (recoveryClass) {
            const parts = [recoveryClass];

            Number.isFinite(confidence) && parts.push(`confidence ${confidence}`);
            parts.push(`action class ${actionClass ?? 'none'}`);

            return parts.join(' · ')
        }

        if (diagnosisStatus) return `${diagnosisStatus} · no recovery diagnosis`;

        return 'the orchestrator recorded no decision for this service — shown, not guessed'
    }
}

export default Neo.setupClass(List);
