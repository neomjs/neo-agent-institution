// The Electron harness main: boots the Agent OS app on the packaged origin the Electron-shell ADR
// specifies (neomjs/neo: learn/agentos/decisions/0034-electron-shell-architecture.md).
// Every section reference below resolves against that decision record.
// Scope: harness skeleton + multi-window join + the supervised Brain
// (the hosting-spike verdict: Arm B — see brain.mjs).
//
// ADR bindings implemented here:
//   §2.2 C1  privileged app:// scheme (standard + secure + supportFetchAPI), one stable origin
//   §2.2 C3  window.open popups materialize via setWindowOpenHandler and join the shared workers
//   §2.3.1   explicit secure renderer flags on EVERY window, including popups
//   §2.3.2   fail-closed content/window/navigation policy with a host + path allowlist
//   §2.3.3   permissions denied by default + restrictive document CSP
//   §2.3.4   one capability-shaped preload; IPC validates senderFrame before accepting messages
//   §2.6     the app:// origin resolves the same source graph as dev HTTP through an explicit
//            renderer-content allowlist; it never exposes the whole repository
//
//   §2.1.5   one retained cockpit + tray; explicit quit owns exact-once Brain teardown

import {app, BrowserWindow, ipcMain, Menu, nativeImage, protocol, safeStorage, session, shell, Tray} from 'electron';
import {createReadStream, readFileSync}                                                              from 'node:fs';
import {fileURLToPath}                                                                               from 'node:url';
import path                                                                                          from 'node:path';
import {
    ADAPTER_STATE_NAMES,
    ROSTER_CROSSING_WINDOW_MS,
    computeFirstPaintVerdict
} from './adapterWitness.mjs';
import {createAppLifecycle}                                 from './appLifecycle.mjs';
import {createCredentialPrompt}                             from './credentialPrompt.mjs';
import {createAbsentFleetCapability, createFleetCapability} from './fleetCapability.mjs';
import {
    APP_HOST,
    CONTENT_SECURITY_POLICY,
    REQUIRED_ASSET_PATHS,
    createHarnessAssetResolver,
    isAllowedHarnessAssetPath,
    isHarnessDocumentUrl,
    windowOpenDisposition
} from './contentPolicy.mjs';
import {
    allocatePort,
    assertIsolatedProfile,
    awaitFleetReady,
    besidePlaneRefusal,
    bootFailureCause,
    awaitOrchestratorReady,
    awaitPortListening,
    buildBrainProfile,
    buildPackagedBrainEnv,
    clearRunState,
    detectLiveBrain,
    FLEET_SERVER_ENTRY,
    fleetReadyOrPlaneRefusal,
    ORCHESTRATOR_ENTRY,
    probePort,
    registerOwnedChild,
    resolveBrainMode,
    resolveLauncherRuntimeRoot,
    resolveUiFleetTransport,
    resolveBrainPaths,
    resolveProductBrainPlan,
    resolveSmokeRoot,
    loadFleetRuntimeContracts,
    runBrainScript,
    runtimePlaneCause,
    startBrainChild,
    stopBrainTree,
    sweepStaleRunState,
    typePlaneRefusal,
    writeRunState
} from './brain.mjs';
import {createSmokeSafeStorage, FIXTURE_PLANE_ID, startFixturePlane} from './fixturePlane.mjs';
import {resolveSmokeHold, watchPlaneControl, writeWalkManifest}      from './walkControl.mjs';
import {carriesSecret, createMainLog}                                from './mainLog.mjs';
import {
    createPlaneBroker,
    launchedPlaneRecord,
    planeEnvFragment,
    probePlaneCredential,
    readPlaneConfig
} from './planeConfig.mjs';
import {settleSeatRoot, writeSeatRootRecord}                                                        from './seatRootRecord.mjs';
import {findFleetWriters, runSeatMoveStep, seatMoveBootHold, settleSeatRootMove}                    from './seatRootMove.mjs';
import {SEAT_ROOT_CHANNELS, createSeatRootBroker, createSeatRootRuntime}                           from './seatRootBroker.mjs';
import {CONFIG_SOURCE_PATH, SETUP_CHANNELS, createSetupBroker, loadSetupModules, resolveSetupRoots} from './setupBroker.mjs';
import {
    WAKE_RECEIVER_LAUNCH_AGENT,
    settleWakeReceiver,
    wakeReceiverEnv
} from './wakeReceiver.mjs';

const
    harnessDir           = path.dirname(fileURLToPath(import.meta.url)),
    repoRoot             = path.resolve(harnessDir, '..'),
    packagedMode         = app.isPackaged,
    packagedOrganismRoot = packagedMode ? path.join(process.resourcesPath, 'organism') : null,
    // Renderer assets stay product-owned.
    productRoot           = packagedMode ? packagedOrganismRoot : repoRoot,
    // DEV MODE, deliberately (operator decision 2026-07-10): the harness window loads the
    // zero-build SOURCE app — Neural Link possession needs real ESM, which minification destroys.
    APP_URL      = `app://${APP_HOST}/apps/agentos/index.html`,
    smokeMode            = process.env.NEO_HARNESS_SMOKE === '1',
    lifecycleWitnessMode = process.env.NEO_HARNESS_LIFECYCLE_WITNESS === '1',
    diagnosticMode       = smokeMode || lifecycleWitnessMode,
    // The Arm-B Brain leg: DEFAULT-ON when packaged (a Finder double-click supplies no env — the
    // product IS the supervised organism; NEO_HARNESS_BRAIN=0 is the explicit opt-out) and opt-in
    // on a checkout (dev machines carry a canonical Brain; see brain.mjs#resolveBrainMode).
    brainMode             = resolveBrainMode({env: process.env, packaged: packagedMode}),
    // The fixture-plane arm: the Brain smoke attaches to a plane of its own, through a record whose
    // bearer only this run can decrypt, so the OS keychain is never touched.
    smokePlaneMode        = smokeMode && brainMode && process.env.NEO_HARNESS_SMOKE_PLANE === '1',
    // A walker's held run (`NEO_HARNESS_SMOKE_HOLD=1`): the fixture-plane arm only, refused anywhere else.
    smokeHold             = resolveSmokeHold({env: process.env, smokePlaneMode}),
    planeSafeStorage      = smokePlaneMode ? createSmokeSafeStorage() : safeStorage,
    // Brain executables resolve through their own explicit runtime root in checkout mode; the
    // packaged artifact supplies one assembled organism root; a checkout with the Brain leg OFF and
    // no root boots as the UI alone — no root, no contracts, no transport (the resolver's rule).
    agentosRuntimeRoot    = resolveLauncherRuntimeRoot({brainMode, env: process.env, packaged: packagedMode, packagedOrganismRoot}),
    fleetRuntimeContracts = agentosRuntimeRoot ? await loadFleetRuntimeContracts({productRoot, runtimeRoot: agentosRuntimeRoot}) : null,
    // ONE main-owned secret per Electron boot. It crosses only into the Fleet child environment
    // and main-process Authorization headers; preload/renderer/App-Worker receive no getter or byte.
    // `null` when this boot carries no transport: nothing to protect, nothing to censor.
    fleetBearerToken = fleetRuntimeContracts ? fleetRuntimeContracts.resolveFleetBearer({suppliedToken: process.env.NEO_FLEET_BEARER}) : null,
    smokeState       = {
        assetFailures : new Set(),
        assetsSeen    : new Set(),
        fleetMethods  : [],
        rendererErrors: [],
        secretLeaks   : new Set()
    },
    bootReports       = new Map(),
    bootWaiters       = new Map(),
    firstPaintReports = new Map(),
    firstPaintWaiters = new Map(),
    // A diagnostic run owns its whole profile: Electron's `userData` moves under the smoke root
    // before anything reads it, so neither a stored plane record nor the smoke shot is the installed app's.
    smokeRoot         = diagnosticMode ? resolveSmokeRoot({env: process.env, harnessDir, packaged: packagedMode, tempDir: app.getPath('temp')}) : null;

// A hold outside the fixture-plane arm would attach to or own this machine's organism: stop before any of it.
if (smokeHold.refusal) {
    console.log('HARNESS_SMOKE_HOLD_REFUSED ' + smokeHold.refusal);
    app.exit(2)
}

smokeRoot && app.setPath('userData', path.join(smokeRoot, 'userData'));

let
    brainBootPromise = Promise.resolve(null),
    resolveHarnessAsset,
    // The shell's transport-boot fact for the cockpit banner — attached to every brain-health
    // answer so the renderer can name WHICH shell case is live instead of guessing "offline".
    // `null` = no transport story this run (plain UI-only smoke spawns nothing by isolation
    // contract); `{phase: 'starting'}` while a boot is in flight; the normalized settle after.
    uiTransportFact = null,
    // The plane record's bearer once a boot has read it (the product's, or the smoke's fixture plane);
    // the log redacts it with the others.
    storedPlaneBearer = null,
    // The stored record this boot launched its fleet child with (`launchedPlaneRecord`), or `null` when
    // the plane came from elsewhere: the one record `verifyPlane()` may probe while the shell runs.
    launchedPlane = null,
    // How this boot settled a consented move of the seats (`settleSeatRootMove`), or `null` outside a
    // packaged product boot: the outcome the shell reports, also when the Fleet could not start over it.
    seatMoveOutcome = null;

// Every secret main holds. The main log and a plane refusal's cockpit detail both drop a line carrying one.
const mainSecrets = () => [fleetBearerToken, process.env.NEO_FLEET_PLANE_BEARER, process.env.NEO_FLEET_PLANE_ADMISSION_BEARER, storedPlaneBearer];

