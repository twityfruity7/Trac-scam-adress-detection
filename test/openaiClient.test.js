import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { OpenAICompatibleClient } from '../src/prompt/openaiClient.js';
import { INTERCOMSWAP_TOOLS } from '../src/prompt/tools.js';

function withServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/v1/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

test('openai client: sends body + parses tool_calls', async (t) => {
  let seen = null;
  const srv = await withServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    seen = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) };

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'cmpl_1',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'intercomswap_sc_info', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
  });
  t.after(async () => srv.close());

  const client = new OpenAICompatibleClient({
    baseUrl: srv.url,
    apiKey: '',
    defaultModel: 'test-model',
    timeoutMs: 10_000,
    toolFormat: 'tools',
  });

  const out = await client.chatCompletions({
    messages: [{ role: 'user', content: 'hi' }],
    tools: INTERCOMSWAP_TOOLS,
    toolChoice: 'auto',
    maxTokens: 123,
    temperature: 0.4,
    topP: 0.95,
    topK: 40,
    minP: 0.05,
    repetitionPenalty: 1.1,
  });

  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/v1/chat/completions');
  assert.equal(seen.body.model, 'test-model');
  assert.equal(seen.body.max_tokens, 123);
  assert.equal(seen.body.temperature, 0.4);
  assert.equal(seen.body.top_p, 0.95);
  assert.equal(seen.body.top_k, 40);
  assert.equal(seen.body.min_p, 0.05);
  assert.equal(seen.body.repetition_penalty, 1.1);
  assert.ok(Array.isArray(seen.body.tools));
  assert.equal(seen.body.tool_choice, 'auto');

  assert.equal(out.finishReason, 'tool_calls');
  assert.equal(out.toolCalls.length, 1);
  assert.deepEqual(out.toolCalls[0], {
    id: 'call_1',
    name: 'intercomswap_sc_info',
    arguments: {},
    argumentsRaw: '{}',
    parseError: null,
  });
});

test('openai client: legacy function_call parsing', async (t) => {
  const srv = await withServer(async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'cmpl_2',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            finish_reason: 'function_call',
            message: {
              role: 'assistant',
              content: null,
              function_call: { name: 'intercomswap_sc_stats', arguments: '{}' },
            },
          },
        ],
      })
    );
  });
  t.after(async () => srv.close());

  const client = new OpenAICompatibleClient({
    baseUrl: srv.url,
    defaultModel: 'test-model',
    timeoutMs: 10_000,
    toolFormat: 'functions',
  });

  const out = await client.chatCompletions({
    messages: [{ role: 'user', content: 'hi' }],
    tools: INTERCOMSWAP_TOOLS,
  });

  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, 'intercomswap_sc_stats');
  assert.deepEqual(out.toolCalls[0].arguments, {});
});

test('openai client: surfaces http errors', async (t) => {
  const srv = await withServer(async (req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'unauthorized' } }));
  });
  t.after(async () => srv.close());

  const client = new OpenAICompatibleClient({ baseUrl: srv.url, defaultModel: 'test-model', timeoutMs: 10_000 });
  await assert.rejects(
    () => client.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] }),
    /LLM error: unauthorized/
  );
});

test('openai client: retries when endpoint returns HTML once (ngrok interstitial / proxy flake)', async (t) => {
  let calls = 0;
  const srv = await withServer(async (_req, res) => {
    calls += 1;
    if (calls === 1) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body>ngrok warning</body></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      })
    );
  });
  t.after(async () => srv.close());

  const client = new OpenAICompatibleClient({ baseUrl: srv.url, defaultModel: 'test-model', timeoutMs: 10_000 });
  const out = await client.chatCompletions({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 16 });
  assert.equal(out.content, 'ok');
  assert.equal(calls, 2);
});
