// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';

import { AgentRuntimeService } from './AgentRuntimeService';
import { WorkspaceExecutionGuard } from './WorkspaceExecutionGuard';

const mocks = vi.hoisted(() => ({ findById: vi.fn(), settleLive: vi.fn(), settleTopic: vi.fn() }));
vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: vi.fn() }));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findById = mocks.findById;
    settleLive = mocks.settleLive;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    settleRunningOperation = mocks.settleTopic;
  },
}));

const db = {} as LobeChatDatabase;
const coordinator = { loadAgentState: vi.fn(), markInterrupted: vi.fn(), saveAgentState: vi.fn() };
let role: string | null;
let operation: { status: string; topicId: string; userId: string; workspaceId: string };
beforeEach(() => {
  vi.clearAllMocks();
  role = 'member';
  operation = { status: 'running', topicId: 'topic', userId: 'user', workspaceId: 'workspace' };
  mocks.findById.mockImplementation(async () => ({ ...operation }));
  mocks.settleLive.mockImplementation(async () => {
    operation.status = 'interrupted';
    return true;
  });
  coordinator.loadAgentState.mockResolvedValue({
    status: 'running',
    stepCount: 1,
    origin: { userId: 'user', workspaceId: 'workspace' },
  });
  vi.mocked(getActiveWorkspaceMembershipRole).mockImplementation(async () => role);
});

const harness = () => {
  const guard = new WorkspaceExecutionGuard(db, 'user', 'workspace', coordinator);
  const service = Object.create(AgentRuntimeService.prototype) as AgentRuntimeService;
  Object.assign(service, { workspaceId: 'workspace', workspaceExecutionGuard: guard });
  return { guard, service };
};

describe('queued workspace execution revocation', () => {
  it.each(['running', 'waiting_for_human', 'waiting_for_async_tool', 'waiting_for_client'])(
    'ACKs a revoked %s delivery with durable terminal state and no step execution',
    async (status) => {
      const { guard, service } = harness();
      operation.status = status;
      await expect(guard.check('operation')).resolves.toBeNull();
      role = null;
      const result = await service.executeStep({ operationId: 'operation', stepIndex: 1 });
      expect(result).toMatchObject({
        success: true,
        nextStepScheduled: false,
        state: { status: 'interrupted' },
      });
      expect(operation.status).toBe('interrupted');
      expect(coordinator.markInterrupted).toHaveBeenCalledWith('operation');
      expect(coordinator.saveAgentState).toHaveBeenCalledWith(
        'operation',
        expect.objectContaining({ status: 'interrupted' }),
      );
      expect(mocks.settleTopic).toHaveBeenCalledWith('topic', 'operation', 'active');
      await expect(
        service.executeStep({ operationId: 'operation', stepIndex: 1 }),
      ).resolves.toMatchObject({ success: true, nextStepScheduled: false });
    },
  );
  it('does not schedule human, client or async-parent resumes for a downgraded viewer', async () => {
    const { service } = harness();
    role = 'viewer';
    await expect(
      service.processHumanIntervention({
        action: 'approve',
        operationId: 'operation',
        stepIndex: 1,
      }),
    ).resolves.toEqual({});
    await expect(service.resumeFromClientLlmWait({ operationId: 'operation' })).resolves.toEqual({
      resumed: false,
    });
    await expect(
      service.tryResumeParentFromAsyncTool({ parentOperationId: 'operation' }),
    ).resolves.toBe(false);
    await expect(service.startExecution({ operationId: 'operation' })).resolves.toMatchObject({
      scheduled: false,
    });
  });
  it('never executes another initiator or a missing workspace operation', async () => {
    const { guard } = harness();
    operation.userId = 'other';
    await expect(guard.check('operation')).rejects.toThrow('membership required');
    mocks.findById.mockResolvedValue(null);
    await expect(guard.check('missing')).rejects.toThrow('membership required');
    expect(coordinator.markInterrupted).not.toHaveBeenCalled();
  });
});
