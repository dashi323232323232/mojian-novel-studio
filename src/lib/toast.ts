import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'warn';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  ttl?: number;
}

interface ToastState {
  items: ToastItem[];
  push: (kind: ToastKind, message: string, ttl?: number) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (kind, message, ttl = 3800) => {
    const id = nextId++;
    set({ items: [...get().items, { id, kind, message, ttl }] });
    if (ttl > 0) {
      window.setTimeout(() => get().dismiss(id), ttl);
    }
    return id;
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (message: string) => useToastStore.getState().push('info', message),
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message, 6000),
  warn: (message: string) => useToastStore.getState().push('warn', message, 5000),
};
