import { agentSignal } from './agentSignal';
import { connectorOAuthState } from './connectorOAuthState';
import { deviceSystemInfo } from './deviceSystemInfo';
import { skillTools } from './skillTools';
import { workspaceRescan } from './workspaceRescan';

/** Business Redis API. Providers, keys and expiry policy stay inside each domain. */
export const redisService = {
  agentSignal,
  connectorOAuthState,
  deviceSystemInfo,
  skillTools,
  workspaceRescan,
};
