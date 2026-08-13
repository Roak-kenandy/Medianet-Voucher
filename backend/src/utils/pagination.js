export function normalizePagination(page = 1, limit = 20, maxLimit = 100) {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(maxLimit, Math.max(1, Number.parseInt(limit, 10) || 20));
  const offsetNum = (pageNum - 1) * limitNum;

  return { page: pageNum, limit: limitNum, offset: offsetNum };
}

/** Safe LIMIT/OFFSET for MySQL prepared statements (inline integers). */
export function paginationSql(page = 1, limit = 20, maxLimit = 100) {
  const { page: pageNum, limit: limitNum, offset: offsetNum } = normalizePagination(
    page,
    limit,
    maxLimit
  );

  return {
    page: pageNum,
    limit: limitNum,
    offset: offsetNum,
    clause: `LIMIT ${limitNum} OFFSET ${offsetNum}`,
  };
}
