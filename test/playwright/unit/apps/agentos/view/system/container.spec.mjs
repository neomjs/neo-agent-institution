import {setup} from '../../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'SystemViewTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect}      from '@playwright/test';
import Neo                 from '../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core           from '../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                          '../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import BaseContainer       from '../../../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import Provider            from '../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import DeploymentStateRead from '../../../../../../../apps/agentos/util/DeploymentStateRead.mjs';
import FleetInstances      from '../../../../../../../apps/agentos/store/FleetInstances.mjs';
import SystemView          from '../../../../../../../apps/agentos/view/system/Container.mjs';

/** The wire's picture for a plane with one serving and one degraded service, the backup lane exhausted. */
const projection = () => ({
    state      : 'ok',
    reason     : null,
    generatedAt: 1_788_568_958_677,
    ageMs      : 12_000,
    services   : [{
        serviceKey    : 'chroma',
        observedAt    : 1_788_568_959_783,
        status        : 'available',
        memoryPressure: {disposition: 'below', reason: null},
        restartChurn  : {baseline: 'available', detecting: true},
        classification: {serviceClass: 'store', serviceClassDeclared: true, appliedMemoryThreshold: 80, sampleCount: 2},
        diagnosis     : {status: 'healthy', actionClass: null, recoveryClass: null, confidence: null}
    }, {
        serviceKey    : 'mc-server',
        observedAt    : 1_788_568_964_079,
        status        : 'degraded',
        memoryPressure: {disposition: 'at-cap', reason: 'sustained-saturation'},
        restartChurn  : {baseline: 'available', detecting: true},
        classification: {serviceClass: 'transient', serviceClassDeclared: true, appliedMemoryThreshold: 90, sampleCount: 12},
        diagnosis     : {status: 'degraded', actionClass: 'restart', recoveryClass: 'exhaustion', confidence: 0.95}
    }],
    maintenance: {
        backup    : {phase: 'exhausted', lastSuccessAt: null, lastSuccessAgeMs: null, health: {status: 'degraded', reasonCodes: ['backup-never-succeeded', 'off-host-durability-unmet']}, lastBackup: {finishedAt: '2026-09-04T16:41:27.657Z', status: 'success', offHostSync: 'disabled'}},
        starvation: {posture: 'degraded', breachCount: 5}
    }
});

/**
 * The System keeper-view under a Viewport-shaped provider: the picture and the observation are
 * declared on the PARENT (the cockpit's read owner writes them there through the closest-owner
 * walk), and this view binds them as a sibling. Every state the design sketch names is driven
 * through the real provider and read back from the rendered components.
 */
