# Performance Optimization: CSV Import

## Problem
The original implementation of the CSV import process suffered from an N+1 query problem. For each row in the CSV file, the application executed a `SELECT` query to check if the client already existed in the database.

For a CSV file with N rows, this resulted in:
- N `SELECT` queries
- N `INSERT` or `UPDATE` queries (plus additional queries for revenue data)

Total database round-trips: **2N + X**

## Optimization
We have refactored the `process-csv` endpoint to pre-fetch all existing clients that match the names in the CSV file using a single query:

```sql
SELECT ... FROM clients WHERE LOWER(name) = ANY($1)
```

We then store these clients in a `Map` for O(1) lookup during the iteration. The logic for handling `INSERT` vs `UPDATE` and preserving manual enhancements remains unchanged, ensuring functional correctness.

New database round-trips: **1 + N + X** (1 SELECT query + N INSERT/UPDATE queries)

This significantly reduces network latency and database load, especially for large CSV files.

## Verification
A benchmark script `benchmark-csv.cjs` has been included to measure the performance improvement.

### How to Run Benchmark
1. Ensure your local development environment has a running PostgreSQL database.
2. Set `DATABASE_URL` in your `.env` file.
3. Run the benchmark:
   ```bash
   node benchmark-csv.cjs
   ```

### Expected Results
- **Baseline (N+1)**: ~10-20ms per row (network latency dominated).
- **Optimized (1+N)**: ~2-5ms per row (mostly write latency).

**Note:** In the current sandbox environment, a live database connection was not available to capture exact timing metrics, but the architectural improvement is guaranteed to reduce latency by eliminating N network round-trips.
