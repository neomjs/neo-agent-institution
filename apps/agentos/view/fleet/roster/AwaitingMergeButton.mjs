import AgentFreshness        from '../../../util/AgentFreshness.mjs';
import AwaitingMergeMenuList from './AwaitingMergeMenuList.mjs';
import Button                from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import FloatingMenuTheme     from '../../../util/FloatingMenuTheme.mjs';

/**
 * @summary What the fleet head shows for the open-work read's state and the merge queue's size.
 *
 * Zero earns no pixels, and neither does an answer nobody gave: no read yet, a bridge without the
 * open-work verb (an expected absence), or a read that threw (the connection's story, which the spine
 * banner already tells). A producer that answered `unavailable` is named once, so a blind queue never
 * reads as an empty one. A stale queue says so in its words.
 * @param {Object|null} openWork The provider's `openWork` block `{coverage, observedAt, reason, state}`.
 * @param {Number} count The merge queue's row count.
 * @param {Number} [now=Date.now()] The viewer's clock, for a stale queue's age.
 * @returns {{hidden: Boolean, interactive: Boolean, stale: Boolean, unavailable: Boolean, text: String, title: String}}
 */
export function describeMergeQueue(openWork, count, now = Date.now()) {
    const
        state       = openWork?.state ?? null,
        unavailable = state === 'unavailable' && openWork.coverage === 'unavailable',
        stale       = state === 'stale',
        interactive = count > 0 && (state === 'ok' || stale),
        ageMs       = stale && openWork.observedAt ? now - Date.parse(openWork.observedAt) : NaN,
        age         = Number.isFinite(ageMs) ? `, observed ${AgentFreshness.formatAge(ageMs)}` : '',
        prs         = count === 1 ? 'pull request' : 'pull requests';

    if (unavailable) {
        return {
            hidden     : false,
            interactive: false,
            stale      : false,
            unavailable: true,
            text       : 'merge queue unavailable',
            title      : `The merge queue could not be read${openWork.reason ? `: ${openWork.reason}` : ''}`
        }
    }

    return {
        hidden     : !interactive,
        interactive,
        stale,
        unavailable: false,
        text       : interactive ? `${count} awaiting merge${stale ? ' · stale' : ''}` : '',
        title      : interactive ? `${count} ${prs} approved, green and mergeable, awaiting your merge${stale ? ` · stale${age}` : ''}` : ''
    }
}

/**
 * @class AgentOS.view.fleet.roster.AwaitingMergeButton
 * @extends Neo.button.Base
 *
 * @summary The fleet head's merge queue: "N awaiting merge" after the health bar, opening a floating,
 * Store-backed list of the pull requests the operator can merge ({@link AgentOS.view.fleet.roster.AwaitingMergeMenuList}).
 *
 * Both facts arrive as GIVEN: the rows ride the injected {@link #store} (the provider's
 * {@link AgentOS.store.FleetAwaitingMerge}), the read's state rides {@link #openWork}. The button
 * derives its words from the two ({@link describeMergeQueue}) and reaches for nothing itself.
 */
