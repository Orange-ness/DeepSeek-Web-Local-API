import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDeepSeekDeltaAssembler, iterateSseEvents } from '../src/sse.js';

test('iterateSseEvents parses multiple blocks', async () => {
  const stream = Readable.toWeb(Readable.from([
    'data: {"content":"hel"}\n\n',
    'data: {"content":"lo"}\n\n'
  ]));

  const events = [];
  for await (const event of iterateSseEvents(stream)) {
    events.push(event.data);
  }

  assert.deepEqual(events, ['{"content":"hel"}', '{"content":"lo"}']);
});

test('createDeepSeekDeltaAssembler handles cumulative payloads', () => {
  const assemble = createDeepSeekDeltaAssembler();

  assert.equal(assemble({ content: 'hel' }), 'hel');
  assert.equal(assemble({ content: 'hello' }), 'lo');
  assert.equal(assemble({ content: 'hello!' }), '!');
});

test('createDeepSeekDeltaAssembler reads nested DeepSeek web chat payloads', () => {
  const assemble = createDeepSeekDeltaAssembler();

  assert.equal(
    assemble({ type: 'chat:completion', data: { content: 'Hello' } }),
    'Hello'
  );

  assert.equal(
    assemble({ type: 'chat:completion', data: { content: 'Hello everyone' } }),
    ' everyone'
  );
});

test('createDeepSeekDeltaAssembler reads patch-style delta payloads', () => {
  const assemble = createDeepSeekDeltaAssembler();

  assert.equal(
    assemble({ p: 'response/content', o: 'APPEND', v: 'Hi' }),
    'Hi'
  );

  assert.equal(
    assemble({ v: ' there' }),
    ' there'
  );

  assert.equal(
    assemble({ p: 'response/status', v: 'FINISHED' }),
    ''
  );
});

test('createDeepSeekDeltaAssembler ignores thinking deltas until response content begins', () => {
  const assemble = createDeepSeekDeltaAssembler();

  assert.equal(
    assemble({ p: 'response/thinking_content', v: 'We' }),
    ''
  );

  assert.equal(
    assemble({ v: ' need' }),
    ''
  );

  assert.equal(
    assemble({ p: 'response/content', v: 'OK' }),
    'OK'
  );

  assert.equal(
    assemble({ v: '!' }),
    '!'
  );
});
