// @vitest-environment node
import type { Composio } from '@composio/core';
import { describe, expect, it, vi } from 'vitest';

import { listComposioTools } from './listTools';

const tool = (slug: string) => ({
  description: `Tool ${slug}`,
  input_parameters: { properties: { document_id: { type: 'string' } }, type: 'object' },
  slug,
});

function fixture() {
  const list = vi.fn();
  const client = { getClient: () => ({ tools: { list } }) } as unknown as Pick<
    Composio,
    'getClient'
  >;
  return { client, list };
}

describe('listComposioTools', () => {
  it('discovers all 48 tools across pages without featured filtering and preserves schemas', async () => {
    const { client, list } = fixture();
    list
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => tool(`TOOL_${i}`)),
        next_cursor: 'page2',
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => tool(`TOOL_${i + 20}`)),
        next_cursor: 'page3',
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 8 }, (_, i) => tool(`TOOL_${i + 40}`)),
        next_cursor: null,
      });

    const result = await listComposioTools(client, 'googledocs');

    expect(result).toHaveLength(48);
    expect(result[47]).toEqual({
      description: 'Tool TOOL_47',
      inputSchema: tool('TOOL_47').input_parameters,
      name: 'TOOL_47',
    });
    expect(list).toHaveBeenNthCalledWith(1, {
      important: 'false',
      include_deprecated: true,
      limit: 1000,
      toolkit_slug: 'googledocs',
      toolkit_versions: 'latest',
    });
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'page2' }));
    expect(list).toHaveBeenNthCalledWith(3, expect.objectContaining({ cursor: 'page3' }));
  });

  it('deduplicates overlapping pages by slug without replacing the first schema', async () => {
    const { client, list } = fixture();
    list.mockResolvedValueOnce({ items: [tool('ONE')], next_cursor: 'two' });
    list.mockResolvedValueOnce({
      items: [{ ...tool('ONE'), description: 'changed' }, tool('TWO')],
    });
    expect(await listComposioTools(client, 'gmail')).toEqual([
      { description: 'Tool ONE', inputSchema: tool('ONE').input_parameters, name: 'ONE' },
      { description: 'Tool TWO', inputSchema: tool('TWO').input_parameters, name: 'TWO' },
    ]);
  });

  it('follows a cursor even when an intermediate page is empty', async () => {
    const { client, list } = fixture();
    list.mockResolvedValueOnce({ items: [], next_cursor: 'two' });
    list.mockResolvedValueOnce({ items: [tool('LAST')] });
    expect(await listComposioTools(client, 'googledocs')).toHaveLength(1);
  });

  it('fails closed rather than returning a partial manifest on repeated cursors', async () => {
    const { client, list } = fixture();
    list.mockResolvedValue({ items: [tool('ONE')], next_cursor: 'repeat' });
    await expect(listComposioTools(client, 'gmail')).rejects.toThrow('repeated a cursor');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('bounds pagination even when every cursor is unique', async () => {
    const { client, list } = fixture();
    let page = 0;
    list.mockImplementation(async () => ({ items: [], next_cursor: `page-${++page}` }));
    await expect(listComposioTools(client, 'gmail')).rejects.toThrow('page limit');
    expect(list).toHaveBeenCalledTimes(100);
  });

  it('propagates a later page failure without exposing a partial manifest', async () => {
    const { client, list } = fixture();
    list.mockResolvedValueOnce({ items: [tool('ONE')], next_cursor: 'two' });
    list.mockRejectedValueOnce(new Error('upstream unavailable'));
    await expect(listComposioTools(client, 'gmail')).rejects.toThrow('upstream unavailable');
  });

  it('rejects invalid tool metadata instead of inventing a schema', async () => {
    const { client, list } = fixture();
    list.mockResolvedValue({ items: [{ slug: 'BROKEN' }] });
    await expect(listComposioTools(client, 'gmail')).rejects.toThrow('Invalid Composio');
  });
});