test.describe('AgentOS.view.system.Container — the engine room reads the provider-held picture', () => {
    const makeHost = () => {
        const host = Neo.create(BaseContainer, {
            stateProvider: {
                module: Provider,
                data  : {
                    boundProfileId  : null,
                    deploymentState : DeploymentStateRead.blank(),
                    instanceState   : 'off',
                    systemConnection: {state: null, reason: null}
                },
                stores: {fleetInstances: {module: FleetInstances}}
            },
            items: [{module: SystemView, reference: 'system'}]
        });

        return {host, provider: host.getStateProvider(), view: host.getReference('system')}
    };

    const laneWord = (view, id) => view.getReference(`lane-${id}-word`);
    const laneLine = (view, id) => view.getReference(`lane-${id}-line`);

    test('never answered: the head says so, no card exists, every lane reads not observed, no reason block', () => {
        const {host, view} = makeHost();

        try {
            expect(view.getReference('fresh').text).toBe('not observed yet');
            expect(view.getReference('fresh').cls).toContain('is-cold');
            expect(view.getReference('reason').hidden).toBe(true);
            expect(view.getReference('planes').hidden).toBe(false);
            expect(view.getReference('empty').hidden, 'the honest empty line stands where the cards will').toBe(false);
            expect(view.serviceStore.getCount()).toBe(0);
            expect(laneWord(view, 'maintenance').text).toBe('not observed');
            expect(laneWord(view, 'backup').text).toBe('not observed');
            expect(laneWord(view, 'snapshot').text).toBe('not observed');
            expect(view.getReference('connection').hidden).toBe(true);
            expect(view.getReference('scope').text).toBe('diagnosing — no bound instance');
            // observe-only by declaration, and the logs region names its missing verb instead of faking a stream
            expect(view.getReference('observe').text).toBe('observe-only');
            expect(view.getReference('logs-line').text).toContain('neomjs/neo-agent-brain issue 27');
            expect(view.getReference('logs-line').text).toContain('Not wired yet')
        } finally {
            host.destroy()
        }
    });

    test('an ok picture lands as cards and lanes — words from the wire, ages on the reader\'s clock', () => {
        const {host, provider, view} = makeHost();

        try {
            provider.setData({deploymentState: projection()});

            expect(view.getReference('fresh').text).toBe('snapshot 12s ago');
            expect(view.getReference('fresh').cls).toContain('is-fresh');
            expect(view.getReference('reason').hidden).toBe(true);
            expect(view.getReference('empty').hidden).toBe(true);

            const rows = view.serviceStore.items.map(record => record.toJSON ? record.toJSON() : record);

            expect(rows.map(row => row.serviceKey)).toEqual(['chroma', 'mc-server']);
            expect(rows[0]).toMatchObject({status: 'available', memoryDisposition: 'below', serviceClass: 'store', memoryThreshold: 80, sampleCount: 2, diagnosisStatus: 'healthy', recoveryClass: null});
            expect(rows[1]).toMatchObject({status: 'degraded', memoryDisposition: 'at-cap', memoryReason: 'sustained-saturation', serviceClass: 'transient', actionClass: 'restart', recoveryClass: 'exhaustion', confidence: 0.95});
            // 12 000 ms of picture age minus the 1 106 ms between generation and the row's observation
            expect(rows[0].observedAgeMs).toBe(10_894);

            expect(laneWord(view, 'maintenance').text).toBe('degraded · 5 tasks starved');
            expect(laneWord(view, 'maintenance').cls).toContain('is-bad');
            expect(laneWord(view, 'backup').text).toBe('exhausted');
            expect(laneWord(view, 'backup').cls).toContain('is-bad');
            expect(laneLine(view, 'backup').text).toBe('backup never succeeded · off host durability unmet');
            expect(laneWord(view, 'snapshot').text).toBe('current');
            expect(laneLine(view, 'snapshot').text).toContain('2 services · read from the fleet server')
        } finally {
            host.destroy()
        }
    });

    test('a stale picture keeps its cards and dates them — a stopped clock, never a silently current one', () => {
        const {host, provider, view} = makeHost();

        try {
            provider.setData({deploymentState: {...projection(), state: 'stale', ageMs: 360_000}});

            expect(view.getReference('fresh').text).toBe('snapshot 6m ago — past the horizon · showing the last known picture');
            expect(view.getReference('fresh').cls).toContain('is-stale');
            expect(view.serviceStore.getCount()).toBe(2);
            expect(laneWord(view, 'snapshot').text).toBe('past the horizon');
            expect(laneWord(view, 'snapshot').cls).toContain('is-warn')
        } finally {
            host.destroy()
        }
    });

    test('an unavailable picture is ONE reason for the whole view — cards hidden, the wire\'s reason named', () => {
        const {host, provider, view} = makeHost();

        try {
            provider.setData({deploymentState: {...DeploymentStateRead.blank(), state: 'unavailable', reason: 'snapshot-missing'}});

            expect(view.getReference('reason').hidden).toBe(false);
            expect(view.getReference('reason-word').text).toBe('No deployment-state snapshot at the fleet server');
            expect(view.getReference('planes').hidden).toBe(true);
            expect(view.getReference('fresh').text).toBe('no picture from the fleet server');
            expect(laneWord(view, 'snapshot').text).toBe('unavailable');

            // an older build: the build gap is named, never an empty plane
            provider.setData({deploymentState: {...DeploymentStateRead.blank(), state: 'unavailable', reason: 'unsupported-method'}});

            expect(view.getReference('reason-word').text).toBe('This instance\'s fleet server predates the deployment-state verb');

            // a reason the copy table does not know prints itself
            provider.setData({deploymentState: {...DeploymentStateRead.blank(), state: 'unavailable', reason: 'snapshot-read-failed'}});

            expect(view.getReference('reason-word').text).toBe('Deployment state unavailable');
            expect(view.getReference('reason-text').text).toContain('snapshot-read-failed');

            // the plane comes back: the reason block leaves, the cards return
            provider.setData({deploymentState: projection()});

            expect(view.getReference('reason').hidden).toBe(true);
            expect(view.getReference('planes').hidden).toBe(false);
            expect(view.serviceStore.getCount()).toBe(2)
        } finally {
            host.destroy()
        }
    });

    test('the read owner\'s observation rides its own line and leaves when the wire answers', () => {
        const {host, provider, view} = makeHost();

        try {
            provider.setData({systemConnection: {state: 'connecting', reason: null}});
            expect(view.getReference('connection').hidden).toBe(false);
            expect(view.getReference('connection').text).toBe('fleet read connecting');

            provider.setData({systemConnection: {state: 'refused', reason: 'request denied'}});
            expect(view.getReference('connection').text).toBe('fleet read refused · request denied');

            provider.setData({systemConnection: {state: null, reason: null}});
            expect(view.getReference('connection').hidden).toBe(true)
        } finally {
            host.destroy()
        }
    });

    test('the scope line names WHICH instance — the bound profile, by its configured label once the store carries it', () => {
        const {host, provider, view} = makeHost();

        try {
            provider.setData({boundProfileId: 'local-agent-os'});
            expect(view.getReference('scope').text).toBe('diagnosing local-agent-os · via fleet-server');

            provider.getStore('fleetInstances').add({profileId: 'local-agent-os', label: 'Local Agent OS', canonicalEndpoint: 'http://127.0.0.1:8083/fleet'});
            view.applyScope();
            expect(view.getReference('scope').text).toBe('diagnosing Local Agent OS · via fleet-server');

            provider.setData({boundProfileId: null});
            expect(view.getReference('scope').text).toBe('diagnosing — no bound instance')
        } finally {
            host.destroy()
        }
    })
});
