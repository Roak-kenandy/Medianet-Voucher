import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, FileText } from 'lucide-react';
import Modal from '../../components/Modal';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import './admin-shared.css';

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const emptyForm = () => ({
  title: '',
  description: '',
  sortOrder: '0',
  isActive: true,
  file: null,
  fileLabel: '',
});

export default function KnowledgeBaseTab() {
  const toast = useToast();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadDocuments = () => {
    setLoading(true);
    adminApi
      .getKnowledgeDocuments()
      .then(setDocuments)
      .catch((err) => toast.error(err.message || 'Failed to load documents'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const openCreate = () => {
    setEditDoc(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (doc) => {
    setEditDoc(doc);
    setForm({
      title: doc.title,
      description: doc.description || '',
      sortOrder: String(doc.sortOrder ?? 0),
      isActive: doc.isActive,
      file: null,
      fileLabel: doc.fileOriginalName,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditDoc(null);
    setForm(emptyForm());
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setForm({ ...form, file, fileLabel: file.name });
  };

  const buildFormData = () => {
    const fd = new FormData();
    fd.append('title', form.title.trim());
    fd.append('description', form.description.trim());
    fd.append('sortOrder', form.sortOrder || '0');
    fd.append('isActive', form.isActive ? 'true' : 'false');
    if (form.file) fd.append('file', form.file);
    return fd;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!editDoc && !form.file) {
      toast.error('Upload a PDF or Word document');
      return;
    }

    setSubmitting(true);
    try {
      const fd = buildFormData();
      if (editDoc) {
        await adminApi.updateKnowledgeDocument(editDoc.id, fd);
        toast.success('Document updated');
      } else {
        await adminApi.createKnowledgeDocument(fd);
        toast.success('Document published');
      }
      closeModal();
      loadDocuments();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await adminApi.deleteKnowledgeDocument(deleteTarget.id);
      toast.success('Document removed');
      setDeleteTarget(null);
      loadDocuments();
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  return (
    <>
      <div className="card">
        <div className="card-header activation-report-header">
          <div>
            <h3 className="card-title">Guidelines &amp; downloads</h3>
            <p className="card-subtitle">
              Operators download these from Help Center. PDF or Word · max 15 MB.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={16} />
            Upload document
          </button>
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : documents.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No documents yet</p>
              <p>Upload operator guides, process PDFs, or training material.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>File</th>
                    <th>Size</th>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{doc.title}</div>
                        {doc.description && (
                          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                            {doc.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-neutral">
                          <FileText size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                          {doc.fileOriginalName}
                        </span>
                      </td>
                      <td>{formatFileSize(doc.fileSize)}</td>
                      <td>{doc.sortOrder}</td>
                      <td>
                        <span className={`badge ${doc.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {doc.isActive ? 'Published' : 'Hidden'}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(doc)}>
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-danger-outline"
                            onClick={() => setDeleteTarget(doc)}
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

      <Modal open={modalOpen} onClose={closeModal} title={editDoc ? 'Edit document' : 'Upload document'}>
        <form onSubmit={handleSubmit} className="form-grid">
          <div className="form-group form-group-full">
            <label className="form-label">Title</label>
            <input
              className="form-input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Operator portal guide"
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
              placeholder="What this document covers"
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
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <span>Published (visible in Help Center)</span>
            </label>
          </div>
          <div className="form-group form-group-full">
            <label className="form-label">{editDoc ? 'Replace file (optional)' : 'Document file'}</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onFileChange}
            />
            {form.fileLabel && (
              <p className="form-hint">Selected: {form.fileLabel}</p>
            )}
          </div>
          <div className="form-group form-group-full modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : editDoc ? 'Save changes' : 'Upload'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Delete document?">
        <p>
          Remove <strong>{deleteTarget?.title}</strong>? Operators will no longer see it in Help Center.
        </p>
        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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
