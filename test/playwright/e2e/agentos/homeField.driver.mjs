/**
 * @summary The tests' Home field driver: loaded into the App worker through `Neo.worker.App.loadModule`, it waits
 * until Home's field has drawn on the canvas worker in the state the query names, then dwells and counts the frames
 * drawn meanwhile, and until the rects the field is quiet under are where the hero's lines stand. It throws with the
 * renderer's statistics when the field never settles, the dwell contradicts the state or the quiet rects never
 * follow the lines, so the spec reads the failure's message as the reason.
 *
 * Query: `still=true` (the reduced-motion field: it draws no frame over the dwell) or `still=false` (the moving
 * field: it draws several); `marks=<n>` or `marks=none`, the marks the field draws; `theme=dark|light`, optional.
 */
const
    params = new URL(import.meta.url).searchParams,
    still  = params.get('still') === 'true',
    marks  = params.get('marks'),
    theme  = params.get('theme'),
    canvas = Neo.manager.Component.findFirst('ntype', 'fm-home-canvas');

if (!canvas) {
    throw new Error('homeField driver: no fm-home-canvas is mounted')
}

/**
 * @param {Object|null} stats
 * @returns {Boolean} Whether the field drew the state the query names
 */
const settled = stats => !!stats && stats.frames > 0 && stats.size?.width > 0 && stats.still === still &&
    (marks === null || (marks === 'none' ? stats.marks === null : stats.marks?.total === Number(marks))) &&
    (theme === null || stats.theme === theme);

let before = null;

for (let attempt = 0; attempt < 200 && !settled(before); attempt++) {
    attempt && await canvas.timeout(50);
    before = await canvas.readStats()
}

if (!settled(before)) {
    throw new Error(`homeField driver: the field never drew still=${still} marks=${marks} theme=${theme}: ${JSON.stringify(before)}`)
}

// a still field draws once for each input a mount still delivers late (a size report, the theme): wait those out
for (let attempt = 0; still && attempt < 20; attempt++) {
    await canvas.timeout(150);

    const next = await canvas.readStats();

    if (next.frames === before.frames) {
        break
    }

    before = next
}

await canvas.timeout(400);

const after = await canvas.readStats(), drawn = after.frames - before.frames;

if (still ? drawn !== 0 : drawn < 5) {
    throw new Error(`homeField driver: ${still ? 'a still field drew' : 'a moving field drew only'} ${drawn} frames in 400ms`)
}

/**
 * @returns {Promise<Object[]>} The hero's shown lines as they stand, relative to the canvas node measured with them
 */
const lines = async () => {
    const [node, ...rects] = await canvas.getDomRect([canvas.id, ...canvas.quietIds]);

    return rects.filter(rect => rect?.width > 0 && rect.height > 0)
        .map(({height, width, x, y}) => ({height, width, x: x - node.x, y: y - node.y}))
};

/**
 * @param {Object[]} quiet
 * @param {Object[]} expected
 * @returns {Boolean} Whether the field is quiet under exactly the lines, to the pixel
 */
const follows = (quiet, expected) => quiet?.length === expected.length &&
    quiet.every((rect, i) => ['height', 'width', 'x', 'y'].every(key => Math.abs(rect[key] - expected[i][key]) < 1));

let expected = await lines(), quiet = after.quiet;

// the host measures a line it changed one frame later
for (let attempt = 0; attempt < 40 && !follows(quiet, expected); attempt++) {
    await canvas.timeout(50);
    expected = await lines();
    quiet    = (await canvas.readStats()).quiet
}

// the eyebrow and the lead show for both readers
if (expected.length < 2 || !follows(quiet, expected)) {
    throw new Error(`homeField driver: the field is quiet under ${JSON.stringify(quiet)}, the hero's lines stand at ${JSON.stringify(expected)}`)
}
