import {expect, test}                   from '@playwright/test';
import {EventEmitter}                   from 'node:events';
import fs, {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir}                         from 'node:os';
import path                             from 'node:path';
import {startBrainChild}                from '../../../../harness/brain.mjs';
import {
    readReceiverLaunchAgent,
    settleWakeReceiver,
    wakeReceiverEnv
} from '../../../../harness/wakeReceiver.mjs';

const
    MANIFEST         = '/Users/operator/Library/Application Support/Neo/AgentOS/wake/routes.json',
    LOCAL_PLANE      = 'http://127.0.0.1:3102',
    NO_ENV           = {},
    SETTLED          = Object.freeze({origin: 'launch-agent', manifest: MANIFEST, base: 'http://host.docker.internal:3199', reason: null}),
    DECLINED         = Object.freeze({origin: 'launch-agent', manifest: null, base: null, reason: 'declined'}),
    PSEUDO_ARGUMENTS = '<key>ProgramArguments</key><array><string>--manifest</string><string>/tmp/pseudo/routes.json</string><string>--port</string><string>4299</string></array>';

/** @summary The parts of a spawned child that `startBrainChild` touches after the spawn. */
function fakeChild() {
    return Object.assign(new EventEmitter(), {pid: 4242, stderr: new EventEmitter(), stdout: new EventEmitter()})
}

/**
 * @summary The receiver's LaunchAgent as the local-agent-os runbook installs it (`plutil` writes tabs), with
 * its `ProgramArguments` replaceable.
 */
function launchAgentXml(args = ['/opt/homebrew/bin/node', 'ai/daemons/wake/receiver.mjs', '--manifest', MANIFEST, '--state-dir', '/tmp/wake/state', '--host', '127.0.0.1', '--port', '3199']) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '\t<key>KeepAlive</key>',
        '\t<true/>',
        '\t<key>Label</key>',
        '\t<string>com.neomjs.agent-os-wake</string>',
        '\t<key>ProgramArguments</key>',
        '\t<array>',
        ...args.map(arg => `\t\t${arg.startsWith('<') ? arg : `<string>${arg}</string>`}`),
        '\t</array>',
        '</dict>',
        '</plist>',
        ''
    ].join('\n')
}

/** @summary A LaunchAgents directory holding the given plist content, or none. */
function launchAgent(content) {
    const plistPath = path.join(mkdtempSync(path.join(tmpdir(), 'wake-receiver-')), 'com.neomjs.agent-os-wake.plist');

    if (content !== undefined) {
        writeFileSync(plistPath, content)
    }

    return plistPath
}

