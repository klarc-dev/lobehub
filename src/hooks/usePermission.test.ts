import { describe, expect, it } from 'vitest';

import { hasWorkspacePermission } from './usePermission';

describe('workspace UI permissions', () => {
  it.each(['owner', 'admin'])('allows %s to manage native workspace settings', (role) => {
    expect(hasWorkspacePermission(role, 'manage_settings')).toBe(true);
    expect(hasWorkspacePermission(role, 'manage_provider_key')).toBe(true);
  });
  it.each(['member', 'viewer', 'unknown', undefined])(
    'does not grant %s administrative actions',
    (role) => {
      expect(hasWorkspacePermission(role, 'manage_settings')).toBe(false);
      expect(hasWorkspacePermission(role, 'manage_provider_key')).toBe(false);
      expect(hasWorkspacePermission(role, 'edit_others_content')).toBe(false);
    },
  );
  it('keeps viewer read-only even for formerly owned resources', () => {
    expect(hasWorkspacePermission('viewer', 'edit_own_content')).toBe(false);
    expect(hasWorkspacePermission('viewer', 'create_content')).toBe(false);
    expect(hasWorkspacePermission('member', 'create_content')).toBe(true);
  });
  it('fails closed for unknown capabilities', () => {
    expect(hasWorkspacePermission('owner', 'unknown')).toBe(false);
  });
});