class AwaitingMergeButton extends Button {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.roster.AwaitingMergeButton'
         * @protected
         */
        className: 'AgentOS.view.fleet.roster.AwaitingMergeButton',
        /**
         * @member {String[]} cls=['fm-awaiting-merge']
         * @reactive
         */
        cls: ['fm-awaiting-merge'],
        /**
         * Nothing to show until the read answers.
         * @member {Boolean} hidden=true
         * @reactive
         */
        hidden: true,
        /**
         * The open-work read's state, the provider's `openWork` block. Injected via binding.
         * @member {Object|null} openWork_=null
         * @reactive
         */
        openWork_: null,
        /**
         * The provider-scoped merge queue Store. Injected via binding.
         * @member {Neo.data.Store|null} store_=null
         * @reactive
         */
        store_: null,
        /**
         * @member {String} ui='ghost'
         * @reactive
         */
        ui: 'ghost',
        /**
         * The chip has no transient ink-ripple layer.
         * @member {Boolean} useRippleEffect=false
         * @reactive
         */
        useRippleEffect: false
    }

    /**
     * @summary Store swap: re-word on every load and hand the exact provider Store to the menu, which
     * preserves its external ownership.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetStore(value, oldValue) {
        let me = this;

        oldValue?.un('load', me.updateButton, me);
        value?.on('load', me.updateButton, me);

        if (value && me.menuList && me.menuList.store !== value) {
            me.menuList.store = value
        } else if (value && me.isConstructed) {
            me.ensureMergeMenu()
        }

        me.updateButton()
    }

    /**
     * @summary The read's state changed: re-word.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetOpenWork(value, oldValue) {
        this.updateButton()
    }

    /**
     * @summary Creates the framework menu config once the provider Store binding is available.
     * @protected
     */
    ensureMergeMenu() {
        let me = this;

        if (!me.menu && me.store) {
            me.menu = {
                module: AwaitingMergeMenuList,
                store : me.store
            }
        }
    }

    /**
     * @summary Lazy menu-construction callback: reconciles a Store binding that changed while the
     * framework import was resolving.
     * @param {AgentOS.view.fleet.roster.AwaitingMergeMenuList} menu
     */
    onMergeMenuReady(menu) {
        if (this.store && menu.store !== this.store) {
            menu.store = this.store
        }

        FloatingMenuTheme.sync(this, menu)
    }

    /**
     * @summary Keeps the trigger's expanded state in step with every menu dismissal path.
     * @param {Boolean} expanded
     */
    syncMenuExpanded(expanded) {
        this.changeVdomRootKey('aria-expanded', String(expanded))
    }

    /**
     * @summary Opens the list only when there is one, re-theming it at every open and moving focus into
     * it, so arrows, Escape and focus-leave work.
     * @returns {Promise<void>}
     */
    async toggleMenu() {
        let me         = this,
            {menuList} = me;

        if (!describeMergeQueue(me.openWork, me.store?.count ?? 0).interactive) return;

        if (!menuList) {
            me.ensureMergeMenu();
            return
        }

        menuList.hidden && FloatingMenuTheme.sync(me, menuList);

        await super.toggleMenu();

        me.syncMenuExpanded(!menuList.hidden);
        !menuList.hidden && menuList.focus()
    }

    /**
     * @summary Words the button from the read's state and the queue's size: text, title, accessible
     * name, visibility. An unavailable read is named but opens nothing.
     * @protected
     */
    updateButton() {
        let me    = this,
            queue = describeMergeQueue(me.openWork, me.store?.count ?? 0),
            root  = me.getVdomRoot();

        me.set({
            cls   : ['fm-awaiting-merge', ...(queue.stale ? ['is-stale'] : []), ...(queue.unavailable ? ['is-unavailable'] : [])],
            hidden: queue.hidden,
            text  : queue.text
        });

        Object.assign(root, {
            'aria-disabled': queue.interactive ? null : 'true',
            'aria-expanded': queue.interactive ? String(Boolean(me.menuList && !me.menuList.hidden)) : null,
            'aria-haspopup': queue.interactive ? 'menu' : null,
            'aria-label'   : queue.hidden ? null : queue.title,
            title          : queue.hidden ? null : queue.title
        });

        me.update()
    }

    /**
     * @summary Completes lazy menu setup after every config and binding has settled.
     */
    onConstructed() {
        super.onConstructed();
        this.ensureMergeMenu();
        this.updateButton()
    }

    /**
     * @summary Detaches the queue listener; button.Base destroys the transient menu, whose
     * autoDestroyStore=false contract preserves the provider Store.
     * @param {...*} args
     */
    destroy(...args) {
        this.store?.un('load', this.updateButton, this);
        super.destroy(...args)
    }
}

export default Neo.setupClass(AwaitingMergeButton);
