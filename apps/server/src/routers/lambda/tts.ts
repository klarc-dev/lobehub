import { TRPCError } from '@trpc/server';
import { speechMimeType, synthesizeInput } from './ttsInput';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const ttsProcedure = wsCompatProcedure
  .use(serverDatabase)
  .use(requireWorkspaceRoleWhenScoped('member'));

export const ttsRouter = router({
  synthesize: ttsProcedure.input(synthesizeInput).mutation(async ({ ctx, input, signal }) => {
    const { provider, ...payload } = input;
    const runtime = await initModelRuntimeFromDB(
      ctx.serverDB,
      ctx.userId,
      provider,
      ctx.workspaceId ?? undefined,
    );

    const audio = await runtime.textToSpeech(payload, { signal, user: ctx.userId });

    if (!audio) {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: `Provider "${provider}" does not support text-to-speech.`,
      });
    }

    if (audio.byteLength > 3 * 1024 * 1024 + 44) {
      throw new TRPCError({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Synthesized audio exceeds the inline response limit.',
      });
    }
    return {
      audioBase64: Buffer.from(audio).toString('base64'),
      format: payload.response_format,
      mimeType: speechMimeType[payload.response_format],
    };
  }),
});
