import fs   from 'node:fs';
import path from 'node:path';

/**
 * @module harness/wakeReceiver
 * @summary Where the installed shell finds the host wake receiver, so the Fleet it starts can arm the wake
 * route of every GUI seat it launches (the Brain's `armFleetSeatWake`). A Finder-launched app inherits no
 * shell exports, so when the launch carries no receiver, the shell reads the receiver's own LaunchAgent.
 *
 * Settled once per launch, in this order:
 * - the launch environment, when it carries both `NEO_WAKE_RECEIVER_MANIFEST` and `NEO_WAKE_RECEIVER_BASE`
 *   (origin `environment`);
 * - else the receiver's LaunchAgent (origin `launch-agent`). Its `--manifest` is the manifest, and its
 *   `--port` gives the base the dockerized plane reaches, `http://host.docker.internal:<port>`. That base
 *   applies only while the Fleet attaches to a plane on this host: a remote plane cannot reach a host
 *   receiver, and a plane running natively on the host declares its base through the environment;
 * - else none (origin `none`).
 *
 * Anything short of both coordinates passes neither, and the Fleet's seats report `unarmed` with the
 * Brain's own reason. A LaunchAgent that exists but cannot be read is a named refusal, never a guess.
 */

/**
 * The receiver's LaunchAgent, as the local-agent-os runbook installs it under `~/Library/LaunchAgents`.
 * @type {String}
 */
export const WAKE_RECEIVER_LAUNCH_AGENT = 'com.neomjs.agent-os-wake.plist';

const
    LOCAL_HOSTS       = ['127.0.0.1', 'localhost', '[::1]'],
    PROGRAM_ARGUMENTS = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
    XML_STRING        = /<string>([^<]*)<\/string>/g,
    // the escapes Apple's property-list writer emits
    XML_ENTITIES      = {amp: '&', apos: '\'', gt: '>', lt: '<', quot: '"'};

/**
 * @summary The `ProgramArguments` strings of an XML property list, or `null` when the array is absent or
 * holds anything but strings.
 * @param {String} xml
 * @returns {String[]|null}
 * @private
 */
function programArguments(xml) {
    const body = PROGRAM_ARGUMENTS.exec(xml)?.[1];

    if (body === undefined || body.replace(XML_STRING, '').trim()) {
        return null
    }

    return [...body.matchAll(XML_STRING)].map(([, text]) => text.replace(/&(amp|apos|gt|lt|quot);/g, (entity, name) => XML_ENTITIES[name]))
}

/**
 * @summary Whether the Fleet attaches to a plane on this host, which is the dockerized plane the runbook
 * installs. An absent or unparsable plane base is not local.
 * @param {String} [planeBase]
 * @returns {Boolean}
 * @private
 */
function isLocalPlane(planeBase) {
    try {
        return LOCAL_HOSTS.includes(new URL(planeBase).hostname)
    } catch {
        return false
    }
}

/**
 * @summary The receiver's own declaration: the `--manifest` and `--port` its LaunchAgent runs it with.
 * @param {Object} options
 * @param {String} options.plistPath
 * @param {Object} [options.fsModule=fs]
 * @returns {{manifest: String, port: Number}|null} `null` when no LaunchAgent is installed.
 * @throws {Error} When the LaunchAgent exists but does not readably declare both.
 */
export function readReceiverLaunchAgent({plistPath, fsModule = fs}) {
    let xml;

    try {
        xml = fsModule.readFileSync(plistPath, 'utf8')
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null
        }

        throw new Error(`${plistPath} cannot be read (${error.message})`)
    }

    if (xml.startsWith('bplist')) {
        throw new Error(`${plistPath} is a binary property list; \`plutil -convert xml1\` restores the XML the runbook installs`)
    }

    const
        args     = programArguments(xml) ?? [],
        after    = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined,
        manifest = after('--manifest'),
        port     = Number(after('--port'));

    if (!path.isAbsolute(manifest ?? '') || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${plistPath} declares no absolute --manifest and valid --port in its ProgramArguments`)
    }

    return {manifest, port}
}

/**
 * @summary The receiver for this launch, with its origin and, when it is not settled, why.
 * @param {Object} options
 * @param {Object} options.env The launch environment.
 * @param {String} [options.planeBase] The plane the Fleet attaches to, as the Brain resolved it.
 * @param {String} options.plistPath The receiver's LaunchAgent.
 * @param {Object} [options.fsModule=fs]
 * @returns {{origin: String, manifest: String|null, base: String|null, reason: String|null}}
 */
export function settleWakeReceiver({env, planeBase, plistPath, fsModule = fs}) {
    if (env.NEO_WAKE_RECEIVER_MANIFEST && env.NEO_WAKE_RECEIVER_BASE) {
        return {origin: 'environment', manifest: env.NEO_WAKE_RECEIVER_MANIFEST, base: env.NEO_WAKE_RECEIVER_BASE, reason: null}
    }

    const unsettled = (origin, reason) => ({origin, manifest: null, base: null, reason});
    let agent;

    try {
        agent = readReceiverLaunchAgent({plistPath, fsModule})
    } catch (error) {
        return unsettled('launch-agent', error.message)
    }

    if (!agent) {
        return unsettled('none', `neither the launch environment nor ${plistPath} declares a wake receiver`)
    }

    return isLocalPlane(planeBase)
        ? {origin: 'launch-agent', manifest: agent.manifest, base: `http://host.docker.internal:${agent.port}`, reason: null}
        : unsettled('launch-agent', 'the Fleet attaches to no plane on this host, and only a local plane reaches the host receiver')
}

/**
 * @summary The Fleet child's environment fragment: both coordinates of a settled receiver, nothing otherwise.
 * @param {Object|null} receiver A {@link settleWakeReceiver} result, `null` when none was settled.
 * @returns {Object}
 */
export function wakeReceiverEnv(receiver) {
    return receiver?.manifest && receiver.base ? {NEO_WAKE_RECEIVER_BASE: receiver.base, NEO_WAKE_RECEIVER_MANIFEST: receiver.manifest} : {}
}
