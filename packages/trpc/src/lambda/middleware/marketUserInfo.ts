import { type LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import { UserModel } from '@/database/models/user';
import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import { normalizeWorkspaceId } from '@/database/utils/workspace';
import { type TrustedClientUserInfo } from '@/libs/trusted-client';

import { trpc } from '../init';

interface ContextWithServerDB {
  marketAccessToken?: string;
  serverDB?: LobeChatDatabase;
  userId?: string | null;
  workspaceId?: string | null;
}

interface MarketUserContext {
  marketAccessToken?: string;
  marketUserInfo?: TrustedClientUserInfo;
}

export const resolveMarketUserContext = async (
  ctx: ContextWithServerDB,
): Promise<MarketUserContext> => {
  // Scope validation must stay outside the optional profile lookup's catch.
  // Public Market routers also use this middleware, without userAuth.
  const workspaceId = normalizeWorkspaceId(ctx.workspaceId) ?? undefined;
  if (workspaceId) {
    if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    if (!ctx.serverDB) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const role = await getActiveWorkspaceMembershipRole(ctx.serverDB, {
      userId: ctx.userId,
      workspaceId,
    });
    if (!role || !['viewer', 'member', 'admin', 'owner'].includes(role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Active workspace membership required' });
    }
  }

  // Anonymous personal discovery does not require a Market identity.
  if (!ctx.userId || !ctx.serverDB) return { marketUserInfo: undefined };

  try {
    const user = await UserModel.findById(ctx.serverDB, ctx.userId);

    if (!user || !user.email) return { marketUserInfo: undefined };

    const marketUserInfo: TrustedClientUserInfo = {
      email: user.email,
      name: user.fullName || user.username || undefined,
      userId: ctx.userId,
      // In a workspace context, the token acts as the workspace's mirrored
      // organization; absent for personal requests.
      ...(workspaceId ? { workspaceId } : {}),
    };

    // Fetch market access token from user_settings.market
    const userModel = new UserModel(ctx.serverDB, ctx.userId);
    const userSettings = await userModel.getUserSettings();
    const marketTokenFromDB = (userSettings?.market as any)?.accessToken;

    return {
      // Prioritize database token over cookie token
      marketAccessToken: marketTokenFromDB || ctx.marketAccessToken,
      marketUserInfo,
    };
  } catch {
    // If fetching user info fails, continue without it
    return { marketUserInfo: undefined };
  }
};

/**
 * Middleware that fetches user info for Market trusted client authentication
 * This requires serverDatabase middleware to be applied first
 */
export const marketUserInfo = trpc.middleware(async (opts) => {
  const ctx = opts.ctx as ContextWithServerDB;
  const marketContext = await resolveMarketUserContext(ctx);

  return opts.next({ ctx: marketContext });
});
