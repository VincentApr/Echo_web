import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/agentThreadExecution.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const execution = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const { reserveAgentExecution, agentResponseParent, pendingAgentExecution, cancelAgentExecution, rememberThreadMessage, mergeThreadMessage, subscribeAgentExecutions, isThreadExecuting } = execution;
const now = Date.now();
const answer = (overrides = {}) => ({
    uuid: 'answer', conversation_uuid: 'conversation', framework_agent_uuid: 'agent',
    is_ai_generated: true, created_at: new Date(now + 1000).toISOString(), ...overrides,
});

reserveAgentExecution('owner', 'conversation', 'agent', 'root', now);
assert.throws(() => reserveAgentExecution('owner', 'conversation', 'agent', 'other-root', now));
assert.equal(agentResponseParent(answer(), 'other-owner'), undefined);
assert.equal(agentResponseParent(answer({ conversation_uuid: 'other-conversation' }), 'owner'), undefined);
assert.equal(agentResponseParent(answer({ framework_agent_uuid: 'other-agent' }), 'owner'), undefined);
assert.equal(agentResponseParent(answer({ is_ai_generated: false }), 'owner'), undefined);
assert.equal(agentResponseParent(answer({ created_at: new Date(now - 1000).toISOString() }), 'owner'), undefined);
assert.equal(agentResponseParent(answer({ parent_message_uuid: 'another-server-thread' }), 'owner'), undefined);
assert.equal(agentResponseParent(answer(), 'owner'), 'root');
assert.equal(pendingAgentExecution('owner', 'agent'), undefined);
assert.equal(agentResponseParent(answer(), 'owner'), 'root', 'duplicate chat_message/agent_message keeps its parent');

reserveAgentExecution('owner', 'conversation', 'agent', 'second-root', now);
assert.equal(agentResponseParent(answer(), 'owner'), 'root', 'old echo cannot consume a newer invocation');
assert.equal(agentResponseParent(answer({ uuid: 'second-answer', parent_message_uuid: 'second-root' }), 'owner'), 'second-root');
const cancel = reserveAgentExecution('owner', 'conversation', 'agent', 'root', now);
assert.equal(pendingAgentExecution('owner', 'agent')?.root, 'root');
cancel();
assert.equal(pendingAgentExecution('owner', 'agent'), undefined);
reserveAgentExecution('owner', 'conversation', 'agent', 'root', now);
reserveAgentExecution('owner', 'other-conversation', 'agent', 'other-root', now);
assert.equal(pendingAgentExecution('owner', 'agent'), undefined, 'ambiguous acknowledgements must not select an arbitrary conversation');
cancelAgentExecution('owner', 'other-conversation', 'agent');
assert.equal(pendingAgentExecution('owner', 'agent')?.root, 'root');
const userReply = { uuid: 'user-reply', conversation_uuid: 'conversation', is_ai_generated: false, content: 'Suite', parent_message_uuid: null };
rememberThreadMessage('owner', 'conversation', 'user-reply', 'root');
const confirmedReply = mergeThreadMessage(undefined, userReply, 'owner');
assert.equal(confirmedReply.parent_message_uuid, 'root', 'parentless user confirmation remains in the thread');
assert.equal(confirmedReply.web_agent_parent_uuid, 'root');
assert.equal(mergeThreadMessage(confirmedReply, userReply, 'owner').parent_message_uuid, 'root', 'REST null cannot detach the reply');
assert.equal(mergeThreadMessage(undefined, userReply, 'other-owner').parent_message_uuid, null);
assert.equal(mergeThreadMessage(undefined, { ...userReply, uuid: 'normal-message' }, 'owner').parent_message_uuid, null, 'ordinary messages stay outside threads');
assert.equal(mergeThreadMessage(confirmedReply, { ...userReply, parent_message_uuid: 'server-parent' }, 'owner').parent_message_uuid, 'server-parent');
// Use an ID absent from the in-memory registry to simulate reopening the app.
const storedReply = { ...confirmedReply, uuid: 'restored-reply' };
assert.equal(mergeThreadMessage(storedReply, { uuid: 'restored-reply', parent_message_uuid: null }, 'owner').parent_message_uuid, 'root', 'persisted association survives reload');
assert.equal(mergeThreadMessage(undefined, storedReply, 'owner').parent_message_uuid, 'root');
const initialPrompt = { uuid: 'initial', conversation_uuid: 'conversation', ai_agent_uuid: 'agent',
    content: 'Première question', is_ai_generated: false, web_agent_waiting_since: now };
