export type Row = Record<string, unknown>;

export interface QueryJobOptions {
  query: string;
  params?: Record<string, unknown>;
}

/** Minimal shape of a @google-cloud/bigquery client we depend on. */
export interface BigQueryClient {
  query(options: QueryJobOptions): Promise<[Row[], ...unknown[]]>;
}

// DML / DDL keywords that must never appear in a read-only query.
const FORBIDDEN = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];

/**
 * Guard: throw if a SQL string contains any mutating keyword. Matches on word
 * boundaries (case-insensitive) so column names like `created_at` are safe.
 */
export function assertReadOnly(sql: string): void {
  const upper = sql.toUpperCase();
  for (const kw of FORBIDDEN) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upper)) {
      throw new Error(`Read-only guard: forbidden keyword "${kw}" in query`);
    }
  }
}

export interface BigQueryAccess {
  queryHistorical(sql: string, params?: Record<string, unknown>): Promise<Row[]>;
}

/** Factory: inject a BigQuery client (real or fake) for offline tests. */
export function createBigQuery(client: BigQueryClient): BigQueryAccess {
  async function queryHistorical(
    sql: string,
    params: Record<string, unknown> = {},
  ): Promise<Row[]> {
    assertReadOnly(sql);
    const [rows] = await client.query({ query: sql, params });
    return rows;
  }
  return { queryHistorical };
}
