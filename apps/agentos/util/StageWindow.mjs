import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary Opens one optional development sibling from the cockpit's held observation.
 * The channel carries JSON between independent App workers. Main retains physical window custody;
 * an open receipt is never a record-admission or Canvas-draw receipt.
 * @class AgentOS.util.StageWindow
 * @extends Neo.core.Base
 */
class StageWindow extends Base {
    static config = {
        className: 'AgentOS.util.StageWindow',
        /** @member {Object|null} owner=null The cockpit which owns and destroys this launch. */
        owner: null,
        /** @member {Number} launchTimeout=15000 Maximum wait for Stage's first draw. */
        launchTimeout: 15000
    }

    /** @member {Object|null} active=null The exact current launch lifetime. */
    active = null

    /**
     * @summary Resolves only an explicitly configured same-origin development destination.
     * @param {Object} config The owning window's configuration.
     * @returns {String|null}
     */
    static entryUrl(config) {
        try {
            const base = new URL(config.url.href), target = new URL(config.stageLaunchUrl, base);
            return config.environment === 'development' && typeof config.stageLaunchUrl === 'string' &&
                config.stageLaunchUrl.trim() && target.origin === base.origin &&
                ['http:', 'https:'].includes(target.protocol) ? target.href : null
        } catch {
            return null
        }
    }

    /**
     * @summary Publishes an addressed result for the row which initiated this launch.
     * @param {String} recordId The queue's repository-qualified key.
     * @param {String} state
     * @param {String} message
     */
    publish(recordId, state, message) {
        !this.owner.isDestroyed && this.owner.component.getStateProvider()?.setData({stageLaunch: {recordId, state, message}})
    }

    /**
     * @summary Resolves row and envelope from one held answer, then waits for the sibling's actual draw.
     * @param {String} recordId The clicked Store key; never a row index or cached title.
     * @returns {Promise<Object>} The terminal launch result.
     */
    async open(recordId) {
        const me = this, owner = me.owner, windowId = owner.component.windowId,
            config = Neo.windowConfigs?.[windowId] || Neo.config,
            url = StageWindow.entryUrl(config), snapshot = owner.openWorkSnapshot,
            profileId = owner.openWorkProfileId,
            row = snapshot?.awaitingMerge?.find(item => `${item.repo}#${item.number}` === recordId);

        if (me.active?.recordId === recordId && !me.active.settled) return me.active.promise;
        me.retire();
        if (!url || typeof globalThis.BroadcastChannel !== 'function' || !row ||
            !['ok', 'stale'].includes(snapshot.state) || profileId !== owner.bridgeProfileId) {
            me.publish(recordId, 'unavailable', 'Stage unavailable for this observation. Reopen the queue after its source answers.');
            return {state: 'unavailable'}
        }

        const token = crypto.randomUUID(), target = new URL(url),
            launch = {token, windowId, recordId, snapshot, profileId, windowName: `neo-stage-${token}`, settled: false};
        target.searchParams.set('stageHandoff', token);
        launch.promise = new Promise(resolve => { launch.resolve = resolve });
        me.active = launch;
        try {
            launch.context = JSON.parse(JSON.stringify({record: row, provenance: {
                source: 'fleet-open-work', recordId, profileId,
                observedAt: snapshot.observedAt ?? null, coverage: snapshot.coverage ?? null
            }}));
            launch.channel = new BroadcastChannel(`neo-stage:${token}`);
            launch.channel.onmessage = ({data}) => me.receive(launch, data);
            launch.timer = setTimeout(() => me.fail(launch, 'Stage did not acknowledge a drawn record. Check its dev URL and reload the entry.'), me.launchTimeout);
            launch.monitor = setInterval(async () => {
                if (!me.isCurrent(launch)) return me.active === launch && me.cancel();
                if (launch.nativeRoute && !launch.checkingClose) {
                    launch.checkingClose = true;
                    try {
                        const closed = await Neo.Main.windowNativeIsClosed({nativeHandleKey: launch.nativeRoute.nativeHandleKey, windowId});
                        if (closed === true && me.active === launch) {
                            me.publish(recordId, 'closed', 'Stage closed.');
                            me.retire()
                        }
                    } catch {/* A failed observation grants no closure claim. */}
                    finally { launch.checkingClose = false }
                }
            }, 500);
            me.publish(recordId, 'opening', 'Opening Stage…');
            Neo.Main.windowOpen({url: target.href, windowName: launch.windowName,
                windowId, windowFeatures: 'width=1200,height=850', nativeCapabilities: {close: true, focus: true}}).then(opened => {
                if (!me.isCurrent(launch)) {
                    me.active === launch && me.cancel();
                    return Neo.Main.windowClose({names: launch.windowName, windowId})
                }
                if (!opened) me.fail(launch, 'Stage popup was denied. Allow this launch and try again.')
            }).catch(() => me.fail(launch, 'Stage could not be opened. Check its dev URL and try again.'));
        } catch {
            me.fail(launch, 'Stage could not be opened. Check its dev URL and try again.')
        }
        return launch.promise
    }

