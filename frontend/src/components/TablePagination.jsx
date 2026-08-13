import './TableToolbar.css';

export default function TablePagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  itemLabel = 'records',
}) {
  if (!total) return null;

  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="table-pagination">
      <div className="table-pagination-info">
        Showing {start}-{end} of {total} {itemLabel}
      </div>
      <div className="table-pagination-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="table-pagination-info">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
