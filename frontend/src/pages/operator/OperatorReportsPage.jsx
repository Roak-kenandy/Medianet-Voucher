import { useState, useCallback } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import {
  formatColumnLabel,
  formatSummaryLabel,
  formatCellValue,
  formatSummaryValue,
  isTextSummaryKey,
  downloadBlob,
} from '../../utils/reports';
import { getDefaultReportDateRange } from '../../utils/dates';
import '../admin/admin-shared.css';

const REPORT_PAGE_SIZE = 50;

export default function OperatorReportsPage() {
  const toast = useToast();
  const defaultRange = getDefaultReportDateRange();
  const [filters, setFilters] = useState({
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);

  const buildParams = useCallback(
    (overrides = {}) => ({
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      page: overrides.page ?? tablePage,
      limit: REPORT_PAGE_SIZE,
      search: overrides.search !== undefined ? overrides.search || undefined : tableSearch || undefined,
    }),
    [filters, tablePage, tableSearch]
  );

  const loadReport = async ({ page = 1, search = '', fullScreenLoad = false, keepSummary = false }) => {
    if (fullScreenLoad) setLoading(true);
    else setTableLoading(true);
    try {
      const data = await operatorApi.generateReport(buildParams({ page, search: search || undefined }));
      setReport((prev) => ({
        ...data,
        summary: data.summary ?? (keepSummary ? prev?.summary : null),
      }));
      setTablePage(page);
      setTableSearch(search);
      const total = data.pagination?.total ?? data.rows?.length ?? 0;
      if (fullScreenLoad) {
        toast.success(`Report ready — ${total.toLocaleString()} row(s) total`);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setLoading(false);
      setTableLoading(false);
    }
  };

  const generate = () => loadReport({ page: 1, search: '', fullScreenLoad: true });

  const exportCsv = async () => {
    try {
      toast.success('Preparing download…');
      const blob = await operatorApi.exportReport({
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      });
      downloadBlob(blob, 'my-activity-report.csv');
      toast.success('Report downloaded successfully');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    }
  };

  const columns = report?.rows?.[0] ? Object.keys(report.rows[0]) : [];
  const pagination = report?.pagination || {
    page: tablePage,
    limit: REPORT_PAGE_SIZE,
    total: report?.rows?.length || 0,
    totalPages: 1,
  };

  const handleTableSearchChange = (value) => {
    if (report) {
      loadReport({ page: 1, search: value, keepSummary: true });
    } else {
      setTableSearch(value);
      setTablePage(1);
    }
  };

  const handleTablePageChange = (page) => {
    if (report) {
      loadReport({ page, search: tableSearch, keepSummary: true });
    } else {
      setTablePage(page);
    }
  };

  const canExport =
    (report?.pagination?.total ?? 0) > 0 ||
    (report?.rows?.length ?? 0) > 0 ||
    Boolean(report?.summary);

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Account Reports</h1>
        <p className="page-subtitle">
          Account creation activity by date range. Results load in pages; CSV export includes all rows.
        </p>
      </div>

      <div className="card reports-panel" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <div className="reports-filters" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div className="form-group">
              <label className="form-label">Start Date</label>
              <input
                type="date"
                className="form-input"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">End Date</label>
              <input
                type="date"
                className="form-input"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>
          </div>

          <div className="reports-actions">
            <button className="btn btn-primary" onClick={generate} disabled={loading}>
              <FileBarChart size={18} />
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
            {canExport && (
              <button className="btn btn-secondary" onClick={exportCsv} disabled={loading}>
                <Download size={18} /> Download CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {report?.summary && (
        <div className="reports-summary">
          {Object.entries(report.summary).map(([key, val]) => {
            const textValue = formatSummaryValue(key, val);
            const isText = isTextSummaryKey(key);
            return (
              <div className="stat-card" key={key}>
                <div className="stat-card-label">{formatSummaryLabel(key)}</div>
                <div
                  className={`stat-card-value${isText ? ' is-text' : ''}${isText && String(textValue).length > 36 ? ' is-compact' : ''}`}
                  title={isText ? textValue : undefined}
                >
                  {textValue}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {report && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Account Activity</h3>
            <p className="card-subtitle">
              Generated {new Date(report.generatedAt).toLocaleString()}
              {pagination.total != null && <> · {pagination.total.toLocaleString()} total rows</>}
            </p>
          </div>
          {(report.rows.length > 0 || pagination.total > 0) && (
            <TableToolbar
              value={tableSearch}
              onChange={handleTableSearchChange}
              placeholder="Search report results..."
            />
          )}
          <div className="card-body" style={{ padding: 0 }}>
            {tableLoading ? (
              <div className="loading-screen" style={{ height: 120 }}>
                <div className="spinner" />
              </div>
            ) : pagination.total === 0 ? (
              <div className="empty-state"><p>No accounts found for the selected period</p></div>
            ) : report.rows.length === 0 ? (
              <div className="empty-state"><p>No rows match your search</p></div>
            ) : (
              <>
                <div className="table-wrapper reports-table">
                  <table className="table">
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th key={c}>{formatColumnLabel(c)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row, i) => (
                        <tr key={i}>
                          {columns.map((c) => (
                            <td key={c}>{formatCellValue(c, row[c])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  total={pagination.total}
                  limit={pagination.limit}
                  onPageChange={handleTablePageChange}
                  itemLabel="rows"
                />
              </>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
