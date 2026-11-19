import type { useActivityUnread } from '../ActivityUnreadProvider';

export type RegisterRefresh = (refresh: () => Promise<void>) => () => void;
export type MarkRead = ReturnType<typeof useActivityUnread>['markRead'];
