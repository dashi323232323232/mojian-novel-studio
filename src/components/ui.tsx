import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import { useToastStore } from '../lib/toast';

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'info' ? '' : t.kind}`}>
          {t.kind === 'success' ? (
            <CheckCircle2 size={16} style={{ marginTop: 1, flex: '0 0 auto' }} />
          ) : t.kind === 'error' ? (
            <XCircle size={16} style={{ marginTop: 1, flex: '0 0 auto' }} />
          ) : t.kind === 'warn' ? (
            <AlertTriangle size={16} style={{ marginTop: 1, flex: '0 0 auto' }} />
          ) : (
            <Info size={16} style={{ marginTop: 1, flex: '0 0 auto' }} />
          )}
          <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{t.message}</div>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** 点击外部关闭的浮层菜单。 */
export function useClickOutside<T extends HTMLElement>(onOutside: () => void, active: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOutside();
    };
    window.addEventListener('mousedown', handler);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('keydown', key);
    };
  }, [active, onOutside]);
  return ref;
}

export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function DropdownMenu({
  items,
  align = 'left',
  label,
  className,
  children,
}: {
  items: (MenuItem | 'sep' | { label: string; key: string })[];
  align?: 'left' | 'right';
  label?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  return (
    <div className={`menu-anchor ${className ?? ''}`} ref={ref}>
      <button
        className={className ?? 'icon-btn'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={label ?? '菜单'}
        title={label}
      >
        {children}
      </button>
      {open ? (
        <div className={`menu ${align === 'right' ? 'right' : ''}`} onClick={(e) => e.stopPropagation()}>
          {items.map((item, idx) => {
            if (item === 'sep') return <div className="menu-sep" key={`sep-${idx}`} />;
            if ('label' in item && !('onClick' in item)) {
              return (
                <div className="menu-label" key={item.key}>
                  {item.label}
                </div>
              );
            }
            const mi = item as MenuItem;
            return (
              <button
                key={mi.key}
                className={`menu-item${mi.danger ? ' danger' : ''}`}
                disabled={mi.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  mi.onClick();
                }}
              >
                {mi.icon}
                {mi.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Spinner({ large }: { large?: boolean }) {
  return <span className={`spinner${large ? ' lg' : ''}`} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="icon-wrap">{icon}</div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