    /**
     * @summary Names a source replacement before releasing the launch and its pending feedback.
     */
    cancel() {
        const launch = this.active;
        launch && this.publish(launch.recordId, 'superseded', 'Stage launch canceled: its source observation changed.');
        this.retire()
    }

    /**
     * @summary A pending launch belongs to its exact snapshot and profile, not the read-start generation.
     * @param {Object} launch
     * @returns {Boolean}
     */
    isCurrent(launch) {
        return this.active === launch && !this.isDestroyed && !this.owner.isDestroyed &&
            this.owner.bridgeProfileId === launch.profileId && this.owner.openWorkProfileId === launch.profileId &&
            (launch.settled || this.owner.openWorkSnapshot === launch.snapshot)
    }

    /**
     * @summary Answers only the bound child and accepts its draw receipt once; stale messages cannot reopen it.
     * @param {Object} launch
     * @param {Object} data
     */
    receive(launch, data) {
        if (data?.token !== launch.token || !this.isCurrent(launch)) return;
        if (data.type === 'request' && !launch.childWindowId && typeof data.windowId === 'string' && data.windowId.trim()) {
            launch.childWindowId = data.windowId;
            if (data.nativeRoute?.ownerWindowId === launch.windowId && data.nativeRoute?.targetWindowId === data.windowId) {
                launch.nativeRoute = data.nativeRoute
            }
            launch.channel.postMessage({type: 'context', token: launch.token, windowId: data.windowId, context: launch.context})
        } else if (launch.childWindowId && data.windowId === launch.childWindowId && data.type === 'painted' && !launch.settled) {
            launch.settled = true;
            clearTimeout(launch.timer);
            this.publish(launch.recordId, 'painted', 'Stage is showing this observation.');
            launch.resolve({state: 'painted', windowId: data.windowId});
        } else if (launch.childWindowId && data.windowId === launch.childWindowId && data.type === 'return') {
            this.publish(launch.recordId, 'closing', 'Stage close requested.');
            this.retire()
        } else if (launch.childWindowId && data.windowId === launch.childWindowId && data.type === 'unavailable') {
            this.fail(launch, 'Stage could not draw this record. Check the sibling and try again.')
        }
    }

    /**
     * @summary Retires before requesting physical closure; a late open result closes only its unique handle.
     */
    retire() {
        const launch = this.active;
        this.active = null;
        if (launch) {
            clearTimeout(launch.timer);
            clearInterval(launch.monitor);
            launch.channel?.close();
            launch.resolve({state: 'superseded'});
            Neo.Main.windowClose({names: launch.windowName, windowId: launch.windowId}).catch(() => {})
        }
    }

    /**
     * @summary Records failure only for the still-owned launch, then releases all transport resources.
     * @param {Object} launch
     * @param {String} message
     */
    fail(launch, message) {
        if (this.active !== launch) return;
        if (!this.isCurrent(launch)) return this.cancel();
        this.publish(launch.recordId, 'unavailable', message);
        launch.resolve({state: 'unavailable'});
        this.retire()
    }

    /** @summary The cockpit's destruction cancels its channel and ordinary sibling window. */
    destroy(...args) {
        this.retire();
        super.destroy(...args)
    }
}

export default Neo.setupClass(StageWindow);
