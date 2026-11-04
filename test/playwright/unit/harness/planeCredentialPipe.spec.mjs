import {expect, test}                         from '@playwright/test';
import {once}                                 from 'node:events';
import {mkdtempSync, rmSync, writeFileSync}   from 'node:fs';
import {tmpdir}                               from 'node:os';
import path                                   from 'node:path';
import {Duplex}                               from 'node:stream';
import {startBrainChild, stopBrainChild}      from '../../../../harness/brain.mjs';
import {
    openPlaneCredentialPipe,
    parsePlaneCredentialAnswer,
    pipePlaneCredential,
    planeCredentialFrame
} from '../../../../harness/planeCredentialPipe.mjs';

const CLOSED = 'the fleet child closed its credential pipe';

/**
 * @summary The child's end of the pipe as main sees it: what main writes is kept, and each answer is pushed
 * as one line.
 */
function childEnd() {
    const
        written = [],
        stream  = new Duplex({
            read() {},
            write(chunk, encoding, callback) {
                written.push(String(chunk));
                callback()
            }
        });

    return {answer: value => stream.push(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`), stream, written}
}

test.describe('harness/planeCredentialPipe — main\'s end of the fleet child\'s credential pipe (#843)', () => {
    test('a frame is the record\'s bearer and the class the plane named for it, one JSON line each', async () => {
        const
            end  = childEnd(),
            pipe = openPlaneCredentialPipe({stream: end.stream});

        expect(planeCredentialFrame({authSource: 'github-pat', bearer: 'ghp_a'})).toEqual({bearer: 'ghp_a', bearerClass: 'github-pat'});
        expect(planeCredentialFrame({authSource: null, bearer: 'ghp_a'}), 'a record without a class sends none').toEqual({bearer: 'ghp_a', bearerClass: ''});
        expect(planeCredentialFrame({bearer: 'ghp_a'})).toEqual({bearer: 'ghp_a', bearerClass: ''});

        const answered = pipe.send({bearer: 'ghp_a', bearerClass: 'github-pat'});

        end.answer({identity: '@fixture-viewer', state: 'adopted'});

        expect(await answered).toEqual({identity: '@fixture-viewer', state: 'adopted'});
        expect(end.written).toEqual(['{"bearer":"ghp_a","bearerClass":"github-pat"}\n'])
    });

    test('answers are matched to frames in the order they were sent', async () => {
        const
            end     = childEnd(),
            pipe    = openPlaneCredentialPipe({stream: end.stream}),
            boot    = pipe.send({bearer: 'ghp_boot', bearerClass: ''}),
            rotated = pipe.send({bearer: 'ghp_next', bearerClass: ''});

        end.answer({identity: '@fixture-viewer', state: 'adopted'});
        end.answer({expectedIdentity: '@fixture-viewer', reason: 'another account', resolvedIdentity: '@someone-else', state: 'refused'});

        expect(await boot).toEqual({identity: '@fixture-viewer', state: 'adopted'});
        expect(await rotated).toEqual({expectedIdentity: '@fixture-viewer', reason: 'another account', resolvedIdentity: '@someone-else', state: 'refused'})
    });

    test('an answer main cannot read is a refusal, never an adoption', () => {
        const unreadable = {reason: 'the fleet child answered the credential pipe with no readable answer', state: 'refused'};

        expect(parsePlaneCredentialAnswer('not json')).toEqual(unreadable);
        expect(parsePlaneCredentialAnswer('{"state":"adopted"}'), 'an adoption names its identity').toEqual(unreadable);
        expect(parsePlaneCredentialAnswer('{"state":"maybe"}')).toEqual(unreadable);
        expect(parsePlaneCredentialAnswer('{"state":"refused"}')).toEqual({reason: 'refused', state: 'refused'});
        expect(parsePlaneCredentialAnswer('{"state":"refused","reason":"no","resolvedIdentity":"@x"}'), 'one account is no pair').toEqual({reason: 'no', state: 'refused'})
    });

    test('a pipe that closes answers the frames still waiting, and every later one, as refused', async () => {
        const
            end     = childEnd(),
            pipe    = openPlaneCredentialPipe({stream: end.stream}),
            waiting = pipe.send({bearer: 'ghp_a', bearerClass: ''});

        end.stream.push(null);

        expect(await waiting).toEqual({reason: CLOSED, state: 'refused'});
        expect(pipe.isOpen()).toBe(false);
        expect(await pipe.send({bearer: 'ghp_b', bearerClass: ''})).toEqual({reason: CLOSED, state: 'refused'});
        expect(end.written, 'nothing is written into a closed pipe').toHaveLength(1)
    });

    test('a pipe that fails answers what waits as refused, and main never throws', async () => {
        const
            end     = childEnd(),
            pipe    = openPlaneCredentialPipe({stream: end.stream}),
            waiting = pipe.send({bearer: 'ghp_a', bearerClass: ''});

        end.stream.destroy(new Error('write EPIPE'));

        expect(await waiting).toEqual({reason: 'the fleet child\'s credential pipe failed', state: 'refused'});
        expect(pipe.isOpen()).toBe(false)
    });

    test('close() ends rotations: main\'s end is ended, and later frames are refused', async () => {
        const
            end  = childEnd(),
            pipe = openPlaneCredentialPipe({stream: end.stream});

        pipe.close();

        expect(end.stream.writableEnded).toBe(true);
        expect(await pipe.send({bearer: 'ghp_a', bearerClass: ''})).toEqual({reason: CLOSED, state: 'refused'})
    });

    test.describe('a real child on fd 3', () => {
        let workDir;

        test.beforeEach(() => {
            workDir = mkdtempSync(path.join(tmpdir(), 'plane-credential-pipe-'));

            // the Brain's end in miniature: it adopts a bearer named good-*, refuses any other, and never echoes one
            writeFileSync(path.join(workDir, 'child.mjs'), [
                "import net from 'node:net';",
                "import readline from 'node:readline';",
                'const socket = new net.Socket({fd: Number(process.env.NEO_FLEET_PLANE_CREDENTIAL_FD), readable: true, writable: true, allowHalfOpen: true});',
                "process.stdout.write(JSON.stringify({fd: process.env.NEO_FLEET_PLANE_CREDENTIAL_FD}) + '\\n');",
                "readline.createInterface({input: socket}).on('line', line => {",
                '    const {bearer, bearerClass} = JSON.parse(line);',
                "    socket.write(JSON.stringify(bearer.startsWith('good') ? {identity: '@fixture-viewer', state: 'adopted'} : {reason: `refused (${bearerClass})`, state: 'refused'}) + '\\n')",
                '});'
            ].join('\n'))
        });

        test.afterEach(() => {
            rmSync(workDir, {force: true, recursive: true})
        });

        test('the boot frame and each rotation are answered in order, and a child that is gone refuses the rest', async () => {
            const child = startBrainChild({credentialPipe: true, entry: 'child.mjs', ownershipTokenFn: () => 'pipe-token', repoRoot: workDir});

            try {
                const [hello] = await once(child.stdout, 'data');

                expect(JSON.parse(String(hello)), 'the child is told which fd carries the pipe').toEqual({fd: '3'});

                const {boot, pipe} = pipePlaneCredential({child, record: {authSource: 'github-pat', bearer: 'good-boot'}});

                expect(await boot).toEqual({identity: '@fixture-viewer', state: 'adopted'});
                expect(await Promise.all([
                    pipe.send({bearer: 'bad-rotation', bearerClass: 'github-pat'}),
                    pipe.send({bearer: 'good-rotation', bearerClass: ''})
                ])).toEqual([
                    {reason: 'refused (github-pat)', state: 'refused'},
                    {identity: '@fixture-viewer', state: 'adopted'}
                ]);

                child.kill('SIGKILL');
                await once(child, 'close');

                expect(pipe.isOpen()).toBe(false);
                expect(await pipe.send({bearer: 'good-late', bearerClass: ''})).toEqual({reason: CLOSED, state: 'refused'})
            } finally {
                await stopBrainChild(child, {graceMs: 500})
            }
        })
    })
});
