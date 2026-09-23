import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileBarChart } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import TopupReportResults from '../../components/admin/TopupReportResults';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import TableToolbar, { useClientTable } from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { REPORT_TYPES } from '../../constants/packages';
import {
  formatColumnLabel,
  formatSummaryLabel,
  formatCellValue,
  formatSummaryValue,
  isTextSummaryKey,
  downloadBlob,
  SERVER_PAGINATED_REPORT_TYPES,
} from '../../utils/reports';
import { getDefaultReportDateRange } from '../../utils/dates';
import { useAuth } from '../../context/AuthContext';
import './admin-shared.css';

const REPORT_PAGE_SIZE = 50;

export default function ReportsPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const defaultRange = getDefaultReportDateRange();
  const initialReportType = (() => {
    const fromQuery = searchParams.get('type');
    if (fromQuery && REPORT_TYPES.some((r) => r.value === fromQuery)) {
      return fromQuery;
    }
    return user?.role === 'sales' ? 'sales_report' : 'dealer_topup';
  })();
  const [operators, setOperators] = useState([]);
  const [packages, setPackages] = useState([]);
  const [filters, setFilters] = useState({
    reportType: initialReportType,
    operatorId: '',
    packageType: '',
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);

  useEffect(() => {
    adminApi.getOperators({ page: 1, limit: 500 }).then((result) => setOperators(result.operators));
    adminApi.getPackages().then(setPackages).catch(() => setPackages([]));
  }, []);

  const isServerPaginated = SERVER_PAGINATED_REPORT_TYPES.includes(filters.reportType);

  const buildParams = useCallback(
    (overrides = {}) => ({
      reportType: filters.reportType,
      operatorId: filters.operatorId || undefined,
      packageType: filters.packageType || undefined,
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      ...(isServerPaginated
        ? {
            page: overrides.page ?? tablePage,
            limit: REPORT_PAGE_SIZE,
            search: overrides.search !== undefined ? overrides.search || undefined : tableSearch || undefined,
          }
        : {}),
      ...overrides,
    }),
    [filters, isServerPaginated, tablePage, tableSearch]
  );

  const loadReport = async ({ page = 1, search = '', fullScreenLoad = false, keepSummary = false }) => {
    if (fullScreenLoad) setLoading(true);
    else setTableLoading(true);
    try {
      const data = await adminApi.generateReport(
        buildParams({ page, search: search || undefined })
      );
      setReport((prev) => ({
        ...data,
        summary: data.summary ?? (keepSummary ? prev?.summary : null),
      }));
      setTablePage(page);
      setTableSearch(search);
      const total = data.pagination?.total ?? data.rows?.length ?? 0;
      if (fullScreenLoad) {
        const unit =
          filters.reportType === 'dealer_topup' ? 'transaction(s)' : 'row(s)';
        toast.success(`Report ready — ${total.toLocaleString()} ${unit} total`);
      }
      return data;
    } catch (err) {
      toast.error(err.message || 'Failed to load report');
      throw err;
    } finally {
      setLoading(false);
      setTableLoading(false);
    }
  };

  const generate = () => loadReport({ page: 1, search: '', fullScreenLoad: true });

  const isTopupReport = filters.reportType === 'dealer_topup';
  const isSalesReport = filters.reportType === 'sales_report';
  const showPackageFilter =
    filters.reportType !== 'package_breakdown' && !isTopupReport && !isSalesReport;
  const showOperatorFilter = filters.reportType !== 'package_breakdown';

  const exportCsv = async () => {
    try {
      toast.success('Preparing download…');
      const blob = await adminApi.exportReport({
        reportType: filters.reportType,
        operatorId: filters.operatorId || undefined,
        packageType: filters.packageType || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      });
      downloadBlob(
        blob,
        isTopupReport
          ? 'operator-topup-report.csv'
          : isSalesReport
            ? 'sales-report.csv'
            : `report-${filters.reportType}.csv`
      );
      toast.success('Report exported successfully');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    }
  };

  const reportCurrency = report?.summary?.currencyCode || 'MVR';
  const columns = !isTopupReport && report?.rows?.[0] ? Object.keys(report.rows[0]) : [];

  const { rows: clientPagedRows, pagination: clientPagination } = useClientTable(
    isServerPaginated ? [] : report?.rows || [],
    {
      search: tableSearch,
      page: tablePage,
      limit: 20,
      columns,
    }
  );

  const handleTableSearchChange = (value) => {
    if (isServerPaginated && report) {
      loadReport({ page: 1, search: value, keepSummary: true });
      return;
    }
    setTableSearch(value);
    setTablePage(1);
  };

  const handleTablePageChange = (page) => {
    if (isServerPaginated && report) {
      loadReport({ page, search: tableSearch, keepSummary: true });
      return;
    }
    setTablePage(page);
  };

  const tableRows = isServerPaginated ? report?.rows || [] : clientPagedRows;
  const tablePagination = isServerPaginated
    ? report?.pagination || { page: 1, limit: REPORT_PAGE_SIZE, total: 0, totalPages: 1 }
    : clientPagination;

  const canExport =
    (report?.pagination?.total ?? 0) > 0 ||
    (report?.rows?.length ?? 0) > 0 ||
    Boolean(report?.summary);

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">
          Sales summary, operator top-ups, client and customer reports, and package breakdown.
          Large reports load in pages; CSV export includes all matching rows.
        </p>
      </div>

      <div className="card reports-panel" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <div className="reports-filters">
            <div className="form-group">
              <label className="form-label">Report Type</label>
              <select
                className="form-input"
                value={filters.reportType}
                onChange={(e) => {
                  setFilters({ ...filters, reportType: e.target.value });
                  setReport(null);
                }}
              >
                {REPORT_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {showOperatorFilter && (
              <div className="form-group">
                <label className="form-label">Operator</label>
                <select
                  className="form-input"
                  value={filters.operatorId}
                  onChange={(e) => setFilters({ ...filters, operatorId: e.target.value })}
                >
                  <option value="">All operators</option>
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
            {canExport && (
              <button className="btn btn-secondary" onClick={exportCsv} disabled={loading}>
                <Download size={18} />
                {isTopupReport ? 'Download Excel (CSV)' : 'Export CSV'}
              </button>
            )}
          </div>
        </div>
      </div>

      {isTopupReport && report && (
        <TopupReportResults
          report={report}
          search={tableSearch}
          onSearchChange={handleTableSearchChange}
          page={tablePagination.page}
          onPageChange={handleTablePageChange}
          pagination={tablePagination}
          loading={tableLoading}
        />
      )}

      {!isTopupReport && report?.summary && (
        <div className="reports-summary">
          {Object.entries(report.summary).map(([key, val]) => {
            const textValue = formatSummaryValue(key, val, reportCurrency);
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

      {!isTopupReport && report && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Results</h3>
            <p className="card-subtitle">
              Generated {new Date(report.generatedAt).toLocaleString()}
              {report.pagination?.total != null && (
                <> · {report.pagination.total.toLocaleString()} total rows</>
              )}
            </p>
          </div>
          {(report.rows.length > 0 || isServerPaginated) && (
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
            ) : report.rows.length === 0 && (report.pagination?.total ?? 0) === 0 ? (
              <div className="empty-state"><p>No data for selected filters</p></div>
            ) : tableRows.length === 0 ? (
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
                      {tableRows.map((row, i) => (
                        <tr key={i}>
                          {columns.map((c) => (
                            <td key={c}>{formatCellValue(c, row[c], reportCurrency)}</td>
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
