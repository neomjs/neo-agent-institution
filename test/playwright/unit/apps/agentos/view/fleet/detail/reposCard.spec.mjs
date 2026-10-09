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
 * does. Each other repository also shows the last start's outcome from a real roster Store.
 */
test.describe('AgentOS.view.fleet.detail.AgentReposContainer — rows from the definition, one list per change', () => {
    let AgentDefinition, AgentReposCard, FleetRoster, Store;

    test.beforeAll(async () => {
        AgentDefinition = (await import('../../../../../../../../apps/agentos/model/AgentDefinition.mjs')).default;
        AgentReposCard  = (await import('../../../../../../../../apps/agentos/view/fleet/detail/AgentReposContainer.mjs')).default;
        FleetRoster     = (await import('../../../../../../../../apps/agentos/store/FleetRoster.mjs')).default;
        Store           = (await import('../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default
    });

    const
        working = {repoSlug: 'neomjs/neo', cloneUrl: 'https://github.com/neomjs/neo.git'},
        brain   = {repoSlug: 'neomjs/neo-agent-brain', cloneUrl: 'https://github.com/neomjs/neo-agent-brain.git'},
        skills  = {repoSlug: 'neomjs/neo-agent-skills', cloneUrl: 'git@github.com:neomjs/neo-agent-skills.git'},
        reason  = 'git clone exited 128: remote: Repository not found.';

    /**
     * @summary One seat in a real definitions Store, the card scoped to it, and its fired intents.
     * @param {Object} metadata The definition's `metadata`.
     * @param {Neo.data.Store|null} [rosterStore=null] The fleet roster the card reads outcomes from.
     * @param {Object} [definition={}] Other public definition fields, e.g. a GitLab seat's `forge`.
     * @returns {Object}
     */
    const mount = (metadata, rosterStore=null, definition={}) => {
        const
            store    = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
                {id: 'ada', githubUsername: 'ada', harnessType: 'claude-desktop', metadata, ...definition}
            ]}),
            record   = store.get('ada'),
            card     = Neo.create(AgentReposCard, {record, rosterStore}),
            intents  = [],
            rowStore = () => card.getReference('repo-list').store,
            rows     = () => rowStore().items.map(row => ({repoSlug: row.repoSlug, working: row.working})),
            outcomes = () => rowStore().items.map(({repoSlug}) => {
                const {reason, state} = rowStore().get(repoSlug);

                return {repoSlug, state, reason}
            });

        card.on('configIntent', data => intents.push(data));

        return {card, intents, outcomes, record, rows, store}
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

    test("a GitLab seat's change carries every stored entry whole, its forge included, and its field asks for a group path (#448)", () => {
        const
            gitlab = (repoSlug) => ({repoSlug, cloneUrl: `https://gitlab.example.com/${repoSlug}.git`, forge: 'gitlab'}),
            docs   = gitlab('group/sub/docs'),
            cli    = gitlab('group/cli'),
            {card, intents, store} = mount({repo: gitlab('group/work'), repos: [docs, cli]}, null, {forge: 'gitlab'});

        expect(card.getReference('field-repo').placeholderText).toBe('group/project');

        // a change re-sends the other entries: without its forge, the Fleet would read each as GitHub
        card.onRemoveRepository({repoSlug: cli.repoSlug});
        card.getReference('field-repo').value = 'Group/Sub/Tools';
        card.onAddClick();

        expect(intents).toHaveLength(2);
        expect(intents[0]).toMatchObject({id: 'ada', repos: [docs]});
        expect(intents[1]).toMatchObject({id: 'ada', repos: [docs, cli, {repoSlug: 'group/sub/tools'}]});

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

    test('each other repository shows the last start\'s outcome from the seat\'s roster record; one that start did not cover shows none', () => {
        const
            createApp = {repoSlug: 'neomjs/create-app', cloneUrl: 'https://github.com/neomjs/create-app.git'},
            roster    = Neo.create(FleetRoster);

        roster.add({agentId: 'ada', repoOutcomes: [
            {repoSlug: brain.repoSlug,  state: 'prepared'},
            {repoSlug: skills.repoSlug, state: 'failed', reason}
        ]});

        const {card, intents, outcomes, store} = mount({repo: working, repos: [brain, skills, createApp]}, roster);

        expect(outcomes()).toEqual([
            {repoSlug: 'neomjs/neo',              state: null,       reason: null},
            {repoSlug: 'neomjs/neo-agent-brain',  state: 'prepared', reason: null},
            {repoSlug: 'neomjs/neo-agent-skills', state: 'failed',   reason},
            // the last start did not cover it: no outcome until the next one
            {repoSlug: 'neomjs/create-app',       state: null,       reason: null}
        ]);
        // an outcome is a fact of the last start, and the heading says so
        expect(card.getReference('repos-heading').text).toBe('Repositories · declared · last start');

        const vdom = JSON.stringify(card.getReference('repo-list').vdom);

        expect(vdom.match(/fm-repo-outcome/g)).toHaveLength(2);
        expect(vdom).toContain('"text":"Prepared"');
        expect(vdom).toContain('"text":"Failed"');
        expect(vdom.match(/fm-repo-reason/g)).toHaveLength(1);
        expect(vdom).toContain(reason);

        // the outcome is display only: a new list carries the registry's entries and nothing else
        card.getReference('field-repo').value = 'neomjs/neo-agent-institution';
        card.onAddClick();

        expect(intents[0].repos.map(Object.keys)).toEqual([['cloneUrl', 'repoSlug'], ['cloneUrl', 'repoSlug'], ['cloneUrl', 'repoSlug'], ['repoSlug']]);

        card.destroy();
        roster.destroy();
        store.destroy()
    });

    test('every checkout shows its dependency state, the working one included; a failed clone wins, and an install still running belongs to this start (#610)', () => {
        const
            roster = Neo.create(FleetRoster),
            npm    = 'npm ci exited 1: ERESOLVE could not resolve dependency tree',
            vdom   = card => JSON.stringify(card.getReference('repo-list').vdom);

        roster.add({agentId: 'ada', repoOutcomes: [
            {repoSlug: brain.repoSlug,  state: 'prepared'},
            {repoSlug: skills.repoSlug, state: 'failed', reason}
        ], dependencyOutcomes: [
            {repoSlug: working.repoSlug, state: 'skipped', reason: 'skipped during the install'},
            {repoSlug: brain.repoSlug,   state: 'failed',  reason: npm},
            {repoSlug: skills.repoSlug,  state: 'unverified'}
        ]});

        const {card, outcomes, store} = mount({repo: working, repos: [brain, skills]}, roster);

        expect(outcomes()).toEqual([
            {repoSlug: 'neomjs/neo',              state: 'skipped', reason: 'skipped during the install'},
            {repoSlug: 'neomjs/neo-agent-brain',  state: 'failed',  reason: npm},
            // nothing was installed in a clone that failed: its row is the clone's
            {repoSlug: 'neomjs/neo-agent-skills', state: 'failed',  reason}
        ]);
        expect(card.getReference('repos-heading').text).toBe('Repositories · declared · last start');
        expect(vdom(card)).toContain('"text":"Skipped"');
        // every reason reads whole on its own line; only a failure's takes the alert class
        expect(vdom(card).match(/"fm-repo-reason"/g)).toHaveLength(3);
        expect(vdom(card).match(/"fm-repo-reason","is-failed"/g)).toHaveLength(2);

        // a Start installing now: its rows are live, and the heading names this start
        roster.get('ada').set({dependencyOutcomes: [
            {repoSlug: working.repoSlug, state: 'installing'},
            {repoSlug: brain.repoSlug,   state: 'installed'}
        ]});

        expect(outcomes().slice(0, 2)).toEqual([
            {repoSlug: 'neomjs/neo',             state: 'installing', reason: null},
            {repoSlug: 'neomjs/neo-agent-brain', state: 'prepared',   reason: null}
        ]);
        expect(card.getReference('repos-heading').text).toBe('Repositories · declared · this start');
        expect(vdom(card)).toContain('"text":"Installing","title":"This start"');

        // no preparation step reads as itself, never as prepared
        roster.get('ada').set({dependencyOutcomes: [{repoSlug: working.repoSlug, state: 'not-applicable'}]});
        expect(outcomes()[0]).toEqual({repoSlug: 'neomjs/neo', state: 'not-applicable', reason: null});
        expect(vdom(card)).toContain('"text":"No preparation step"');

        card.destroy();
        roster.destroy();
        store.destroy()
    });

    test('a roster read refreshes the outcomes in place, another seat\'s read leaves the card alone, and a roster that arrives later fills it', () => {
        const roster = Neo.create(FleetRoster);

        roster.add([{agentId: 'ada'}, {agentId: 'vega'}]);

        // no roster yet, as before the app's first roster read
        const {card, outcomes, store} = mount({repo: working, repos: [brain]});

        expect(outcomes()[1]).toEqual({repoSlug: brain.repoSlug, state: null, reason: null});

        // the roster arrives; this seat has no start yet
        card.rosterStore = roster;
        expect(outcomes()[1]).toEqual({repoSlug: brain.repoSlug, state: null, reason: null});
        expect(card.getReference('repos-heading').text).toBe('Repositories · declared');

        // a roster read after a failed start: the card follows the record without being asked
        roster.get('ada').set({repoOutcomes: [{repoSlug: brain.repoSlug, state: 'failed', reason}]});
        expect(outcomes()[1]).toEqual({repoSlug: brain.repoSlug, state: 'failed', reason});

        let refreshes = 0;
        const refresh = card.refresh.bind(card);

        card.refresh = () => {refreshes++; refresh()};

        roster.get('vega').set({repoOutcomes: [{repoSlug: brain.repoSlug, state: 'prepared'}]});
        expect(refreshes).toBe(0);

        // the next start replaces the outcome
        roster.get('ada').set({repoOutcomes: [{repoSlug: brain.repoSlug, state: 'prepared'}]});
        expect(refreshes).toBe(1);
        expect(outcomes()[1]).toEqual({repoSlug: brain.repoSlug, state: 'prepared', reason: null});

        // a retired card leaves the roster's listeners behind it
        card.destroy();
        roster.get('ada').set({repoOutcomes: null});
        expect(refreshes).toBe(1);

        roster.destroy();
        store.destroy()
    });

    test('a repository removed and re-added before the next start shows that start\'s outcome again: it records the start, not the list', () => {
        const roster = Neo.create(FleetRoster);

        roster.add({agentId: 'ada', repoOutcomes: [{repoSlug: brain.repoSlug, state: 'failed', reason}]});

        const {card, outcomes, record, store} = mount({repo: working, repos: [brain]}, roster);

        expect(outcomes()[1]).toEqual({repoSlug: brain.repoSlug, state: 'failed', reason});

        // removed: the readback drops the row, and its outcome with it
        record.set({metadata: {repo: working, repos: []}});
        card.refresh();
        expect(outcomes().map(row => row.repoSlug)).toEqual(['neomjs/neo']);

        // re-added before another start: that start did try it, so its outcome is still true
        record.set({metadata: {repo: working, repos: [brain]}});
        card.refresh();
        expect(outcomes()[1]).toEqual({repoSlug: brain.repoSlug, state: 'failed', reason});

        card.destroy();
        roster.destroy();
        store.destroy()
    });
});
