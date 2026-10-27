import { EventEmitter } from 'node:events';

export type ChangeScope =
  | 'projects'
  | 'structure'
  | 'chapter'
  | 'outline'
  | 'links'
  | 'foreshadow'
  | 'audio'
  | 'settings';

export interface ChangeEvent {
  scope: ChangeScope;
  projectId?: string;
  chapterId?: string;
  action?: string;
  source?: 'ui' | 'api' | 'system';
}

/** 主进程内部事件总线：任何数据变更都会广播给所有窗口，保持 UI 与 API 修改同步。 */
export class ChangeBus extends EventEmitter {
  emitChange(event: ChangeEvent): void {
    this.emit('change', event);
  }
}
