import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'AgentReposCardTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * @summary The Accounts Repositories card over real objects: an {@link AgentOS.model.AgentDefinition}
 * record in a real Store, the card's own rows Store, and the `configIntent` it fires. The card lists
 * what the registry declares (the working repository first, then the others) and turns an add or a
 * Remove into the seat's whole new list. It never changes the record: only the owner's round-trip
 * does.
 */
test.describe('AgentOS.view.fleet.detail.AgentReposContainer — rows from the definition, one list per change', () => {
    let AgentDefinition, AgentReposCard, Store;

    test.beforeAll(async () => {
        AgentDefinition = (await import('../../../../../../../../apps/agentos/model/AgentDefinition.mjs')).default;
        AgentReposCard  = (await import('../../../../../../../../apps/agentos/view/fleet/detail/AgentReposContainer.mjs')).default;
        Store           = (await import('../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default
    });

    const
        working = {repoSlug: 'neomjs/neo', cloneUrl: 'https://github.com/neomjs/neo.git'},
        brain   = {repoSlug: 'neomjs/neo-agent-brain', cloneUrl: 'https://github.com/neomjs/neo-agent-brain.git'},
        skills  = {repoSlug: 'neomjs/neo-agent-skills', cloneUrl: 'git@github.com:neomjs/neo-agent-skills.git'};

    /**
     * @summary One seat in a real definitions Store, the card scoped to it, and its fired intents.
     * @param {Object} metadata The definition's `metadata`.
     * @returns {Object}
     */
    const mount = metadata => {
        const
            store   = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
                {id: 'ada', githubUsername: 'ada', harnessType: 'claude-desktop', metadata}
            ]}),
            record  = store.get('ada'),
            card    = Neo.create(AgentReposCard, {record}),
            intents = [],
            rows    = () => card.getReference('repo-list').store.items.map(row => ({repoSlug: row.repoSlug, working: row.working}));

        card.on('configIntent', data => intents.push(data));

        return {card, intents, record, rows, store}
    };

    test('the rows are the working repository first, then the others, as the definition declares them', () => {
        const {card, rows, store} = mount({repo: working, repos: [brain, skills]});

        expect(rows()).toEqual([
            {repoSlug: 'neomjs/neo',              working: true},
            {repoSlug: 'neomjs/neo-agent-brain',  working: false},
            {repoSlug: 'neomjs/neo-agent-skills', working: false}
        ]);
        expect(card.getReference('repos-empty').hidden).toBe(true);

        card.destroy();
        store.destroy()
    });

    test('an add sends the whole new list, the stored clone URLs carried forward and the slug lowercased', () => {
        const {card, intents, record, store} = mount({repo: working, repos: [skills]});

        card.getReference('field-repo').value = '  NeoMJS/Neo-Agent-Brain ';
        card.onAddClick();

        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({id: 'ada', repos: [
            {repoSlug: skills.repoSlug, cloneUrl: skills.cloneUrl},
            {repoSlug: 'neomjs/neo-agent-brain'}
        ]});

        // an empty field sends nothing, and the record is untouched: only the round-trip writes it
        card.getReference('field-repo').value = '   ';
        card.onAddClick();

        expect(intents).toHaveLength(1);
        expect(record['metadata.repos']).toEqual([skills]);

        card.destroy();
        store.destroy()
    });

    test('a Remove sends the list without that repository, and the working repository offers none', () => {
        const {card, intents, store} = mount({repo: working, repos: [brain, skills]});

        card.onRemoveRepository({repoSlug: brain.repoSlug});

        expect(intents[0]).toMatchObject({id: 'ada', repos: [{repoSlug: skills.repoSlug, cloneUrl: skills.cloneUrl}]});

        // the row vdom: the working repository carries its tag, every other row a Remove button
        const vdom = JSON.stringify(card.getReference('repo-list').vdom);

        expect(vdom.match(/fm-repo-remove/g)).toHaveLength(2);
        expect(vdom).toContain('"text":"Working"');

        card.destroy();
        store.destroy()
    });

    test('while a change is in flight the card sends nothing; a refusal keeps the typed slug, an acceptance clears it', () => {
        const {card, intents, store} = mount({repo: working, repos: []});

        card.setSaveStatus('ada', 'pending', 'Saving configuration…');
        card.getReference('field-repo').value = 'neomjs/neo-agent-brain';
        card.onAddClick();
        card.onRemoveRepository({repoSlug: brain.repoSlug});

        expect(intents).toHaveLength(0);
        expect(card.getReference('add-button').disabled).toBe(true);

        card.setSaveStatus('ada', 'rejected', 'a repository is listed twice.');

        expect(card.getReference('field-repo').value).toBe('neomjs/neo-agent-brain');
        expect(card.getReference('repos-status').text).toBe('a repository is listed twice.');
        expect(card.getReference('add-button').disabled).toBe(false);

        card.setSaveStatus('ada', 'accepted', 'Configuration saved.');

        expect(card.getReference('field-repo').value).toBeFalsy();

        // a status for another agent never paints this card
        expect(card.setSaveStatus('vega', 'rejected', 'not mine')).toBe(false);
        expect(card.getReference('repos-status').text).toBe('Configuration saved.');

        card.destroy();
        store.destroy()
    });

    test('a seat without a working repository says so and offers no add, and a readback refreshes the rows in place', () => {
        const {card, record, rows, store} = mount({});

        expect(rows()).toEqual([]);
        expect(card.getReference('repos-empty').hidden).toBe(false);
        // the Fleet refuses other repositories until the seat has a working one
        expect(card.getReference('add-button').disabled).toBe(true);
        expect(card.getReference('field-repo').disabled).toBe(true);

        record.set({metadata: {repo: working, repos: [brain]}});
        card.refresh();

        expect(rows().map(row => row.repoSlug)).toEqual(['neomjs/neo', 'neomjs/neo-agent-brain']);
        expect(card.getReference('repos-empty').hidden).toBe(true);
        expect(card.getReference('add-button').disabled).toBe(false);

        card.destroy();
        store.destroy()
    });
});
