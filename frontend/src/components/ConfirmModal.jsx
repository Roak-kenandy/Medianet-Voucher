import Modal from './Modal';

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Confirm action',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
}) {
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 0 }}>
        {message}
      </p>
      <div className="modal-footer" style={{ padding: '20px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
          onClick={handleConfirm}
          disabled={loading}
        >
          {loading ? 'Processing...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
