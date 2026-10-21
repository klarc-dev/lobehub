import { createWorkspaceLambdaClient, lambdaClient } from '@/libs/trpc/client/lambda';

export const workspaceService = {
  list: () => lambdaClient.workspace.list.query(),
  create: (input: { name: string; slug: string }) => lambdaClient.workspace.create.mutate(input),
  update: (id: string, input: { name: string; description?: string }) =>
    createWorkspaceLambdaClient(id).workspace.update.mutate(input),
  members: (id: string, includeDeleted = false) =>
    createWorkspaceLambdaClient(id).workspaceMember.list.query({ includeDeleted }),
  addMember: (id: string, input: { email: string; role: 'admin' | 'member' | 'viewer' }) =>
    createWorkspaceLambdaClient(id).workspaceMember.addByEmail.mutate(input),
};
