import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Plus, Trash2, Download, List } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { sanitizePhoneInput, getPhoneValidationMessage, PHONE_HINT, PHONE_TEMPLATE_EXAMPLES } from '../../utils/phone';

const MAX_BULK = 10;

function emptyRow() {
  return { fullName: '', phoneNumber: '', key: crypto.randomUUID() };
}

function ResultStatusBadge({ status }) {
  const map = {
    created: 'badge-success',
    failed: 'badge-danger',
  };
  return (
    <span className={`badge ${map[status] || 'badge-neutral'}`}>
      {status}
    </span>
  );
}

export default function BulkUploadPage() {
  const toast = useToast();
  const [rows, setRows] = useState([emptyRow(), emptyRow(), emptyRow()]);
  const [remaining, setRemaining] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    operatorApi.getStats().then((s) => setRemaining(s.remainingQuota));
  }, []);

  const filledRows = rows.filter((r) => r.fullName.trim() || r.phoneNumber.trim());
  const canAddMore = rows.length < MAX_BULK && rows.length < (remaining ?? MAX_BULK);

  const addRow = () => {
    if (rows.length >= MAX_BULK) return;
    setRows([...rows, emptyRow()]);
  };

  const removeRow = (key) => {
    if (rows.length <= 1) return;
    setRows(rows.filter((r) => r.key !== key));
  };

  const updateRow = (key, field, value) => {
    const nextValue = field === 'phoneNumber' ? sanitizePhoneInput(value) : value;
    setRows(rows.map((r) => (r.key === key ? { ...r, [field]: nextValue } : r)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResults(null);

    const accounts = rows
      .filter((r) => r.fullName.trim() && r.phoneNumber.trim())
      .map(({ fullName, phoneNumber }) => ({
        fullName,
        phoneNumber: sanitizePhoneInput(phoneNumber),
      }));

    if (accounts.length === 0) {
      setError('Add at least one complete account entry');
      return;
    }

    const invalidEntry = accounts.find((account) => getPhoneValidationMessage(account.phoneNumber));
    if (invalidEntry) {
      setError(getPhoneValidationMessage(invalidEntry.phoneNumber));
      return;
    }

    if (accounts.length > MAX_BULK) {
      setError(`Maximum ${MAX_BULK} accounts per bulk upload`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await operatorApi.createBulkAccounts(accounts);
      setRemaining(result.remainingQuota);
      setResults(result.created);

      const successCount = result.created.filter((r) => r.status === 'created').length;
      const failedCount = result.created.length - successCount;

      if (failedCount === 0) {
        toast.success(`${successCount} account(s) created successfully`);
      } else if (successCount === 0) {
        toast.error(`All ${failedCount} account(s) failed`);
      } else {
        toast.warning(`${successCount} created, ${failedCount} failed — see results below`);
      }

      setRows([emptyRow(), emptyRow(), emptyRow()]);
    } catch (err) {
      const message = err.message || 'Bulk upload failed';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = `fullName,phoneNumber\nExample Customer,${PHONE_TEMPLATE_EXAMPLES[0]}\nExample Customer 2,${PHONE_TEMPLATE_EXAMPLES[1]}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk-upload-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== 'string') return;

      const lines = text.split('\n').slice(1).filter((l) => l.trim());
      const parsed = lines.slice(0, MAX_BULK).map((line) => {
        const [fullName, phoneNumber] = line.split(',').map((s) => s.trim());
        return {
          fullName: fullName || '',
          phoneNumber: sanitizePhoneInput(phoneNumber || ''),
          key: crypto.randomUUID(),
        };
      });

      if (parsed.length > 0) {
        setRows(parsed);
        setResults(null);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const resultSuccessCount = results?.filter((r) => r.status === 'created').length || 0;
  const resultFailedCount = results ? results.length - resultSuccessCount : 0;

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Bulk Upload</h1>
          <p className="page-subtitle">
            Upload up to {MAX_BULK} accounts at a time
            {remaining !== null && ` · ${remaining.toLocaleString()} quota remaining`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={downloadTemplate}>
            <Download size={16} /> Template
          </button>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            <Upload size={16} /> Import CSV
            <input type="file" accept=".csv" onChange={handleFileUpload} hidden />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Account Entries</h3>
          <p className="card-subtitle">
            {filledRows.length} of {rows.length} rows filled · Max {MAX_BULK} per upload · {PHONE_HINT}
          </p>
        </div>
        <div className="card-body">
          {error && <div className="alert alert-error">{error}</div>}

          {remaining === 0 && (
            <div className="alert alert-info">
              You have reached your account creation quota.
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Full Name</th>
                    <th>Phone Number</th>
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.key}>
                      <td>{idx + 1}</td>
                      <td>
                        <input
                          className="form-input"
                          value={row.fullName}
                          onChange={(e) => updateRow(row.key, 'fullName', e.target.value)}
                          placeholder="Customer name"
                          disabled={remaining === 0}
                        />
                      </td>
                      <td>
                        <input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel-national"
                          className="form-input"
                          value={row.phoneNumber}
                          onChange={(e) => updateRow(row.key, 'phoneNumber', e.target.value)}
                          placeholder="9XXXXXX"
                          maxLength={7}
                          pattern="[79][0-9]{6}"
                          aria-label={`Phone number row ${idx + 1}`}
                          disabled={remaining === 0}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => removeRow(row.key)}
                          disabled={rows.length <= 1}
                          aria-label="Remove row"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addRow}
                disabled={!canAddMore || remaining === 0}
              >
                <Plus size={16} /> Add Row
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || remaining === 0 || filledRows.length === 0}
              >
                <Upload size={16} />
                {submitting ? 'Uploading...' : `Submit ${filledRows.length} Account(s)`}
              </button>
            </div>
          </form>

          {results && results.length > 0 && (
            <div className="bulk-results">
              <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Upload Results</h4>
              <div className="bulk-results-summary">
                <span className="badge badge-success">{resultSuccessCount} created</span>
                {resultFailedCount > 0 && (
                  <span className="badge badge-danger">{resultFailedCount} failed</span>
                )}
              </div>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 500 }}>{row.fullName}</td>
                        <td>{row.phoneNumber}</td>
                        <td><ResultStatusBadge status={row.status} /></td>
                        <td>
                          {row.status === 'failed' ? (
                            <span className="error-cell">{row.errorMessage}</span>
                          ) : row.externalRef ? (
                            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                              Ref: {row.externalRef}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 16 }}>
                <Link to="/operator/accounts" className="btn btn-secondary btn-sm">
                  <List size={16} /> View all accounts
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
