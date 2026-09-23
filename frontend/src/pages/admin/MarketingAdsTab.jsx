import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, ImageIcon } from 'lucide-react';
import Modal from '../../components/Modal';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import './admin-shared.css';
import './marketing-ads.css';

function ScheduleBadge({ status }) {
  const map = {
    live: 'badge-success',
    scheduled: 'badge-warning',
    ended: 'badge-neutral',
    inactive: 'badge-danger',
  };
  const labels = {
    live: 'Live',
    scheduled: 'Scheduled',
    ended: 'Ended',
    inactive: 'Inactive',
  };
  return (
    <span className={`badge ${map[status] || 'badge-neutral'}`}>
      {labels[status] || status}
    </span>
  );
}

function formatDateInputValue(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

const emptyForm = () => ({
  title: '',
  description: '',
  displayStart: new Date().toISOString().slice(0, 10),
  displayEnd: '',
  linkUrl: '',
  sortOrder: '0',
  isActive: true,
  imageFile: null,
  imagePreview: null,
});

export default function MarketingAdsTab() {
  const toast = useToast();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editAd, setEditAd] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadAds = () => {
    setLoading(true);
    adminApi
      .getMarketingAds()
      .then(setAds)
      .catch((err) => toast.error(err.message || 'Failed to load ads'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAds();
  }, []);

  const openCreate = () => {
    setEditAd(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (ad) => {
    setEditAd(ad);
    setForm({
      title: ad.title,
      description: ad.description || '',
      displayStart: formatDateInputValue(ad.displayStart),
      displayEnd: formatDateInputValue(ad.displayEnd),
      linkUrl: ad.linkUrl || '',
      sortOrder: String(ad.sortOrder ?? 0),
      isActive: ad.isActive,
      imageFile: null,
      imagePreview: ad.imageUrl,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (form.imagePreview && form.imageFile) {
      URL.revokeObjectURL(form.imagePreview);
    }
    setModalOpen(false);
    setEditAd(null);
    setForm(emptyForm());
  };

  const onImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (form.imagePreview && form.imageFile) {
      URL.revokeObjectURL(form.imagePreview);
    }
    setForm({
      ...form,
      imageFile: file,
      imagePreview: URL.createObjectURL(file),
    });
  };

  const buildFormData = () => {
    const fd = new FormData();
    fd.append('title', form.title.trim());
    fd.append('description', form.description.trim());
    fd.append('displayStart', form.displayStart);
    if (form.displayEnd) fd.append('displayEnd', form.displayEnd);
    if (form.linkUrl.trim()) fd.append('linkUrl', form.linkUrl.trim());
    fd.append('sortOrder', form.sortOrder || '0');
    fd.append('isActive', form.isActive ? 'true' : 'false');
    if (form.imageFile) fd.append('image', form.imageFile);
    return fd;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!editAd && !form.imageFile) {
      toast.error('Upload an image for the ad');
      return;
    }

    setSubmitting(true);
    try {
      const fd = buildFormData();
      if (editAd) {
        await adminApi.updateMarketingAd(editAd.id, fd);
        toast.success('Ad updated');
      } else {
        await adminApi.createMarketingAd(fd);
        toast.success('Ad created');
      }
      closeModal();
      loadAds();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await adminApi.deleteMarketingAd(deleteTarget.id);
      toast.success('Ad deleted');
      setDeleteTarget(null);
      loadAds();
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  return (
    <>
      <div className="card">
        <div className="card-header activation-report-header">
          <div>
            <h3 className="card-title">Campaigns</h3>
            <p className="card-subtitle">
              Upload promotional banners. Live ads appear on the operator dashboard during the display window.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={16} />
            New ad
          </button>
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : ads.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No marketing ads yet</p>
              <p>Create your first campaign to show operators a promo banner on their dashboard.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table marketing-ads-table">
                <thead>
                  <tr>
                    <th>Preview</th>
                    <th>Title</th>
                    <th>Display window</th>
                    <th>Status</th>
                    <th>Order</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ads.map((ad) => (
                    <tr key={ad.id}>
                      <td>
                        {ad.imageUrl ? (
                          <img src={ad.imageUrl} alt="" className="marketing-ad-thumb" />
                        ) : (
                          <span className="marketing-ad-thumb-placeholder">
                            <ImageIcon size={18} />
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{ad.title}</div>
                        {ad.description && (
                          <div className="marketing-ad-desc-preview">{ad.description}</div>
                        )}
                      </td>
                      <td className="marketing-ad-dates">
                        {formatDateInputValue(ad.displayStart)}
                        {' → '}
                        {ad.displayEnd ? formatDateInputValue(ad.displayEnd) : 'No end date'}
                      </td>
                      <td><ScheduleBadge status={ad.scheduleStatus} /></td>
                      <td>{ad.sortOrder}</td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(ad)}>
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-danger-outline"
                            onClick={() => setDeleteTarget(ad)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={editAd ? 'Edit marketing ad' : 'New marketing ad'}>
        <form onSubmit={handleSubmit} className="form-grid marketing-ad-form">
          <div className="form-group form-group-full">
            <label className="form-label">Title</label>
            <input
              className="form-input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. EPL live on Medianet TV"
              required
            />
          </div>
          <div className="form-group form-group-full">
            <label className="form-label">Description</label>
            <textarea
              className="form-input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short message shown with the banner on the operator dashboard"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Display from</label>
            <input
              type="date"
              className="form-input"
              value={form.displayStart}
              onChange={(e) => setForm({ ...form, displayStart: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Display until (optional)</label>
            <input
              type="date"
              className="form-input"
              value={form.displayEnd}
              onChange={(e) => setForm({ ...form, displayEnd: e.target.value })}
            />
          </div>
          <div className="form-group form-group-full">
            <label className="form-label">Click-through link (optional)</label>
            <input
              type="url"
              className="form-input"
              value={form.linkUrl}
              onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div className="form-group">
            <label className="form-label">Sort order</label>
            <input
              type="number"
              min={0}
              className="form-input"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            />
            <p className="form-hint">Lower numbers show first when multiple ads are live.</p>
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <span>Active</span>
            </label>
          </div>
          <div className="form-group form-group-full">
            <label className="form-label">{editAd ? 'Replace image (optional)' : 'Banner image'}</label>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onImageChange} />
            <p className="form-hint">
              JPG, PNG, or WebP · max 5 MB · use square artwork (1080×1080 or 1200×1200) so the full
              banner shows in the slideshow without cropping.
            </p>
            {form.imagePreview && (
              <img src={form.imagePreview} alt="" className="marketing-ad-form-preview" />
            )}
          </div>
          <div className="form-group form-group-full modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : editAd ? 'Save changes' : 'Create ad'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete ad?"
      >
        <p>
          Delete <strong>{deleteTarget?.title}</strong>? This removes the banner from operator dashboards.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </Modal>
    </>
  );
}
