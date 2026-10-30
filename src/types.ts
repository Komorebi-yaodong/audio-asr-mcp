export type OutputFormat = 'text' | 'srt';

export interface TranscribeInput {
  audio_path: string;
  format?: OutputFormat | undefined;
  output_path?: string | undefined;
  language?: string | undefined;
  prompt?: string | undefined;
}

export interface Transcript {
  content: string;
  format: OutputFormat;
  fallbackReason?: string;
}

export interface Delivery {
  delivery: 'inline' | 'file';
  outputPath?: string;
  fallbackReason?: string;
}
