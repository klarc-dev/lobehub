import type { LobeTool } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { toWorkspacePluginInventory } from './pluginInventory';

describe('workspace plugin schema projection', () => {
  it('removes nested prefill values while preserving tool properties named default', () => {
    const row: LobeTool = {
      identifier: 'legacy',
      manifest: {
        api: [
          {
            description: 'Tool',
            name: 'run',
            parameters: {
              properties: {
                default: { type: 'string', default: 'DEFAULT_SENTINEL' },
                token: { examples: ['EXAMPLE_SENTINEL'], type: 'string' },
              },
              required: ['default'],
              type: 'object',
            },
          },
        ],
        identifier: 'legacy',
        meta: { title: 'Legacy' },
      },
      type: 'customPlugin',
    };
    const result = toWorkspacePluginInventory(row);
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
    expect(result.manifest?.api[0].parameters).toEqual({
      properties: { default: { type: 'string' }, token: { type: 'string' } },
      required: ['default'],
      type: 'object',
    });
    expect(JSON.stringify(row)).toContain('DEFAULT_SENTINEL');
  });
});
