/**
 * @souhailaS
 *
 * The script supports multiple GitHub tokens to avoid rate limiting.
 * When the rate limit is hit, it switches to the next token.
 *
 */
import path from "path";
import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";
import { logger } from "./logger.js";

import {
  connectToMongoDB,
  saveQueryMetadata,
  saveQueryResult,
} from "./db-connector.js";
import { DATABASE_KEYWORDS, GITHUB_TOKENS } from "./constants.js";

const db = await connectToMongoDB();

let currentTokenIndex = 0;
const getOctokitInstance = () => {
  return new Octokit({
    auth: GITHUB_TOKENS[currentTokenIndex],
    userAgent: "octokit/rest.js v18",
  });
};

let octokit = getOctokitInstance();

// Function to switch tokens
const switchToken = () => {
  currentTokenIndex = (currentTokenIndex + 1) % GITHUB_TOKENS.length;
  octokit = getOctokitInstance();
  logger.info(`Switched to token index ${currentTokenIndex}`);
};

// Function to check rate limit and switch tokens if necessary
const checkRateLimit = async (threshold = 10) => {
  try {
    const { data } = await octokit.rateLimit.get();
    const { remaining, reset } = data.rate;

    logger.info(`Rate Limit: ${remaining}/${data.rate.limit}`);
    logger.info(`Reset Time: ${new Date(reset * 1000).toLocaleString()}`);

    if (remaining <= threshold) {
      logger.info("Approaching rate limit, switching token...");
      switchToken();
    }
  } catch (error) {
    logger.error("Error checking rate limit:", error.message);
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
    await saveQueryMetadata(
      db,
      query,
      sizeRange,
      page,
      data.total_count,
      Math.ceil(data.total_count / 100)
    );
    return data.items || [];
  } catch (error) {
    if (error.status === 403) {
      logger.error("Rate limit hit. Waiting...");
      await checkRateLimit(); // Wait explicitly if rate limit is hit
      return searchRepositories(query, sizeRange, page); // Retry after waiting
    }
    logger.error("Error fetching repositories:", error.message);
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
    logger.error(
      `Error fetching file content for ${repo}/${path}:`,
      error.message
    );
    return null;
  }
};

// Updated function to analyze README.md content for "microservices" and database terms
const analyzeReadme = (content) => {
  const containsMicroservices = /micro[-]?service(s)?/i.test(
    content.toLowerCase()
  );
  const containsDatabase = DATABASE_KEYWORDS.some((keyword) =>
    contentLowerCase.includes(keyword)
  );
  return containsMicroservices && containsDatabase;
};

// Function to analyze DockerCompose File or YAML content for services and databases
const analyzeDockerComposeFile = (content, numService) => {
  try {
    const parsedYaml = yaml.load(content);
    if (parsedYaml && parsedYaml.services) {
      const services = Object.keys(parsedYaml.services);
      if (services.length >= numService) {
        return services.some((service) => {
          const image = parsedYaml.services[service]?.image || "";
          return DATABASE_KEYWORDS.some((keyword) =>
            image.toLowerCase().includes(keyword)
          );
        });
      }
    }
  } catch (error) {
    logger.error("Error parsing YAML:", error.message);
  }
  return false;
};

// Function to fetch repository metadata (stars, commits, contributors, creation date, last update date)
const fetchRepoMetadata = async (owner, repo) => {
  try {
    const repoData = await octokit.repos.get({ owner, repo });

    // Fetch commits count
    const commitsData = await octokit.repos.listCommits({
      owner,
      repo,
      per_page: 1,
    });
    const commitsCount = commitsData.data.length;

    // Fetch contributors count
    const contributorsData = await octokit.repos.listContributors({
      owner,
      repo,
      per_page: 1,
    });
    const contributorsCount = contributorsData.data.length;

    return {
      stars: repoData.data.stargazers_count || 0,
      commits: commitsCount,
      contributors: contributorsCount,
      creation_date: repoData.data.created_at,
      last_update_date: repoData.data.updated_at,
    };
  } catch (error) {
    logger.error(
      `Error fetching repository metadata for ${owner}/${repo}:`,
      error.message
    );
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
    logger.error(
      `Error fetching repository content for ${owner}/${repo}:`,
      error.message
    );
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
  logger.info("Searching for repositories with potential microservices...");
  const step = 1; // Increment in KB
  const maxSize = 5000; // Max size in KB
  const outputPath = path.resolve("./microservices_results_3.csv");

  const queries = [
    { query: "filename:docker-compose.yml services", type: "YAML" },
    {
      query: "microservices OR microservice OR micro-services OR micro-service",
      type: "README",
    },
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
        logger.info(
          `Fetching ${type} results for size range ${sizeRange}, page ${page}...`
        );
        await checkRateLimit();

        const searchResults = await searchRepositories(query, sizeRange, page);

        if (searchResults.length === 0) {
          hasMoreResults = false;
          break;
        }

        for (const item of searchResults) {
          const [owner, repo] = item.repository.full_name.split("/");
          const filePath = item.path;

          logger.info(`Analyzing ${type} in ${repo}/${filePath}...`);
          const content = await fetchFileContent(owner, repo, filePath);

          let isMicroservices = false;
          if (type === "README" && content) {
            isMicroservices = analyzeReadme(content);
          } else if (type === "DOCKER-COMPOSE" && content) {
            isMicroservices = analyzeDockerComposeFile(content, 3);
          }
          if (isMicroservices) {
            const hasCode = await hasCodeStructure(owner, repo);
            if (!hasCode) {
              logger.info(
                `Skipping ${owner}/${repo} as it does not have at least two folders.`
              );
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
            await saveQueryResult(db, data);
          } else {
            logger.info(
              `Project is not microservices: ${item.repository.full_name}`
            );
          }
        }
        page++;
      }
    }
  }
};

// Run the script
mineMicroservices();