// A Finder launch has no terminal: every line main prints also lands in `main.log` in the platform's logs
// folder, with each secret main holds redacted at the file boundary. A diagnostic run logs under its own
// root, never into the installed app's file. A logs path the platform refuses leaves the boot running
// without a file, never failing it.
try {
    app.setAppLogsPath(smokeRoot ? path.join(smokeRoot, 'logs') : undefined);
    createMainLog({
        dir    : app.getPath('logs'),
        secrets: mainSecrets
    }).install()
} catch (error) {
    console.error(`HARNESS_MAIN_LOG_UNAVAILABLE ${error?.message ?? error}`)
}

/**
 * @summary Normalizes a settled transport/Brain boot outcome into the wire-safe banner fact.
 *
 * Every boot path resolves a slightly different shape (`bootUiFleetTransport`'s three-outcome
 * plan, `bootProductBrain`'s plan modes, `bootSmokeBrain`'s profile record, the catch handlers'
 * `{error, up: false}`); the cockpit needs ONE shape. Deliberately no bearer, no paths — ports and
 * harness-authored refusal/error strings only, rendered through the banner's text sink.
 * @param {Object|null} boot The settled boot outcome, or `null` (no transport story).
 * @returns {Object|null}
 */
function normalizeTransportFact(boot) {
    if (!boot) return null;

    return {
        error    : boot.error     ?? null,
        fleetPort: boot.fleetPort ?? null,
        mode     : boot.mode      ?? null,
        phase    : 'settled',
        reason   : boot.reason    ?? null,
        up       : boot.up === true
    }
}

// Packaged mode: every parent-side child spawn (Brain children, the config resolver) runs on the
// bundled Electron runtime — the packaged env fragments add ELECTRON_RUN_AS_NODE per child.
if (packagedMode && !process.env.NEO_HARNESS_NODE_BIN) {
    process.env.NEO_HARNESS_NODE_BIN = process.execPath
}

protocol.registerSchemesAsPrivileged([
    {scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true}}
]);

/**
 * @summary Returns the renderer flags that are explicit invariants for every harness window.
 * @returns {Object}
 */
function getSecureWebPreferences() {
    return {
        backgroundThrottling: false,
        contextIsolation    : true,
        nodeIntegration     : false,
        preload             : path.join(harnessDir, 'preload.cjs'),
        sandbox             : true,
        webSecurity         : true
    }
}

/**
 * @summary Records one de-duplicated runtime failure for the smoke verdict.
 * @param {String} type
 * @param {*} details
 */
function recordSmokeFailure(type, details) {
    if (!diagnosticMode) {
        return
    }

    const
        raw           = String(details?.message ?? details ?? 'unknown'),
        containsToken = carriesSecret(raw, mainSecrets()),
        message       = `${type}: ${containsToken ? '[secret-bearing detail redacted]' : raw.slice(0, 500)}`;

    containsToken && smokeState.secretLeaks.add(type);

    if (!smokeState.rendererErrors.includes(message)) {
        smokeState.rendererErrors.push(message)
    }

    console.log(`HARNESS_RUNTIME_FAILURE ${message}`)
}

/**
 * Serves only the allowlisted source graph and public assets. A realpath check inside the resolver
 * closes symlink escapes; every denial is the same 404 response so filesystem shape is not leaked.
 * @summary Handles app:// requests through the fail-closed renderer-content boundary.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function serveHarnessContent(request) {
    const resolved = await resolveHarnessAsset(request.url);

    if (!resolved.ok) {
        if (
            smokeMode &&
            resolved.pathname &&
            isAllowedHarnessAssetPath(resolved.pathname) &&
            ['containment', 'missing'].includes(resolved.reason)
        ) {
            smokeState.assetFailures.add(`${resolved.pathname}:${resolved.reason}`)
        }

        smokeMode && console.log(`HARNESS_404 ${resolved.pathname ?? '<denied>'} ${resolved.reason}`);
        return new Response('not found', {status: 404})
    }

    smokeState.assetsSeen.add(resolved.pathname);

    const headers = {
        'cache-control'         : 'no-store',
        'content-type'          : resolved.contentType,
        'x-content-type-options': 'nosniff'
    };

    if (resolved.isDocument) {
        headers['content-security-policy'] = CONTENT_SECURITY_POLICY;
        headers['x-frame-options']          = 'DENY'
    }

    return new Response(createReadStream(resolved.filePath), {headers})
}

/**
 * @summary Applies popup, navigation, webview, and smoke-diagnostic policy to one WebContents.
 * @param {Electron.WebContents} contents
 */
function configureWebContents(contents) {
    contents.setWindowOpenHandler(({url: target}) => {
        const disposition = windowOpenDisposition(target);

        if (disposition.action === 'deny') {
            // An allowlisted https link leaves for the operator's browser; the shell still opens
            // nothing for it (shell ADR §2.3 item 2, the external hand-off).
            disposition.openExternal && shell.openExternal(target);
            return {action: 'deny'}
        }

        return {
            action                      : 'allow',
            overrideBrowserWindowOptions: {webPreferences: getSecureWebPreferences()}
        }
    });

    contents.on('will-navigate', (event, target) => {
        if (!isHarnessDocumentUrl(target)) {
            event.preventDefault()
        }
    });

    contents.on('will-attach-webview', event => event.preventDefault());

    if (!smokeMode) {
        return
    }

    contents.on('render-process-gone', (event, details) => recordSmokeFailure('renderer-gone', JSON.stringify(details)));
    contents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
        isMainFrame && recordSmokeFailure('load-failed', `${code} ${description} ${url}`)
    });
    contents.on('preload-error', (event, preloadPath, error) => recordSmokeFailure('preload-error', error));
    contents.on('console-message', details => {
        const secret = carriesSecret(String(details.message), mainSecrets());

        secret && smokeState.secretLeaks.add('renderer-console');
        console.log(`HARNESS_PAGE ${details.level} ${secret ? '[secret-bearing message redacted]' : String(details.message).slice(0, 300)}`);

        if (details.level === 'error') {
            recordSmokeFailure('renderer-console', details.message)
        }
    })
}

/**
 * @summary On macOS the cockpit's top bar is the window's title bar: the traffic lights sit inset in
 * it, and the window-controls overlay tells the bar where its free area starts
 * (`env(titlebar-area-x)` in `Viewport.scss`; a browser reports none, so the cockpit is unchanged
 * there). Other platforms keep the native frame: their overlay paints window controls in fixed
 * colours that a theme switch could not follow.
 * @type {Object}
 */
const MACOS_TITLE_BAR = Object.freeze({
    titleBarOverlay: true,
    titleBarStyle  : 'hiddenInset',
    // the lights' 14px frame centred in the 50px `.agent-top-toolbar`
    trafficLightPosition: Object.freeze({x: 16, y: 18})
});

/**
 * Creates a visible harness window. Hidden windows do not mount because Neo's main-thread delta
 * application rides requestAnimationFrame; background throttling is disabled for the same reason.
 * @summary Creates a primary harness BrowserWindow with the explicit secure renderer posture.
 * @param {String} url
 * @returns {BrowserWindow}
 */
function createHarnessWindow(url) {
    const win = new BrowserWindow({
        height: 900,
        width : 1400,
        ...(process.platform === 'darwin' ? MACOS_TITLE_BAR : {}),
        webPreferences: getSecureWebPreferences()
    });

    win.loadURL(url);
    return win
}

/**
 * Rebuilds the menu on each owner event because Linux does not project later MenuItem mutations
 * until `setContextMenu()` is called again. The disabled state row and tooltip carry the triad;
 * the macOS template icon remains monochrome by platform convention.
 * @summary Creates the one durable tray handle and its state/menu projection controller.
 * @param {Object} options
 * @param {Function} options.onOpen Shows the retained cockpit.
 * @param {Function} options.onQuit Enters explicit quit.
 * @param {'running'|'degraded'|'stopped'} options.state Initial Brain state.
 * @returns {Object}
 */
function createHarnessTray({onOpen, onQuit, state}) {
    const
        iconName = process.platform === 'darwin' ? 'neoTrayTemplate.png' : 'neoTray.png',
        iconPath = path.join(harnessDir, 'assets', 'tray', iconName),
        icon     = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
        throw new Error(`Harness tray icon failed to load: ${iconPath}`)
    }

    const tray = new Tray(icon);
    let menu;

    /**
     * @summary Rebuilds the platform menu from the lifecycle owner's current state.
     * @param {'running'|'degraded'|'stopped'} nextState
     */
    function setState(nextState) {
        const label = nextState[0].toUpperCase() + nextState.slice(1);

        menu = Menu.buildFromTemplate([
            {enabled: false, id: 'brain-state', label: `State: ${label}`},
            {type: 'separator'},
            {click: onOpen, id: 'open-cockpit', label: 'Open Cockpit'},
            {click: onQuit, id: 'quit', label: 'Quit'}
        ]);
        tray.setContextMenu(menu);
        tray.setToolTip(`Neo Harness — ${label}`)
    }

    setState(state);

    return {
        destroy: () => tray.destroy(),
        invoke(action) {
            const item = menu.getMenuItemById(action);

            if (!item) {
                return false
            }

            item.click(item);
            return true
        },
        setState
    }
}

/**
 * @summary Validates that an IPC event came from an allowlisted top-level Agent OS document.
 * @param {Electron.IpcMainEvent} event
 * @returns {Boolean}
 */
function isTrustedIpcSender(event) {
    const frame = event.senderFrame;

    return Boolean(
        frame &&
        frame === event.sender.mainFrame &&
        isHarnessDocumentUrl(frame.url)
    )
}

// One credential window serves plane attach and every credential-bearing Fleet verb.
const promptFleetCredential = createCredentialPrompt({
    BrowserWindow,
    Menu,
    preloadPath: path.join(harnessDir, 'credentialPrompt.preload.cjs')
});

