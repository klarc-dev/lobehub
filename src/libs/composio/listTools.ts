import type { Composio } from '@composio/core';

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

/** The high-level SDK drops cursors and defaults toolkit queries to featured tools. */
export async function listComposioTools(client: Pick<Composio, 'getClient'>, appSlug: string) {
  const tools = new Map<
    string,
    { description: string; inputSchema: Record<string, unknown>; name: string }
  >();
  const cursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await client.getClient().tools.list({
      ...(cursor ? { cursor } : {}),
      important: 'false',
      include_deprecated: true,
      limit: PAGE_SIZE,
      toolkit_slug: appSlug,
      toolkit_versions: 'latest',
    });

    for (const tool of response.items) {
      if (!tool.slug || !tool.input_parameters || typeof tool.input_parameters !== 'object') {
        throw new Error('Invalid Composio tool definition');
      }
      // Preserve the first version/schema if page boundaries overlap.
      if (!tools.has(tool.slug)) {
        tools.set(tool.slug, {
          description: tool.description || '',
          inputSchema: tool.input_parameters,
          name: tool.slug,
        });
      }
    }

    const next = response.next_cursor;
    if (!next) return [...tools.values()];
    if (cursors.has(next)) throw new Error('Composio tool pagination repeated a cursor');
    cursors.add(next);
    cursor = next;
  }

  // Never publish a partial manifest as a complete refresh.
  throw new Error('Composio tool pagination exceeded the page limit');
}
