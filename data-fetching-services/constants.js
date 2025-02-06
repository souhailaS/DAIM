import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();

export const DATABASE_KEYWORDS = [
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "cassandra",
  "cockroachdb",
  "neo4j",
  "dynamodb",
  "oracle",
  "mssql",
  "db2",
  "sqlite",
  "timescaledb",
  "influxdb",
  "etcd",
  "tarantool",
  "couchbase",
  "couchdb",
  "tidb",
  "clickhouse",
  "opensearch",
  "elasticsearch",
  "solr",
  "hbase",
  "mongo",
];

// Load all GH tokens from environment variables
export const GITHUB_TOKENS = Object.entries(process.env)
  .filter(([key]) => key.startsWith("GH_TOKEN_"))
  .map(([, value]) => value)
  .filter(Boolean);

if (githubTokens.length === 0) {
  console.error("No GitHub tokens found in the environment variables.");
  process.exit(1);
}

console.log(`Loaded ${githubTokens.length} GitHub tokens.`);
