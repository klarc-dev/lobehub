import { DeviceModel } from '@/database/models/device';
import type { LobeChatDatabase } from '@/database/type';

/** Address a registered workspace device without reclassifying personal devices. */
export const resolveDeviceWorkspaceId = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  deviceId: string | undefined,
): Promise<string | undefined> => {
  if (!deviceId || !workspaceId) return undefined;
  const row = await new DeviceModel(db, userId, workspaceId).findWorkspaceDeviceById(deviceId);
  return row ? workspaceId : undefined;
};