// The handler closures own the only renderer→Fleet route in the packaged topology. The Brain
// promise is read at call time so an early-rendering UI receives a named not-ready envelope while a
// later call joins the exact boot the lifecycle owner retained. A boot without a Brain root keeps
// the route registered and rejects every request with the named reason — never a missing handler.
const fleetCapability = fleetRuntimeContracts
    ? createFleetCapability({
        bearerToken        : fleetBearerToken,
        createWireOffer    : fleetRuntimeContracts.createFleetWireOffer,
        createWireRequest  : fleetRuntimeContracts.createFleetWireRequest,
        createWireResponse : fleetRuntimeContracts.createFleetWireResponse,
        credentialMethods  : fleetRuntimeContracts.FLEET_CREDENTIAL_METHODS,
        credentialProvider : promptFleetCredential,
        getBrain           : () => brainBootPromise,
        inspectWireResponse: fleetRuntimeContracts.inspectFleetWireResponse,
        isTrustedSender    : isTrustedIpcSender,
        onAdmitted         : ({method}) => diagnosticMode && smokeState.fleetMethods.push(method),
        responseStates     : fleetRuntimeContracts.FLEET_WIRE_RESPONSE_STATES,
        wireMethods        : fleetRuntimeContracts.FLEET_WIRE_METHODS
    })
    : createAbsentFleetCapability({
        isTrustedSender: isTrustedIpcSender,
        reason         : 'fleet: this shell boots without a Brain root (NEO_HARNESS_BRAIN is off and NEO_AGENTOS_RUNTIME_ROOT is unset) — no Fleet transport in this boot'
    });

/**
 * @summary Reduces an untrusted boot-report payload to its allowlisted primitive fields.
 * @param {*} report
 * @returns {Object|null}
 */
function sanitizeBootReport(report) {
    if (
        !report ||
        !Number.isFinite(report.mounted) ||
        report.mounted < 0 ||
        !(report.viewportId === null || typeof report.viewportId === 'string') ||
        !(report.bootMs === null || Number.isFinite(report.bootMs))
    ) {
        return null
    }

    return {
        bootMs    : report.bootMs,
        mounted   : report.mounted,
        timedOut  : report.timedOut === true,
        viewportId: report.viewportId
    }
}

/**
 * @summary Reduces an untrusted first-paint report to bounded semantic primitives, stamping
 * shell-launch-to-accepted-receipt `firstPaintMs` while preserving renderer-load-to-semantic-ready
 * `rendererFirstPaintMs`.
 * @param {*} report
 * @returns {Object|null}
 */
function sanitizeFirstPaintReport(report) {
    const
        boundedText   = value => value === null || (typeof value === 'string' && value.length <= 100),
        // `null` = head absent. Any other value must be one of the states the witness knows how to
        // check, so an unmapped state cannot arrive as a plausible-looking string and pass silently.
        adapterState  = value => value === null || (typeof value === 'string' && ADAPTER_STATE_NAMES.includes(value));

    if (
        !report ||
        !adapterState(report.rosterState) ||
        !adapterState(report.streamState) ||
        !boundedText(report.activityLabel) ||
        !Number.isInteger(report.cardCount) ||
        report.cardCount < 0 ||
        typeof report.cockpitVisible !== 'boolean' ||
        typeof report.emptyCta !== 'boolean' ||
        !(report.rendererFirstPaintMs === null ||
            (Number.isFinite(report.rendererFirstPaintMs) && report.rendererFirstPaintMs >= 0)) ||
        !boundedText(report.rosterLabel) ||
        !Number.isInteger(report.tourControlCount) ||
        report.tourControlCount < 0
    ) {
        return null
    }

    return {
        activityLabel       : report.activityLabel,
        cardCount           : report.cardCount,
        cockpitVisible      : report.cockpitVisible,
        emptyCta            : report.emptyCta,
        firstPaintMs        : report.rendererFirstPaintMs === null ? null : Math.round(process.uptime() * 1000),
        rendererFirstPaintMs: report.rendererFirstPaintMs,
        rosterLabel         : report.rosterLabel,
        rosterState         : report.rosterState,
        streamState         : report.streamState,
        timedOut            : report.timedOut === true,
        tourControlCount    : report.tourControlCount
    }
}

/**
 * @summary Accepts, caches, and resolves a sender-validated preload boot report.
 * @param {Electron.IpcMainEvent} event
 * @param {*} report
 */
function onBootReport(event, report) {
    if (!isTrustedIpcSender(event)) {
        recordSmokeFailure('ipc-rejected', 'shell-boot-report sender');
        return
    }

    const normalized = sanitizeBootReport(report);

    if (!normalized) {
        recordSmokeFailure('ipc-rejected', 'shell-boot-report payload');
        return
    }

    const
        senderId = event.sender.id,
        waiter   = bootWaiters.get(senderId);

    diagnosticMode && console.log('HARNESS_BOOT_REPORT ' + JSON.stringify(normalized));

    if (waiter) {
        clearTimeout(waiter.timer);
        bootWaiters.delete(senderId);
        waiter.resolve(normalized)
    } else {
        bootReports.set(senderId, normalized)
    }
}

/**
 * @summary Accepts, caches, and resolves a sender-validated packaged first-paint report.
 * @param {Electron.IpcMainEvent} event
 * @param {*} report
 */
function onFirstPaintReport(event, report) {
    if (!isTrustedIpcSender(event)) {
        recordSmokeFailure('ipc-rejected', 'shell-first-paint-report sender');
        return
    }

    const normalized = sanitizeFirstPaintReport(report);

    if (!normalized) {
        recordSmokeFailure('ipc-rejected', 'shell-first-paint-report payload');
        return
    }

    const
        senderId = event.sender.id,
        waiter   = firstPaintWaiters.get(senderId);

    diagnosticMode && console.log('HARNESS_FIRST_PAINT_REPORT ' + JSON.stringify(normalized));

    if (waiter) {
        clearTimeout(waiter.timer);
        firstPaintWaiters.delete(senderId);
        waiter.resolve(normalized)
    } else {
        firstPaintReports.set(senderId, normalized)
    }
}

/**
 * @summary Accepts a sender-validated renderer failure for the smoke verdict.
 * @param {Electron.IpcMainEvent} event
 * @param {*} report
 */
function onRuntimeError(event, report) {
    if (!isTrustedIpcSender(event)) {
        recordSmokeFailure('ipc-rejected', 'shell-runtime-error sender');
        return
    }

    const
        type    = ['error', 'unhandledrejection'].includes(report?.type) ? report.type : 'renderer-error',
        message = typeof report?.message === 'string' ? report.message : 'invalid runtime error payload';

    recordSmokeFailure(type, message)
}

/**
 * Awaits the preload boot report of a window. Reports received before the caller discovers a popup
 * are cached, closing the original popup-report race.
 * @summary Resolves one validated window boot report or a deterministic timeout report.
 * @param {BrowserWindow} win
 * @param {Number} timeoutMs
 * @returns {Promise<Object>}
 */
function awaitBootReport(win, timeoutMs = 30000) {
    const
        senderId = win.webContents.id,
        cached   = bootReports.get(senderId);

    if (cached) {
        bootReports.delete(senderId);
        return Promise.resolve(cached)
    }

    return new Promise(resolve => {
        const timer = setTimeout(() => {
            bootWaiters.delete(senderId);
            resolve({bootMs: null, mounted: 0, timedOut: true, viewportId: null})
        }, timeoutMs);

        bootWaiters.set(senderId, {resolve, timer})
    })
}

/**
 * Reports received before the main smoke reaches this await are cached by sender id.
 * @summary Resolves one validated first-paint report or a deterministic timeout receipt.
 * @param {BrowserWindow} win
 * @param {Number} [timeoutMs=65000]
 * @returns {Promise<Object>}
 */
function awaitFirstPaintReport(win, timeoutMs = 65000) {
    const
        senderId = win.webContents.id,
        cached   = firstPaintReports.get(senderId);

    if (cached) {
        firstPaintReports.delete(senderId);
        return Promise.resolve(cached)
    }

    return new Promise(resolve => {
        const timer = setTimeout(() => {
            firstPaintWaiters.delete(senderId);
            resolve({
                activityLabel       : null,
                cardCount           : 0,
                cockpitVisible      : false,
                emptyCta            : false,
                firstPaintMs        : null,
                rendererFirstPaintMs: null,
                rosterLabel         : null,
                timedOut            : true,
                tourControlCount    : 0
            })
        }, timeoutMs);

        firstPaintWaiters.set(senderId, {resolve, timer})
    })
}

/**
 * @summary Waits for a popup BrowserWindow without leaving the smoke probe unbounded.
 * @param {BrowserWindow} primary
 * @param {Number} timeoutMs
 * @returns {Promise<BrowserWindow|null>}
 */
function awaitPopupWindow(primary, timeoutMs = 10000) {
    return new Promise(resolve => {
        const
            interval = setInterval(() => {
                const popup = BrowserWindow.getAllWindows().find(win => win !== primary);

                if (popup) {
                    clearInterval(interval);
                    clearTimeout(timeout);
                    resolve(popup)
                }
            }, 100),
            timeout = setTimeout(() => {
                clearInterval(interval);
                resolve(null)
            }, timeoutMs)
    })
}

/**
 * @summary Calls one preload capability from a real BrowserWindow and applies an independent
 * main-side secret census to the reply. Used only by the headed smoke.
 * @param {BrowserWindow} win
 * @param {String} call The capability call, e.g. `planeStatus()`.
 * @param {Number} [timeoutMs=8000]
 * @returns {Promise<Object>} `{envelope, shellKeys}`
 */
