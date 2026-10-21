import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { redisService } from '@/server/services/redis';

const log = debug('lobe-server:connector:oauth-state');

export interface ConnectorOAuthStatePayload {
  /** Authorization server resolved at start; reused at exchange to avoid drift. */
  authorizationServerUrl: string;
  /** PKCE verifier — must round-trip to the token exchange. */
  codeVerifier: string;
  /** The connector being connected. */
  connectorId: string;
  /** LobeHub user who initiated the connect. */
  lobeUserId: string;
  /** Where to send the user after the callback finishes (relative path). */
  returnTo?: string;
  /** Issuance timestamp (ms epoch) for diagnostics. */
  ts: number;
  /**
   * Workspace the connector belongs to. The callback has no request context of
   * its own, so it must reuse this to find workspace-scoped connectors.
   */
  workspaceId?: string;
}

/** Generate an opaque, single-use state value to embed in the authorize URL. */
export const generateConnectorOAuthState = (): string => randomUUID().replaceAll('-', '');

/**
 * Persist the connect-flow payload under an explicit `state` value. The state
 * is chosen first (so it can be embedded in the authorize URL), then the PKCE
 * verifier returned by `startAuthorization` is stored alongside it. Same
 * Redis-backed single-use pattern as the messenger Slack OAuth state store
 * (TTL expiry, delete-on-consume, no replay).
 */
export const saveConnectorOAuthState = async (
  state: string,
  payload: Omit<ConnectorOAuthStatePayload, 'ts'>,
): Promise<void> => {
  const value: ConnectorOAuthStatePayload = { ...payload, ts: Date.now() };

  await redisService.connectorOAuthState.save(state, JSON.stringify(value));
  log(
    'saved connector OAuth state for user=%s connector=%s',
    payload.lobeUserId,
    payload.connectorId,
  );
};

/**
 * Atomically read + delete the state. Replay is impossible after the first
 * consume. Returns null if invalid / expired / already consumed.
 */
export const consumeConnectorOAuthState = async (
  state: string,
): Promise<ConnectorOAuthStatePayload | null> => {
  const raw = await redisService.connectorOAuthState.consume(state);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ConnectorOAuthStatePayload;
  } catch {
    return null;
  }
};
