import { useCallback } from 'react';
import { useAppStore, type ViewKind } from '../store/app';
import { confirmLeave } from './leaveGuard';

/**
 * 统一的页面跳转：先经过编辑器未保存守卫，再切换视图。
 * 侧边栏、内容页、按钮等所有导航都应使用它。
 */
export function useNavigateGuard() {
  const navigate = useAppStore((s) => s.navigate);
  return useCallback(
    async (next: { view: ViewKind; projectId?: string | null; chapterId?: string | null; nodeId?: string | null }) => {
      const ok = await confirmLeave();
      if (!ok) return false;
      navigate(next);
      return true;
    },
    [navigate],
  );
}
