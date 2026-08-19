import { useState, useEffect } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import TableToolbar, { useClientTable } from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { REPORT_TYPES } from '../../constants/packages';
import { formatColumnLabel, formatSummaryLabel, formatCellValue, downloadCsv } from '../../utils/reports';
import { getDefaultReportDateRange } from '../../utils/dates';
import { useAuth } from '../../context/AuthContext';
import './admin-shared.css';

export default function ReportsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const defaultRange = getDefaultReportDateRange();
  const [operators, setOperators] = useState([]);
  const [packages, setPackages] = useState([]);
  const [filters, setFilters] = useState({
    reportType: 'client_summary',
    operatorId: '',
    packageType: '',
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);

  useEffect(() => {
    adminApi.getOperators({ page: 1, limit: 500 }).then((result) => setOperators(result.operators));
    adminApi.getPackages().then(setPackages).catch(() => setPackages([]));
  }, []);

  const buildParams = () => ({
    reportType: filters.reportType,
    operatorId: filters.operatorId || undefined,
    packageType: filters.packageType || undefined,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
  });

  const generate = async () => {
    setLoading(true);
    try {
      const data = await adminApi.generateReport(buildParams());
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
      const csv = await adminApi.exportReport(buildParams());
      downloadCsv(csv, `report-${filters.reportType}.csv`);
      toast.success('Report exported successfully');
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
  const showPackageFilter = filters.reportType !== 'package_breakdown';

  const handleTableSearchChange = (value) => {
    setTableSearch(value);
    setTablePage(1);
  };

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Generate client-wise, period, and package breakdown reports</p>
      </div>

      <div className="card reports-panel" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <div className="reports-filters">
            <div className="form-group">
              <label className="form-label">Report Type</label>
              <select
                className="form-input"
                value={filters.reportType}
                onChange={(e) => setFilters({ ...filters, reportType: e.target.value })}
              >
                {REPORT_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {filters.reportType !== 'package_breakdown' && (
              <div className="form-group">
                <label className="form-label">Client / Operator</label>
                <select
                  className="form-input"
                  value={filters.operatorId}
                  onChange={(e) => setFilters({ ...filters, operatorId: e.target.value })}
                >
                  <option value="">All clients</option>
                  {operators.map((o) => (
                    <option key={o.id} value={o.id}>{o.client_name}</option>
                  ))}
                </select>
              </div>
            )}

            {showPackageFilter && (
              <div className="form-group">
                <label className="form-label">Package</label>
                <select
                  className="form-input"
                  value={filters.packageType}
                  onChange={(e) => setFilters({ ...filters, packageType: e.target.value })}
                >
                  <option value="">All packages</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.label || p.name}>{p.label || p.name}</option>
                  ))}
                </select>
              </div>
            )}

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
            {report?.rows?.length > 0 && (
              <button className="btn btn-secondary" onClick={exportCsv}>
                <Download size={18} /> Export CSV
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
              <div className="stat-card-value">{val}</div>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Results</h3>
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
              <div className="empty-state"><p>No data for selected filters</p></div>
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
