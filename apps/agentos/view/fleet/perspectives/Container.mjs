import Button    from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Component from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import Container from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';

/**
 * The cockpit's saved layouts: every perspective the dock document can take, one card each, with
 * the two explicit acts — apply one, or capture the live layout as a new one.
 *
 * @summary Renders the perspective list the owning FleetCockpit projects into provider data
 * (`perspectives`) and fires intent (`perspectiveRequest`); it never reaches the perspective
 * library itself. The three built-in presets ship with the cockpit (`AgentOS.util.CockpitPresets`);
 * a captured layout joins them under the operator's name and appears in the top bar's preset
 * switcher the same way, because both surfaces read the same projected list.
 *
 * Honest states: no projected list renders as exactly that (never an empty list posing as "no
 * layouts"), the active perspective is named in the meta line and marked on its card, and a
 * refused capture renders the library's own reason.
 *
 * @class AgentOS.view.fleet.perspectives.Container
 * @extends Neo.container.Base
 */
class PerspectivesPane extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.perspectives.Container'
         * @protected
         */
        className: 'AgentOS.view.fleet.perspectives.Container',
        /**
         * @member {String} ntype='fm-perspectives-pane'
         * @protected
         */
        ntype: 'fm-perspectives-pane',
        /**
         * @member {String[]} baseCls=['fm-perspectives-pane']
         */
        baseCls: ['fm-perspectives-pane'],
        /**
         * The projected perspective list, as the cockpit publishes it:
         * `{items: [{layoutId, perspectiveName, title, captureScope}], activeLayoutId, captureNote}` —
         * the note is the latest capture verdict as one sentence, or `null`.
         * `null` (or an empty `items`) is unobserved — nothing projected yet — never "no layouts".
         * @member {Object|null} perspectives_=null
         * @reactive
         */
        perspectives_: null,
        /**
         * The name the capture verb will file the live layout under — the field's last reported
         * value, trimmed; `null` while empty. The verb arms on this and uses exactly this, so the
         * name that enabled the button is the name that files the capture (the field's own
         * `value` commits on blur, which a click on the verb races).
         * @member {String|null} captureName_=null
         * @reactive
         */
        captureName_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-perspectives-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype: 'component',
                cls  : ['fm-perspectives-title'],
                flex : 1,
                text : 'Saved layouts'
            }, {
                ntype: 'component',
                cls  : ['fm-perspectives-authority'],
                text : 'the dock document as data · apply or capture'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-perspectives-meta'],
            flex     : 'none',
            reference: 'perspectives-meta',
            text     : 'No layouts projected yet'
        }, {
            ntype    : 'container',
            cls      : ['fm-perspectives-rows'],
            flex     : 1,
            layout   : {ntype: 'vbox', align: 'stretch'},
            reference: 'perspectives-rows'
        }, {
            // the capture rail: the name on its own line (a drawer is narrow — a field squeezed
            // beside a verb loses its placeholder), the verb right-aligned beneath it
            ntype : 'container',
            cls   : ['fm-perspectives-actions'],
            flex  : 'none',
            layout: {ntype: 'vbox', align: 'stretch'},
            items : [{
                module         : TextField,
                cls            : ['fm-perspectives-name'],
                flex           : 'none',
                labelText      : 'Name',
                labelPosition  : 'inline',
                placeholderText: 'Triage, standup, …',
                reference      : 'perspectives-name',
                listeners      : {change: 'up.onNameChange'}
            }, {
                ntype : 'container',
                flex  : 'none',
                layout: {ntype: 'hbox', align: 'center'},
                items : [{
                    ntype: 'component',
                    flex : 1
                }, {
                    module   : Button,
                    cls      : ['fm-perspectives-capture'],
                    disabled : true,
                    handler  : 'up.onCaptureClick',
                    iconCls  : 'fa fa-camera',
                    reference: 'perspectives-capture',
                    text     : 'Capture current layout',
                    ui       : 'ghost'
                }]
            }]
        }]
    }

    /**
     * @summary Render the held projection once the anatomy exists. No intent fires here: the
     * cockpit publishes the list on its own; the pane only asks for an apply or a capture.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.renderedIdentity = this.projectionIdentity(this.perspectives);
        this.applyPerspectives()
    }

    /**
     * The identity of the list the drawer last rendered — the guard that keeps a reference-only
     * change from re-rendering (see {@link #afterSetPerspectives}).
     * @member {String|null} renderedIdentity=null
     */
    renderedIdentity = null

    /**
     * Triggered after the perspectives config changed — a re-projection (a capture, a switch)
     * re-renders in place.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetPerspectives(value, oldValue) {
        const identity = this.projectionIdentity(value);

        // Provider data hands the binding a NEW object whenever any of its leaves is touched — a
        // projection that did not move must not re-render (and must never re-enter the projection
        // it binds into), so the drawer renders on identity, not on reference.
        if (this.isConstructed && identity !== this.renderedIdentity) {
            this.renderedIdentity = identity;
            this.applyPerspectives()
        }
    }

    /**
     * @summary The content identity of a projected list: what the drawer renders from, and nothing
     * else — a reference change without a content change is a no-op.
     * @param {Object|null} list
     * @returns {String}
     */
    projectionIdentity(list) {
        return JSON.stringify({
            active: list?.activeLayoutId ?? null,
            note  : list?.captureNote ?? null,
            items : (Array.isArray(list?.items) ? list.items : []).map(item => [item.layoutId, item.perspectiveName, item.title, item.captureScope])
        })
    }

    /**
     * @summary Project the list into the meta line and the cards; the capture verdict, when the
     * projection carries one, is named on the meta line rather than flashed and lost.
     */
    applyPerspectives() {
        const
            me       = this,
            list     = me.perspectives,
            items    = Array.isArray(list?.items) ? list.items : [],
            active   = items.find(item => item.layoutId === list?.activeLayoutId) ?? null,
            note     = list?.captureNote ?? null,
            metaEl   = me.getReference('perspectives-meta'),
            target   = me.getReference('perspectives-rows');

        if (metaEl) {
            metaEl.text = !items.length
                ? 'No layouts projected yet — the cockpit publishes its perspectives on boot.'
                : `${items.length} ${items.length === 1 ? 'layout' : 'layouts'} · ${active ? `${me.nameOf(active)} active` : 'none active'}${note ? ` · ${note}` : ''}`
        }

        if (!target) return;

        target.removeAll(true);

        target.add(items.length
            ? items.map(item => me.perspectiveCardConfig(item, item === active))
            : {module: Component, cls: ['fm-perspectives-empty'], text: 'Nothing here claims a layout yet.'}
        )
    }

    /**
     * @summary The product name of a perspective: its `perspectiveName`, else its technical id.
     * @param {Object} item
     * @returns {String}
     */
    nameOf(item) {
        return item.perspectiveName ?? item.layoutId
    }

    /**
     * @summary Build one perspective card: the name, the title line beneath it (only when it says
     * more than the name), and the apply verb — which reads `Active` and rests while the card is
     * the live layout.
     * @param {Object} item One projected list entry.
     * @param {Boolean} active Whether this perspective is the live one.
     * @returns {Object}
     */
    perspectiveCardConfig(item, active) {
        const
            name   = this.nameOf(item),
            detail = item.title && item.title !== name ? item.title : (item.captureScope ? `${item.captureScope} scope` : '');

        return {
            module: Container,
            cls   : ['fm-perspectives-card', ...(active ? ['is-active'] : [])],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype : 'container',
                flex  : 1,
                layout: {ntype: 'vbox', align: 'stretch'},
                items : [{
                    module: Component,
                    cls   : ['fm-perspectives-card-title'],
                    text  : name
                }, {
                    module: Component,
                    cls   : ['fm-perspectives-card-detail'],
                    hidden: !detail,
                    text  : detail
                }]
            }, {
                module    : Button,
                cls       : ['fm-perspectives-apply'],
                disabled  : active,
                handler   : 'up.onApplyClick',
                iconCls   : active ? 'fa fa-check' : 'fa fa-arrow-right',
                presetName: name,
                text      : active ? 'Active' : 'Apply',
                ui        : 'ghost'
            }]
        }
    }

    /**
     * @summary Apply the card's perspective — intent only; the cockpit switches and re-projects.
     * @param {Object} data
     */
    onApplyClick(data) {
        this.fire('perspectiveRequest', {action: 'apply', name: data.component.presetName})
    }

    /**
     * Triggered after the captureName config changed — the capture verb arms only once a name
     * exists: an unnamed capture has nothing to be filed under, so the button says so by resting.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetCaptureName(value, oldValue) {
        const capture = this.getReference('perspectives-capture');

        capture && (capture.disabled = !value)
    }

    /**
     * @summary The field reports every keystroke's value; the trimmed name becomes the verb's.
     * @param {Object} data
     */
    onNameChange(data) {
        this.captureName = (data.value ?? '').trim() || null
    }

    /**
     * @summary Capture the live layout under the armed name — intent only; the cockpit wraps the
     * committed dock document, saves it, and re-projects the list with the verdict.
     */
    onCaptureClick() {
        const name = this.captureName;

        name && this.fire('perspectiveRequest', {action: 'capture', name})
    }
}

export default Neo.setupClass(PerspectivesPane);
