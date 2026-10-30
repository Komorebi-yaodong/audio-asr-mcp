interface ApiIssue {
  message: string;
  field?: string;
  code?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read only diagnostic fields; never include echoed input, headers, or raw bodies. */
function readIssues(body: string): ApiIssue[] {
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return []; }
  if (!isObject(payload)) return [];

  const candidates = Array.isArray(payload.detail)
    ? payload.detail
    : [isObject(payload.error) ? payload.error : payload];
  return candidates.filter(isObject).slice(0, 3).map(issue => {
    const message = typeof issue.message === 'string' ? issue.message : typeof issue.msg === 'string' ? issue.msg : '';
    const field = typeof issue.param === 'string' ? issue.param : Array.isArray(issue.loc)
      ? issue.loc.filter((part: unknown) => typeof part === 'string' || typeof part === 'number').join('.')
      : undefined;
    const code = typeof issue.code === 'string' ? issue.code : typeof issue.type === 'string' ? issue.type : undefined;
    return { message, ...(field ? { field } : {}), ...(code ? { code } : {}) };
  });
}

export function isResponseFormatUnsupported(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return readIssues(body).some(issue => {
    const formatField = issue.field?.split('.').at(-1) === 'response_format';
    // An explicit different field takes precedence over incidental format names in a message.
    if (issue.field && !formatField) return false;
    const mentionsFormat = /\bresponse[_ ]format\b/iu.test(issue.message);
    return (formatField || mentionsFormat)
      && /unsupported|not supported|does not support|invalid|not allowed|must be|only|input should be|expected|permitted|literal_error|enum|not one of/iu.test(`${issue.message} ${issue.code ?? ''}`);
  });
}

function redact(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result
    .replace(/\bBearer\s+[^\s,;"'<>]+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:gsk_|sk-|sk_)[a-z\d_-]+/giu, '[REDACTED]')
    .replace(/\b(?:api[_ -]?key|token|authorization|password)\s*[:=]\s*["']?[^\s,;"'<>]+/giu, '[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[URL]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 320);
}

export function createApiError(status: number, body: string, secrets: readonly string[] = []): Error {
  const hints: Record<number, string> = {
    401: '请检查 API Key。',
    403: '请求被拒绝，请检查访问权限或代理/网络出口。',
    413: '音频文件超过接口限制。',
    422: '请求参数校验失败。',
    429: '请求受限或余额不足，请稍后再试。',
  };
  // Authentication errors may echo credentials; keep those messages generic.
  const issues = status === 401 ? [] : readIssues(body);
  const diagnostics = issues.map(issue => {
    const field = issue.field ? redact(issue.field, secrets) : '';
    const message = redact(issue.message, secrets);
    const code = issue.code ? redact(issue.code, secrets) : '';
    return [field ? `字段 ${field}` : '', message, code ? `代码 ${code}` : ''].filter(Boolean).join('：');
  }).filter(Boolean).join('；');
  return new Error(`转写接口请求失败（HTTP ${status}）。${hints[status] ?? '请检查服务地址、模型和请求参数。'}${diagnostics ? ` ${diagnostics}` : ''}`);
}
