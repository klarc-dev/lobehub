import { useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { groupSidebarTopics, selectSidebarTopics } from '@/store/chat/slices/topic/selectors';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectTopics,
} from '@/store/projectWorkingDirectory';
import { useUserStore } from '@/store/user';
import { userProfileSelectors, workspaceUserSettingsSelectors } from '@/store/user/selectors';
import type { ChatTopic, TopicGroupMode, TopicSortBy } from '@/types/topic';

import { useTopicListReveal, useTopicListScope } from './TopicListScope';

export const useScopedTopics = () => {
  const scope = useTopicListScope();
  const request = useProjectDirectoryStore((s) => s.useFetchProjectTopics)(scope?.projectId);
  const rows = useProjectTopics(scope?.projectId);
  const topics = useMemo(
    () =>
      rows.map((topic) => ({
        ...topic,
        createdAt: new Date(topic.createdAt).getTime(),
        updatedAt: new Date(topic.updatedAt).getTime(),
        favorite: topic.favorite ?? false,
        metadata: topic.metadata ?? undefined,
        title: topic.title ?? '',
      })),
    [rows],
  );
  return { scope, topics, refresh: request.revalidate };
};

export const useScopedTopic = (id?: string) =>
  useScopedTopics().topics?.find((topic) => topic.id === id);

export const useScopedSidebarTopics = (
  pageSize: number,
  sortBy: TopicSortBy,
  groupMode: TopicGroupMode,
  includeCompleted: boolean,
) => {
  const { scope, topics } = useScopedTopics();
  const { topicId } = useActiveRouteParams<{ topicId?: string }>();
  // Project topics are already loaded in full, so "load more" only reveals more
  // rows through host-owned state (see `TopicListRevealContext`).
  const reveal = useTopicListReveal();
  const visibleLimit = pageSize + (reveal?.extraRows ?? 0);
  const running = useChatStore(operationSelectors.visiblyRunningTopicIds);
  const directories = useProjectDirectories(scope?.projectId);
  const activeWorkspaceId = useActiveWorkspaceId();
  const onlyMine = useUserStore(workspaceUserSettingsSelectors.topicOnlyMine(activeWorkspaceId));
  const userId = useUserStore(userProfileSelectors.userId);
  // Project topics arrive in full, so the "only mine" filter applies here
  // instead of on the server.
  const sidebarTopics = useMemo(
    () =>
      (topics ?? []).filter(
        (topic: ChatTopic) =>
          !topic.trigger || !MAIN_SIDEBAR_EXCLUDE_TRIGGERS.includes(topic.trigger),
      ),
    [topics],
  );
  const listed = useMemo(
    () => (onlyMine ? sidebarTopics.filter((topic) => topic.userId === userId) : sidebarTopics),
    [sidebarTopics, onlyMine, userId],
  );
  const visible = useMemo(
    () =>
      selectSidebarTopics(
        listed,
        visibleLimit,
        sortBy,
        includeCompleted,
        // The open topic stays listed even when the filter hides it.
        sidebarTopics.find((topic) => topic.id === topicId),
      ),
    [sidebarTopics, listed, topicId, visibleLimit, sortBy, includeCompleted],
  );
  const groups = useMemo(
    () => groupSidebarTopics(visible, groupMode, sortBy, running, directories),
    [visible, groupMode, sortBy, running, directories],
  );
  const hasMore =
    listed.filter((topic) => includeCompleted || topic.status !== 'completed').length >
    visibleLimit;
  return {
    scope,
    topics: visible,
    groups,
    activeTopicId: topicId,
    hasMore,
    loadMore: () => reveal?.revealMore(),
  };
};
