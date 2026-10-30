import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { deliver } from '../src/output.js';
import { fixture, sampleSrt } from './helpers.js';

const text = { content: '你好，世界。', format: 'text' as const };

test('no output path returns inline', async () => {
  assert.deepEqual(await deliver(text, 'audio.wav'), { delivery: 'inline' });
});

test('existing directory writes UTF-8 with matching basename', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const result = await deliver(text, files.audioPath, files.directory);
  assert.equal(result.delivery, 'file');
  assert.equal(result.outputPath, path.join(files.directory, '测试录音.txt'));
  assert.equal(await readFile(result.outputPath!, 'utf8'), text.content);
});

test('full file path saves SRT', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const target = path.join(files.directory, 'captions.srt');
  assert.equal((await deliver({ content: sampleSrt, format: 'srt' }, files.audioPath, target)).outputPath, target);
  assert.equal(await readFile(target, 'utf8'), sampleSrt);
});

test('nonexistent directory or parent falls back without creating directories', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const missing = path.join(files.directory, 'missing');
  for (const target of [missing, path.join(missing, 'out.txt')]) {
    const result = await deliver(text, files.audioPath, target);
    assert.equal(result.delivery, 'inline'); assert.ok(result.fallbackReason);
  }
  await assert.rejects(access(missing));
  assert.equal((await deliver(text, files.audioPath, 'relative.txt')).delivery, 'inline');
});

test('existing output file is never overwritten', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const target = path.join(files.directory, 'existing.txt');
  await writeFile(target, 'original');
  assert.equal((await deliver(text, files.audioPath, target)).delivery, 'inline');
  assert.equal(await readFile(target, 'utf8'), 'original');
  assert.equal((await deliver(text, files.audioPath, files.audioPath)).delivery, 'inline');
});

test('SRT fallback writes .txt, not misleading .srt', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const requested = path.join(files.directory, 'result.srt');
  const actual = path.join(files.directory, 'result.txt');
  const result = await deliver(text, files.audioPath, requested);
  assert.equal(result.outputPath, actual);
  assert.equal(await readFile(actual, 'utf8'), text.content);
  await assert.rejects(access(requested));
});

test('concurrent calls only create one file', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const target = path.join(files.directory, 'race.txt');
  const results = await Promise.all([deliver(text, files.audioPath, target), deliver(text, files.audioPath, target)]);
  assert.equal(results.filter(result => result.delivery === 'file').length, 1);
  assert.equal(results.filter(result => result.delivery === 'inline').length, 1);
  assert.equal(await readFile(target, 'utf8'), text.content);
});

test('file creation error falls back to inline', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const target = path.join(files.directory, `${'a'.repeat(300)}.txt`);
  const result = await deliver(text, files.audioPath, target);
  assert.equal(result.delivery, 'inline'); assert.ok(result.fallbackReason);
});