async function invokeShellFromWindow(win, call, timeoutMs = 8000) {
    if (!win || win.isDestroyed()) {
        return {error: 'window unavailable', ok: false}
    }

    const reply = await Promise.race([
        win.webContents.executeJavaScript(
            `Promise.resolve(globalThis.neoShell?.${call} ?? ` +
            `{ok:false,error:'capability unavailable'})` +
            `.then(envelope => ({envelope,shellKeys:Object.keys(globalThis.neoShell || {}).sort()}))` +
            `.catch(() => ({envelope:{ok:false,error:'capability rejected'},shellKeys:[]}))`,
            true
        ),
        new Promise(resolve => setTimeout(() => resolve({
            envelope : {error: 'capability probe timed out', ok: false},
            shellKeys: []
        }), timeoutMs))
    ]);

    return censusIpcReply(reply)
}

/**
 * @summary The smoke's census on an IPC reply: a reply carrying any secret main holds is recorded and
 * replaced by a refusal.
 * @param {Object} reply `{envelope, shellKeys}`
 * @returns {Object}
 */
function censusIpcReply(reply) {
    if (!carriesSecret(JSON.stringify(reply), mainSecrets())) {
        return reply
    }

    smokeState.secretLeaks.add('ipc-reply');

    return {
        envelope : {error: 'secret-bearing reply rejected by smoke census', ok: false},
        shellKeys: []
    }
}

/**
 * @summary The fixture-plane arm's red-first check (`NEO_HARNESS_SMOKE_PLANE_LEAK=1`): the plane's bearer
 * enters each census sink where main receives it: a Brain log line, a renderer console error through the
 * window's own listener, and an IPC reply. Each sink records a `secretLeaks` entry and prints nothing, so
 * the run fails; a run without the flag records none. The bearer never reaches the renderer.
 * @param {BrowserWindow} win
 */
function probePlaneLeaks(win) {
    const line = `plane leak probe ${storedPlaneBearer}`;

    brainLog(line);
    win.webContents.emit('console-message', {level: 'error', message: line});
    censusIpcReply({envelope: {probe: line}, shellKeys: []})
}

/**
 * @summary Gives asynchronous stylesheet and image requests a bounded window to hit the protocol.
 * @param {Number} timeoutMs
 * @returns {Promise<void>}
 */
async function awaitRequiredAssets(timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;

    while (
        Date.now() < deadline &&
        !REQUIRED_ASSET_PATHS.every(asset => smokeState.assetsSeen.has(asset))
    ) {
        await new Promise(resolve => setTimeout(resolve, 50))
    }
}

/**
 * @summary Waits for a lifecycle witness predicate without leaving a headed Electron run open.
 * @param {Function} predicate
 * @param {Number} [timeoutMs=3000]
 * @returns {Promise<Boolean>}
 */
async function awaitLifecycleState(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (predicate()) {
            return true
        }

        await new Promise(resolve => setTimeout(resolve, 50))
    }

    return false
}

/**
 * The witness invokes the menu items retained by the actual Tray controller. It compares the
 * BrowserWindow, WebContents, and viewport DOM identities around close → hide → Open Cockpit,
 * then exits through that same tray's Quit item so the normal will-quit owner proves its drain.
 * @summary Runs the headed same-renderer lifecycle witness and exits through the shipped tray.
 * @param {BrowserWindow} win
 * @returns {Promise<void>}
 */
async function runLifecycleWitness(win) {
    const [boot, brain] = await Promise.all([awaitBootReport(win), brainBootPromise]);
    const before        = {
        browserWindowId: win.id,
        viewportId     : boot.viewportId,
        webContentsId  : win.webContents.id
    };

    win.close();

    const
        hidden      = await awaitLifecycleState(() => !win.isVisible()),
        zeroVisible = await awaitLifecycleState(() => BrowserWindow.getAllWindows().every(item => !item.isVisible())),
        openInvoked = appLifecycle.invokeTrayAction('open-cockpit'),
        restored    = await awaitLifecycleState(() => win.isVisible());

    const afterViewportId = await win.webContents.executeJavaScript(
        `document.querySelector('[id^="neo-vnode-"], .neo-viewport')?.id ?? null`, true
    );
    const after = {
        browserWindowId: win.id,
        viewportId     : afterViewportId,
        webContentsId  : win.webContents.id
    };
    const receipt = {
        after,
        before,
        brainUp             : brain?.up === true,
        destroyedAfterHide  : win.isDestroyed(),
        hidden,
        openInvoked,
        rendererErrors      : [...smokeState.rendererErrors],
        sameBrowserWindow   : after.browserWindowId === before.browserWindowId,
        sameRenderer        : after.webContentsId === before.webContentsId,
        sameViewportIdentity: Boolean(before.viewportId) && after.viewportId === before.viewportId,
        state               : appLifecycle.brainState,
        restored,
        zeroVisible
    };
    const lifecyclePassed = receipt.brainUp &&
        !receipt.destroyedAfterHide &&
        receipt.hidden &&
        receipt.openInvoked &&
        receipt.rendererErrors.length === 0 &&
        receipt.sameBrowserWindow &&
        receipt.sameRenderer &&
        receipt.sameViewportIdentity &&
        receipt.state === 'running' &&
        receipt.restored &&
        receipt.zeroVisible;
    // Preserve a failing combined receipt while still traversing the REAL tray Quit callback. A
    // failed Brain leg must not short-circuit the lifecycle witness it is meant to exercise.
    process.exitCode = lifecyclePassed ? 0 : 1;

    const
        quitInvoked = appLifecycle.invokeTrayAction('quit'),
        passed      = lifecyclePassed && quitInvoked;

    console.log('HARNESS_LIFECYCLE_RESULTS=' + JSON.stringify({...receipt, passed, quitInvoked}, null, 2));

    if (!quitInvoked) {
        await appLifecycle.exitTerminal(1)
    }
}

app.on('web-contents-created', (event, contents) => configureWebContents(contents));

process.on('unhandledRejection', async error => {
    recordSmokeFailure('main-unhandled-rejection', error);
    console.log('HARNESS_UNHANDLED ' + (error?.stack || error));

    if (diagnosticMode) {
        // app.exit bypasses will-quit, so the failure net owns the Brain teardown explicitly.
        await appLifecycle.exitTerminal(2)
    }
});

const brainState = {children: [], isolationRoot: null, planeIngress: null, walkControl: null};

function brainLog(line) {
    if (carriesSecret(line, mainSecrets())) {
        smokeState.secretLeaks.add('brain-log');
        console.log('HARNESS_BRAIN [secret-bearing line redacted]')
    } else {
        console.log('HARNESS_BRAIN ' + line.slice(0, 300))
    }
}

/**
 * @summary Full-tree teardown of every child the harness started (and only those — §2.1.1 one
 * lifecycle owner), then clears the smoke run-state: a record surviving a CLEAN stop would make
 * a later sweep signal whatever now owns the recycled process-group ids. Callable from every
 * exit path: will-quit, smoke completion, the smoke nets. A held run's walk control closes first: no
 * plane request starts after it and the one in flight settles, so a plane it started is in the drain.
 * @returns {Promise<Object|null>} per-child stop report, or null when nothing was supervised
 */
async function teardownBrain() {
    await brainState.walkControl?.close();
    brainState.walkControl = null;

    if (!brainState.children.length) {
        return null
    }

    const children = brainState.children;

    brainState.children = [];

    const report = await stopBrainTree(children);

    if (brainState.planeIngress) {
        await brainState.planeIngress.close();
        brainState.planeIngress = null
    }

    if (brainState.isolationRoot) {
        clearRunState({isolationRoot: brainState.isolationRoot});
        brainState.isolationRoot = null
    }

    return report
}

/**
 * @summary Records the smoke's children so a later run's sweep can reap them after a crash. Called after
 * each start, since a crash can come between one start and the next.
 * @param {String} isolationRoot
 */
function recordSmokeRunState(isolationRoot) {
    brainState.isolationRoot = isolationRoot;
    writeRunState({
        isolationRoot,
        children: brainState.children.map(({child, entry, ownershipToken}) => ({
            entry,
            ownershipToken,
            pgid: child.pid
        }))
    })
}

const appLifecycle = createAppLifecycle({
    app,
    onTeardownError(error) {
        console.log('HARNESS_BRAIN_STOP_FAILED ' + (error?.stack || error))
    },
    onTeardownSettled(report) {
        if (diagnosticMode) {
            const
                reports   = Object.values(report ?? {}),
                cleanStop = reports.every(item => item.exited && item.groupEmpty && !item.forced);

            console.log('HARNESS_BRAIN_STOP ' + JSON.stringify({cleanStop, report}))
        }
    },
    smokeMode,
    // Quit during boot waits for that bounded readiness contract before draining children. Without
    // this join, an early will-quit can observe an empty owner and a late spawn becomes an orphan.
    teardownBrain: async () => {
        await brainBootPromise;
        return teardownBrain()
    }
});

/**
 * @summary Registers one owned child: teardown ownership unconditionally, Brain-health
 * observation only for organism children — the split lives in {@link registerOwnedChild}
 * (brain.mjs), where its owner-coverage witness also lives. `observeBrain: false` (the UI-mode
 * fleet transport) is drain-owned with diagnostic-log-only fault visibility.
 * @param {Object} entry The brainState child record (`{child, label, observeBrain?, ...}`).
 * @returns {Object}
 */
function registerBrainChild(entry) {
    return registerOwnedChild({
        children        : brainState.children,
        entry,
        onUnobservedExit: summary => console.log(`HARNESS_UI_FLEET_CHILD ${summary}`),
        watch           : appLifecycle.watchBrainChild
    })
}

/**
 * The product Brain boot — PLANE-ATTACH / ATTACH / OWN (see brain.mjs): a declared containerized
 * plane starts only the missing Fleet transport, a live host Brain is attached, and only a truly
 * fresh machine owns the full organism. It never boots a second organism beside either declared
 * authority — the daemon's single-instance takeover and the supervisor's singleton-port reaping
 * make that unsafe by construction.
 * @summary Boots or attaches the Brain for `start:brain`, supervising only what is missing.
 * @returns {Promise<Object>}
 */
