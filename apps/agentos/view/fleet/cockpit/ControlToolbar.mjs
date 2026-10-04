import Button                      from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import SpineBannerComponent        from './SpineBannerComponent.mjs';
import Toolbar                     from '../../../../../node_modules/neo.mjs/src/toolbar/Base.mjs';
import ViewerWakeTelltaleComponent from './ViewerWakeTelltaleComponent.mjs';

/**
 * @summary The cockpit's control bar: the spine's state block (the fleet pill, its lead, the wake
 * telltale) right-aligned before the action group (Reconnect or Connect, the start summary, the
 * recall verbs, Start fleet).
 *
 * The bar is declared chrome. Its items bind the cockpit's state provider and resolve their string
 * handlers on the cockpit's controller, the closest ones up the tree, and register their references
 * there, so the cockpit reads `fleet-spine-banner` and its siblings as its own. The buttons keep their
 * width: a narrow bar takes its pixels from the state block, whose lead ellipsizes first, never from a
 * verb. The collapse order below 760 px is a container query in the cockpit SCSS, never measured here.
 * @class AgentOS.view.fleet.cockpit.ControlToolbar
 * @extends Neo.toolbar.Base
 */
class ControlToolbar extends Toolbar {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.ControlToolbar'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.ControlToolbar',
        /**
         * @member {String} ntype='fm-cockpit-control-toolbar'
         * @protected
         */
        ntype: 'fm-cockpit-control-toolbar',
        /**
         * @member {String[]} cls=['fm-cockpit-bar']
         * @reactive
         */
        cls: ['fm-cockpit-bar'],
        /**
         * Every item keeps its content width unless it declares its own flex: only the state block
         * and the start summary shrink.
         * @member {Object} itemDefaults={flex:'none'}
         * @reactive
         */
        itemDefaults: {flex: 'none'},
        /**
         * @member {Object[]} items
         * @reactive
         */
        items: ['->', {
            // THE STATE BLOCK — the bar's structural law: state never sits between action
            // buttons; the two spine axes (fleet · wake) render as one right-aligned block
            // before the action group. The pills run in a row wherever they carry their
            // words; narrow widths drop them to marks while the lead keeps its line.
            ntype : 'container',
            cls   : ['fm-bar-state'],
            flex  : '0 1 auto',
            layout: {ntype: 'hbox', align: 'center'},
            // Both pills size to their words: the block's flexbox layout would otherwise
            // write `flex: 1 1 0%` onto each child, which splits the row form's width equally
            // and clipped the longer pill mid-word while the shorter one held slack.
            items: [{
                // the per-SPINE honesty pill — the derived spineBanner leaves bind here at
                // the consumption site; the status word, with the retained cause on title/aria
                module   : SpineBannerComponent,
                bind     : {
                    bannerAriaLabel: data => data.spineBanner.ariaLabel,
                    bannerTitle    : data => data.spineBanner.title,
                    cls            : data => [`fm-spine-banner-${data.spineBanner.kind}`],
                    hidden         : data => data.spineBanner.hidden,
                    text           : data => data.spineBanner.text
                },
                flex     : '0 1 auto',
                reference: 'fleet-spine-banner'
            }, {
                // the reason, VISIBLE beside the pill: a non-live state never hides behind a hover.
                // `text`, never `html`. A zero basis makes it the row's slack: it shows what the
                // pills leave and ellipsizes first, so a pill never loses its word to it
                ntype    : 'component',
                bind     : {
                    hidden: data => data.spineBanner.hidden || !data.spineBanner.lead,
                    text  : data => data.spineBanner.lead
                },
                cls      : ['fm-spine-banner-lead'],
                flex     : '1 1 0%',
                reference: 'fleet-spine-banner-lead'
            }, {
                // the per-viewer wake-push telltale — every channel of the derived chip binds
                // here as its own first-class config (text, cls, title, aria — independently
                // reactive; see the component class)
                module   : ViewerWakeTelltaleComponent,
                bind     : {
                    chipAriaLabel: data => data.viewerWakeTelltale.ariaLabel,
                    chipTitle    : data => data.viewerWakeTelltale.title,
                    cls          : data => data.viewerWakeTelltale.cls.slice(1),
                    text         : data => data.viewerWakeTelltale.text
                },
                flex     : '0 1 auto',
                reference: 'viewer-wake-telltale'
            }]
        }, {
            // the banner's action: Reconnect re-drives every liveness seam through the existing
            // bridge; beside a running plane it becomes Connect and opens the plane card. Its
            // visibility and its words are the banner verdict, bound from the same formula. First
            // of the ACTION group — contextual: it exists only while the fleet pill shows.
            module   : Button,
            bind     : {
                hidden : data => data.spineBanner.hidden,
                iconCls: data => data.spineBanner.action === 'connect-plane' ? 'fa-solid fa-plug' : 'fa-solid fa-rotate',
                text   : data => data.spineBanner.action === 'connect-plane' ? 'Connect' : 'Reconnect'
            },
            cls      : ['fm-reconnect-button'],
            handler  : 'onSpineAction',
            reference: 'fleet-reconnect-button'
        }, {
            // The fleet-start outcome summary — written by the controller after the staged
            // bring-up settles ("N started · U UNKNOWN · M rejected · K excluded"; per-member
            // reasons ride the title). Empty + hidden until a start ran; renders beside the
            // start verb whose outcome it reports.
            ntype    : 'component',
            cls      : ['fm-fleet-start-summary'],
            flex     : '0 1 auto',
            hidden   : true,
            reference: 'fleet-start-summary'
        }, {
            // exception-only chrome (the banner's class): each recall verb renders ONLY
            // while its pane is away in a vessel — the pane carries its own toggle, but a
            // windowed pane leaves the main view with no way home without this. Nominal
            // state costs zero pixels; `removeDom` keeps the class-based selectors honest.
            module   : Button,
            cls      : ['fm-memories-window-toggle'],
            handler  : 'onMemoriesWindowToggle',
            hidden   : true,
            hideMode : 'removeDom',
            iconCls  : 'fa-solid fa-arrow-down-left',
            reference: 'memories-recall-chrome',
            text     : 'Return memories'
        }, {
            module   : Button,
            cls      : ['fm-detail-window-toggle'],
            handler  : 'onDetailWindowToggle',
            hidden   : true,
            hideMode : 'removeDom',
            iconCls  : 'fa-solid fa-arrow-down-left',
            reference: 'detail-recall-chrome',
            text     : 'Reattach detail'
        }, {
            module : Button,
            cls    : ['fm-fleet-start'],
            handler: 'onStartFleet',
            iconCls: 'fa-solid fa-play',
            text   : 'Start fleet'
        }]
    }
}

export default Neo.setupClass(ControlToolbar);
