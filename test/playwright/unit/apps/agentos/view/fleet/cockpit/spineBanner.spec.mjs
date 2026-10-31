import {setup} from '../../../../../../setup.mjs';

setup({appConfig: {name: 'FleetSpineBannerTest'}});

import {test, expect}                             from '@playwright/test';
import Neo                                        from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                                  from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import FleetAdmission                             from '../../../../../../../../apps/agentos/util/FleetAdmission.mjs';
import PlaneVerdict                               from '../../../../../../../../apps/agentos/util/PlaneVerdict.mjs';
import SpineBanner                                from '../../../../../../../../apps/agentos/util/SpineBanner.mjs';
import {bootFailureCause, RETRYABLE_BOOT_REFUSALS} from '../../../../../../../../harness/brain.mjs';

/**
 * The full derivation matrix for the cockpit's per-SPINE honesty pill: a cold GRID (no source has
 * answered the roster) beats daemon faults beats `stale` on either surface (reachable but
 * degraded) beats a cold STREAM under a live roster (feed pending — the surface partition: a
 * verdict may only speak for the surface that produced it) beats `live`; ONLY the fully
 * live spine hides the pill (nominal earns zero pixels).
 *
 * Channel contract: `text` is the pill's STATUS WORD — chrome labels are never sentences —
 * while `title` carries the full honesty sentence (cause AND remedy) and `ariaLabel` mirrors it
 * for screen readers. Every sentence-doctrine witness below therefore reads `title`; the word
 * witnesses read `text`; the aria mirror is pinned once and spot-checked per family.
 * The slot-sync consumer is witnessed directly in fleetCockpit.spec.mjs against a recording
 * banner slot.
 */
