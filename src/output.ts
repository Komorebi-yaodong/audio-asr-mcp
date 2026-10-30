import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Delivery, Transcript } from './types.js';

export async function deliver(
  transcript: Transcript,
  audioPath: string,
  outputPath?: string,
): Promise<Delivery> {
  if (!outputPath) return { delivery: 'inline' };
  if (!path.isAbsolute(outputPath)) {
    return { delivery: 'inline', fallbackReason: '输出路径不是绝对路径，已直接返回内容。' };
  }

  try {
    const extension = transcript.format === 'srt' ? '.srt' : '.txt';
    let target: string;
    let existing;
    try {
      existing = await stat(outputPath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    if (existing) {
      if (!existing.isDirectory()) {
        return { delivery: 'inline', fallbackReason: '输出文件已存在，已直接返回内容。' };
      }
      target = path.join(outputPath, path.parse(audioPath).name + extension);
    } else {
      const givenExtension = path.extname(outputPath).toLowerCase();
      if (givenExtension !== '.txt' && givenExtension !== '.srt') {
        return { delivery: 'inline', fallbackReason: '输出目录不存在，已直接返回内容。' };
      }
      if (!(await stat(path.dirname(outputPath))).isDirectory()) {
        return { delivery: 'inline', fallbackReason: '输出目录不可用，已直接返回内容。' };
      }
      target = path.join(path.dirname(outputPath), path.parse(outputPath).name + extension);
    }

    // Exclusive creation prevents overwrites, including concurrent calls and symlinks.
    const file = await open(target, 'wx');
    try {
      await file.writeFile(transcript.content, 'utf8');
    } finally {
      await file.close();
    }
    return { delivery: 'file', outputPath: target };
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    const fallbackReason = code === 'EEXIST'
      ? '输出文件已存在，已直接返回内容。'
      : '输出路径不存在或无法写入，已直接返回内容。';
    return { delivery: 'inline', fallbackReason };
  }
}
