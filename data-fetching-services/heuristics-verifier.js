import { DATABASE_KEYWORDS } from "./constants.js";
import yaml from "js-yaml";
import { logger } from "./logger.js"; 

// Updated function to analyze README.md content for "microservices" and database terms
export const analyzeReadme = (content) => {
  const containsMicroservices = /micro[-]?service(s)?/i.test(
    content.toLowerCase()
  );
  const containsDatabase = DATABASE_KEYWORDS.some((keyword) =>
    contentLowerCase.includes(keyword)
  );
  return containsMicroservices && containsDatabase;
};

// Function to analyze DockerCompose File or YAML content for services and databases
export const analyzeDockerComposeFile = (content, numService) => {
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


