import { type LobeTool } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { pluginService } from '@/services/plugin';
import { merge } from '@/utils/merge';

import { useToolStore } from '../../store';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: vi.fn(),
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/services/plugin', () => ({
  pluginService: {
    getPluginForEdit: vi.fn(),
    getInstalledPlugins: vi.fn().mockResolvedValue([]),
    updatePluginSettings: vi.fn(),
  },
}));

beforeEach(() => {
  // Reset all mocks before each test
  vi.resetAllMocks();
  vi.mocked(getActiveWorkspaceId).mockReturnValue(null);
});

describe('useToolStore:plugin', () => {
  describe('checkPluginsIsInstalled', () => {
    it('should be deprecated and do nothing', async () => {
      // Old plugin system has been deprecated
      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.checkPluginsIsInstalled(['plugin1', 'plugin2']);
      });

      // Should not call any methods since old plugin system is deprecated
    });
  });

  describe('updatePluginSettings', () => {
    it('merges workspace edits over protected detail, never the redacted inventory', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('team');
      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
        { identifier: 'shared', type: 'plugin' },
      ]);
      vi.mocked(pluginService.getPluginForEdit).mockResolvedValue({
        identifier: 'shared',
        settings: { apiKey: 'OWNER_SENTINEL', label: 'old' },
        type: 'plugin',
      });
      const { result } = renderHook(() => useToolStore());
      await act(async () => result.current.updatePluginSettings('shared', { label: 'new' }));
      expect(pluginService.updatePluginSettings).toHaveBeenCalledWith(
        'shared',
        { apiKey: 'OWNER_SENTINEL', label: 'new' },
        expect.any(AbortSignal),
      );
      expect(JSON.stringify(useToolStore.getState().installedPlugins)).not.toContain(
        'OWNER_SENTINEL',
      );
    });

    it('should update settings for a given plugin', async () => {
      const pluginId = 'test-plugin';
      const newSettings = { setting1: 'new-value' };
      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
        { identifier: pluginId, type: 'plugin' } as LobeTool,
      ]);

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.updatePluginSettings(pluginId, newSettings);
      });

      expect(pluginService.updatePluginSettings).toBeCalledWith(
        pluginId,
        newSettings,
        expect.any(AbortSignal),
      );
    });

    it('should merge settings for a plugin with existing settings', async () => {
      const pluginId = 'test-plugin';
      const existingSettings = { setting1: 'old-value', setting2: 'old-value' };
      const newSettings = { setting1: 'new-value' };
      const mergedSettings = merge(existingSettings, newSettings);
      // The merge base is the server's record, loaded before the write.
      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
        { identifier: pluginId, settings: existingSettings, type: 'plugin' } as LobeTool,
      ]);

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.updatePluginSettings(pluginId, newSettings);
      });

      expect(pluginService.updatePluginSettings).toBeCalledWith(
        pluginId,
        mergedSettings,
        expect.any(AbortSignal),
      );
    });
  });

  describe('validatePluginSettings', () => {
    // 模拟插件数据
    const testPluginId = 'test-plugin';
    // 定义测试用的 schema 和模拟的验证结果
    const testSchema = {
      properties: { abc: { type: 'string' } },
      required: ['abc'],
      type: 'object',
    };

    const testPluginSettings = { abc: 'valid-string' };

    const testPlugin = {
      type: 'plugin',
      identifier: testPluginId,
      manifest: {
        identifier: testPluginId,
        settings: testSchema,
      },
      settings: testPluginSettings,
    } as unknown as LobeTool;

    it('should validate settings against the schema and return valid result', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          installedPlugins: [testPlugin],
        });
      });

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toEqual({ valid: true, errors: [] });
    });

    it('should return invalid result if settings do not match the schema', async () => {
      const { result } = renderHook(() => useToolStore());
      act(() => {
        useToolStore.setState({
          installedPlugins: [{ ...testPlugin, settings: {} }] as any,
        });
      });

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toMatchSnapshot();
    });

    it('should return undefined if manifest or settings are not found', async () => {
      useToolStore.setState({
        installedPlugins: [],
      });

      const { result } = renderHook(() => useToolStore());

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toBeUndefined();
    });
  });
});
