import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

interface ReportScope {
  userId: string;
  visibility: string;
  workspaceId?: string | null;
}

interface ReportReader {
  serverDB: LobeChatDatabase;
  userId?: string | null;
}

/** Resource scope, not the optional request header, governs private reports. */
export const resolveReportReadAccess = async (ctx: ReportReader, report: ReportScope) => {
  const matchesCreator = Boolean(ctx.userId) && ctx.userId === report.userId;
  if (!report.workspaceId) {
    return { canRead: matchesCreator || report.visibility === 'public', isOwner: matchesCreator };
  }

  // Public sharing grants the public payload, never the creator's private origin.
  const member = ctx.userId
    ? await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
        report.workspaceId,
        ctx.userId,
      )
    : undefined;
  const active = !!member && ['viewer', 'member', 'admin', 'owner'].includes(member.role);
  return {
    canRead: active || report.visibility === 'public',
    isOwner: matchesCreator && active,
  };
};

export const canReadAcceptance = async (ctx: ReportReader, report: ReportScope) =>
  (await resolveReportReadAccess(ctx, report)).canRead;
