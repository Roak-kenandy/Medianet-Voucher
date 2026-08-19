import { X } from 'lucide-react';

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  extraWide = false,
}) {
  if (!open) return null;

  const sizeClass = extraWide ? ' modal-extra-wide' : wide ? ' modal-wide' : '';

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className={`modal${sizeClass}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <h3 className="modal-title" id="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