test.describe('fleet/spineBanner — the per-spine honesty derivation', () => {

    const STATES = ['cold', 'stale', 'live'];

    test('partial activity names missing and available sources from guidance, falls back honestly, and offers Recheck without claiming stale data', () => {
        const fallback = SpineBanner.deriveSpineBanner({
            grid: {state: 'live'}, stream: {state: 'partial', reason: 'pr-lane: unavailable'}
        });
        expect(fallback).toEqual({
            action   : 'recheck',
            ariaLabel: 'Activity feed partial — some sources unavailable · pr-lane: unavailable',
            hidden   : false,
            kind     : 'degraded',
            lead     : 'Activity feed partial — some sources unavailable',
            text     : 'feed partial',
            title    : 'Activity feed partial — some sources unavailable · pr-lane: unavailable'
        });

        const guided = SpineBanner.deriveSpineBanner({
            grid  : {state: 'live'},
            stream: {
                state   : 'partial',
                reason  : 'pr-lane: neo: ENOENT',
                guidance: {summary: 'PR lanes unavailable · mailbox available', reason: 'pr-lane: neo: ENOENT'}
            }
        });
        expect(guided).toEqual({
            action   : 'recheck',
            ariaLabel: 'Activity feed partial — PR lanes unavailable · mailbox available · pr-lane: neo: ENOENT',
            hidden   : false,
            kind     : 'degraded',
            lead     : 'Activity feed partial — PR lanes unavailable · mailbox available',
            text     : 'feed partial',
            title    : 'Activity feed partial — PR lanes unavailable · mailbox available · pr-lane: neo: ENOENT'
        });
        expect(guided.title).not.toContain('last-known');
        expect(guided.title).not.toContain('complete');
        expect(SpineBanner.deriveSpineBanner({grid: {state: 'cold'}, stream: {state: 'partial'}}).kind).toBe('cold');
        expect(SpineBanner.deriveSpineBanner({grid: {state: 'stale'}, stream: {state: 'partial'}}).text).toBe('fleet degraded');
    });

    test('FleetAdmission.deriveActivityGuidance covers reserved keys, 32-char unknown labels, malformed slots, producer.coverage, sanitized reasons, and intervalMs cadence', () => {
        // (a) reserved keys (__proto__, constructor) in slots -> generic summary and head
        const protoSlots = Object.defineProperty({}, '__proto__', {
            configurable: true, enumerable: true, value: {state: 'degraded'}, writable: true
        });
        for (const slots of [protoSlots, {constructor: {state: 'degraded'}}, {prototype: {state: 'wired'}}]) {
            const res = FleetAdmission.deriveActivityGuidance({partial: true, capability: {slots}});
            expect(res.head).toBe('partial — some sources unavailable');
            expect(res.summary).toBe('some sources unavailable');
            expect(res.remaining).toBeNull();
        }
        expect(FleetAdmission.formatActivitySlotLabel('__proto__')).toBe('');
        expect(FleetAdmission.formatActivitySlotLabel('constructor')).toBe('');

        // (b) unknown slot key -> its key bounded to 32 characters as the label
        const longKey = 'custom-telemetry-source-name-exceeding-thirty-two-chars',
              bounded = longKey.slice(0, 32),
              unknown = FleetAdmission.deriveActivityGuidance({
                  partial   : true,
                  capability: {slots: {[longKey]: {state: 'unavailable'}, a2a: {state: 'wired'}}}
              });
        expect(FleetAdmission.formatActivitySlotLabel(longKey)).toBe(bounded);
        expect(bounded).toHaveLength(32);
        expect(unknown.head).toBe(`partial — ${bounded} unavailable`);
        expect(unknown.summary).toBe(`${bounded} unavailable · mailbox available`);

        // (c) malformed slots (an array, an empty object, a slot with an unknown state) -> generic
        for (const slots of [[{state: 'degraded'}], {}, {a2a: {state: 'mystery'}}, {a2a: null}]) {
            const res = FleetAdmission.deriveActivityGuidance({partial: true, capability: {slots}});
            expect(res.head).toBe('partial — some sources unavailable');
            expect(res.summary).toBe('some sources unavailable');
            expect(res.remaining).toBeNull();
        }

        // (d) degraded slot with producer.coverage: 'partial' -> partial; same slot with no coverage and no events -> unavailable
        expect(FleetAdmission.slotSuppliedEvents('pr-lane', {state: 'degraded', producer: {coverage: 'partial'}}, [])).toBe(true);
        expect(FleetAdmission.slotSuppliedEvents('pr-lane', {state: 'degraded'}, [])).toBe(false);

        const withCoverage = FleetAdmission.deriveActivityGuidance({
            partial   : true,
            capability: {slots: {'pr-lane': {state: 'degraded', producer: {coverage: 'partial'}}, a2a: {state: 'wired'}}},
            events    : []
        });
        expect(withCoverage.head).toBe('partial — PR lanes partial');
        expect(withCoverage.summary).toBe('PR lanes partial · mailbox available');

        const withoutCoverage = FleetAdmission.deriveActivityGuidance({
            partial   : true,
            capability: {slots: {'pr-lane': {state: 'degraded'}, a2a: {state: 'wired'}}},
            events    : []
        });
        expect(withoutCoverage.head).toBe('partial — PR lanes unavailable');
        expect(withoutCoverage.summary).toBe('PR lanes unavailable · mailbox available');

        // (e) composite reason preferred over per-slot reasons, both through the sanitizer
        const sanitize = value => typeof value === 'string'
            ? value.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim().slice(0, 240) || null
            : null;
        const compositePreferred = FleetAdmission.deriveActivityGuidance({
            partial       : true,
            reason        : 'composite\u0007\n\ttimeout',
            capability    : {slots: {'pr-lane': {state: 'degraded', reason: 'slot-reason'}}},
            sanitizeReason: sanitize
        });
        expect(compositePreferred.reason).toBe('composite timeout');

        const slotFallback = FleetAdmission.deriveActivityGuidance({
            partial       : true,
            reason        : '   ',
            capability    : {slots: {'pr-lane': {state: 'degraded', reason: 'neo:\u0000\r\nENOENT'}, a2a: {state: 'wired'}}},
            sanitizeReason: sanitize
        });
        expect(slotFallback.reason).toBe('pr-lane: neo: ENOENT');

        // (f) intervalMs -> "rechecks every N s"
        const customCadence = FleetAdmission.deriveActivityGuidance({
            partial   : true,
            intervalMs: 30000,
            capability: {slots: {'pr-lane': {state: 'unavailable'}, a2a: {state: 'wired'}}}
        });
        expect(customCadence.recheck).toBe('rechecks every 30 s');
        expect(customCadence.headTitle).toBe('rechecks every 30 s · Recheck now is in the banner · no direct producer repair here');
    });

    const HIDDEN_LIVE = {action: null, hidden: true, kind: 'live', lead: '', text: '', title: '', ariaLabel: ''};

    test.describe('connection observations belong to the deciding read', () => {
        const cases = [
            ['connecting', 'connecting'], ['refused', 'refused'], ['unreachable', 'unreachable'],
            ['timeout', 'timed out'], ['failed-upstream', 'failed']
        ];

        for (const [state, word] of cases) {
            test(`${state} distinguishes cold roster and last-known activity without a server diagnosis`, () => {
                const connection = {state, reason: 'bounded read detail'},
                      cold = SpineBanner.deriveSpineBanner({grid: {state: 'cold', connection}, stream: {state: 'live'}}),
                      stale = SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'stale', connection}});
                expect(cold.text).toBe(`fleet ${word}`);
                expect(cold.title).toContain('no fleet data yet');
                expect(stale.text).toBe(`feed ${word}`);
                expect(stale.title).toContain('last-known');
                expect(stale.ariaLabel).toBe(stale.title);
                expect(cold.title + stale.title).not.toMatch(/safe to wait|authentication refused|server offline/)
            })
        }

        test('a live sibling cannot relabel the stale surface whose reason decided the verdict', () => {
            const result = SpineBanner.deriveSpineBanner({
                grid: {state: 'live', connection: {state: 'timeout', reason: 'wrong sibling'}},
                stream: {state: 'stale', reason: 'activity source not wired'}
            });
            expect(result.text).toBe('fleet degraded');
            expect(result.title).toContain('activity source not wired');
            expect(result.title).not.toMatch(/timed out|wrong sibling/)
        });

        test('reason selection and connection selection agree when both surfaces are stale', () => {
            const result = SpineBanner.deriveSpineBanner({
                grid: {state: 'stale', reason: 42, connection: {state: 'timeout'}},
                stream: {state: 'stale', reason: 'activity refused', connection: {state: 'refused', reason: 'activity refused'}}
            });
            expect(result.text).toBe('feed refused');
            expect(result.title).toContain('activity refused');
            expect(result.title).not.toContain('timed out')
        });

        test('a pending refresh preserves the retained producer reason; daemon and live precedence stand', () => {
            const connection = {state: 'connecting', reason: null},
                  grid = {state: 'stale', reason: 'source unavailable', connection};
            expect(SpineBanner.deriveSpineBanner({grid, stream: {state: 'live'}}).title).toContain('source unavailable');
            expect(SpineBanner.deriveSpineBanner({grid, stream: {state: 'live'}, daemon: {state: 'stopped'}}).text).toBe('agent os stopped');
            expect(SpineBanner.deriveSpineBanner({grid: {state: 'live', connection}, stream: {state: 'live', connection}})).toEqual(HIDDEN_LIVE)
        });

        test('unknown observation states preserve the ordinary fallback, including prototype names', () => {
            const plain = {grid: {state: 'cold'}, stream: {state: 'live'}};
            for (const state of [null, 'slow', 'toString', 'constructor', 'unknown']) {
                expect(SpineBanner.deriveSpineBanner({...plain, grid: {state: 'cold', connection: {state, reason: 'untrusted'}}}))
                    .toEqual(SpineBanner.deriveSpineBanner(plain))
            }
        })
    });

    test.describe('a plane that refused this shell — the refusal speaks, in the child\'s own words', () => {
        const refused = {cause: 'plane-refused', reason: '[fleet] plane mode refused (http://127.0.0.1:3102): plane identity mismatch', state: 'degraded'};

        test('it names the refusal, quotes the reason, and offers Retry: the plane said nothing against the PAT', () => {
            const verdict = SpineBanner.deriveSpineBanner({
                daemon: refused,
                grid  : {state: 'cold', connection: {state: 'refused', reason: 'fleet: Brain is not ready'}},
                stream: {state: 'cold', connection: {state: 'refused', reason: 'fleet: Brain is not ready'}}
            });

            expect(verdict).toEqual({
                action   : 'retry-plane',
                ariaLabel: 'The plane refused this shell — retry, or connect it again · [fleet] plane mode refused (http://127.0.0.1:3102): plane identity mismatch',
                hidden   : false,
                kind     : 'cold',
                lead     : 'The plane refused this shell — retry, or connect it again',
                text     : 'plane refused',
                title    : 'The plane refused this shell — retry, or connect it again · [fleet] plane mode refused (http://127.0.0.1:3102): plane identity mismatch'
            })
        });

        test('a refusal whose line was withheld still names itself', () => {
            expect(SpineBanner.deriveSpineBanner({daemon: {...refused, reason: null}, grid: {state: 'cold'}, stream: {state: 'cold'}}).title)
                .toBe('The plane refused this shell — retry, or connect it again')
        })
    });

    test.describe('a refusal the shell told apart by asking the plane — the connect card\'s own words', () => {
        const
            cold    = {state: 'cold', connection: {state: 'refused', reason: 'fleet: Brain is not ready'}},
            derive  = cause => SpineBanner.deriveSpineBanner({daemon: {cause, reason: 'http://127.0.0.1:9', state: 'degraded'}, grid: cold, stream: cold}),
            answers = [
                ['plane-unreachable',        'plane unreachable', PlaneVerdict.sentences.unreachable,      'retry-plane'],
                ['plane-credential-refused', 'pat refused',       PlaneVerdict.sentences.rejected,         'connect-plane'],
                ['plane-not-a-plane',        'not a plane',       PlaneVerdict.sentences['not-a-plane'],   'retry-plane']
            ];

        test('each answer leads with the card\'s sentence, names the plane by address, and offers its way back', () => {
            for (const [cause, text, sentence, action] of answers) {
                const verdict = derive(cause);

                expect(verdict, cause).toMatchObject({action, hidden: false, kind: 'cold', text});
                expect(verdict.title.startsWith(sentence), cause).toBe(true);
                expect(verdict.title.endsWith(' · http://127.0.0.1:9'), cause).toBe(true);
                expect(verdict.ariaLabel).toBe(verdict.title)
            }

            expect(derive('plane-identity-changed')).toMatchObject({action: 'connect-plane', kind: 'cold', text: 'account changed'})
        });

        test('none of them passes on the fleet child\'s config advice', () => {
            for (const cause of ['plane-unreachable', 'plane-credential-refused', 'plane-not-a-plane', 'plane-identity-changed']) {
                expect(derive(cause).title, cause).not.toMatch(/fleet\.plane|in-process/)
            }
        });

        test('a cause that only shares a name with an object key is not one of them', () => {
            expect(derive('constructor').text).not.toBe(undefined);
            expect(derive('constructor').action).not.toBe('connect-plane')
        })
    });

    test.describe('Retry or Connect — the way back each boot refusal allows (#849)', () => {
        const
            cold   = {state: 'cold', connection: {state: 'refused', reason: 'fleet: Brain is not ready'}},
            derive = cause => SpineBanner.deriveSpineBanner({daemon: {cause, reason: 'http://127.0.0.1:9', state: 'degraded'}, grid: cold, stream: cold});

        test('every refusal the shell runs again offers Retry, and its lead names both ways back', () => {
            for (const cause of RETRYABLE_BOOT_REFUSALS) {
                const verdict = derive(cause);

                expect(verdict.action, cause).toBe('retry-plane');
                expect(verdict.lead, cause).toMatch(/retry, or connect/i)
            }
        });

        test('the credential\'s own two and a plane beside the shell offer Connect only (AC-2)', () => {
            for (const cause of ['plane-credential-refused', 'plane-identity-changed', 'organism-beside-plane']) {
                const verdict = derive(cause);

                expect(bootFailureCause(Object.assign(new Error('x'), {code: cause})), `${cause} is a boot refusal`).not.toBeNull();
                expect(verdict.action, cause).toBe('connect-plane');
                expect(verdict.lead, cause).not.toMatch(/retry/i)
            }
        })
    });

    test.describe('a PAT the plane refuses while the shell runs — Connect, not Reconnect', () => {
        const
            stale  = {state: 'stale', connection: {state: 'failed-upstream', reason: "fleet: 'fleetRoster' failed"}},
            live   = {state: 'live'},
            derive = (cause, grid = stale) => SpineBanner.deriveSpineBanner({daemon: {state: 'running'}, grid, plane: {cause}, stream: live});

        test('the shell\'s answer speaks the card\'s words over a failed roster read, and offers Connect', () => {
            expect(derive('plane-credential-refused')).toMatchObject({action: 'connect-plane', hidden: false, kind: 'degraded', text: 'pat refused'});
            expect(derive('plane-credential-refused').title.startsWith(PlaneVerdict.sentences.rejected)).toBe(true);
            expect(derive('plane-identity-changed')).toMatchObject({action: 'connect-plane', kind: 'degraded', text: 'account changed'});
            expect(derive('plane-credential-refused', {state: 'cold'}).kind, 'a roster that never answered').toBe('cold')
        });

        test('no answer leaves today\'s verdict and its Reconnect', () => {
            const verdict = derive(null);

            expect(verdict.action).toBe(null);
            expect(verdict.text).toBe('fleet failed')
        });

        test('a boot refusal still outranks it', () => {
            expect(SpineBanner.deriveSpineBanner({
                daemon: {cause: 'plane-unreachable', reason: 'http://127.0.0.1:9', state: 'degraded'},
                grid  : stale,
                plane : {cause: 'plane-credential-refused'},
                stream: live
            }).text).toBe('plane unreachable')
        })
    });

    test.describe('a shell beside a running plane — the refusal outranks its own consequences', () => {
        const besidePlane = {cause: 'organism-beside-plane', reason: 'Chroma holds localhost:8000', state: 'degraded'};

        test('it names the running plane and offers Connect over a sample roster the fleet refused', () => {
            const verdict = SpineBanner.deriveSpineBanner({
                daemon: besidePlane,
                grid  : {state: 'cold', connection: {state: 'refused', reason: 'fleet: Brain is not ready'}},
                stream: {state: 'cold', connection: {state: 'refused', reason: 'fleet: Brain is not ready'}}
            });

            expect(verdict).toEqual({
                action   : 'connect-plane',
                ariaLabel: 'A plane already runs on this machine — connect this shell to it · Chroma holds localhost:8000',
                hidden   : false,
                kind     : 'cold',
                lead     : 'A plane already runs on this machine — connect this shell to it',
                text     : 'plane here',
                title    : 'A plane already runs on this machine — connect this shell to it · Chroma holds localhost:8000'
            })
        });

        test('CONTROL: any other daemon cause keeps its verdict and the reconnect action', () => {
            const verdict = SpineBanner.deriveSpineBanner({
                daemon: {cause: 'boot-not-ready', reason: 'boot-not-ready', state: 'degraded'},
                grid  : {state: 'cold', connection: {state: 'refused', reason: 'fleet: Brain is not ready'}},
                stream: {state: 'cold'}
            });

            expect(verdict.action).toBeNull();
            expect(verdict.text).not.toBe('plane here')
        })
    });

    // ⭐ The daemon surface: the shell spec's "tray-state change + ONE cockpit banner with the
    // diagnosis pointer — never a popup storm". The storm clause is a property of EPISODES, not
    // renders, so it is asserted as such below rather than assumed from the return type.
    test.describe('⭐ daemon health — ONE banner per episode, ranked above a stale feed', () => {
        const live = {grid: {state: 'live'}, stream: {state: 'live'}};

        test('a stopped and a degraded daemon each speak, and `running` stays silent', () => {
            // `running` must earn zero pixels like every other nominal state.
            expect(SpineBanner.deriveSpineBanner({...live, daemon: {state: 'running'}})).toEqual(HIDDEN_LIVE);

            for (const state of ['degraded', 'stopped']) {
                const result = SpineBanner.deriveSpineBanner({...live, daemon: {state}});

                expect(result.hidden, state).toBe(false);
                expect(result.kind, state).toBe('degraded');
                // The two are different operator situations, so the PILL WORD distinguishes them —
                // not just the class — and the full sentence repeats the distinction on title/aria
                // (a screen reader reaches the aria mirror, never a colour or a hover).
                expect(result.text, state).toBe(`agent os ${state === 'stopped' ? 'stopped' : 'degraded'}`);
                expect(result.title, state).toContain(state === 'stopped' ? 'stopped' : 'degraded');
                expect(result.ariaLabel, state).toBe(result.title)
            }
        });

        test('⭐ daemon silence renders NOTHING and does not claim health', () => {
            // Absence is UNKNOWN, not nominal. Inventing a degradation from missing information is a
            // false alarm; claiming health from it is the fabrication. Both are wrong, so it stays
            // quiet — and the transport line already speaks when the server is silent.
            for (const daemon of [undefined, null, {}, {state: null}, {state: 'unknown'}, {state: ''}]) {
                const result = SpineBanner.deriveSpineBanner({...live, daemon});

                expect(result.hidden, JSON.stringify(daemon)).toBe(true);
                expect(result.text, JSON.stringify(daemon)).toBe('');
                expect(result.title, JSON.stringify(daemon)).toBe('')
            }
        });

        test('⭐ a dead daemon OUTRANKS a stale feed — the diagnosis, not the symptom', () => {
            // A dead daemon is usually what made the feed stale. Reporting the feed alone would name
            // the symptom and drop the pointer the spec asks for.
            const result = SpineBanner.deriveSpineBanner({
                grid  : {state: 'stale', reason: 'feed went quiet'},
                stream: {state: 'stale'},
                daemon: {state: 'stopped', reason: 'orchestrator exited'}
            });

            expect(result.text).toBe('agent os stopped');
            expect(result.title).toContain('orchestrator exited');
            expect(result.title).not.toContain('last-known data');
            // Control: remove the daemon fault and the SAME input must fall back to the stale line,
            // which is what proves the daemon branch is doing the ranking rather than the text.
            expect(SpineBanner.deriveSpineBanner({
                grid: {state: 'stale', reason: 'feed went quiet'}, stream: {state: 'stale'}
            }).title).toContain('last-known data')
        });

        test('an unreachable transport still wins — it cannot have answered a daemon pull', () => {
            const result = SpineBanner.deriveSpineBanner({
                grid: {state: 'cold'}, stream: {state: 'live'}, daemon: {state: 'stopped'}
            });

            expect(result.kind).toBe('cold');
            expect(result.text).toBe('fleet offline');
            expect(result.title).toContain('Fleet server offline')
        });

        test('⭐ N daemons down in ONE episode yield ONE banner — the storm clause, asserted', () => {
            // The spec's "never a popup storm" is about episodes. The derivation is total and returns
            // exactly one pill whatever the fault breadth, so the storm is unrepresentable rather than
            // debounced — and a caller cannot turn three dead daemons into three banners.
            const episode = SpineBanner.deriveSpineBanner({
                ...live,
                daemon: {state: 'stopped', reason: 'orchestrator, fleet and chroma all exited'}
            });

            expect(Array.isArray(episode)).toBe(false);
            expect(Object.keys(episode).sort()).toEqual(['action', 'ariaLabel', 'hidden', 'kind', 'lead', 'text', 'title']);
            expect(episode.title.match(/Agent OS/g)).toHaveLength(1);

            // And it is IDEMPOTENT across re-derivation: a polling consumer re-deriving the same
            // episode produces an identical pill, so nothing accumulates per poll.
            expect(SpineBanner.deriveSpineBanner({...live, daemon: {state: 'stopped', reason: 'orchestrator, fleet and chroma all exited'}}))
                .toEqual(episode)
        });

        test('a daemon reason cannot be supplied OR silenced by a transport sibling', () => {
            // The module's per-surface-reason doctrine, applied to the new surface: a `stale` grid
            // carrying a reason must not lend it to the daemon line.
            const result = SpineBanner.deriveSpineBanner({
                grid  : {state: 'stale', reason: 'grid-owned cause'},
                stream: {state: 'live'},
                daemon: {state: 'degraded'}
            });

            expect(result.title).not.toContain('grid-owned cause');
            expect(result.title).toContain('check the tray state and the daemon log')
        });
    });

    test('the full 3×3 matrix: only a cold GRID is cold; stale beats a pending stream; only live+live hides', () => {
        // The surface partition: the cold family makes server claims, so only a cold GRID
        // may enter it. A cold STREAM under a live grid is the stream's own degraded verdict; a
        // stale grid outranks it (last-known roster data is the operator-actionable fact).
        for (const gridAdapterState of STATES) {
            for (const streamAdapterState of STATES) {
                const result     = SpineBanner.deriveSpineBanner({grid: {state: gridAdapterState}, stream: {state: streamAdapterState}}),
                      gridCold   = gridAdapterState === 'cold',
                      anyStale   = gridAdapterState === 'stale' || streamAdapterState === 'stale',
                      streamCold = streamAdapterState === 'cold',
                      expected   = gridCold ? 'cold' : anyStale ? 'degraded' : streamCold ? 'degraded' : 'live';

                expect(result.kind, `${gridAdapterState}×${streamAdapterState}`).toBe(expected);
                expect(result.hidden, `${gridAdapterState}×${streamAdapterState}`).toBe(expected === 'live')
            }
        }
    });

    test('cold with NO retained reason: the pill says the word, the TITLE names cause AND a remedy that EXISTS at this head', () => {
        const {text, title, ariaLabel} = SpineBanner.deriveSpineBanner({grid: {state: 'cold'}, stream: {state: 'live'}});

        expect(text).toBe('fleet offline');
        expect(title).toContain('Fleet server offline');
        expect(title).not.toContain('static roster');
        expect(title).toContain('neo-agent-brain checkout');
        // the sentence must never leak into the visible chrome label, and the aria mirror must
        // carry it — the two halves of the label-content law
        expect(text).not.toContain('—');
        expect(ariaLabel).toBe(title)
    });

    test('⭐ a pending stream under a LIVE grid speaks for the STREAM — never a roster or server claim', () => {
        // The lie class, third instance closed: the first fix (retained reasons) stopped "start a
        // running server"; the copy still said "showing the static roster" over a roster that was
        // provably LIVE — and the REASONLESS variant shipped the full "Fleet server offline" lie,
        // observed live 2026-08-10 over a wire-fed 9-agent roster with real presence bands while
        // the stream was honestly cold. The partition makes the misclaim unrepresentable:
        // only a cold GRID reaches the cold family; the stream's verdict names the stream, and
        // states the roster fact that falsified the old copy.
        const reasoned = SpineBanner.deriveSpineBanner({
            grid  : {state: 'live'},
            stream: {state: 'cold', reason: 'fleet activity source not wired'}
        });

        expect(reasoned.kind).toBe('degraded');
        expect(reasoned.text).toBe('feed pending');
        expect(reasoned.title).toContain('Activity feed pending');
        expect(reasoned.title).toContain('roster is live');
        expect(reasoned.title).toContain('fleet activity source not wired');
        expect(reasoned.title).not.toContain('no fleet data yet');
        expect(reasoned.title).not.toContain('Fleet server offline');
        expect(reasoned.title).not.toContain('npm run ai:fleet-server');

        // The reasonless variant — the exact live rendering that once lied — must carry the same
        // honesty without a cause to lean on.
        const bare = SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'cold'}});

        expect(bare.kind).toBe('degraded');
        expect(bare.text).toBe('feed pending');
        expect(bare.title).toBe('Activity feed pending — roster is live')
    });

    test('⭐ ranking around the pending stream: a dead daemon outranks it; a stale grid outranks it', () => {
        // Diagnosis over symptom (a dead daemon is usually why a feed never went live), and the
        // stale ROSTER is the operator-actionable fact when both are degraded — the stream-pending
        // pill only ever renders over a roster that is provably live.
        const daemonWins = SpineBanner.deriveSpineBanner({
            grid  : {state: 'live'},
            stream: {state: 'cold'},
            daemon: {state: 'stopped', reason: 'orchestrator exited'}
        });

        expect(daemonWins.title).toContain('orchestrator exited');
        expect(daemonWins.title).not.toContain('Activity feed pending');

        const staleWins = SpineBanner.deriveSpineBanner({
            grid  : {state: 'stale', reason: 'poll timed out'},
            stream: {state: 'cold'}
        });

        expect(staleWins.text).toBe('fleet degraded');
        expect(staleWins.title).toContain('last-known data');
        expect(staleWins.title).toContain('poll timed out');
        expect(staleWins.title).not.toContain('Activity feed pending');
        expect(staleWins.title).not.toContain('no fleet data yet')
    });

    test('cold falls back to the generic copy for silence — the only state that implies an offline server', () => {
        // The guard against over-correcting: a torn/absent answer teaches the owner NOTHING, so there
        // is no reason to name and the generic remedy is the honest guess. An empty-ish reason must
        // not sneak through as a "cause" either.
        ['', '   ', null, undefined].forEach(degradedReason => {
            const {text, title} = SpineBanner.deriveSpineBanner({grid: {state: 'cold', reason: degradedReason}, stream: {state: 'live'}});

            expect(text, JSON.stringify(degradedReason)).toBe('fleet offline');
            expect(title, JSON.stringify(degradedReason)).toContain('Fleet server offline')
        })
    });

    test('degraded names the honest data state', () => {
        const {text, title} = SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'stale'}});

        expect(text).toBe('fleet degraded');
        expect(title).toContain('degraded');
        expect(title).toContain('last-known')
    });

    test('a fully live spine renders NOTHING — zero nominal pixels', () => {
        const result = SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'live'}});

        expect(result).toEqual(HIDDEN_LIVE)
    });

    // ⭐ The topology-owned cold fallback: generic manual-start advice
    // advice was actively wrong inside the shell — the shell SELF-SUPPLIES its transport, so that
    // advice CAUSES the foreign-listener refusal it then mislabels as "offline". The shell's boot
    // fact (riding the brain-health wire) picks the honest WORD and LINE for SILENCE; a retained
    // surface reason still outranks any topology guess; the plain browser (no fact) keeps the
    // classic copy.
    test.describe('⭐ transport-aware cold fallback — the shell fact picks the honest line', () => {
        const coldSpine = {grid: {state: 'cold'}, stream: {state: 'live'}};

        test('no shell fact (plain browser, or an unreachable shell) keeps the classic offline copy', () => {
            for (const transport of [undefined, null]) {
                const {text, title} = SpineBanner.deriveSpineBanner({...coldSpine, transport});

                expect(text, JSON.stringify(transport)).toBe('fleet offline');
                expect(title, JSON.stringify(transport)).toContain('Fleet server offline');
                expect(title, JSON.stringify(transport)).toContain('neo-agent-brain checkout')
            }
        });

        test('a boot in flight names itself — and never advises a manual start', () => {
            const {kind, text, title} = SpineBanner.deriveSpineBanner({...coldSpine, transport: {phase: 'starting'}});

            expect(kind).toBe('cold');
            expect(text).toBe('fleet starting');
            expect(title).toContain('Fleet transport starting');
            expect(title).not.toContain('npm run ai:fleet-server')
        });

        test('foreign-listener renders the named refusal, the port, and the Reconnect remedy', () => {
            // The exact case the old copy inverted: "start it" is what CREATES this state.
            const {text, title} = SpineBanner.deriveSpineBanner({...coldSpine, transport: {
                fleetPort: 8083, mode: 'foreign-listener', phase: 'settled', reason: 'viewer mismatch on the reuse probe', up: false
            }});

            expect(text).toBe('fleet blocked');
            expect(title).toContain('another fleet server holds port 8083');
            expect(title).toContain('quit it, then Reconnect');
            expect(title).toContain('viewer mismatch on the reuse probe');
            expect(title).not.toContain('npm run ai:fleet-server')
        });

        test('foreign-listener without a carried reason falls back to the generic refusal line', () => {
            const {text, title} = SpineBanner.deriveSpineBanner({...coldSpine, transport: {fleetPort: 8083, mode: 'foreign-listener', phase: 'settled', up: false}});

            expect(text).toBe('fleet blocked');
            expect(title).toContain('another fleet server holds port 8083');
            expect(title).toContain('listener did not prove canonical Fleet identity')
        });

        test('a settled failed boot names the failure — with and without an error detail', () => {
            const withDetail = SpineBanner.deriveSpineBanner({...coldSpine, transport: {mode: 'spawn', phase: 'settled', up: false, error: 'fleet readiness timed out'}}),
                  bareFail   = SpineBanner.deriveSpineBanner({...coldSpine, transport: {mode: 'spawn', phase: 'settled', up: false}});

            expect(withDetail.text).toBe('fleet failed');
            expect(withDetail.title).toContain('Fleet transport failed to start');
            expect(withDetail.title).toContain('fleet readiness timed out');
            expect(bareFail.text).toBe('fleet failed');
            expect(bareFail.title).toContain('Fleet transport failed to start');
            expect(bareFail.title).not.toContain('npm run ai:fleet-server')
        });

        test('a ready transport with cold surfaces points at Reconnect — the server just answered', () => {
            for (const mode of ['spawn', 'reuse']) {
                const {text, title} = SpineBanner.deriveSpineBanner({...coldSpine, transport: {fleetPort: 8083, mode, phase: 'settled', up: true}});

                expect(text, mode).toBe('fleet connecting');
                expect(title, mode).toContain('Fleet transport ready');
                expect(title, mode).toContain('Reconnect');
                expect(title, mode).not.toContain('npm run ai:fleet-server')
            }
        });

        test('⭐ a retained surface reason OUTRANKS the fact — the producer spoke, the topology only guesses', () => {
            // A retained producer cause must win over any transport-derived guess: what the
            // producer SAID beats what the boot implies.
            const {text, title} = SpineBanner.deriveSpineBanner({
                grid     : {state: 'cold', reason: 'roster source not wired'},
                stream   : {state: 'live'},
                transport: {mode: 'foreign-listener', phase: 'settled', up: false}
            });

            expect(text).toBe('fleet offline');
            expect(title).toContain('Fleet data unavailable');
            expect(title).toContain('roster source not wired');
            expect(title).not.toContain('another fleet server holds')
        });

        test('the fact never reaches non-cold branches: stale, daemon, stream-pending and live verdicts ignore it', () => {
            const transport = {mode: 'foreign-listener', phase: 'settled', up: false};

            expect(SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'stale'}, transport}).title).toContain('last-known');
            expect(SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'live'}, daemon: {state: 'stopped'}, transport}).title).toContain('Agent OS stopped');
            expect(SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'cold'}, transport}).title).toBe('Activity feed pending — roster is live');
            expect(SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'live'}, transport})).toEqual(HIDDEN_LIVE)
        })
    });

    test.describe('the lead — the reason the bar shows beside the pill, never only on hover', () => {
        // a retained cause that must stay on title and aria: an endpoint, an error class, a config leaf
        const CAUSE     = '[fleet] plane mode refused (http://127.0.0.1:3102): TypeError — fix fleet.planeBase',
              FORBIDDEN = /\d{1,3}(\.\d{1,3}){3}:\d+|localhost:\d+|npm run|TypeError|fleet\.planeBase/;

        const branches = {
            'organism beside a plane': {daemon: {cause: 'organism-beside-plane', reason: CAUSE}, grid: {state: 'cold'}, stream: {state: 'cold'}},
            'plane refused the shell': {daemon: {cause: 'plane-refused', reason: CAUSE}, grid: {state: 'cold'}, stream: {state: 'cold'}},
            'boot refusal'           : {daemon: {cause: 'plane-credential-refused', reason: CAUSE}, grid: {state: 'cold'}, stream: {state: 'cold'}},
            'runtime refusal'        : {grid: {state: 'stale', reason: CAUSE}, plane: {cause: 'plane-identity-changed'}, stream: {state: 'live'}},
            'cold with a cause'      : {grid: {state: 'cold', reason: CAUSE}, stream: {state: 'cold'}},
            'cold read refused'      : {grid: {state: 'cold', connection: {state: 'refused', reason: CAUSE}}, stream: {state: 'cold'}},
            'cold, transport failed' : {grid: {state: 'cold'}, stream: {state: 'cold'}, transport: {phase: 'settled', up: false, error: CAUSE}},
            'daemon down'            : {daemon: {state: 'stopped', reason: CAUSE}, grid: {state: 'live'}, stream: {state: 'live'}},
            'stale feed'             : {grid: {state: 'stale', reason: CAUSE}, stream: {state: 'live'}},
            'partial feed'           : {grid: {state: 'live'}, stream: {state: 'partial', reason: CAUSE}},
            'pending feed'           : {grid: {state: 'live'}, stream: {state: 'cold', reason: CAUSE}}
        };

        for (const [name, input] of Object.entries(branches)) {
            test(`${name}: the lead is product words, and the title adds the cause to it`, () => {
                const verdict = SpineBanner.deriveSpineBanner(input);

                expect(verdict.hidden).toBe(false);
                expect(verdict.lead.length, 'a non-live state always has a lead').toBeGreaterThan(0);
                expect(verdict.lead, 'no endpoint, error class, config leaf or command reaches the visible line').not.toMatch(FORBIDDEN);
                expect(verdict.title.startsWith(verdict.lead)).toBe(true);
                expect(verdict.ariaLabel).toBe(verdict.title)
            })
        }

        test('every refusal leads with the connect card\'s own words, at boot and while the shell runs', () => {
            const words = {
                'plane-credential-refused': PlaneVerdict.sentences.rejected,
                'plane-not-a-plane'       : PlaneVerdict.sentences['not-a-plane'],
                'plane-unreachable'       : PlaneVerdict.sentences.unreachable
            };

            for (const [cause, sentence] of Object.entries(words)) {
                expect(SpineBanner.deriveSpineBanner({daemon: {cause, reason: CAUSE}, grid: {state: 'cold'}, stream: {state: 'cold'}}).lead.startsWith(sentence), cause).toBe(true);
                expect(SpineBanner.deriveSpineBanner({grid: {state: 'cold'}, plane: {cause}, stream: {state: 'cold'}}).lead.startsWith(sentence), `${cause} at runtime`).toBe(true)
            }

            expect(SpineBanner.deriveSpineBanner({daemon: {cause: 'plane-identity-changed'}, grid: {state: 'cold'}, stream: {state: 'cold'}}).lead)
                .toBe('The plane now names that PAT as another account. Connect again to confirm it.')
        });

        test('a live spine has no lead', () => {
            expect(SpineBanner.deriveSpineBanner({grid: {state: 'live'}, stream: {state: 'live'}}).lead).toBe('')
        });

        test('fleet-starting (#739): names a Fleet still starting past its readiness window with elapsed wait and >=60s guidance', () => {
            const at23s = SpineBanner.deriveSpineBanner({
                grid     : {state: 'cold', connection: {state: 'timeout', reason: 'read timed out'}},
                stream   : {state: 'cold'},
                transport: {elapsedMs: 23_900, phase: 'starting', reason: 'fleet-starting', since: 1_000}
            });

            expect(at23s).toEqual({
                action   : null,
                ariaLabel: 'The Fleet is still starting. The roster appears when it answers.',
                hidden   : false,
                kind     : 'cold',
                lead     : 'The Fleet is still starting. The roster appears when it answers.',
                text     : 'Fleet starting · 23 s',
                title    : 'The Fleet is still starting. The roster appears when it answers.'
            });

            const at64s = SpineBanner.deriveSpineBanner({
                grid     : {state: 'cold', connection: {state: 'timeout', reason: 'read timed out'}},
                stream   : {state: 'cold'},
                transport: {elapsedMs: 64_200, phase: 'starting', reason: 'fleet-starting', since: 1_000}
            });

            expect(at64s.text).toBe('Fleet starting · 64 s');
            expect(at64s.lead).toBe('The Fleet is still starting. The roster appears when it answers. Longer than usual.');
            expect(at64s.title).toBe(at64s.lead);
            expect(at64s.action).toBeNull();
            expect(at64s.kind).toBe('cold')
        });

        test('plane-starting (#735 AC-3): names Agent OS starting with elapsed wait and >=60s guidance while outranking cold connection timeout', () => {
            const at24s = SpineBanner.deriveSpineBanner({
                grid     : {state: 'cold', connection: {state: 'timeout', reason: 'read timed out'}},
                stream   : {state: 'cold'},
                transport: {elapsedMs: 24_100, phase: 'starting', reason: 'plane-starting', since: 1_000}
            });

            expect(at24s).toEqual({
                action   : null,
                ariaLabel: 'Your Agent OS has not answered yet. The Fleet joins by itself when it does.',
                hidden   : false,
                kind     : 'cold',
                lead     : 'Your Agent OS has not answered yet. The Fleet joins by itself when it does.',
                text     : 'Agent OS starting · 24 s',
                title    : 'Your Agent OS has not answered yet. The Fleet joins by itself when it does.'
            });

            const at60s = SpineBanner.deriveSpineBanner({
                grid     : {state: 'cold', connection: {state: 'connecting'}},
                stream   : {state: 'cold'},
                transport: {elapsedMs: 60_000, phase: 'starting', reason: 'plane-starting', since: 1_000}
            });

            expect(at60s.text).toBe('Agent OS starting · 60 s');
            expect(at60s.lead).toBe('Your Agent OS has not answered yet. The Fleet joins by itself when it does. Longer than usual.');
            expect(at60s.title).toBe(at60s.lead);
            expect(at60s.action).toBeNull();
            expect(at60s.kind).toBe('cold')
        });

        test('plane-starting (#847): from three minutes the pill names the action, and the shell still waits', () => {
            const at = elapsedMs => SpineBanner.deriveSpineBanner({
                grid     : {state: 'cold', connection: {state: 'connecting'}},
                stream   : {state: 'cold'},
                transport: {elapsedMs, phase: 'starting', reason: 'plane-starting', since: 1_000}
            });

            expect(at(179_999).text).toBe('Agent OS starting · 179 s');

            const at3min = at(180_000);

            expect(at3min.text).toBe('Agent OS not answering · 3 min');
            expect(at3min.lead).toBe('Your Agent OS has not answered for 3 min. Start it, or connect to another; the Fleet joins by itself when it answers.');
            expect(at3min.title).toBe(at3min.lead);
            expect(at3min.action).toBeNull();
            expect(at3min.kind).toBe('cold');
            expect(at(25 * 60_000 + 59_000).text).toBe('Agent OS not answering · 25 min')
        });

        test('a starting transport outranks a cold grid connection verdict even before the 15s slow window', () => {
            const preWindow = SpineBanner.deriveSpineBanner({
                grid     : {state: 'cold', connection: {state: 'timeout', reason: 'read timed out'}},
                stream   : {state: 'cold'},
                transport: {elapsedMs: 11_000, phase: 'starting', since: 1_000}
            });

            expect(preWindow.text).toBe('fleet starting');
            expect(preWindow.lead).toBe('Fleet transport starting — the cockpit connects automatically')
        })
    })
});

