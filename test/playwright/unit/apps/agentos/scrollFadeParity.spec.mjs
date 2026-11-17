import {test, expect}  from '@playwright/test';
import fs              from 'fs';
import path            from 'path';
import {fileURLToPath} from 'url';

/**
 * The scroll-fade idiom has two homes because its consumers, the setup card's Create door and the
 * memory candidate lists, share no loaded sheet. This spec keeps them one idiom: the blocks between the
 * `scroll-fade` markers must be equal once each file's selector and the ground its fade ends in are
 * named, so a change to one that skips the other fails here.
 */
const
    CSS   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../resources/css/src/apps/agentos'),
    block = (file, selector, ground) => {
        const css   = fs.readFileSync(path.join(CSS, file), 'utf8'),
              match = css.match(/\/\* scroll-fade: begin[\s\S]*?\*\/([\s\S]*?)\/\* scroll-fade: end \*\//);

        expect(match, `${file} marks its scroll-fade block`).not.toBeNull();

        return match[1].split(selector).join('SELECTOR').split(ground).join('GROUND').trim()
    };

test('the two scroll-fade blocks are one idiom', () => {
    const create     = block('setup/CreateContainer.css',              '.fm-setup-create',               'var(--fm-panel)'),
          candidates = block('fleet/instances/MemoryCandidateList.css', '.fm-memory-candidates.neo-list', 'var(--fm-panel-2)');

    expect(create).toContain('SELECTOR::after');
    expect(create).toContain('GROUND');
    expect(candidates).toBe(create)
});
