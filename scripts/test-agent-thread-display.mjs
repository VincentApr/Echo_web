import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/utils/agentThreadDisplay.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { isEmbeddedAgentRoot, findEmbeddedAgentRoot } = exports;
const executionSource = ts.transpileModule(readFileSync(new URL('../src/services/agentThreadExecution.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const execution = {};
vm.runInNewContext(executionSource, { exports: execution });
for (const target of ['main-agent', 'another-agent']) {
    const messages = [
        { uuid: 'ordinary-prompt', content: 'Bonjour' },
        { uuid: 'ordinary-answer', is_ai_generated: true, ai_agent_uuid: 'main-agent', parent_message_uuid: 'ordinary-prompt' },
        { uuid: 'thread', content: 'Question ciblée', ai_agent_uuid: target, is_ai_generated: false },
        { uuid: 'answer', is_ai_generated: true, ai_agent_uuid: target, parent_message_uuid: 'thread' },
        { uuid: 'followup', parent_message_uuid: 'answer', content: 'Précise' },
        { uuid: 'second-answer', is_ai_generated: true, ai_agent_uuid: target, parent_message_uuid: 'followup' },
    ];
    const byUuid = new Map(messages.map(message => [message.uuid, message]));
    assert.equal(isEmbeddedAgentRoot(messages[1], true), false);
    assert.equal(isEmbeddedAgentRoot(messages[2], true), true);
    assert.equal(findEmbeddedAgentRoot(messages[1], byUuid, true), undefined);
    for (const child of messages.slice(3)) {
        assert.equal(findEmbeddedAgentRoot(child, byUuid, true)?.uuid, 'thread');
        assert.equal(findEmbeddedAgentRoot(child, byUuid, false)?.uuid, 'thread');
    }
    // The framework can return the first answer without a parent, including
    // when invoking the agent already participating in the main conversation.
    const since = Date.now();
    execution.reserveAgentExecution('owner', 'conversation', target, 'thread', since);
    const answer = execution.mergeThreadMessage(undefined, {
        uuid: `parentless-${target}`, conversation_uuid: 'conversation',
        ai_agent_uuid: target, is_ai_generated: true,
        created_at: new Date(since + 1000).toISOString(),
    }, 'owner');
    assert.equal(answer.parent_message_uuid, 'thread');
    assert.equal(findEmbeddedAgentRoot(answer, byUuid, true)?.uuid, 'thread');
    const snapshot = execution.mergeThreadMessage(answer, { uuid: answer.uuid, parent_message_uuid: null }, 'owner');
    assert.equal(findEmbeddedAgentRoot(snapshot, byUuid, true)?.uuid, 'thread', 'later REST snapshots keep the first answer in its thread');
    assert.equal(execution.pendingAgentExecution('owner', target, 'conversation'), undefined);
}
const marker = { uuid: 'marker', is_agent_thread_root: true, is_ai_generated: true };
assert.equal(isEmbeddedAgentRoot(marker, true), true);
assert.equal(isEmbeddedAgentRoot({ uuid: 'optimistic', web_agent_waiting_since: Date.now() }, true), true);
const loop = { uuid: 'loop', parent_message_uuid: 'loop', ai_agent_uuid: 'agent' };
assert.equal(findEmbeddedAgentRoot(loop, new Map([['loop', loop]]), true), undefined);
console.log('Thread display checks passed: main feed, same/different agent, nested replies, markers and optimistic prompts.');
