import Button    from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import SetupAsks from '../../util/SetupAsks.mjs';

const GiB = 1073741824;

/**
 * @summary The Create door's choices under Other choices: one card per preset in the table — its facts,
 * the plane's own footprint, its verdict from the placement step with the recipe's reason — the chosen one
 * marked, a refused one visible but disabled with its shortfall. A projection of the table and the
 * placement, drawn again per evaluation; the choose button's request is the door's own (`up.onPresetClick`).
 * @class AgentOS.view.setup.PresetCardsContainer
 * @extends Neo.container.Base
 */
class PresetCardsContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.setup.PresetCardsContainer'
         * @protected
         */
        className: 'AgentOS.view.setup.PresetCardsContainer',
        /**
         * @member {String} ntype='fm-setup-preset-cards'
         * @protected
         */
        ntype: 'fm-setup-preset-cards',
        /**
         * @member {String[]} cls=['fm-setup-presets']
         */
        cls: ['fm-setup-presets'],
        /**
         * @member {String} flex='none'
         */
        flex: 'none',
        /**
         * Folded until the door opens the choices.
         * @member {Boolean} hidden=true
         */
        hidden: true,
        /**
         * @member {Object} layout={ntype:'base'}
         */
        layout: {ntype: 'base'},
        /**
         * @member {Object[]} items=[]
         */
        items: []
    }

    /**
     * @summary Draws the cards for one evaluation: the table's rows with the placement's verdicts.
     * @param {Object} data
     * @param {Object|null} data.placement The placement step's `{recommended, possible, refused}`
     * @param {String|null} data.chosen The consented preset id
     * @param {Object[]} data.presets The preset table
     */
    project({placement, chosen, presets}) {
        const me = this;

        me.removeAll();

        if (presets.length === 0) {
            me.add({ntype: 'component', cls: ['fm-setup-ask-help'], text: 'the preset table has not answered'});
            return
        }

        me.add(presets.map(preset => {
            const
                {margins, reason, verdict} = SetupAsks.presetVerdict(placement, preset.id),
                refused                    = verdict === 'refused',
                workload                   = preset.workload ?? {},
                facts                      = `chat ${preset.chatModel} · embed ${preset.embedder} · ${preset.vectorDimension} dims`,
                // the decision numbers: the plane's own footprint, the models, the floor's date
                footprint                  = preset.inference === 'local'
                    ? `models ${SetupAsks.gibText(workload.modelsBytes)} · ${preset.qualityFloor?.measuredAt ? `floor recorded ${preset.qualityFloor.measuredAt}` : 'no recorded floor'}`
                    : `plane ${Number.isFinite(workload.planeIdleBytes) ? (workload.planeIdleBytes / GiB).toFixed(1) : '?'}–${SetupAsks.gibText(workload.planePeakBytes)} · no local models · needs a provider key`,
                margin                     = Number.isFinite(margins?.host) && margins.host >= 0 ? ` · ${SetupAsks.gibText(margins.host)} host margin` : '';

            return {
                ntype    : 'container',
                cls      : ['fm-setup-preset', `is-${verdict}`, ...(chosen === preset.id ? ['is-chosen'] : []), ...(refused ? ['is-refused'] : [])],
                layout   : {ntype: 'vbox'},
                presetId : preset.id,
                items    : [
                    {ntype: 'component', cls: ['fm-setup-preset-name'],    text: preset.label ?? preset.id},
                    {ntype: 'component', cls: ['fm-setup-preset-fact'],    text: facts},
                    {ntype: 'component', cls: ['fm-setup-preset-fact'],    text: footprint},
                    {ntype: 'component', cls: ['fm-setup-preset-verdict'], text: `${verdict} — ${reason}${margin}`},
                    {module: Button, cls: ['fm-setup-preset-choose'], disabled: refused || chosen === preset.id, handler: 'up.onPresetClick', presetId: preset.id, text: chosen === preset.id ? 'chosen' : 'choose'}
                ]
            }
        }))
    }
}

export default Neo.setupClass(PresetCardsContainer);
