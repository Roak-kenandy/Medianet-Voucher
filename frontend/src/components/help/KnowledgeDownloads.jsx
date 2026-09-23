import { useState, useEffect } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import './knowledge-downloads.css';

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeDownloads() {
  const toast = useToast();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    operatorApi
      .getKnowledgeDocuments()
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = async (doc) => {
    setDownloadingId(doc.id);
    try {
      await operatorApi.downloadKnowledgeDocument(doc.id, doc.fileOriginalName);
    } catch (err) {
      toast.error(err.message || 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="knowledge-downloads-loading">
        <Loader2 size={20} className="spin" />
        <span>Loading guidelines…</span>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="knowledge-downloads-empty">
        No downloadable guidelines yet. Check back later or contact support.
      </p>
    );
  }

  return (
    <ul className="knowledge-downloads-list">
      {documents.map((doc) => (
        <li key={doc.id} className="knowledge-downloads-item">
          <div className="knowledge-downloads-icon">
            <FileText size={22} />
          </div>
          <div className="knowledge-downloads-meta">
            <div className="knowledge-downloads-title">{doc.title}</div>
            {doc.description && (
              <p className="knowledge-downloads-desc">{doc.description}</p>
            )}
            <span className="knowledge-downloads-file">
              {doc.fileOriginalName} · {formatFileSize(doc.fileSize)}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={downloadingId === doc.id}
            onClick={() => handleDownload(doc)}
          >
            {downloadingId === doc.id ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Download size={16} />
            )}
            Download
          </button>
        </li>
      ))}
    </ul>
  );
}
