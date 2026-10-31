import { describe, expect, it } from 'vitest';

import { isComposioExecutionFailure } from './executionResult';

describe('isComposioExecutionFailure', () => {
  it.each([
    { successful: false },
    { error: 'provider failure' },
    { data: { status_code: 400 }, successful: true },
    { data: { status_code: 503 }, successful: true },
    { data: { http_error: '400 Client Error' }, successful: true },
  ])('detects explicit provider failure %j', (result) => {
    expect(isComposioExecutionFailure(result)).toBe(true);
  });

  it.each([
    null,
    { data: 'sent' },
    { data: { status_code: 200, http_error: '' }, error: null, successful: true },
    {
      data: { documentId: 'private-test', replies: [], commentUpdateState: 'ALL_SAVED' },
      successful: true,
    },
    { data: { message: 'error is part of ordinary document text' }, successful: true },
  ])('preserves successful payloads %j', (result) => {
    expect(isComposioExecutionFailure(result)).toBe(false);
  });
});
