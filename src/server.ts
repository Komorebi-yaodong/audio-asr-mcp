import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from './config.js';
import { metadata } from './metadata.js';
import { deliver } from './output.js';
import { transcribe } from './transcription.js';

export function createServer(config: Config): McpServer {
  const server = new McpServer(metadata);
  server.registerTool('transcribe_audio', {
    title: '音频转文字 / SRT',
    description: '将指定本地音频通过配置的转写 API 转为文字或 SRT。可直接返回内容，或保存至已有目录/指定文件；路径不可用时直接返回内容，不覆盖已有文件。',
    inputSchema: {
      audio_path: z.string().min(1).describe('本地音频文件的绝对路径。'),
      format: z.enum(['text', 'srt']).default('text').describe('输出格式：text 为纯文本，srt 为字幕。'),
      output_path: z.string().min(1).optional().describe('可选绝对路径：已有目录，或父目录已存在的 .txt/.srt 文件路径。不填则直接返回内容。'),
      language: z.string().trim().min(1).max(32).optional().describe('可选音频语言代码，例如 zh、en；不填自动识别。'),
      prompt: z.string().min(1).optional().describe('可选上下文或专有名词提示。'),
    },
    outputSchema: {
      format: z.enum(['text', 'srt']),
      delivery: z.enum(['inline', 'file']),
      text: z.string().optional(),
      output_path: z.string().optional(),
      fallback_reason: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (input, extra) => {
    try {
      const transcript = await transcribe(input, config, { signal: extra.signal });
      extra.signal.throwIfAborted();
      const delivery = await deliver(transcript, input.audio_path, input.output_path);
      const fallbackReason = [transcript.fallbackReason, delivery.fallbackReason].filter(Boolean).join(' ');
      const structuredContent: Record<string, unknown> = {
        format: transcript.format,
        delivery: delivery.delivery,
        ...(delivery.outputPath ? { output_path: delivery.outputPath } : { text: transcript.content }),
        ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
      };
      const content: { type: 'text'; text: string }[] = [{
        type: 'text',
        text: delivery.outputPath ? `已保存：${delivery.outputPath}` : transcript.content || '未检测到可转写语音。',
      }];
      if (fallbackReason) content.push({ type: 'text', text: fallbackReason });
      return { content, structuredContent };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : '转写失败，请稍后重试。' }],
      };
    }
  });
  return server;
}
