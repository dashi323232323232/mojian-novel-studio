/**
 * 全局“离开保护”：编辑页注册一个异步守卫，导航/关窗前先询问。
 * 守卫返回 true 表示可以离开（已保存或用户确认放弃）。
 */
type LeaveGuard = () => Promise<boolean>;

let currentGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  currentGuard = guard;
}

export function hasLeaveGuard(): boolean {
  return currentGuard !== null;
}

export async function confirmLeave(): Promise<boolean> {
  if (!currentGuard) return true;
  try {
    return await currentGuard();
  } catch {
    return false;
  }
}

export async function guardedNavigate(action: () => void): Promise<void> {
  const ok = await confirmLeave();
  if (ok) action();
}
