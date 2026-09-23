/** Default rows returned for on-screen report preview */
export const REPORT_DEFAULT_PAGE_SIZE = 50;

/** Maximum rows per preview page */
export const REPORT_MAX_PAGE_SIZE = 100;

/** Rows read from DB per batch when scanning or streaming exports */
export const REPORT_SCAN_BATCH_SIZE = 500;

/** Heavy report jobs (preview scan + export) run concurrently at most this many at a time */
export const REPORT_MAX_CONCURRENT = 2;
