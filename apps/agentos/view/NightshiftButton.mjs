import Button            from '../../../node_modules/neo.mjs/src/button/Base.mjs';
import FloatingMenuTheme from '../util/FloatingMenuTheme.mjs';
import ViewerTime        from '../util/ViewerTime.mjs';

/**
 * @summary The ways to turn Nightshift on: until the operator switches it off, or for a span whose end the
 * plane enforces as `until`, so a forgotten toggle cannot hold the fleet away.
 * @type {ReadonlyArray<Object>}
 */
export const NIGHTSHIFT_SPANS = Object.freeze([
    Object.freeze({id: 'open', hours: null, text: 'Until I switch it off'}),
    Object.freeze({id: '8h',   hours: 8,    text: 'For 8 hours'}),
    Object.freeze({id: '12h',  hours: 12,   text: 'For 12 hours'})
]);

/**
 * @summary What the toggle shows for the plane's operator presence record.
 *
 * Unknown is its own state, never present: a roster whose presence read did not answer, or a Fleet older
 * than the record, leaves `mode` null. An `away` record presses the toggle and names its end when the plane
 * holds one. A `present` record whose `away` ran out (`expired`) says when it ended.
 * @param {Object|null} presence The provider's `operatorPresence` leaf `{expired, mode, since, until}`.
 * @param {Object} [options] {@link AgentOS.util.ViewerTime#formatViewerTime} options; tests pin `locale`,
 *     `timeZone` and `now`.
 * @returns {{label: String, pressed: Boolean, state: String}} `state` is `away`, `present` or `unknown`.
 */
export function describeNightshift(presence, options = {}) {
    const at = instant => ViewerTime.formatViewerTime(instant, options)?.text;

    if (presence?.mode === 'away') {
        const since = at(presence.since), until = at(presence.until);

        return {
            label  : `Nightshift on${since ? ` since ${since}` : ''}, ${until ? `ends ${until}` : 'until you switch it off'}`,
            pressed: true,
            state  : 'away'
        }
    }

    if (presence?.mode === 'present') {
        const ended = presence.expired === true && at(presence.since);

        return {label: ended ? `Nightshift off, ended ${ended}` : 'Nightshift off', pressed: false, state: 'present'}
    }

    return {label: 'Nightshift unknown: the fleet has not reported it', pressed: false, state: 'unknown'}
}

/**
 * @summary Why a `setOperatorPresence` call did not land, in the toggle's own words. The error text is
 * remote and unbounded, so only its validated classification reaches the screen.
 * @param {Error} error The bridge's rejection (`fleetWireState`, `fleetConnectionState`).
 * @returns {String}
 */
export function nightshiftRefusal(error) {
    switch (error?.fleetWireState) {
        case 'unsupported-method': return 'this Fleet does not offer it yet';
        case 'refused'           : return 'the Fleet refused it';
        case 'degraded'          :
        case 'operation-failed'  : return 'the plane did not take it'
    }

    return error?.fleetConnectionState === 'unreachable' ? 'the Fleet is unreachable' : 'the request failed'
}

/**
 * @class AgentOS.view.NightshiftButton
 * @extends Neo.button.Base
 *
 * @summary The product bar's Nightshift toggle, left of the theme switch: pressed while the operator is away.
 *
 * The mode is the plane's record (Memory Core's `OperatorPresenceService`), bound in as {@link #operatorPresence};
 * the toggle holds no state of its own. A click while away fires `nightshiftchange` with `present`. A
 * click while present opens the {@link NIGHTSHIFT_SPANS} menu, and a span fires `away` with its `until`.
 * The Viewport's controller turns the intent into the fleet's `setOperatorPresence` verb, which also tells
 * the peers once.
 */
