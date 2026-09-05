import BaseContainer                from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import DeploymentServices           from '../../store/DeploymentServices.mjs';
import PlaneList                    from './List.mjs';
import AgentFreshness               from '../../util/AgentFreshness.mjs';
import ViewerTime                   from '../../util/ViewerTime.mjs';
import {FLEET_WIRE_RESPONSE_STATES} from '../../config/fleetWireMethods.mjs';

/**
 * @summary The whole-view reason copy per reason the wire names; any other reason prints itself.
 * @type {Object}
 */
const UNAVAILABLE_COPY = Object.freeze({
    [FLEET_WIRE_RESPONSE_STATES.unsupportedMethod]: {
        word: 'This instance\'s fleet server predates the deployment-state verb',
        text: 'An older build answers unsupported-method. The view names the build gap instead of an empty plane; update the instance to see its engine room.'
    },
    'deployment-state-source-unwired': {
        word: 'The fleet server has no deployment-state source',
        text: 'It booted without a snapshot path, so the orchestrator\'s picture never reaches the wire. Nothing is shown because nothing was observed.'
    },
    'snapshot-missing': {
        word: 'No deployment-state snapshot at the fleet server',
        text: 'The orchestrator has not written one at the mounted path yet. Nothing is shown because nothing was observed.'
    }
});

/**
 * @summary The lane tones per word — the closed set: ok, warn (a wait), bad (an incident), quiet (absence).
 * @type {Object}
 */
const
    STARVATION_TONES = Object.freeze({degraded: 'is-bad', healthy: 'is-ok', unknown: 'is-warn', disabled: 'is-quiet'}),
    BACKUP_TONES     = Object.freeze({healthy: 'is-ok', retrying: 'is-warn', unanchored: 'is-bad', exhausted: 'is-bad'}),
    PICTURE_TONES    = Object.freeze({ok: 'is-ok', stale: 'is-warn', unavailable: 'is-bad'});

/**
 * @summary One maintenance lane: eyebrow · word · line — the strip's repeated object.
 * @param {String} id
 * @param {String} eyebrow
 * @returns {Object}
 */
const lane = (id, eyebrow) => ({
    ntype : 'container',
    cls   : ['fm-system-lane'],
    layout: {ntype: 'vbox', align: 'stretch'},
    items : [
        {ntype: 'component', cls: ['fm-system-eyebrow'],   text: eyebrow},
        {ntype: 'component', cls: ['fm-system-lane-word', 'is-quiet'], reference: `lane-${id}-word`, text: 'not observed'},
        {ntype: 'component', cls: ['fm-system-lane-line'], reference: `lane-${id}-line`, text: ''}
    ]
});

/**
 * The System keeper-view — the connected instance's engine room. It reads one thing: the
 * `fleetDeploymentState` picture the cockpit's read owner lands on the Viewport provider (the
 * orchestrator's own observation of its planes, bounded and redacted at the wire), and it renders
 * that picture as plane cards, three maintenance lanes and one freshness line. Observe-only by
 * declaration: nothing on this surface can act on a plane.
 *
 * @summary Binds the provider-held picture and the read's own connection observation; projects the
 * picture's service rows into a view-owned {@link AgentOS.store.DeploymentServices store} the
 * {@link AgentOS.view.system.List plane list} renders; words the lanes from the picture's
 * maintenance blocks. Honest states are first-class: never answered says so, a stale picture keeps
 * its cards and dates them, an unavailable or unsupported wire is ONE reason for the whole view (no
 * card guesses), and the logs region names its missing verb rather than showing a stream that is
 * not the plane's. Nothing here reads the bridge — the pane-never-reads contract.
 *
 * @class AgentOS.view.system.Container
 * @extends Neo.container.Base
 */
