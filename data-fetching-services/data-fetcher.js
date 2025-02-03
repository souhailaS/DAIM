/**
 *
 * The script supports multiple GitHub tokens to avoid rate limiting. 
 * When the rate limit is hit, it switches to the next token. 
 * 
 */
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import { Octokit } from "@octokit/rest";
import { Parser } from "json2csv";
import yaml from "js-yaml";
import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();



// // MongoDB Connection URL
const mongoURL = process.env.MONGO_URL;
console.log("MongoDB URL:", mongoURL ? "Found" : "Not found");

const client = new MongoClient(mongoURL);
let db;

// Connect to MongoDB
const connectToMongoDB = async () => {
  try {
    await client.connect();
    db = client.db("DAIM-db");
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error.message);
  }
};

connectToMongoDB();

const saveQueryMetadata = async (query, sizeRange, page, resultsCount, totalPages) => {
  try {
    // connect to MongoDB
    const collection = db.collection("performed_queries");
    await collection.insertOne({ query, sizeRange, page, resultsCount, totalPages, timestamp: new Date() });
    console.log(`Query metadata saved: ${query}, size range ${sizeRange}, page ${page}, results: ${resultsCount}, total pages: ${totalPages}`);
  } catch (error) {
    console.error("Error saving query metadata:", error.message);
  }
};

// const saveSizeAndPage = async (sizeRange, page) => {
//   try {
//     const collection = db.collection("size_page_tracking");
//     await collection.insertOne({ sizeRange, page, timestamp: new Date() });
//     console.log(`Stored size range ${sizeRange} and page ${page}`);
//   } catch (error) {
//     console.error("Error storing size range and page:", error.message);
//   }
// };

const saveToMongoDB = async (data) => {
  try {
    const collection = db.collection("microservices");
    await collection.insertOne(data);
    console.log(`Inserted into MongoDB: ${data.repository}`);
  } catch (error) {
    console.error("Error inserting into MongoDB:", error.message);
  }
};



// Load all GH tokens from environment variables
const githubTokens = Object.entries(process.env)
  .filter(([key]) => key.startsWith("GH_TOKEN_"))
  .map(([, value]) => value)
  .filter(Boolean);

if (githubTokens.length === 0) {
  console.error("No GitHub tokens found in the environment variables.");
  process.exit(1);
}


console.log(`Loaded ${githubTokens.length} GitHub tokens.`);

let currentTokenIndex = 0;
const getOctokitInstance = () => {
  return new Octokit({
    auth: githubTokens[currentTokenIndex],
    userAgent: "octokit/rest.js v18",
  });
};

let octokit = getOctokitInstance();

// Function to switch tokens
const switchToken = () => {
  currentTokenIndex = (currentTokenIndex + 1) % githubTokens.length;
  octokit = getOctokitInstance();
  console.log(`Switched to token index ${currentTokenIndex}`);
};

// Function to check rate limit and switch tokens if necessary
const checkRateLimit = async (threshold = 10) => {
  try {
    const { data } = await octokit.rateLimit.get();
    const { remaining, reset } = data.rate;
    
    console.log(`Rate Limit: ${remaining}/${data.rate.limit}`);
    console.log(`Reset Time: ${new Date(reset * 1000).toLocaleString()}`);
    
    if (remaining <= threshold) {
      console.log("Approaching rate limit, switching token...");
      switchToken();
    }
  } catch (error) {
    console.error("Error checking rate limit:", error.message);
  }
};

// Function to search for repositories
const searchRepositories = async (query, sizeRange, page = 1) => {
  try {
    await checkRateLimit(); // Check rate limit before making the API call
    const { data } = await octokit.search.code({
      q: `${query} size:${sizeRange}`,
      per_page: 100,
      page,
    });
    await saveQueryMetadata(query, sizeRange, page, data.total_count, Math.ceil(data.total_count / 100));
    return data.items || [];
  } catch (error) {
    if (error.status === 403) {
      console.error("Rate limit hit. Waiting...");
      await checkRateLimit(); // Wait explicitly if rate limit is hit
      return searchRepositories(query, sizeRange, page); // Retry after waiting
    }
    console.error("Error fetching repositories:", error.message);
    return [];
  }
};

// Function to fetch the content of a file
const fetchFileContent = async (owner, repo, path) => {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return content;
  } catch (error) {
    console.error(`Error fetching file content for ${repo}/${path}:`, error.message);
    return null;
  }
};

// Updated function to analyze README.md content for "microservices" and database terms
const analyzeReadme = (content) => {
  const databaseKeywords = [
    "postgres", "mysql", "mariadb", "mongodb", "redis", "cassandra", "cockroachdb",
    "neo4j", "dynamodb", "oracle", "mssql", "db2", "sqlite", "timescaledb", "influxdb",
    "etcd", "tarantool", "couchbase", "couchdb", "tidb", "clickhouse", "opensearch",
    "elasticsearch", "solr", "hbase",
  ];

  const contentLowerCase = content.toLowerCase();
  const containsMicroservices = contentLowerCase.includes("microservices");
  const containsDatabase = databaseKeywords.some((keyword) =>
    contentLowerCase.includes(keyword)
  );

  return containsMicroservices && containsDatabase;
};

