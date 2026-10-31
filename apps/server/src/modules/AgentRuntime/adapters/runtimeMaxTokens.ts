import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { resolveSafeMaxTokens } from '@lobechat/model-runtime/utils/resolveSafeMaxTokens';

import { resolveRuntimeModelTokenLimits } from '@/server/modules/Mecha/ModelParams/runtimeTokenLimits';

/** Keep a smaller requested budget, but never reserve above configured limits. */
export const resolveRuntimeMaxTokens = (
  payload: Pick<ChatStreamPayload, 'max_tokens' | 'messages' | 'model' | 'tools'>,
  limits: { contextWindowTokens?: number; maxOutput?: number },
) => {
  // A context window is not an output limit. Unknown output metadata must
  // keep the provider's default, not turn a 1M context into a 1M completion.
  if (payload.max_tokens === undefined && limits.maxOutput === undefined) return undefined;
  const safeLimit = resolveSafeMaxTokens(
    { ...payload, max_tokens: undefined },
    [{ ...limits, id: payload.model, type: 'chat' }],
    { minOutputTokens: 1 },
  );
  return payload.max_tokens === undefined
    ? safeLimit
    : safeLimit === undefined
      ? payload.max_tokens
      : Math.min(payload.max_tokens, safeLimit);
};

export const resolveRuntimePayloadMaxTokens = async (
  payload: Pick<ChatStreamPayload, 'max_tokens' | 'messages' | 'model' | 'tools'>,
  scope: Omit<Parameters<typeof resolveRuntimeModelTokenLimits>[0], 'model'>,
) =>
  resolveRuntimeMaxTokens(
    payload,
    await resolveRuntimeModelTokenLimits({ ...scope, model: payload.model }),
  );
