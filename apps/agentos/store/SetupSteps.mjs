import SetupStepModel from '../model/SetupStep.mjs';
import Store          from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.SetupSteps
 * @extends Neo.data.Store
 *
 * @summary The Create door's projection of one recipe evaluation: eleven step rows in recipe order,
 * every row sharing one evaluation instant. The door owns the store and destroys it with the door;
 * the recipe's truth stays query-time in the vessel's main process (the CLI's `--json` shape), and
 * no row survives the view's lifecycle. A fresh evaluation replaces the whole list — the recipe
 * re-evaluates every step together, so a partial merge would mix two instants.
 */
class SetupSteps extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.SetupSteps'
         * @protected
         */
        className: 'AgentOS.store.SetupSteps',
        /**
         * @member {String} keyProperty='id'
         */
        keyProperty: 'id',
        /**
         * @member {Neo.data.Model} model=SetupStepModel
         * @reactive
         */
        model: SetupStepModel
    }

    /**
     * @summary Replaces the rows with one evaluation's steps, in the recipe's order. An evaluation
     * without a `steps` array clears the list: the door then says why nothing is projected.
     * @param {Object|null} evaluation The recipe's evaluation (`{steps, terminal, binding, …}`), or `null`
     * @returns {Number} The number of rows projected
     */
    projectEvaluation(evaluation) {
        const
            me    = this,
            steps = Array.isArray(evaluation?.steps) ? evaluation.steps.filter(step => typeof step?.id === 'string') : [];

        me.clear();
        steps.length > 0 && me.add(steps);

        return steps.length
    }

    /**
     * @summary The progress the chrome shows — counts `ok` rows only (`unknown` is never green by
     * default) and names the first row that is not `ok` in recipe order as the next step.
     * @returns {{ok: Number, total: Number, next: String|null, blocking: String|null}} `blocking` is the
     * first `failed` or `reconcile-required` row's id, the row the operator must look at first
     */
    describeProgress() {
        const
            rows     = this.items,
            ok       = rows.filter(row => row.status === 'ok').length,
            next     = rows.find(row => row.status !== 'ok') ?? null,
            blocking = rows.find(row => row.status === 'failed' || row.status === 'reconcile-required') ?? null;

        return {ok, total: rows.length, next: next?.id ?? null, blocking: blocking?.id ?? null}
    }
}

export default Neo.setupClass(SetupSteps);