async function bootProductBrain() {
    // Packaged mode: the organism ships read-only(ish), so every mutable path moves to the
    // per-user data root, and Brain children (plus shebang grandchildren via the organism's node
    // shim) run on the BUNDLED Electron runtime — a stranger's machine carries no Node. A plane the
    // user attached from the cockpit joins as the env the launcher would export; set env still wins.
    const storedPlane = packagedMode ? readPlaneConfig({dir: app.getPath('userData'), safeStorage}) : null;

    storedPlaneBearer = storedPlane?.bearer ?? null;

    const
        dataRoot     = path.join(app.getPath('userData'), 'brain'),
        fleetPort    = Number(process.env.NEO_FLEET_PORT) || 8083,
        brainBaseEnv = {
            ...buildPackagedBrainEnv({backupRoot: path.join(app.getPath('userData'), 'backups'), dataRoot}),
            ELECTRON_RUN_AS_NODE    : '1',
            NEO_HARNESS_ELECTRON_BIN: process.execPath
        };

    // A consented move of the seats settles first: before the first-launch choice reads the root record, and
    // before any Brain child could hold the registry (seatRootMove.mjs). One that can neither go on nor come
    // back holds the boot, as does a committed one whose old folders could not be archived, so no Fleet
    // starts over a half-moved installation.
    seatMoveOutcome = packagedMode ? await settleSeatRootMove({
        dir        : app.getPath('userData'),
        checkWriter: () => findFleetWriters({fleetEntry: path.join(agentosRuntimeRoot, FLEET_SERVER_ENTRY), fleetPort, probePortFn: probePort}),
        runStep    : step => runSeatMoveStep({...step, runScript: ({env, ...script}) => runBrainScript({...script, env: {...brainBaseEnv, ...env}, repoRoot: agentosRuntimeRoot})}),
        log        : entry => console.log(`HARNESS_SEAT_MOVE ${JSON.stringify(entry)}`)
    }) : null;

    if (seatMoveOutcome && seatMoveOutcome.state !== 'none') {
        console.log(`HARNESS_SEAT_MOVE_OUTCOME ${JSON.stringify(seatMoveOutcome)}`)
    }

    const seatMoveHold = seatMoveBootHold(seatMoveOutcome);

    if (seatMoveHold) {
        throw new Error(`the consented move of the seats is held: ${seatMoveHold}`)
    }

    // Where the seats live is the installation's record, never this launch's environment
    // (seatRootRecord.mjs); a fresh installation records the root the Brain resolves below.
    const seatRoot = packagedMode ? settleSeatRoot({
        dir       : app.getPath('userData'),
        envRoot   : process.env.NEO_FLEET_AGENTS_ROOT,
        legacyRoot: path.join(dataRoot, 'fleet', 'agents')
    }) : null;

    if (seatRoot?.ignoredEnvRoot) {
        console.warn(`HARNESS_SEAT_ROOT_ENV_IGNORED ${JSON.stringify({environment: seatRoot.ignoredEnvRoot, recorded: seatRoot.record.root})}`)
    }

    // the backups sit beside the plane in the per-user root, so removing the plane never removes them
    const planeFragment = packagedMode ? planeEnvFragment({env: process.env, planeConfig: storedPlane}) : {};

    launchedPlane = launchedPlaneRecord(storedPlane, planeFragment);

    const packagedEnv = packagedMode
        ? {
            ...buildPackagedBrainEnv({agentsRoot: seatRoot.record?.root, backupRoot: path.join(app.getPath('userData'), 'backups'), dataRoot}),
            ...planeFragment,
            ELECTRON_RUN_AS_NODE    : '1',
            NEO_HARNESS_ELECTRON_BIN: process.execPath
        }
        : {};

    const paths = await resolveBrainPaths({env: packagedEnv, repoRoot: agentosRuntimeRoot});

    if (packagedMode) {
        const seatRecord = seatRoot.record ?? writeSeatRootRecord({dir: app.getPath('userData'), root: paths.fleetAgentsRoot, origin: 'default'});

        console.log(`HARNESS_SEAT_ROOT ${JSON.stringify({origin: seatRecord.origin, root: seatRecord.root})}`)
    }

    // The host receiver the Fleet publishes its seats' wake routes to, settled against the plane the paths
    // resolved. Only the Fleet consumes it, so it joins the Fleet child's env alone (wakeReceiver.mjs).
    const wakeReceiver = packagedMode ? settleWakeReceiver({
        env      : process.env,
        planeBase: paths.fleetPlaneBase,
        plistPath: path.join(app.getPath('home'), 'Library', 'LaunchAgents', WAKE_RECEIVER_LAUNCH_AGENT)
    }) : null;

    if (wakeReceiver) {
        console.log(`HARNESS_WAKE_RECEIVER ${JSON.stringify(wakeReceiver)}`)
    }

    const
        live      = await detectLiveBrain({
            productRoot,
            bearerToken        : fleetBearerToken,
            fleetPort,
            orchestratorDataDir: paths.orchestratorDataDir,
            repoRoot           : agentosRuntimeRoot
        }),
        plan      = resolveProductBrainPlan({
            fleetServing     : live.fleetServing,
            orchestratorAlive: live.orchestratorAlive,
            planeBase        : paths.fleetPlaneBase
        }),
        {mode}    = plan;

    // The selected plan goes on record BEFORE anything spawns: a boot that fails past this point
    // logs HARNESS_BRAIN_BOOT_FAILED with no plan context of its own, and diagnosing "which mode
    // was it attempting" from silence cost a live iteration run. Success keeps the richer
    // HARNESS_BRAIN_MODE line below.
    console.log(`HARNESS_BRAIN_PLAN ${JSON.stringify({fleetPort, mode, planeBase: plan.planeBase ?? null, startFleet: !!plan.startFleet, startOrchestrator: !!plan.startOrchestrator})}`);

    if (plan.startOrchestrator) {
        // Coexistence guard (dev machines): a packaged app's own-mode organism runs the DEFAULT
        // ports — a checkout Brain's Chroma already on that port would be REAPED by the spawned
        // supervisor (singleton-port reconciliation). A held Chroma port without a serving fleet
        // fails the boot closed instead.
        if (packagedMode && await probePort({host: 'localhost', port: paths.chromaPort})) {
            throw besidePlaneRefusal(paths.chromaPort)
        }

        const orchestrator = startBrainChild({entry: ORCHESTRATOR_ENTRY, env: packagedEnv, onLog: brainLog, repoRoot: agentosRuntimeRoot});

        registerBrainChild({child: orchestrator, label: 'orchestrator'});
        await awaitOrchestratorReady({child: orchestrator})
    }

    if (plan.startFleet) {
        // Protocol identity, fail closed: a listener that does NOT answer the fleet wire verb is
        // a foreign server squatting the port — spawning into it would EADDRINUSE, and skipping
        // the spawn would report a Brain that the window cannot actually reach.
        if (live.fleetPortHeld) {
            throw new Error(`fleet port ${fleetPort} cannot be reused: ${live.fleetRefusalReason || 'listener did not prove canonical Fleet identity'} — free the port or set NEO_FLEET_PORT`)
        }

        let fleetLastLine = null;

        const fleet = startBrainChild({
            entry   : FLEET_SERVER_ENTRY,
            env     : {...packagedEnv, ...wakeReceiverEnv(wakeReceiver), NEO_FLEET_BEARER: fleetBearerToken, NEO_FLEET_PORT: String(fleetPort)},
            onLog   : line => {fleetLastLine = line; brainLog(line)},
            repoRoot: agentosRuntimeRoot
        });

        registerBrainChild({child: fleet, label: 'fleet'});
        await fleetReadyOrPlaneRefusal({
            awaitReady : () => awaitFleetReady({bearerToken: fleetBearerToken, child: fleet, port: fleetPort, productRoot, repoRoot: agentosRuntimeRoot}),
            child      : fleet,
            lastLine   : () => fleetLastLine,
            mode,
            secrets    : mainSecrets(),
            typeRefusal: refusal => typePlaneRefusal(refusal, {planeConfig: launchedPlane, probe: probePlaneCredential})
        })
    }

    console.log(`HARNESS_BRAIN_MODE ${mode}${plan.planeBase ? ` planeBase=${plan.planeBase}` : ''} fleetPort=${fleetPort} started=[${brainState.children.map(entry => entry.label).join(',') || 'none'}]`);
    return {fleetPort, mode, planeBase: plan.planeBase, up: true}
}

/**
 * The UI-only transport boot: plain `npm start` self-supplies the fleet transport instead of
 * demanding a hand-carried `NEO_FLEET_BEARER` across two terminals (the first live operator run
 * proved that coordination model unusable — and `fleetCapability` gates every renderer request on
 * this boot receipt, so WITHOUT it the UI-only window could never reach a transport at all, even
 * a perfectly-coordinated external one).
 *
 * Three outcomes, fail-honest:
 * - **reuse** — a listener on the port proves canonical Fleet identity for THIS bearer + viewer
 *   (the same-token-same-viewer probe): the shell adopts it and spawns nothing.
 * - **spawn** — the port is free: the shell starts `devFleetServer` as an OWNED child with the
 *   bearer it already holds (zero coordination — the packaged topology's behavior), awaits real
 *   wire readiness, and the existing quit drain tears it down (`brainState.children` is the one
 *   ownership set; the drain keys on membership, not on Brain mode). Ownership ≠ observation:
 *   the child registers `observeBrain: false`, so its death logs diagnostically and renders as
 *   the cockpit's honest offline — never as whole-Brain `degraded` (the tray reports the
 *   organism, not the UI's transport convenience).
 * - **foreign-listener** — something else holds the port: the WINDOW must not brick (contrast:
 *   organism boot fails closed), so the cockpit keeps its honest offline state and the named
 *   refusal lands in the shell log.
 * @summary Probes-then-spawns the app↔fleet transport for UI-only mode; never touches tray Brain state.
 * @returns {Promise<Object>} `{fleetPort, mode: 'reuse'|'spawn'|'foreign-listener', up: Boolean}`
 */
