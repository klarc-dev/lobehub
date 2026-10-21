import type { AgentState } from '@lobechat/agent-runtime';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';

import {
  assertWorkspaceExecutionAllowed,
  WorkspaceExecutionDeniedError,
} from '../workspaceExecutionAuthorization';
import type { AgentExecutionResult } from './types';

const terminalResult = (status: 'done' | 'error' | 'interrupted'): AgentExecutionResult => ({
  nextStepScheduled: false,
  state: { status },
  stepResult: null,
  success: true,
});

/** Cleanup is deliberately local: revocation must not dispatch user completion hooks. */
export class WorkspaceExecutionGuard {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId: string | undefined,
    private readonly coordinator: Pick<
      AgentRuntimeCoordinator,
      'loadAgentState' | 'markInterrupted' | 'saveAgentState'
    >,
    private readonly model: AgentOperationModel = new AgentOperationModel(db, userId, workspaceId),
  ) {}

  /** Resume gates do not change legacy personal operation behavior. */
  checkWorkspace(operationId: string): Promise<AgentExecutionResult | null> {
    return this.workspaceId === undefined ? Promise.resolve(null) : this.check(operationId);
  }

  assertStateScope(state: AgentState): void {
    if (
      (state.origin?.workspaceId ?? undefined) !== this.workspaceId ||
      (state.origin?.userId && state.origin.userId !== this.userId)
    ) {
      throw new WorkspaceExecutionDeniedError();
    }
  }

  async check(operationId: string): Promise<AgentExecutionResult | null> {
    const model = this.model;
    // Keep legacy personal runtime availability on transient durable-store errors.
    const operation =
      this.workspaceId === undefined
        ? await model.findById(operationId).catch((error) => {
            console.error('Personal operation status check failed:', error);
            return null;
          })
        : await model.findById(operationId);

    if (this.workspaceId !== undefined) {
      // A workspace-scoped model can read other members' operations. Only the
      // persisted initiating principal may execute one, never a supplied scope.
      if (
        !operation ||
        operation.userId !== this.userId ||
        operation.workspaceId !== this.workspaceId
      )
        throw new WorkspaceExecutionDeniedError();
      try {
        await assertWorkspaceExecutionAllowed({
          db: this.db,
          userId: operation.userId,
          workspaceId: operation.workspaceId,
        });
      } catch (error) {
        if (!(error instanceof WorkspaceExecutionDeniedError)) throw error;
        const state = await this.coordinator.loadAgentState(operationId);
        await this.coordinator.markInterrupted(operationId);
        if (state && !['done', 'error', 'interrupted'].includes(state.status)) {
          const interrupted: AgentState = {
            ...state,
            clientLlmWait: undefined,
            lastModified: new Date().toISOString(),
            status: 'interrupted',
          };
          await this.coordinator.saveAgentState(operationId, interrupted);
        }
        await model.settleLive(operationId, 'interrupted');
        if (operation.topicId) {
          await new TopicModel(this.db, this.userId, this.workspaceId).settleRunningOperation(
            operation.topicId,
            operationId,
            'active',
          );
        }
        return terminalResult('interrupted');
      }
    }
    if (operation && ['done', 'error', 'interrupted', 'abandoned'].includes(operation.status)) {
      return terminalResult(
        operation.status === 'done'
          ? 'done'
          : operation.status === 'error'
            ? 'error'
            : 'interrupted',
      );
    }
    return null;
  }
}
