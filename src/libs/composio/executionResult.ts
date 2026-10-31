const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Some Composio actions return HTTP failures inside a successful SDK envelope. */
export function isComposioExecutionFailure(result: unknown): boolean {
  if (!isRecord(result)) return false;
  if (result.successful === false || result.error) return true;
  const data = result.data;
  if (!isRecord(data)) return false;
  return (
    (typeof data.status_code === 'number' && data.status_code >= 400) ||
    (typeof data.http_error === 'string' && data.http_error.trim().length > 0)
  );
}