class Container extends BaseContainer {
    static config = {
        /**
         * @member {String} className='AgentOS.view.system.Container'
         * @protected
         */
        className: 'AgentOS.view.system.Container',
        /**
         * @member {String} ntype='fm-system-view'
         * @protected
         */
        ntype: 'fm-system-view',
        /**
         * @member {String[]} baseCls=['fm-system-view']
         */
        baseCls: ['fm-system-view'],
        /**
         * The Viewport provider's truths this view reads — the picture and the observation as whole
         * objects (the provider bubbles a fresh parent on every leaf write, so a content change lands
         * here), the bound instance for the scope line, the instance store for its label.
         * @member {Object} bind
         */
        bind: {
            boundProfileId  : data => data.boundProfileId,
            deploymentState : data => data.deploymentState,
            instanceStore   : 'stores.fleetInstances',
            systemConnection: data => data.systemConnection
        },
        /**
         * The bound instance's profileId, mirrored from the switcher's truth.
         * @member {String|null} boundProfileId_=null
         * @reactive
         */
        boundProfileId_: null,
        /**
         * The provider-held deployment-state picture. `null` before the provider binds.
         * @member {Object|null} deploymentState_=null
         * @reactive
         */
        deploymentState_: null,
        /**
         * The configured-instances store, for the bound instance's label.
         * @member {Neo.data.Store|null} instanceStore_=null
         * @reactive
         */
        instanceStore_: null,
        /**
         * The deployment-state read's connection observation `{state, reason}`.
         * @member {Object|null} systemConnection_=null
         * @reactive
         */
        systemConnection_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-system-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype: 'component',
                tag  : 'h2',
                cls  : ['fm-system-title'],
                text : 'System'
            }, {
                ntype    : 'component',
                cls      : ['fm-system-scope'],
                reference: 'scope',
                text     : 'diagnosing — no bound instance'
            }, {
                ntype    : 'component',
                cls      : ['fm-system-chip'],
                reference: 'observe',
                text     : 'observe-only'
            }, {
                ntype    : 'component',
                cls      : ['fm-system-fresh', 'is-cold'],
                reference: 'fresh',
                text     : 'not observed yet'
            }, {
                ntype    : 'component',
                cls      : ['fm-system-connection'],
                hidden   : true,
                reference: 'connection',
                text     : ''
            }]
        }, {
            // the honest empty line for a picture with no rows — never a blank claiming to be the plane
            ntype    : 'component',
            cls      : ['fm-system-empty'],
            flex     : 'none',
            reference: 'empty',
            text     : 'No plane cards yet — the picture arrives with the first read from the fleet server.'
        }, {
            module   : PlaneList,
            flex     : 1,
            reference: 'planes'
        }, {
            ntype: 'container',
            cls  : ['fm-system-strip'],
            flex : 'none',
            items: [lane('maintenance', 'heavy maintenance'), lane('backup', 'backup lane'), lane('snapshot', 'snapshot')]
        }, {
            ntype : 'container',
            cls   : ['fm-system-logs'],
            flex  : 'none',
            layout: {ntype: 'vbox', align: 'stretch'},
            items : [{
                ntype: 'component',
                cls  : ['fm-system-eyebrow'],
                text : 'logs · per service'
            }, {
                ntype    : 'component',
                cls      : ['fm-system-lane-line'],
                reference: 'logs-line',
                text     : 'Not wired yet. Bounded, redacted plane-log reads arrive with the Brain\'s own verb (neomjs/neo-agent-brain issue 27); until then this region stays empty rather than showing a stream that is not the plane\'s.'
            }]
        }, {
            ntype    : 'container',
            cls      : ['fm-system-reason'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'vbox', align: 'stretch'},
            reference: 'reason',
            items    : [{
                ntype    : 'component',
                cls      : ['fm-system-reason-word'],
                reference: 'reason-word',
                text     : ''
            }, {
                ntype    : 'component',
                cls      : ['fm-system-reason-text'],
                reference: 'reason-text',
                text     : ''
            }]
        }]
    }

    /** @member {AgentOS.store.DeploymentServices|null} serviceStore=null */
    serviceStore = null

    /**
     * @summary Create the view-owned projection store, seat it on the list, and render whatever the
     * provider already holds — a keeper-view constructed after the first read must not wait a cadence.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        let me = this;

        me.serviceStore = Neo.create(DeploymentServices);
        me.getReference('planes').store = me.serviceStore;

        me.applyPicture();
        me.applyConnection();
        me.applyScope()
    }

    /** @param {...*} args */
    destroy(...args) {
        let me = this;

        me.instanceStore?.un('load', me.applyScope, me);
        me.serviceStore?.destroy();
        me.serviceStore = null;
        super.destroy(...args)
    }

    /** @param {String|null} value @param {String|null} oldValue */
    afterSetBoundProfileId(value, oldValue) {
        this.isConstructed && this.applyScope()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetDeploymentState(value, oldValue) {
        this.isConstructed && this.applyPicture()
    }

    /** @param {Neo.data.Store|null} value @param {Neo.data.Store|null} oldValue */
    afterSetInstanceStore(value, oldValue) {
        oldValue?.un('load', this.applyScope, this);
        value?.on('load', this.applyScope, this);
        this.isConstructed && this.applyScope()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetSystemConnection(value, oldValue) {
        this.isConstructed && this.applyConnection()
    }

    /**
     * @summary Render the picture: the freshness line, the whole-view reason (unavailable states only),
     * the plane cards (a wholesale replace — rows are a glance at one instant, never an accumulation),
     * and the three lanes.
     */
    applyPicture() {
        const
            me          = this,
            picture     = me.deploymentState,
            state       = picture?.state ?? null,
            reason      = picture?.reason ?? null,
            ageMs       = picture?.ageMs ?? null,
            generatedAt = picture?.generatedAt ?? null,
            services    = Array.isArray(picture?.services) ? picture.services.filter(row => row && typeof row === 'object' && typeof row.serviceKey === 'string') : [],
            unavailable = state === 'unavailable',
            age         = Number.isFinite(ageMs) ? AgentFreshness.formatAge(ageMs) : null,
            fresh       = me.getReference('fresh'),
            reasonBlock = me.getReference('reason');

        // the freshness line — a stopped clock is said, never a silently current one
        fresh.text = state === null
            ? 'not observed yet'
            : unavailable
                ? 'no picture from the fleet server'
                : state === 'stale'
                    ? `snapshot ${age ?? 'of unknown age'} — past the horizon · showing the last known picture`
                    : `snapshot ${age ?? 'of unknown age'}`;
        fresh.cls = ['fm-system-fresh', state === null ? 'is-cold' : unavailable ? 'is-unavailable' : state === 'stale' ? 'is-stale' : 'is-fresh'];

        // one reason for the whole view; the cards never invent a plane
        if (unavailable) {
            const copy = UNAVAILABLE_COPY[reason] ?? {
                word: 'Deployment state unavailable',
                text: `Reason from the wire: ${reason ?? 'unknown'}. Nothing is shown because nothing was observed.`
            };

            me.getReference('reason-word').text = copy.word;
            me.getReference('reason-text').text = copy.text
        }

        reasonBlock.hidden = !unavailable;
        me.getReference('planes').hidden = unavailable;
        me.getReference('empty').hidden  = unavailable || services.length > 0;

        if (me.serviceStore) {
            me.serviceStore.clear();
            me.serviceStore.add(services.map(row => ({
                serviceKey          : row.serviceKey,
                observedAt          : row.observedAt ?? null,
                observedAgeMs       : me.observedAge(row.observedAt, generatedAt, ageMs),
                status              : row.status ?? null,
                memoryDisposition   : row.memoryPressure?.disposition ?? null,
                memoryReason        : row.memoryPressure?.reason ?? null,
                churnBaseline       : row.restartChurn?.baseline ?? null,
                churnDetecting      : row.restartChurn?.detecting ?? null,
                serviceClass        : row.classification?.serviceClass ?? null,
                serviceClassDeclared: row.classification?.serviceClassDeclared ?? null,
                memoryThreshold     : row.classification?.appliedMemoryThreshold ?? null,
                sampleCount         : row.classification?.sampleCount ?? null,
                diagnosisStatus     : row.diagnosis?.status ?? null,
                actionClass         : row.diagnosis?.actionClass ?? null,
                recoveryClass       : row.diagnosis?.recoveryClass ?? null,
                confidence          : row.diagnosis?.confidence ?? null
            })))
        }

        me.applyLanes({picture, state, unavailable, generatedAt, serviceCount: services.length})
    }

    /**
     * @summary Word the three lanes from the maintenance blocks and the picture's own state.
     * @param {Object} facts
     * @protected
     */
    applyLanes({picture, state, unavailable, generatedAt, serviceCount}) {
        const
            me         = this,
            backup     = picture?.maintenance?.backup ?? null,
            starvation = picture?.maintenance?.starvation ?? null,
            posture    = starvation?.posture ?? null,
            breaches   = starvation?.breachCount ?? null,
            phase      = backup?.phase ?? null,
            verdict    = backup?.health?.status ?? null,
            codes      = Array.isArray(backup?.health?.reasonCodes) ? backup.health.reasonCodes : [],
            receipt    = backup?.lastBackup ?? null;

        me.setLane('maintenance',
            posture === 'degraded'
                ? `degraded · ${Number.isFinite(breaches) ? breaches : 'some'} ${breaches === 1 ? 'task' : 'tasks'} starved`
                : posture === 'disabled' ? 'watchdog disabled' : (posture ?? 'not observed'),
            STARVATION_TONES[posture] ?? 'is-quiet',
            posture ? 'the queue itself is the scheduler view\'s' : 'the watchdog posture arrives with the picture'
        );

        me.setLane('backup',
            phase ?? verdict ?? 'not observed',
            BACKUP_TONES[phase] ?? (verdict === 'degraded' ? 'is-bad' : verdict === 'healthy' ? 'is-ok' : 'is-quiet'),
            codes.length > 0
                ? codes.map(code => code.replaceAll('-', ' ')).join(' · ')
                : phase === 'healthy' && Number.isFinite(backup?.lastSuccessAgeMs)
                    ? `last success ${AgentFreshness.formatAge(backup.lastSuccessAgeMs)}`
                    : receipt?.status
                        ? `last bundle ${receipt.status} · off-host sync ${receipt.offHostSync ?? 'unknown'}`
                        : 'no backup receipt on the wire'
        );

        me.setLane('snapshot',
            state === 'ok' ? 'current' : state === 'stale' ? 'past the horizon' : unavailable ? 'unavailable' : 'not observed',
            PICTURE_TONES[state] ?? 'is-quiet',
            Number.isFinite(generatedAt)
                ? `generated ${ViewerTime.formatViewerTime(generatedAt)?.text ?? 'at an unknown time'} · ${serviceCount} ${serviceCount === 1 ? 'service' : 'services'} · read from the fleet server`
                : 'no picture yet'
        )
    }

    /**
     * @summary One lane's word, tone and line.
     * @param {String} id
     * @param {String} word
     * @param {String} tone
     * @param {String} line
     * @protected
     */
    setLane(id, word, tone, line) {
        const
            wordEl = this.getReference(`lane-${id}-word`),
            lineEl = this.getReference(`lane-${id}-line`);

        if (wordEl) {
            wordEl.text = word;
            wordEl.cls  = ['fm-system-lane-word', tone]
        }

        if (lineEl) {
            lineEl.text = line
        }
    }

    /**
     * @summary The read owner's own observation, shown only while it has one — connecting, refused,
     * unreachable, timeout, failed-upstream — with the sanitized reason the owner retained.
     */
    applyConnection() {
        const
            me          = this,
            observation = me.systemConnection,
            state       = observation?.state ?? null,
            connection  = me.getReference('connection');

        if (!connection) return;

        connection.hidden = !state;
        connection.text   = !state
            ? ''
            : state === 'connecting'
                ? 'fleet read connecting'
                : `fleet read ${state}${observation.reason ? ` · ${observation.reason}` : ''}`
    }

    /**
     * @summary The scope line — WHICH instance this view diagnoses, by the switcher's bound profile
     * and the configured instance's label when the store carries it.
     */
    applyScope() {
        const
            me        = this,
            profileId = me.boundProfileId,
            record    = profileId && me.instanceStore?.get(profileId),
            // the configured label, else the registry key spelled for a reader: the profile prefix
            // and the scheme go, the host and path stay (the switcher's own short form)
            label     = record?.label || (typeof profileId === 'string' ? profileId.replace(/^fleet-profile:v\d+:/, '').replace(/^https?:\/\//, '') : null),
            scope     = me.getReference('scope');

        if (scope) {
            scope.text = label ? `diagnosing ${label} · via fleet-server` : 'diagnosing — no bound instance'
        }
    }

    /**
     * @summary How old a row's observation is on the reader's clock: the picture's own age plus the
     * span between the snapshot's generation and the row's observation. `null` when any part is unknown.
     * @param {Number|null} observedAt
     * @param {Number|null} generatedAt
     * @param {Number|null} ageMs
     * @returns {Number|null}
     */
    observedAge(observedAt, generatedAt, ageMs) {
        return Number.isFinite(observedAt) && Number.isFinite(generatedAt) && Number.isFinite(ageMs)
            ? Math.max(0, ageMs + (generatedAt - observedAt))
            : null
    }
}

export default Neo.setupClass(Container);