class NightshiftButton extends Button {
    static config = {
        /**
         * @member {String} className='AgentOS.view.NightshiftButton'
         * @protected
         */
        className: 'AgentOS.view.NightshiftButton',
        /**
         * @member {String[]} cls=['agent-button','agent-nightshift-button']
         * @reactive
         */
        cls: ['agent-button', 'agent-nightshift-button'],
        /**
         * The theme switch beside it owns the plain moon.
         * @member {String} iconCls='fa-solid fa-cloud-moon'
         * @reactive
         */
        iconCls: 'fa-solid fa-cloud-moon',
        /**
         * The Viewport provider's `operatorPresence` leaf. Injected via binding.
         * @member {Object|null} operatorPresence_=null
         * @reactive
         */
        operatorPresence_: null,
        /**
         * @member {String} text='Nightshift'
         * @reactive
         */
        text: 'Nightshift',
        /**
         * The toggle has no transient ink-ripple layer.
         * @member {Boolean} useRippleEffect=false
         * @reactive
         */
        useRippleEffect: false,
        /**
         * Why the last change did not land, or `null`. The next record or the next click clears it.
         * @member {String|null} writeError_=null
         * @reactive
         */
        writeError_: null
    }

    /**
     * @summary A new record re-words the toggle and retires the last refusal.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetOperatorPresence(value, oldValue) {
        const me = this;

        me.writeError = null;
        me.isConstructed && me.updateButton()
    }

    /**
     * @summary A refusal re-words the toggle.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetWriteError(value, oldValue) {
        this.isConstructed && this.updateButton()
    }

    /**
     * @summary Creates the span menu at construction: its module loads on demand, and a click must find it.
     * The trigger's `aria-expanded` follows the list's own `mounted` state, so Escape, focus-leave and a
     * chosen span all close it in the accessible state too.
     * @protected
     */
    ensureSpanMenu() {
        const me = this;

        if (me.menu) return;

        me.menu = {
            cls  : ['fm-nightshift-menu'],
            items: NIGHTSHIFT_SPANS.map(span => ({id: span.id, text: span.text, handler: () => me.onSpanSelect(span)}))
        };

        me.menuListReady.then(() => {
            me.isDestroyed || me.observeConfig(me.menuList, 'mounted', mounted => me.syncMenuExpanded(mounted))
        })
    }

    /**
     * @summary A span turns Nightshift on, ending after its hours when it has any.
     * @param {Object} span One of {@link NIGHTSHIFT_SPANS}
     * @param {Number} [now=Date.now()]
     */
    onSpanSelect(span, now = Date.now()) {
        this.fire('nightshiftchange', {
            mode: 'away',
            ...(span.hours ? {until: new Date(now + span.hours * 3_600_000).toISOString()} : {})
        })
    }

    /**
     * @summary Keeps the trigger's expanded state in step with every menu dismissal path.
     * @param {Boolean} expanded
     */
    syncMenuExpanded(expanded) {
        this.changeVdomRootKey('aria-expanded', expanded ? 'true' : this.pressed ? null : 'false')
    }

    /**
     * @summary The click: while away it switches Nightshift off, no menu; otherwise it opens the spans,
     * re-themed at every open and focused, so arrows, Enter, Escape and focus-leave work.
     * @returns {Promise<void>}
     */
    async toggleMenu() {
        const me = this;

        me.writeError = null;

        if (me.pressed) {
            me.fire('nightshiftchange', {mode: 'present'});
            return
        }

        await me.trap(me.menuListReady);

        const {menuList} = me;

        menuList.hidden && FloatingMenuTheme.sync(me, menuList);

        await super.toggleMenu();

        menuList.hidden || menuList.focus()
    }

    /**
     * @summary Words the toggle from the record and the last refusal: pressed state, title, accessible name.
     * @protected
     */
    updateButton() {
        const
            me       = this,
            view     = describeNightshift(me.operatorPresence),
            label    = me.writeError ? `Nightshift could not be set: ${me.writeError}` : view.label,
            expanded = Boolean(me.menuList && !me.menuList.hidden);

        me.pressed = view.pressed;
        me.toggleCls('is-unknown', view.state === 'unknown');
        me.toggleCls('is-refused', Boolean(me.writeError));

        Object.assign(me.getVdomRoot(), {
            'aria-expanded': view.pressed ? null : String(expanded),
            'aria-haspopup': view.pressed ? null : 'menu',
            'aria-label'   : label,
            'aria-pressed' : String(view.pressed),
            title          : label
        });

        me.update()
    }

    /**
     * @summary Completes the menu and the words once every config and binding has settled.
     */
    onConstructed() {
        super.onConstructed();
        this.ensureSpanMenu();
        this.updateButton()
    }
}

export default Neo.setupClass(NightshiftButton);