// Function to analyze DockerCompose File or YAML content for services and databases
const analyzeDockerComposeFile = (content,numService) => {
  try {
    const parsedYaml = yaml.load(content);
    if (parsedYaml && parsedYaml.services) {
      const services = Object.keys(parsedYaml.services);
      if (services.length >= numService) {
        const databaseKeywords = [
          "postgres", "mysql", "mariadb", "mongodb", "redis", "cassandra", "cockroachdb",
          "neo4j", "dynamodb", "oracle", "mssql", "db2", "sqlite", "timescaledb", "influxdb",
          "etcd", "tarantool", "couchbase", "couchdb", "tidb", "clickhouse", "opensearch",
          "elasticsearch", "solr", "hbase"
        ];
        return services.some((service) => {
          const image = parsedYaml.services[service]?.image || "";
          return databaseKeywords.some((keyword) => image.toLowerCase().includes(keyword));
        });
      }
    }
  } catch (error) {
    console.error("Error parsing YAML:", error.message);
  }
  return false;
};

// Function to append a repository to the CSV file
const appendToCSV = (data, outputPath) => {
  const fields = [
    "repository",
    "url",
    "file_type",
    "file_path",
    "repo_size_range",
    "stars",
    "commits",
    "contributors",
    "creation_date",
    "last_update_date",
  ];
  const parser = new Parser({ fields, header: !fs.existsSync(outputPath) });
  const csv = parser.parse(data);

  fs.appendFileSync(outputPath, csv + "\n", "utf8");
  console.log(`Appended to CSV: ${data.repository}`);
};

// Function to fetch repository metadata (stars, commits, contributors, creation date, last update date)
const fetchRepoMetadata = async (owner, repo) => {
  try {
    const repoData = await octokit.repos.get({ owner, repo });

    // Fetch commits count
    const commitsData = await octokit.repos.listCommits({ owner, repo, per_page: 1 });
    const commitsCount = commitsData.data.length;

    // Fetch contributors count
    const contributorsData = await octokit.repos.listContributors({ owner, repo, per_page: 1 });
    const contributorsCount = contributorsData.data.length;

    return {
      stars: repoData.data.stargazers_count || 0,
      commits: commitsCount,
      contributors: contributorsCount,
      creation_date: repoData.data.created_at,
      last_update_date: repoData.data.updated_at,
    };
  } catch (error) {
    console.error(`Error fetching repository metadata for ${owner}/${repo}:`, error.message);
    return {
      stars: 0,
      commits: "N/A",
      contributors: "N/A",
      creation_date: "N/A",
      last_update_date: "N/A",
    };
  }
};

// Function to check if the repository has at least two folders
const hasCodeStructure = async (owner, repo) => {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: "" });
    const folders = data.filter((item) => item.type === "dir");
    return folders.length >= 2;
  } catch (error) {
    console.error(`Error fetching repository content for ${owner}/${repo}:`, error.message);
    return false;
  }
};

// Generate size ranges with dynamic increments
const generateSizeRanges = (maxSize, step) => {
  const ranges = [];
  for (let i = 800; i < maxSize; i += step) {
    ranges.push(`${i}..${i + step - 1}`);
  }
  return ranges;
};

// Main function to mine repositories for microservices
const mineMicroservices = async () => {
  console.log("Searching for repositories with potential microservices...");
  const step = 1; // Increment in KB
  const maxSize = 5000; // Max size in KB
  const outputPath = path.resolve("./microservices_results_3.csv");

  const queries = [
    { query: "filename:docker-compose.yml services", type: "YAML" },
    { query: "microservices OR microservice OR micro-services OR micro-service", type: "README" }, 
    // { query: "microservice", type: "README" },
    // { query: "micro-services", type: "README" },
    // { query: "micro-service", type: "README" },// TODO: Verify if this query is correctly working 
    // TODO: If possible to look in title or repo description and labels 
  ];

  const sizeRanges = generateSizeRanges(maxSize, step);

  for (const sizeRange of sizeRanges) {
    for (const { query, type } of queries) {
      let page = 1;
      let hasMoreResults = true;

      while (hasMoreResults && page <= 10) {
        console.log(`Fetching ${type} results for size range ${sizeRange}, page ${page}...`);
        await checkRateLimit();

        const searchResults = await searchRepositories(query, sizeRange, page);

        if (searchResults.length === 0) {
          hasMoreResults = false;
          break;
        }

        for (const item of searchResults) {
          const [owner, repo] = item.repository.full_name.split("/");
          const filePath = item.path;

          console.log(`Analyzing ${type} in ${repo}/${filePath}...`);
          const content = await fetchFileContent(owner, repo, filePath);

          let isMicroservices = false;
          if (type === "README" && content) {
            isMicroservices = analyzeReadme(content);
          } else if (type === "DOCKER-COMPOSE" && content) {
            isMicroservices = analyzeDockerComposeFile(content,3);
          }
          if (isMicroservices) {
            const hasCode = await hasCodeStructure(owner, repo);
            if (!hasCode) {
              console.log(`Skipping ${owner}/${repo} as it does not have at least two folders.`);
              continue;
            }
            const metadata = await fetchRepoMetadata(owner, repo);
            const data = {
              repository_metadata: metadata,
              url: item.repository.html_url,
              file_type: type,
              file_path: filePath,
              repo_size_range: sizeRange,
            };
            await saveToMongoDB(data);
          } else {
            console.log(`Project is not microservices: ${item.repository.full_name}`);
          }
        }
        page++;
      }
    }
  }
};
// Run the script
mineMicroservices();