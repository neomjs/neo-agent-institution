import {expect, test}                   from '@playwright/test';
import fs, {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir}                         from 'node:os';
import path                             from 'node:path';
import {
    readReceiverLaunchAgent,
    settleWakeReceiver,
    wakeReceiverEnv
} from '../../../../harness/wakeReceiver.mjs';

const
    MANIFEST    = '/Users/operator/Library/Application Support/Neo/AgentOS/wake/routes.json',
    LOCAL_PLANE = 'http://127.0.0.1:3102',
    NO_ENV      = {};

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
        ['an argument that is no string', launchAgentXml(['node', '<integer>3199</integer>', '--manifest', MANIFEST, '--port', '3199']), /declares no absolute --manifest and valid --port/]
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

    test('the Fleet child carries both coordinates of a settled receiver, and neither otherwise', () => {
        expect(wakeReceiverEnv({origin: 'launch-agent', manifest: MANIFEST, base: 'http://host.docker.internal:3199', reason: null}))
            .toEqual({NEO_WAKE_RECEIVER_BASE: 'http://host.docker.internal:3199', NEO_WAKE_RECEIVER_MANIFEST: MANIFEST});

        expect(wakeReceiverEnv({origin: 'launch-agent', manifest: null, base: null, reason: 'x'})).toEqual({});
        expect(wakeReceiverEnv({origin: 'environment', manifest: MANIFEST, base: '', reason: null})).toEqual({});
        expect(wakeReceiverEnv(null)).toEqual({});
    });
});