test.describe('harness/wakeReceiver — the host receiver the installed Fleet arms its seats against', () => {
    test('a launch environment carrying both coordinates wins, and the LaunchAgent is never read', () => {
        const
            env      = {NEO_WAKE_RECEIVER_BASE: 'http://host.docker.internal:4199', NEO_WAKE_RECEIVER_MANIFEST: '/srv/wake/routes.json'},
            fsModule = {...fs, readFileSync: () => { throw new Error('the LaunchAgent must not be read') }};

        expect(settleWakeReceiver({env, planeBase: LOCAL_PLANE, plistPath: launchAgent(launchAgentXml()), fsModule})).toEqual({
            origin  : 'environment',
            manifest: '/srv/wake/routes.json',
            base    : 'http://host.docker.internal:4199',
            reason  : null
        });
    });

    test('a Finder launch reads the receiver\'s LaunchAgent: its manifest, and its port as the docker host\'s', () => {
        const plistPath = launchAgent(launchAgentXml());

        for (const planeBase of [LOCAL_PLANE, 'http://localhost:3102', 'http://[::1]:3102']) {
            expect(settleWakeReceiver({env: NO_ENV, planeBase, plistPath})).toEqual({
                origin  : 'launch-agent',
                manifest: MANIFEST,
                base    : 'http://host.docker.internal:3199',
                reason  : null
            });
        }
    });

    test('half an environment is not a declaration: the LaunchAgent settles both coordinates', () => {
        const receiver = settleWakeReceiver({env: {NEO_WAKE_RECEIVER_MANIFEST: '/srv/wake/routes.json'}, planeBase: LOCAL_PLANE, plistPath: launchAgent(launchAgentXml())});

        expect(receiver).toMatchObject({origin: 'launch-agent', manifest: MANIFEST, base: 'http://host.docker.internal:3199'});
    });

    test('a plane that is not on this host cannot reach the host receiver, so nothing is settled', () => {
        const plistPath = launchAgent(launchAgentXml());

        for (const planeBase of ['https://plane.example.com', undefined, 'not a url']) {
            expect(settleWakeReceiver({env: NO_ENV, planeBase, plistPath})).toEqual({
                origin  : 'launch-agent',
                manifest: null,
                base    : null,
                reason  : 'the Fleet attaches to no plane on this host, and only a local plane reaches the host receiver'
            });
        }
    });

    test('no receiver anywhere is origin none, with the reason', () => {
        const plistPath = launchAgent();

        expect(settleWakeReceiver({env: NO_ENV, planeBase: LOCAL_PLANE, plistPath})).toEqual({
            origin  : 'none',
            manifest: null,
            base    : null,
            reason  : `neither the launch environment nor ${plistPath} declares a wake receiver`
        });
    });

    const MALFORMED = [
        ['a binary property list',       'bplist00\u0000\u0001',                                                         /is a binary property list/],
        ['no ProgramArguments',          launchAgentXml().replace('ProgramArguments', 'Arguments'),                       /declares no absolute --manifest and valid --port/],
        ['no --port',                    launchAgentXml(['node', 'receiver.mjs', '--manifest', MANIFEST]),               /declares no absolute --manifest and valid --port/],
        ['a relative --manifest',        launchAgentXml(['node', '--manifest', 'wake/routes.json', '--port', '3199']),   /declares no absolute --manifest and valid --port/],
        ['a port that is not a port',    launchAgentXml(['node', '--manifest', MANIFEST, '--port', '31x9']),             /declares no absolute --manifest and valid --port/],
        ['an argument that is no string', launchAgentXml(['node', '<integer>3199</integer>', '--manifest', MANIFEST, '--port', '3199']), /declares no absolute --manifest and valid --port/],
        // What a plist reader skips must never name the receiver: each of these carries a pseudo array that
        // a pattern match would read, ahead of the real one.
        ['a processing instruction holding a pseudo array', launchAgentXml().replace('<dict>', `<dict>\n\t<?neo ${PSEUDO_ARGUMENTS} ?>`), /is not a whole property list/],
        ['a comment holding a pseudo array',                launchAgentXml().replace('<dict>', `<dict>\n\t<!-- ${PSEUDO_ARGUMENTS} -->`), /is not a whole property list/],
        ['a document cut off after its array',              launchAgentXml().split('\t</array>')[0] + '\t</array>\n',  /is not a whole property list: the document ends early/],
        ['content after its root',                          `${launchAgentXml()}<plist version="1.0"><dict/></plist>\n`, /is not a whole property list: content follows/],
        ['the key twice',                                   launchAgentXml().replace('\t<key>Label</key>', `\t${PSEUDO_ARGUMENTS}\n\t<key>Label</key>`), /is not a whole property list: the key ProgramArguments appears twice/],
        ['an entity no property list uses',                 launchAgentXml(['node', '--manifest', '/Users/operator/R&#38;D/routes.json', '--port', '3199']), /is not a whole property list: it uses an entity/]
    ];

    for (const [label, content, reason] of MALFORMED) {
        test(`a LaunchAgent with ${label} is a named refusal, never a guess`, () => {
            const
                plistPath = launchAgent(content),
                receiver  = settleWakeReceiver({env: NO_ENV, planeBase: LOCAL_PLANE, plistPath});

            expect(receiver).toMatchObject({origin: 'launch-agent', manifest: null, base: null});
            expect(receiver.reason).toContain(plistPath);
            expect(receiver.reason).toMatch(reason);
        });
    }

    test('escaped characters in a path read back as written', () => {
        const manifest = '/Users/operator/R&D <wake>/routes.json';

        expect(readReceiverLaunchAgent({plistPath: launchAgent(launchAgentXml(['node', '--manifest', '/Users/operator/R&amp;D &lt;wake&gt;/routes.json', '--port', '3199']))}))
            .toEqual({manifest, port: 3199});
    });

    test('a settled receiver passes both coordinates, a declined one clears both, and an unpackaged launch adds none', () => {
        expect(wakeReceiverEnv(SETTLED)).toEqual({NEO_WAKE_RECEIVER_BASE: 'http://host.docker.internal:3199', NEO_WAKE_RECEIVER_MANIFEST: MANIFEST});

        for (const declined of [DECLINED, {origin: 'environment', manifest: MANIFEST, base: '', reason: null}]) {
            expect(wakeReceiverEnv(declined)).toEqual({NEO_WAKE_RECEIVER_BASE: '', NEO_WAKE_RECEIVER_MANIFEST: ''});
        }

        expect(wakeReceiverEnv(null)).toEqual({});
    });

    test('at the child boundary, an inherited half never reaches the Fleet, while an unpackaged launch still inherits', () => {
        const childEnv = receiver => {
            let options;

            startBrainChild({
                entry   : 'fleet.mjs',
                env     : wakeReceiverEnv(receiver),
                repoRoot: mkdtempSync(path.join(tmpdir(), 'wake-receiver-child-')),
                spawnFn : (command, args, spawnOptions) => { options = spawnOptions; return fakeChild() }
            });

            return options.env
        };

        for (const half of ['NEO_WAKE_RECEIVER_MANIFEST', 'NEO_WAKE_RECEIVER_BASE']) {
            const saved = process.env[half];

            process.env[half] = 'stale-half-declaration';

            try {
                expect(childEnv(DECLINED)).toMatchObject({NEO_WAKE_RECEIVER_BASE: '', NEO_WAKE_RECEIVER_MANIFEST: ''});
                expect(childEnv(SETTLED)).toMatchObject({NEO_WAKE_RECEIVER_BASE: SETTLED.base, NEO_WAKE_RECEIVER_MANIFEST: MANIFEST});
                expect(childEnv(null)[half]).toBe('stale-half-declaration');
            } finally {
                saved === undefined ? delete process.env[half] : process.env[half] = saved;
            }
        }
    });
});
