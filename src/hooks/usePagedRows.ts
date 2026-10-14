import { useEffect, useState } from 'react';
import { TABLE_PAGE_SIZE } from '../components/Table';

/**
 * Page state for a list shown in a table. Goes back to page 1 whenever
 * `resetKey` changes (a new filter, tab or search), and never points past
 * the last page when the list shrinks.
 */
export function usePagedRows<T>(rows: T[], resetKey?: unknown) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey]);
  const totalPages = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  const current = Math.min(page, totalPages);
  return {
    page: current,
    setPage,
    pageRows: rows.slice((current - 1) * TABLE_PAGE_SIZE, current * TABLE_PAGE_SIZE),
  };
}
