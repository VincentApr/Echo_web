import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const values = new Map();
const storage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
};
const source = readFileSync(new URL('../src/services/composerDrafts.ts', import.meta.url), 'utf8');
function load() {
    const context = { exports: {}, localStorage: storage };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
    return context.exports;
}
const api = load();
const draft = { text: 'Réponse importante', jarvisMode: true, agent: null, reply: { uuid: 'thread', isAgentThread: true } };
api.saveDraft('alice', 'a', draft);
assert.equal(api.readComposer('alice', 'a').draft.text, draft.text);
assert.equal(api.readComposer('alice', 'b').draft.text, '');
assert.equal(api.readComposer('bob', 'a').draft.text, '');
assert.equal(load().readComposer('alice', 'a').draft.reply.uuid, 'thread', 'context survives reload');
api.beginSend('alice', 'a', { id: 'temp-1', draft, fileNames: ['rapport.pdf'], status: 'pending' });
api.saveDraft('alice', 'a', { ...draft, text: 'Nouveau brouillon' });
api.failSend('alice', 'a', 'temp-1', 'Network error', true);
assert.equal(api.readComposer('alice', 'a').draft.text, 'Nouveau brouillon');
assert.equal(load().readComposer('alice', 'a').sends[0].status, 'uncertain');
api.completeSend('alice', 'a', 'temp-1');
assert.equal(api.readComposer('alice', 'a').sends.length, 0);
assert.equal(api.readComposer('alice', 'a').draft.text, 'Nouveau brouillon', 'late acknowledgement never clears the next draft');
api.saveDraft('bob', 'a', draft);
api.clearComposerForOwner('alice');
assert.equal(api.readComposer('alice', 'a').draft.text, '');
assert.equal(api.readComposer('bob', 'a').draft.text, draft.text);
storage.setItem = () => { throw new Error('Quota exceeded'); };
assert.throws(() => api.saveDraft('bob', 'a', draft), /Quota exceeded/);
console.log('Composer checks passed: persistence, account/conversation isolation, late acknowledgement, uncertain delivery and quota errors.');