async function bootUiFleetTransport() {
    // The three-outcome routing AND the ownership≠observation invariant live in the witnessable
    // composition (brain.mjs#resolveUiFleetTransport); this wrapper only binds the real
    // collaborators: env coordinates, the shell bearer, the child spawner, and the owner registry.
    return resolveUiFleetTransport({
        productRoot,
        agentIdentityNodeId: process.env.NEO_AGENT_IDENTITY,
        awaitReady         : awaitFleetReady,
        bearerToken        : fleetBearerToken,
        fleetPort          : Number(process.env.NEO_FLEET_PORT) || 8083,
        onOutcome          : summary => console.log(`HARNESS_UI_FLEET ${summary}`),
        registerChild      : registerBrainChild,
        repoRoot           : agentosRuntimeRoot,
        spawn              : ({fleetPort}) => startBrainChild({
            entry   : FLEET_SERVER_ENTRY,
            env     : {NEO_FLEET_BEARER: fleetBearerToken, NEO_FLEET_PORT: String(fleetPort)},
            onLog   : brainLog,
            repoRoot: agentosRuntimeRoot
        })
    })
}

/**
 * The smoke Brain boot. TWO profile shapes, deliberately distinct:
 * - **Packaged:** the EXACT product profile (`buildPackagedBrainEnv` — the artifact's lane and
 *   resource closure, unreduced), shifted only in COORDINATES: allocated Chroma/fleet ports and a
 *   throwaway data root, so a dev box's live Brain is never touched while the smoke still proves
 *   what a real double-click boots.
 * - **Checkout:** the fully isolated dev profile (`buildBrainProfile` — every side lane gated),
 *   because a checkout smoke runs beside a canonical organism whose lanes must not double-run.
 * Both assert the isolation matrix THROUGH the config SSOT before anything spawns; readiness is
 * genuine service readiness (poll-loop marker + a real fleet wire verb), never PID existence.
 *
 * The fixture-plane arm (`NEO_HARNESS_SMOKE_PLANE=1`) first starts a plane of the smoke's own and
 * boots the fleet child from the record it wrote. The product's plan then attaches instead of owning,
 * so no orchestrator starts, exactly as a stored plane boots the installed app.
 * @summary Boots the smoke organism under the mode-correct profile, returning every observable.
 * @returns {Promise<Object>}
 */
async function bootSmokeBrain() {
    const
        isolationRoot           = smokeRoot,
        sweptPgids              = sweepStaleRunState({isolationRoot}),
        [chromaPort, fleetPort] = await Promise.all([allocatePort(), allocatePort()]),
        runtimeEnv              = packagedMode ? {ELECTRON_RUN_AS_NODE: '1', NEO_HARNESS_ELECTRON_BIN: process.execPath} : {},
        planeEnv                = smokePlaneMode
            ? await attachSmokePlane({isolationRoot, runtimeEnv})
            : {NEO_FLEET_PLANE_BASE: '', NEO_FLEET_PLANE_BEARER: ''},
        // a smoke's bundles are disposable, so they stay inside its throwaway root; a sibling of that
        // root would land in the shared temp parent
        profile                 = {
            ...(packagedMode
                ? {...buildPackagedBrainEnv({agentsRoot: path.join(isolationRoot, 'fleet', 'agents'), backupRoot: path.join(isolationRoot, 'backups'), dataRoot: isolationRoot}), ...runtimeEnv, NEO_CHROMA_PORT: String(chromaPort), NEO_FLEET_PORT: String(fleetPort)}
                : buildBrainProfile({chromaPort, fleetPort, isolationRoot})),
            NEO_FLEET_BEARER: fleetBearerToken,
            ...planeEnv
        },
        resolved                = await resolveBrainPaths({env: profile, repoRoot: agentosRuntimeRoot}),
        matrixViolations        = assertIsolatedProfile({chromaPort, isolationRoot, resolved}),
        // The product's plan over the resolved config. The smoke never adopts a live Brain, so it observes none.
        plan                    = resolveProductBrainPlan({fleetServing: false, orchestratorAlive: false, planeBase: resolved.fleetPlaneBase});

    if (matrixViolations.length > 0) {
        return {chromaPort, fleetPort, isolationRoot, matrixViolations, sweptPgids, up: false}
    }

    let fleetLastLine = null,
        planeAdmitted = false;

    const
        orchestrator = plan.startOrchestrator ? startBrainChild({entry: ORCHESTRATOR_ENTRY, env: profile, onLog: brainLog, repoRoot: agentosRuntimeRoot}) : null,
        fleet        = startBrainChild({
            entry: FLEET_SERVER_ENTRY,
            env  : profile,
            onLog: line => {
                fleetLastLine = line;
                planeAdmitted ||= line.includes(`bound to the containerized plane at ${plan.planeBase} `);
                brainLog(line)
            },
            repoRoot: agentosRuntimeRoot
        });

    orchestrator && registerBrainChild({child: orchestrator, ...orchestrator.neoHarnessIdentity, label: 'orchestrator'});
    registerBrainChild({child: fleet, ...fleet.neoHarnessIdentity, label: 'fleet'});
    recordSmokeRunState(isolationRoot);

    await Promise.all([
        orchestrator && awaitOrchestratorReady({child: orchestrator}),
        fleetReadyOrPlaneRefusal({
            awaitReady: () => awaitFleetReady({bearerToken: fleetBearerToken, child: fleet, port: fleetPort, productRoot, repoRoot: agentosRuntimeRoot}),
            child     : fleet,
            lastLine  : () => fleetLastLine,
            mode      : plan.mode,
            secrets   : mainSecrets()
        })
    ]);

    return {
        chromaPort,
        fleetPort,
        isolationRoot,
        matrixViolations,
        mode       : plan.mode,
        planeAdmitted,
        planeBase  : plan.planeBase,
        profileMode: packagedMode ? 'packaged-product' : 'checkout-isolated',
        sweptPgids,
        up         : true
    }
}

/**
 * @summary The fixture-plane arm's attach. Starts the smoke's own plane, then reads the record it wrote
 * through the product's read path, so the fleet child attaches from the record alone. Every other plane
 * credential is exported empty: a Finder launch carries none, and a machine export must not ride into
 * the fixture.
 * @param {Object} options
 * @param {String} options.isolationRoot
 * @param {Object} options.runtimeEnv The runtime env Brain children need.
 * @returns {Promise<Object>} The fleet child's plane env.
 * @throws {Error} When the record does not read back as an attachable plane.
 */
async function attachSmokePlane({isolationRoot, runtimeEnv}) {
    brainState.planeIngress = await startFixturePlane({
        holdMode     : smokeHold.hold,
        isolationRoot,
        onLog        : brainLog,
        recordDir    : app.getPath('userData'),
        registerChild: entry => {
            registerBrainChild(entry);
            recordSmokeRunState(isolationRoot)
        },
        repoRoot   : agentosRuntimeRoot,
        runtimeEnv,
        safeStorage: planeSafeStorage,
        startChild : startBrainChild
    });

    const
        storedPlane = readPlaneConfig({dir: app.getPath('userData'), safeStorage: planeSafeStorage}),
        fragment    = planeEnvFragment({env: {}, planeConfig: storedPlane});

    storedPlaneBearer = storedPlane.bearer;

    if (!fragment.NEO_FLEET_PLANE_BASE) {
        throw new Error('the fixture plane record did not read back as an attachable plane')
    }

    return {
        NEO_FLEET_PLANE_ADMISSION_BEARER     : '',
        NEO_FLEET_PLANE_ADMISSION_BEARER_FILE: '',
        NEO_FLEET_PLANE_BEARER_FILE          : '',
        NEO_FLEET_WAKE_SELF_BASE             : '',
        ...fragment
    }
}

/**
 * @summary The held run's candidate: a packaged run's build receipt, or the checkout's runtime root.
 * @returns {Object}
 */
function readHeldCandidate() {
    if (!packagedMode) {
        return {runtimeRoot: agentosRuntimeRoot, source: 'checkout'}
    }

    try {
        return {source: 'packaged', ...JSON.parse(readFileSync(path.join(packagedOrganismRoot, 'organism-build-info.json'), 'utf8'))}
    } catch (error) {
        return {error: `organism-build-info.json unreadable (${error.code ?? error.message})`, source: 'packaged'}
    }
}

/**
 * @summary A held run (`NEO_HARNESS_SMOKE_HOLD=1`): the organism stays attached to its fixture plane and
 * the window stays open for a walker, instead of the teardown and the verdict. It names its candidate and
 * auth mode, writes the walk manifest `walkControl.mjs` acts on, and answers plane stop/start through the
 * fixture plane's own handles. Closing the window quits through `window-all-closed` → `will-quit`, which
 * runs the same owned-Brain teardown `exitTerminal` runs, so the organism and the plane stop with it.
 * @returns {Promise<never>}
 */
async function holdForWalk() {
    const
        plane    = brainState.planeIngress,
        manifest = writeWalkManifest({smokeRoot, manifest: {
            auth        : 'seat-token: the fixture plane\'s own seat, never a forge PAT',
            candidate   : readHeldCandidate(),
            identities  : plane.identities,
            ingressPort : plane.ingressPort,
            pid         : process.pid,
            planeBase   : plane.planeBase,
            planeId     : FIXTURE_PLANE_ID,
            planePort   : plane.planePort,
            registryPath: plane.registryPath,
            runtimeRoot : agentosRuntimeRoot
        }});

    brainState.walkControl = watchPlaneControl({handlers: {'plane-start': plane.startPlane, 'plane-stop': plane.stopPlane}, onLog: brainLog, smokeRoot});
    console.log('HARNESS_SMOKE_HOLD ' + JSON.stringify({auth: manifest.auth, candidate: manifest.candidate, planeBase: manifest.planeBase, smokeRoot: manifest.smokeRoot}));

    return new Promise(() => {})
}

