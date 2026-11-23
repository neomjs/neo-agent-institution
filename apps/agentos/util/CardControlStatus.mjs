import Base                from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import SeatCredential      from './SeatCredential.mjs';
import SeatDependencies    from './SeatDependencies.mjs';
import SeatGitIdentity     from './SeatGitIdentity.mjs';
import SeatLaunchAdmission from './SeatLaunchAdmission.mjs';
import SeatModel           from './SeatModel.mjs';
import SeatSessionFolder   from './SeatSessionFolder.mjs';

/**
 * @summary Pure resolver for `AgentOS.view.fleet.roster.card.Container`'s `control-status` row and
 * restart tooltip, keeping one priority ladder across Start round-trips, session-folder checks, model
 * refusals, credential refusals / 7-day token expiry warnings, unplanned exits, launch admission,
 * and dependency preparation.
 *
 * Extracted along the card's status-row responsibility seam so `roster/card/Container.mjs` stays focused
 * on card rendering well below the 1,000-line app file budget.
 *
 * @class AgentOS.util.CardControlStatus
 * @extends Neo.core.Base
 */
class CardControlStatus extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.CardControlStatus'
         * @protected
         */
        className: 'AgentOS.util.CardControlStatus'
    }

    /**
     * @summary Compute the roster card's `control-status` presentation and admission aging target.
     * @param {Object}      input
     * @param {Object}      input.record
     * @param {String}      input.recordState
     * @param {Object}      input.resolved
     * @param {Object}      input.sources
     * @param {String|null} input.rosterState
     * @param {Boolean}     input.disabled
     * @param {String|null} input.pendingAction
     * @param {Object|null} input.controlReason
     * @param {Object|null} input.preparation
     * @param {String|null} input.cancel
     * @param {Object|null} input.exitLine
     * @param {Number}      input.now
     * @returns {{admissionUntil: Number|null, restartTitle: String|null, live: Boolean, cls: String[], hidden: Boolean, text: String, title: String|null}}
     */
    static resolve({
        record,
        recordState,
        resolved,
        sources,
        rosterState,
        disabled,
        pendingAction,
        controlReason,
        preparation,
        cancel,
        exitLine,
        now
    }) {
        const
            wrongFolder       = record.sessionFolder?.state === 'wrong',
            sessionLine       = wrongFolder || !(pendingAction || controlReason || preparation)
                ? SeatSessionFolder.cardLine(record.sessionFolder)
                : null,
            modelRefusal      = !pendingAction && !preparation && !wrongFolder
                ? SeatModel.refusal(record.seatModel, controlReason)
                : null,
            credentialStart   = !pendingAction && !preparation && !wrongFolder && !modelRefusal &&
                SeatCredential.isStartCredentialRefusal(controlReason)
                ? SeatCredential.cardLine(record, {now})
                : null,
            credentialPassive = !pendingAction && !preparation && !wrongFolder && !controlReason
                ? SeatCredential.cardLine(record, {now})
                : null,
            admissionLine     = recordState !== 'off' && !(pendingAction || controlReason || wrongFolder || modelRefusal || credentialPassive)
                ? SeatLaunchAdmission.cardLine(record.launchAdmission, {
                    now,
                    canRestart : !disabled && recordState !== 'off',
                    mcpSettings: record.mcpSettings,
                    rosterState,
                    runtime    : sources.runtime
                })
                : null,
            skillsLine        = resolved.state !== 'off' &&
                !(pendingAction || controlReason || wrongFolder || modelRefusal || credentialPassive || admissionLine || sessionLine)
                ? SeatDependencies.cardLine(record.dependencyOutcomes, record.repoSlug)
                : null,
            credentialLine    = credentialStart ?? credentialPassive,
            live              = Boolean(
                pendingAction || controlReason || preparation || sessionLine || modelRefusal ||
                credentialPassive || admissionLine || skillsLine || exitLine
            ),
            text              = wrongFolder
                ? sessionLine.text
                : cancel
                    ? cancel === 'sent' ? 'canceling start…' : 'canceling start… no answer yet'
                    : preparation
                        ? `${pendingAction === 'restart' ? 'restart' : 'start'}… ${preparation.text}`
                        : pendingAction
                            ? `${pendingAction}…`
                            : modelRefusal
                                ? modelRefusal.text
                                : credentialStart
                                    ? credentialStart.text
                                    : !controlReason
                                        ? credentialPassive?.text ?? exitLine?.text ?? admissionLine?.text ?? sessionLine?.text ?? skillsLine?.text ?? ''
                                        : controlReason.kind === 'timeout'
                                            ? `${controlReason.action}… no answer yet`
                                            : controlReason.kind === 'cleanup'
                                                ? `⚠ cleanup: ${controlReason.reason} — Start re-checks it`
                                                : `⚠ ${controlReason.kind}: ${controlReason.reason}`,
            timeoutTitle      = !wrongFolder && !pendingAction && !preparation && !modelRefusal && controlReason?.kind === 'timeout'
                ? `${text}. The outcome is unknown until the Fleet answers.`
                : null,
            identityNote      = controlReason && !pendingAction && SeatGitIdentity.needsRepair(record.gitIdentity)
                ? ` · The last start's commit identity: ${SeatGitIdentity.describe(record.gitIdentity)} Repair it in Detail › Configuration.`
                : '',
            title             = timeoutTitle || (cancel
                ? cancel === 'sent'
                    ? 'Cancel requested: the Fleet stops the installs and does not launch the seat.'
                    : 'Cancel requested, and the Fleet has not answered yet while the Start still prepares. Its answer settles the card.'
                : preparation
                    ? preparation.title
                    : modelRefusal
                        ? modelRefusal.title + identityNote
                        : credentialStart
                            ? credentialStart.title + identityNote
                            : (!controlReason ? credentialPassive?.title ?? exitLine?.title : null) ??
                              admissionLine?.title ??
                              sessionLine?.title ??
                              skillsLine?.title ??
                              (text ? text + identityNote : null)),
            cls               = [
                'fm-card-control-status',
                ...(sessionLine ? [`is-session-${record.sessionFolder.state}`] : []),
                ...(modelRefusal ? ['is-model-refused'] : []),
                ...(credentialLine ? [`is-credential-${credentialLine.state}`] : []),
                ...(exitLine && !controlReason && !wrongFolder && !modelRefusal && !credentialPassive ? [`is-exit-${exitLine.state}`] : [])
            ];

        return {
            admissionUntil: admissionLine?.until ?? null,
            restartTitle  : admissionLine?.restart ? admissionLine.title : null,
            live,
            cls,
            hidden        : !live,
            text,
            title
        }
    }
}

export default Neo.setupClass(CardControlStatus);
