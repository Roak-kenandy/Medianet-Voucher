import { useState } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import TableToolbar, { useClientTable } from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { formatColumnLabel, formatSummaryLabel, formatCellValue, downloadCsv } from '../../utils/reports';
import { getDefaultReportDateRange } from '../../utils/dates';
import '../admin/admin-shared.css';

export default function OperatorReportsPage() {
  const toast = useToast();
  const defaultRange = getDefaultReportDateRange();
  const [filters, setFilters] = useState({
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);

  const buildParams = () => ({
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
  });

  const generate = async () => {
    setLoading(true);
    try {
      const data = await operatorApi.generateReport(buildParams());
      setReport(data);
      setTableSearch('');
      setTablePage(1);
      toast.success(`Report generated — ${data.rows?.length || 0} row(s)`);
    } catch (err) {
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    try {
      const csv = await operatorApi.exportReport(buildParams());
      downloadCsv(csv, 'my-activity-report.csv');
      toast.success('Report downloaded successfully');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    }
  };

  const columns = report?.rows?.[0] ? Object.keys(report.rows[0]) : [];
  const { rows: pagedRows, pagination: tablePagination } = useClientTable(report?.rows || [], {
    search: tableSearch,
    page: tablePage,
    limit: 20,
    columns,
  });

  const handleTableSearchChange = (value) => {
    setTableSearch(value);
    setTablePage(1);
  };

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Download your account activity and quota summary</p>
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
            {(report?.rows?.length > 0 || report?.summary) && (
              <button className="btn btn-secondary" onClick={exportCsv}>
                <Download size={18} /> Download CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {report?.summary && (
        <div className="reports-summary">
          {Object.entries(report.summary).map(([key, val]) => (
            <div className="stat-card" key={key}>
              <div className="stat-card-label">{formatSummaryLabel(key)}</div>
              <div className="stat-card-value" style={key === 'email' ? { fontSize: 16, wordBreak: 'break-all' } : undefined}>
                {val}
              </div>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Account Activity</h3>
            <p className="card-subtitle">Generated {new Date(report.generatedAt).toLocaleString()}</p>
          </div>
          {report.rows.length > 0 && (
            <TableToolbar
              value={tableSearch}
              onChange={handleTableSearchChange}
              placeholder="Search report results..."
            />
          )}
          <div className="card-body" style={{ padding: 0 }}>
            {report.rows.length === 0 ? (
              <div className="empty-state"><p>No accounts found for the selected period</p></div>
            ) : pagedRows.length === 0 ? (
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
                    {pagedRows.map((row, i) => (
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
                page={tablePagination.page}
                totalPages={tablePagination.totalPages}
                total={tablePagination.total}
                limit={tablePagination.limit}
                onPageChange={setTablePage}
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