app.whenReady().then(async () => {
    if (smokeHold.refusal) return;

    resolveHarnessAsset = await createHarnessAssetResolver(productRoot);
    await protocol.handle('app', serveHarnessContent);

    // §2.3.3 deny-by-default; Electron requires BOTH handlers for complete permission coverage.
    // Allowlist additions amend the shell ADR §2.3 first.
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));

    if (diagnosticMode) {
        // Preload diagnostics are smoke-only. Registering these in normal operation would cache
        // one unconsumed boot report per window even though no smoke waiter exists.
        ipcMain.on('shell-boot-report', onBootReport);
        ipcMain.on('shell-first-paint-report', onFirstPaintReport);
        ipcMain.on('shell-runtime-error', onRuntimeError)
    }

    ipcMain.handle('fleet-request', fleetCapability.request);

    // Whole-Brain health crosses ONLY from the lifecycle owner — never composed from per-agent
    // fleet rows. Untrusted senders reject (transport truth, never daemon truth).
    ipcMain.handle('brain-health', event => {
        if (!isTrustedIpcSender(event)) {
            throw new Error('brain-health: untrusted sender')
        }

        // Daemon truth plus the shell's transport-boot fact on one pull: the cockpit's banner
        // needs BOTH — the organism's health for the daemon line, the transport fact for honest
        // cold-case guidance (never "start it: npm run ai:fleet-server" inside a shell that
        // self-supplies). No new channel: the fact rides the wire that already crosses.
        return {...appLifecycle.brainHealth, transport: uiTransportFact}
    });

    // The plane-attach broker: the cockpit reads whether a plane is configured, asks main to attach
    // one, and asks whether the plane still admits the launched PAT; the PAT stays in main custody.
    const planeBroker = createPlaneBroker({
        causeOf         : runtimePlaneCause,
        dir             : app.getPath('userData'),
        getLaunchedPlane: () => launchedPlane,
        getTransportFact: () => uiTransportFact,
        isTrustedSender : isTrustedIpcSender,
        packaged        : packagedMode,
        promptCredential: promptFleetCredential,
        relaunch        : () => setTimeout(() => { app.relaunch(); app.quit() }, 250),
        safeStorage     : planeSafeStorage
    });

    ipcMain.handle('shell-plane-status', planeBroker.status);
    ipcMain.handle('shell-plane-attach', planeBroker.attach);
    ipcMain.handle('shell-plane-verify', planeBroker.verify);

    // The first-run setup broker: the setup card's Create door projects the recipe's live evaluation,
    // main runs the host effects through the Brain's host-effect module (one module, the CLI's), and
    // a credential enters main's window and leaves as a kept file's path. A boot without a Brain root
    // keeps every channel registered and answers each with the named reason.
    const setupBroker = createSetupBroker({
        configSourcePath: agentosRuntimeRoot ? path.join(agentosRuntimeRoot, CONFIG_SOURCE_PATH) : null,
        isTrustedSender : isTrustedIpcSender,
        loadModules     : agentosRuntimeRoot ? () => loadSetupModules({runtimeRoot: agentosRuntimeRoot}) : null,
        packaged        : packagedMode,
        promptCredential: promptFleetCredential,
        ...resolveSetupRoots({env: process.env})
    });

    for (const [name, channel] of Object.entries(SETUP_CHANNELS)) {
        ipcMain.handle(channel, setupBroker[name])
    }

    // Register before boot: a held transition must remain readable from System.
    const seatRootBroker = createSeatRootBroker({
        ...(agentosRuntimeRoot
            ? createSeatRootRuntime({repoRoot: agentosRuntimeRoot, userData: app.getPath('userData')})
            : {resolveDestination: null}),
        dir            : app.getPath('userData'),
        getOutcome     : () => seatMoveOutcome,
        isTrustedSender: isTrustedIpcSender,
        packaged       : packagedMode,
        relaunch       : () => setTimeout(() => { app.relaunch(); app.quit() }, 250)
    });

    for (const [name, channel] of Object.entries(SEAT_ROOT_CHANNELS)) {
        ipcMain.handle(channel, seatRootBroker[name])
    }

    const win1 = createHarnessWindow(APP_URL);

    appLifecycle.attachCockpitWindow(win1);

    // The Brain boots in parallel with the window — the UI never blocks on the supervisor, and
    // fail-closed surfaces render honestly until the transport is reachable. Boot rejection is
    // deterministic (readiness contract) and lands as up:false, never as a hung promise.
    if (brainMode) {
        appLifecycle.setBrainState('degraded')
    }

    // The banner fact enters 'starting' exactly when a transport boot is actually in flight —
    // brain mode boots the organism's fleet leg, UI-only product self-supplies. Plain UI-only
    // smoke spawns nothing by isolation contract and keeps `null`: no transport story to tell.
    if (brainMode || (!diagnosticMode && agentosRuntimeRoot)) {
        uiTransportFact = {phase: 'starting'}
    } else if (!diagnosticMode) {
        console.log('HARNESS_UI_FLEET none — no Brain root in this boot: the shell runs as the UI alone')
    }

    brainBootPromise = brainMode
        ? (diagnosticMode ? bootSmokeBrain() : bootProductBrain())
            .catch(error => {
                console.log('HARNESS_BRAIN_BOOT_FAILED ' + error.message);
                return {cause: bootFailureCause(error), error: error.message, up: false}
            })
            .then(boot => {
                appLifecycle.settleBrainBoot(boot.up === true, boot.cause);
                uiTransportFact = normalizeTransportFact(boot);
                return boot
            })
        : (diagnosticMode || !agentosRuntimeRoot
            // Plain smoke keeps its isolation contract: UI-only legs spawn nothing (a dev machine
            // may carry a live transport); the fleet leg's evidence lives in smoke:brain. A checkout
            // without a Brain root has nothing to self-supply from: the UI alone, no transport story.
            ? Promise.resolve(null)
            // UI-only product path: self-supply the transport. Tray Brain state is deliberately
            // untouched — a fleet transport is not a Brain claim.
            : bootUiFleetTransport()
                .catch(error => {
                    console.log('HARNESS_UI_FLEET_BOOT_FAILED ' + error.message);
                    return {error: error.message, up: false}
                })
                .then(boot => {
                    uiTransportFact = normalizeTransportFact(boot);
                    return boot
                }));

    if (!smokeMode) {
        try {
            // The boot promise is retained BEFORE Quit becomes reachable from the tray. An early
            // tray click therefore cannot drain an empty owner while a late child still spawns.
            appLifecycle.installTray(createHarnessTray)
        } catch (error) {
            // Fail reachable: without a tray, cockpit close remains ordinary and
            // window-all-closed keeps the pre-E8 quit fallback.
            console.log('HARNESS_TRAY_INIT_FAILED ' + error.message);
            appLifecycle.setBrainState('degraded')
        }
    }

    if (lifecycleWitnessMode) {
        await runLifecycleWitness(win1);
        return
    }

    if (!smokeMode) {
        return
    }

    // Smoke: slice-1 boot + slice-2 renderer-initiated popup + one-heap evidence. The popup's
    // viewport id must continue the primary window's App-worker sequence, not restart at 1.
    const [boot1, firstPaint] = await Promise.all([
        awaitBootReport(win1),
        awaitFirstPaintReport(win1)
    ]);

    // Renderer window.open needs a user gesture. Post-boot executeJavaScript is bounded because the
    // same call can wedge during module-graph boot; real product popouts originate from real clicks.
    // The popup opens through the engine's windowOpen, so the smoke takes every product popup's path.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const openPath = await Promise.race([
        win1.webContents.executeJavaScript(
            `Neo.Main.windowOpen({url: '${APP_URL}', windowFeatures: 'width=900,height=700', windowName: 'harness-smoke-popup'}) ? 'engine-window-open' : 'engine-window-refused'`, true
        ),
        new Promise(resolve => setTimeout(() => resolve('gesture-call-wedged'), 5000))
    ]);

    console.log('HARNESS_POPUP_PATH ' + openPath);

    const
        win2  = await awaitPopupWindow(win1),
        boot2 = win2 ? await awaitBootReport(win2) : {
            bootMs: null, mounted: 0, timedOut: true, viewportId: null
        };

    await awaitRequiredAssets();

    // The VISUAL verdict: mounted-node counts and asset probes cannot see a broken layout (stale
    // built themes, corrupted template data — a live incident shipped exactly that). Every smoke
    // run captures the primary window so a human — or the next agent — can LOOK at what actually
    // rendered. Packaged mode writes to userData (the app bundle is read-only-ish).
    try {
        const
            image    = await win1.capturePage(),
            shotPath = path.join(packagedMode ? app.getPath('userData') : harnessDir, 'smoke-shot.png');

        (await import('node:fs')).writeFileSync(shotPath, image.toPNG());
        console.log('HARNESS_SMOKE_SHOT ' + shotPath)
    } catch (error) {
        console.log('HARNESS_SMOKE_SHOT_FAIL ' + error.message)
    }

    // The Brain leg (Arm B): the isolated organism proven through its OWN consumable surfaces —
    // the resolved-leaf isolation matrix, genuine orchestrator + Fleet readiness, authenticated
    // capability calls from both real windows, a fresh App-Worker crossing after popup close, a
    // genuine off-origin rejection, then full-tree teardown gated on group-empty AND released listeners.
    let brain = {mode: false};

    if (brainMode) {
        const boot = await brainBootPromise;

        let chromaListening = null,
            fleetFromWindow = null,
            plane           = null;

        if (boot.up) {
            // Let an owned organism SETTLE before quitting: the isolated Chroma serving on the
            // allocated port is live isolation evidence AND removes the mid-startup-child race
            // from the graceful-teardown measurement. Chroma binds `localhost` (::1 on macOS),
            // and a cold start on a fresh persist dir takes ~a minute. An attached boot starts no Chroma.
            chromaListening = boot.mode === 'plane-attach' ? null : await awaitPortListening({host: 'localhost', port: boot.chromaPort, timeoutMs: 120000});

            const
                fleetCall           = `fleetRequest(${JSON.stringify({method: 'listAgents', params: {}})})`,
                primary             = await invokeShellFromWindow(win1, fleetCall),
                popup               = await invokeShellFromWindow(win2, fleetCall),
                firstWorkerCrossing = await awaitLifecycleState(
                    () => smokeState.fleetMethods.includes('fleetRoster'),
                    20000
                ),
                rosterCountAtClose  = smokeState.fleetMethods.filter(method => method === 'fleetRoster').length;

            win2 && !win2.isDestroyed() && win2.close();

            const
                popupClosed           = Boolean(win2) && await awaitLifecycleState(() => win2.isDestroyed(), 3000),
                primaryAfterPopup     = await invokeShellFromWindow(win1, fleetCall),
                workerAfterPopupClose = await awaitLifecycleState(
                    () => smokeState.fleetMethods.filter(method => method === 'fleetRoster').length > rosterCountAtClose,
                    ROSTER_CROSSING_WINDOW_MS
                ),
                forgedWindow            = new BrowserWindow({show: false, webPreferences: getSecureWebPreferences()});

            let forgedSender;

            try {
                await forgedWindow.loadURL('data:text/html;charset=utf-8,<title>forged Fleet sender</title>');
                forgedSender = await invokeShellFromWindow(forgedWindow, fleetCall)
            } catch {
                forgedSender = {envelope: {error: 'off-origin window failed to load', ok: false}, shellKeys: []}
            } finally {
                !forgedWindow.isDestroyed() && forgedWindow.destroy()
            }

            const
                expectedShellKeys = [
                    'attachPlane', 'brainHealth', 'fleetRequest', 'planeStatus',
                    'setupAnswer', 'setupCredential', 'setupEffect', 'setupEvaluate', 'setupPresets', 'setupProbe',
                    'shellVersion', 'verifyPlane'
                ],
                probes            = [primary, popup, primaryAfterPopup, forgedSender],
                surfaceExact      = probes.every(probe =>
                    JSON.stringify(probe.shellKeys) === JSON.stringify(expectedShellKeys)
                ),
                urlSecretFree     = BrowserWindow.getAllWindows().every(win =>
                    !carriesSecret(win.webContents.getURL(), mainSecrets())
                );

            fleetFromWindow = {
                firstWorkerCrossing,
                fleetMethods: [...smokeState.fleetMethods],
                forgedSender,
                popup,
                popupClosed,
                primary,
                primaryAfterPopup,
                surfaceExact,
                urlSecretFree,
                workerAfterPopupClose
            };

            // The fixture plane's four observations are the boot fact, the cockpit's plane status, the fleet
            // child's admission line and the `listAgents` round trip above, all through this attached boot.
            if (smokePlaneMode) {
                plane = {
                    admitted : boot.planeAdmitted,
                    base     : boot.planeBase,
                    status   : (await invokeShellFromWindow(win1, 'planeStatus()')).envelope,
                    transport: uiTransportFact
                };

                process.env.NEO_HARNESS_SMOKE_PLANE_LEAK === '1' && probePlaneLeaks(win1)
            }
        }

        // A held run stops here with the organism attached; a boot that never attached has nothing to hold.
        if (smokeHold.hold) {
            plane?.status?.attached === true
                ? await holdForWalk()
                : console.log('HARNESS_SMOKE_HOLD_UNAVAILABLE the organism did not attach to its fixture plane; the run reports its verdict instead')
        }

        const
            stop          = await appLifecycle.teardown(),
            stopReports   = Object.values(stop ?? {}),
            groupsEmpty   = stopReports.every(report => report.groupEmpty),
            portsReleased = boot.up
                ? !(await probePort({host: 'localhost', port: boot.chromaPort})) && !(await probePort({port: boot.fleetPort}))
                : null;

        if (fleetFromWindow) {
            fleetFromWindow.secretLeaks = [...smokeState.secretLeaks];
            fleetFromWindow.secretFree  = fleetFromWindow.urlSecretFree && fleetFromWindow.secretLeaks.length === 0
        }

        // `mode` marks the Brain leg; the boot's own mode is on the transport fact.
        brain = {...boot, chromaListening, fleetFromWindow, groupsEmpty, mode: true, plane, portsReleased, stop, transport: uiTransportFact}
    }

    const
        assetFailures       = [...smokeState.assetFailures],
        rendererErrors      = [...smokeState.rendererErrors],
        requiredAssetsReady = REQUIRED_ASSET_PATHS.every(asset => smokeState.assetsSeen.has(asset)) &&
            assetFailures.length === 0,
        sharedHeapEvidence  = Boolean(
            boot1.viewportId &&
            boot2.viewportId &&
            boot1.viewportId !== boot2.viewportId
        ),
        // The verdict arithmetic lives in `adapterWitness.mjs` so it is unit-testable without Electron:
        // it had NO coverage while it sat here, and the verdict is what the release gate reads.
        //
        // NOTE on `tourControlCount`: it is not a term in the verdict, but it DOES gate the final result
        // transitively — the preload only reports `ready` when no tour controls are present, so a demo
        // tour makes the report arrive via the timeout path and `timedOut === false` then fails. The
        // product-first-paint policy is intended; describing it as "removed from the verdict" was true
        // of the expression and false of the behaviour.
        verdict = computeFirstPaintVerdict({
            firstPaint,
            packagedMode,
            brainMode,
            brainUp: brain.mode ? brain.up === true : null
        }),
        {adaptersCoherent, firstPaintPassed, productWitnessPassed, productWitnessUnmet} = verdict,
        firstPaintReceipt = {
            ...firstPaint,
            adaptersCoherent,
            brainMode,
            brainUp: brain.mode ? brain.up === true : null,
            packagedMode,
            passed : firstPaintPassed,
            productWitnessPassed,
            productWitnessUnmet
        },
        results = {
            assetFailures,
            boot1,
            boot2,
            brain,
            firstPaint       : firstPaintReceipt,
            popupMaterialized: Boolean(win2),
            rendererErrors,
            requiredAssetsReady,
            sharedHeapEvidence,
            versions         : {
                chrome  : process.versions.chrome,
                electron: process.versions.electron,
                node    : process.versions.node
            }
        },
        brainPassed = !brain.mode || (
            brain.up === true &&
            (brain.matrixViolations ?? ['unresolved']).length === 0 &&
            (smokePlaneMode
                ? brain.plane?.transport?.mode === 'plane-attach' && brain.plane.transport.up === true &&
                    brain.plane.status?.configured === true && brain.plane.status.attached === true &&
                    brain.plane.admitted === true
                : brain.chromaListening === true) &&
            brain.fleetFromWindow?.primary?.envelope?.ok === true &&
            brain.fleetFromWindow?.popup?.envelope?.ok === true &&
            brain.fleetFromWindow?.popupClosed === true &&
            brain.fleetFromWindow?.primaryAfterPopup?.envelope?.ok === true &&
            brain.fleetFromWindow?.forgedSender?.envelope?.ok === false &&
            brain.fleetFromWindow?.forgedSender?.envelope?.error === 'fleet: untrusted shell sender' &&
            brain.fleetFromWindow?.firstWorkerCrossing === true &&
            brain.fleetFromWindow?.workerAfterPopupClose === true &&
            brain.fleetFromWindow?.surfaceExact === true &&
            brain.fleetFromWindow?.secretFree === true &&
            brain.groupsEmpty === true &&
            brain.portsReleased === true &&
            Object.values(brain.stop ?? {}).every(report => report.exited && !report.forced)
        ),
        passed = boot1.mounted > 10 &&
            boot2.mounted > 10 &&
            firstPaintPassed &&
            results.popupMaterialized &&
            requiredAssetsReady &&
            sharedHeapEvidence &&
            rendererErrors.length === 0 &&
            brainPassed;

    console.log('HARNESS_FIRST_PAINT_RESULTS=' + JSON.stringify(firstPaintReceipt, null, 2));
    console.log('HARNESS_SMOKE_RESULTS=' + JSON.stringify(results, null, 2));
    await appLifecycle.exitTerminal(passed ? 0 : 1)
});

// Smoke safety net — on timeout, capture compositor state before exiting.
// A held run has no deadline: the walker's window close ends it.
(smokeMode || lifecycleWitnessMode) && !smokeHold.hold && setTimeout(async () => {
    console.log('HARNESS_SMOKE_TIMEOUT');

    try {
        const
            win   = BrowserWindow.getAllWindows()[0],
            image = await win?.capturePage();

        if (image) {
            const {writeFileSync} = await import('node:fs');

            writeFileSync(path.join(harnessDir, 'smoke-timeout.png'), image.toPNG());
            console.log('HARNESS_TIMEOUT_CAPTURE written')
        }
    } catch (error) {
        console.log('HARNESS_TIMEOUT_CAPTURE_FAIL ' + error.message)
    }

    // app.exit bypasses will-quit, so the timeout net owns the Brain teardown explicitly.
    await appLifecycle.exitTerminal(1)
    // The Brain leg legitimately spends ~2min on a cold Chroma start; the UI-only smoke stays tight.
}, brainMode ? 240000 : 60000);
