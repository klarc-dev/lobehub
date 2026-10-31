import type { LobeChatDatabase } from '@lobechat/database';
import { resolveModelTokenLimits } from '@lobechat/mecha';
import type { FrozenModelFacts } from '@lobechat/types';
import type { LobeDefaultAiModelListItem } from 'model-bank';
import { ModelProvider } from 'model-bank';

import { loadModels } from '@/business/client/model-bank/loadModels';
import { getServerAiProviderConfig } from '@/server/globalConfig';

import { createServerModelParamsProviders } from './providers';

/** The same deployment catalog used by the client's provider/model list. */
export const loadRuntimeModelCatalog = async (
  provider: string,
  builtinModels?: LobeDefaultAiModelListItem[],
): Promise<LobeDefaultAiModelListItem[]> => {
  const models = builtinModels ?? (await loadModels());
  // Custom provider ids have no environment catalog. Their scoped ai_models
  // row is resolved separately, with the bundled bank as an id-only fallback.
  if (!Object.values(ModelProvider).includes(provider as ModelProvider)) return models;

  const config = await getServerAiProviderConfig(provider as ModelProvider);
  return [
    ...config.serverModelLists.map((card) => ({
      ...card,
      abilities: card.abilities ?? {},
      providerId: provider,
    })),
    ...models.filter((card) => card.providerId !== provider),
  ];
};

interface RuntimeTokenLimitsInput {
  model: string;
  modelFacts?: FrozenModelFacts;
  provider: string;
  serverDB?: LobeChatDatabase;
  userId?: string;
  workspaceId?: string;
}

/**
 * One authority for compression and outbound completion budgets. New operations
 * freeze the limits, including an explicit empty object for unknown metadata.
 * Legacy operations and a different compression/subagent model resolve live in
 * the caller's user/workspace scope, never from the parent's model by accident.
 */
export const resolveRuntimeModelTokenLimits = async ({
  model,
  modelFacts,
  provider,
  serverDB,
  userId,
  workspaceId,
}: RuntimeTokenLimitsInput) => {
  if (
    modelFacts?.model === model &&
    modelFacts.provider === provider &&
    modelFacts.tokenLimits !== undefined
  ) {
    return modelFacts.tokenLimits;
  }

  return resolveModelTokenLimits(
    { model, provider },
    createServerModelParamsProviders({
      builtinModels: await loadRuntimeModelCatalog(provider),
      serverDB,
      userId,
      workspaceId,
    }),
  );
};
