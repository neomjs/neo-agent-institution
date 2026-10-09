import Button    from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';

/**
 * @summary The Observatory's View section: the controls that choose what the scene draws, each
 * labelled by the question it answers rather than by its algorithm. The wells follow the roadmap (the Brain's
 * strategic anchors) or the hubs (the read's best-connected nodes); Attention brightens what drew attention in the
 * stated window; Route draws the Golden Path's route; Messages brings agent mail into the scene; Outside wells draws
 * the nodes no well reached. A pressed control is a drawn choice. A route the Golden Path read withholds reads
 * withheld in its own control, without a hover, and the reason sits in the control's detail; the control still
 * draws or drops the route the graph read carries. Each control is named by what it does: the Golden Path is the
 * dock pane the route illustrates, never this section's word.
 *
 * The pane owns the state: it wires the controls' handlers and hands the section its state through {@link #sync}.
 * @class AgentOS.view.fleet.goldenpath.ObservatoryViewContainer
 * @extends Neo.container.Base
 */
class ObservatoryViewContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryViewContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryViewContainer',
        /**
         * @member {String} ntype='fm-observatory-view'
         * @protected
         */
        ntype: 'fm-observatory-view',
        /**
         * @member {String[]} baseCls=['fm-observatory-view']
         */
        baseCls: ['fm-observatory-view'],
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The title, the wells' two geographies, then the overlays and what the scene holds.
         * @member {Object[]} items
         */
        items: [{
            ntype: 'component',
            cls  : ['fm-observatory-side-title'],
            flex : 'none',
            text : 'View'
        }, {
            ntype : 'container',
            cls   : ['fm-pane-actions', 'fm-observatory-view-row'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            items : [{
                ntype: 'component',
                cls  : ['fm-observatory-view-label'],
                flex : 'none',
                text : 'Wells'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'geography-strategic',
                text     : 'Roadmap',
                tooltip  : 'Wells around the Brain\'s strategic anchors: where the roadmap\'s weight lies',
                ui       : 'ghost'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'geography-density',
                text     : 'Hubs',
                tooltip  : 'Wells around the read\'s best-connected nodes: what is central',
                ui       : 'ghost'
            }]
        }, {
            ntype : 'container',
            cls   : ['fm-pane-actions', 'fm-observatory-view-row'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            items : [{
                module   : Button,
                flex     : 'none',
                reference: 'heat-toggle',
                text     : 'Attention',
                ui       : 'ghost'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'route-toggle',
                text     : 'Route',
                ui       : 'ghost'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'mail-toggle',
                text     : 'Messages',
                tooltip  : 'Draw agent messages and the relations routing them',
                ui       : 'ghost'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'halo-toggle',
                text     : 'Outside wells',
                tooltip  : 'Draw the nodes no well reached in an outer halo',
                ui       : 'ghost'
            }]
        }]
    }

    /**
     * @summary What the Observatory's head calls the geography the scene drew: the wells by what they gather
     * around, as this section's controls name them, or the topology's communities, which no control offers.
     * @param {String|null} geography The scene's drawn geography
     * @returns {String|null} `null` for no drawn geography
     */
    static titleOf(geography) {
        return {communities: 'Communities', density: 'Hub wells', strategic: 'Roadmap wells'}[geography] ?? null
    }

    /**
     * @summary Shows the pane's state: the drawn geography pressed, each overlay pressed while drawn (for the eye
     * and for assistive technology alike), and a withheld route named withheld with its reason in the detail.
     * @param {Object}      state
     * @param {String}      state.geography   The pane's geography
     * @param {Boolean}     state.halo
     * @param {Boolean}     state.heat
     * @param {Number}      state.heatDays    The attention window, in days
     * @param {Boolean}     state.mail
     * @param {Boolean}     state.route
     * @param {String|null} state.routeWithheld Why the Golden Path read withholds the route, `null` while it does not
     */
    sync({geography, halo, heat, heatDays, mail, route, routeWithheld}) {
        const me = this;

        [
            ['geography-strategic', geography === 'strategic'],
            ['geography-density',   geography === 'density'],
            ['heat-toggle',         heat],
            ['route-toggle',        route],
            ['mail-toggle',         mail],
            ['halo-toggle',         halo]
        ].forEach(([reference, pressed]) => {
            const control = me.getReference(reference);

            control.pressed               = pressed;
            control.vdom['aria-pressed'] = String(pressed);
            control.update()
        });

        me.getReference('heat-toggle').tooltip = `Brighten what drew attention in the last ${heatDays} day${heatDays === 1 ? '' : 's'}: open work, memories and gaps`;
        me.getReference('route-toggle').set({
            text   : routeWithheld ? 'Route · withheld' : 'Route',
            tooltip: routeWithheld
                ? `The Golden Path read withholds the route (${routeWithheld}); the route drawn is the one the graph read carries`
                : 'Draw the Golden Path route over the graph'
        })
    }
}

export default Neo.setupClass(ObservatoryViewContainer);
