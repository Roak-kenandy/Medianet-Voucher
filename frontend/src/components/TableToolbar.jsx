import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import './TableToolbar.css';

export default function TableToolbar({
  value,
  onChange,
  placeholder = 'Search...',
  debounceMs = 300,
}) {
  const [inputValue, setInputValue] = useState(value || '');
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onChangeRef.current(inputValue);
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [inputValue, debounceMs]);

  return (
    <div className="table-toolbar">
      <Search size={18} className="table-toolbar-icon" aria-hidden="true" />
      <input
        type="search"
        className="table-toolbar-input"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Search table"
      />
    </div>
  );
}

export function useClientTable(rows = [], { search = '', page = 1, limit = 20, columns = [] } = {}) {
  return useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? rows.filter((row) =>
          (columns.length ? columns : Object.keys(row)).some((key) =>
            String(row[key] ?? '')
              .toLowerCase()
              .includes(term)
          )
        )
      : rows;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const start = (safePage - 1) * limit;

    return {
      rows: filtered.slice(start, start + limit),
      pagination: {
        page: safePage,
        limit,
        total,
        totalPages,
      },
    };
  }, [rows, search, page, limit, columns]);
}
