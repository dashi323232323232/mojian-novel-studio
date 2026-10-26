import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeOnBackdrop?: boolean;
}

export function Modal({
  open,
  title,
  subtitle,
  width = 'md',
  onClose,
  children,
  footer,
  closeOnBackdrop = true,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>(
        'input:not([type=checkbox]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
      );
      first?.focus();
    }, 40);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;
  const widthClass = width === 'sm' ? '' : width === 'lg' ? ' modal-wide' : width === 'xl' ? ' modal-xl' : '';
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${widthClass}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="modal-title">{title}</h2>
            {subtitle ? <div className="modal-subtitle">{subtitle}</div> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => undefined : onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {confirmText}
          </button>
        </>
      }
    >
      <div className="modal-subtitle" style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 14 }}>
        {message}
      </div>
      {children}
    </Modal>
  );
}
