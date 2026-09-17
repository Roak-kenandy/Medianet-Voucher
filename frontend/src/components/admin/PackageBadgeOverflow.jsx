import { useState } from 'react';
import Modal from '../Modal';
import './PackageBadgeOverflow.css';

const DEFAULT_MAX_VISIBLE = 2;

export default function PackageBadgeOverflow({
  names = [],
  formatLabel = (name) => name,
  modalTitle = 'Packages',
  maxVisible = DEFAULT_MAX_VISIBLE,
  onShowMore,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const labels = names.map((name) => formatLabel(name)).filter(Boolean);

  if (!labels.length) return '—';

  const visible = labels.slice(0, maxVisible);
  const hiddenCount = labels.length - visible.length;

  const openModal = () => {
    if (onShowMore) {
      onShowMore({ labels, title: modalTitle });
      return;
    }
    setInternalOpen(true);
  };

  return (
    <>
      <div className="package-badge-overflow">
        {visible.map((label) => (
          <span key={label} className="badge badge-info package-badge-overflow-item" title={label}>
            {label}
          </span>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="package-badge-overflow-more"
            onClick={openModal}
            aria-label={`Show ${hiddenCount} more packages`}
          >
            +{hiddenCount}
          </button>
        )}
      </div>

      {!onShowMore && (
        <Modal
          open={internalOpen}
          onClose={() => setInternalOpen(false)}
          title={modalTitle}
          footer={(
            <button type="button" className="btn btn-secondary" onClick={() => setInternalOpen(false)}>
              Close
            </button>
          )}
        >
          <p className="package-badge-overflow-modal-count">
            {labels.length} package{labels.length === 1 ? '' : 's'} assigned
          </p>
          <div className="package-badge-overflow-modal-list">
            {labels.map((label) => (
              <span key={label} className="badge badge-info">
                {label}
              </span>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
