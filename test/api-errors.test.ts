import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiError, isResponseFormatUnsupported } from '../src/api-errors.js';

test('response format negotiation accepts only explicit 400/422 format errors', () => {
  const positive = [
    { error: { param: 'response_format', message: 'Invalid value' } },
    { error: { message: "response_format must be one of ['json', 'text']" } },
    { detail: [{ loc: ['body', 'response_format'], type: 'literal_error', msg: "Input should be 'json'" }] },
  ];
  for (const payload of positive) {
    assert.equal(isResponseFormatUnsupported(400, JSON.stringify(payload)), true);
    assert.equal(isResponseFormatUnsupported(422, JSON.stringify(payload)), true);
    assert.equal(isResponseFormatUnsupported(403, JSON.stringify(payload)), false);
    assert.equal(isResponseFormatUnsupported(429, JSON.stringify(payload)), false);
  }
  for (const payload of [
    { error: { param: 'language', message: 'Invalid language; srt is not allowed here' } },
    { error: { param: 'file', message: 'Invalid audio for response_format' } },
    { error: { message: 'Could not decode input audio' } },
    { error: { message: 'srt subtitle file is not supported as audio input' } },
  ]) assert.equal(isResponseFormatUnsupported(422, JSON.stringify(payload)), false);
  assert.equal(isResponseFormatUnsupported(422, '<html>failure</html>'), false);
});

test('diagnostics omit raw input, sanitize secrets and bound error length', () => {
  const error = createApiError(422, JSON.stringify({ detail: [{ loc: ['body', 'prompt'], type: 'value_error', msg: `bad token=secret Bearer other-secret ${'x'.repeat(1000)}`, input: 'never echo input', ctx: { secret: 'never echo context' } }] }));
  assert.match(error.message, /body\.prompt/u);
  assert.doesNotMatch(error.message, /token=secret|other-secret|never echo/u);
  assert.ok(error.message.length < 500);
});