const syncedPrompt = mergeThreadMessage(initialPrompt, { uuid: 'initial', isPending: false }, 'owner');
assert.equal(syncedPrompt.web_agent_waiting_since, now, 'initial loading survives confirmation and later snapshots');
assert.equal(syncedPrompt.isPending, false, 'sending and waiting for an answer are separate states');
console.log('Agent thread execution checks passed.');

let updates = 0;
const unsubscribe = subscribeAgentExecutions(() => updates++);
reserveAgentExecution('test-owner', 'conv', 'agent', 'thread', now);
assert.equal(isThreadExecuting('test-owner', 'conv', 'thread'), true);
assert.equal(isThreadExecuting('other-owner', 'conv', 'thread'), false);
agentResponseParent(answer({ uuid: 'loader-answer', conversation_uuid: 'conv' }), 'test-owner');
assert.equal(isThreadExecuting('test-owner', 'conv', 'thread'), false);
assert.equal(updates, 2, 'spinner updates at invocation and answer');
const stop = reserveAgentExecution('test-owner', 'conv', 'agent', 'thread', now);
stop();
assert.equal(isThreadExecuting('test-owner', 'conv', 'thread'), false, 'failed send stops spinner');
unsubscribe();

// Exercise the real database reconciliation method without a browser database.
const dbSource = readFileSync(new URL('../src/services/webDatabase.ts', import.meta.url), 'utf8');
const dbJs = ts.transpileModule(dbSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const dbExports = {};
new Function('exports', 'require', dbJs)(dbExports, name => {
    if (name === './agentThreadExecution') return execution;
    if (name === '../utils/logger') return { webLogger: {} };
    throw new Error(`Unexpected dependency: ${name}`);
});
const db = dbExports.webDatabaseManager;
const pendingReply = { id: 'pending', uuid: 'temp', is_pending: true, created_at_ms: now, raw: {
    sender_uuid: 'owner', content: 'Ma réponse', parent_message_uuid: 'thread', web_agent_parent_uuid: 'thread',
} };
const earlyEcho = { id: 'confirmed', uuid: 'confirmed', is_pending: false, conversation_uuid: 'conv', created_at_ms: now, raw: {
    sender_uuid: 'owner', content: 'Ma réponse', parent_message_uuid: null, isPending: false,
} };
db.getAllByIndex = async () => [pendingReply];
assert.equal(await db.findMatchingPendingMessageId('owner', earlyEcho), 'pending');
assert.equal(mergeThreadMessage(pendingReply.raw, earlyEcho.raw, 'owner').parent_message_uuid, 'thread');
assert.equal(mergeThreadMessage(pendingReply.raw, earlyEcho.raw, 'owner').isPending, false);
db.getAllByIndex = async () => [pendingReply, { ...pendingReply, id: 'another-pending' }];
assert.equal(await db.findMatchingPendingMessageId('owner', earlyEcho), null, 'ambiguous echoes must not be guessed');
db.getAllByIndex = async () => [pendingReply];
assert.equal(await db.findMatchingPendingMessageId('owner', { ...earlyEcho, raw: { ...earlyEcho.raw, sender_uuid: 'someone-else' } }), null);
assert.equal(await db.findMatchingPendingMessageId('owner', { ...earlyEcho, raw: { ...earlyEcho.raw, is_ai_generated: true } }), null);
console.log('Early socket echo reconciliation and thread loading checks passed.');
