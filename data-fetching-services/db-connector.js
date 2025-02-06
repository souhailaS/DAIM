/**
 * @souhailaS
 */
import { MongoClient } from "mongodb";
import {logger} from "./logger.js";
import dotenv from "dotenv";
dotenv.config();

const mongoURL = process.env.MONGO_URL;
logger.info("MongoDB URL:", mongoURL ? "Found" : "Not found");

const client = new MongoClient(mongoURL);


/**
 * Connects to MongoDB and returns the database object
 * @returns {Promise<import("mongodb").Db>}
 */
export const connectToMongoDB = async () => {
  try {
    await client.connect();
    const db = client.db("DAIM-db");
    logger.info("Connected to MongoDB");
    return db;
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    throw error;
  }
};


/**
 * Saves the query metadata to the database
 * @param {import("mongodb").Db} db - The database object
 * @param {string} query - The search query
 * @param {string} sizeRange - The size range of the search results
 * @param {number} page - The page number of the search results
 * @param {number} resultsCount - The number of results
 * @param {number} totalPages - The total number of pages
 * @returns {Promise<void>}
 */
export const saveQueryMetadata = async (db, query, sizeRange, page, resultsCount, totalPages) => {
  try {
    // Input validation
    if (!query || typeof query !== "string") {
      throw new Error("Invalid query parameter");
    }
    if (!Array.isArray(sizeRange)) {
      throw new Error("Invalid sizeRange parameter");
    }
    if (typeof page !== "number" || page < 1) {
      throw new Error("Invalid page parameter");
    }
    if (typeof resultsCount !== "number" || resultsCount < 0) {
      throw new Error("Invalid resultsCount parameter");
    }
    if (typeof totalPages !== "number" || totalPages < 0) {
      throw new Error("Invalid totalPages parameter");
    }

    const collection = db.collection("performed_queries");
    await collection.insertOne({
      query,
      sizeRange,
      page,
      resultsCount,
      totalPages,
      timestamp: new Date(),
    });

    logger.info(
      `Query metadata saved: query=${query}, sizeRange=${sizeRange}, page=${page}, results=${resultsCount}, totalPages=${totalPages}`
    );
  } catch (error) {
    logger.error(`Error saving query metadata: ${error.message}`);
    throw error;
  }
};


/**
 * Saves the query result which consists of the metadata of the project that satisfies the heuristics to the database and the docker-compose or readme file.
 * @param {import("mongodb").Db} db - The database object
 * @param {object} data - The query result data
 * @returns {Promise<{ success: boolean, message: string, data: object }>}
 * @throws {Error} If the input data is invalid
 * @throws {Error} If there is an error inserting the data
*/
export const saveQueryResult = async (db, data) => {
  try {
    // Validate the input data
    if (!data || typeof data !== "object") {
      throw new Error("Invalid data: must be a non-null object");
    }
    if (!data.repository) {
      throw new Error("Invalid data: 'repository' field is required");
    }

    const collection = db.collection("microservices");
    await collection.insertOne(data);

    logger.info(`Inserted into MongoDB: repository=${data.repository}`);
    return { success: true, message: "Data inserted successfully", data };
  } catch (error) {
    logger.error(`Error inserting into MongoDB: ${error.message}`);
    throw error; // Rethrow the error for the caller to handle if needed
  }
};

/**
 * Saves the size range and page number to the database
 * @param {import("mongodb").Db} db - The database object
 * @param {string} sizeRange - The size range of the search results
 * @param {number} page - The page number of the search results
 * @returns {Promise<{ success: boolean, message: string, sizeRange: string, page: number }>}
 *  
 * @throws {Error} If the input data is invalid
 * @throws {Error} If there is an error inserting the data
 */
export const saveSizeAndPage = async (db, sizeRange, page) => {
  try {
    // Validate inputs
    if (!sizeRange || typeof sizeRange !== "string") {
      throw new Error("Invalid sizeRange: must be a non-empty string");
    }
    if (!Number.isInteger(page) || page < 1) {
      throw new Error("Invalid page: must be a positive integer");
    }

    const collection = db.collection("size_page_tracking");

    // Insert document into the collection
    await collection.insertOne({ sizeRange, page, timestamp: new Date() });

    logger.info(`Stored size range: ${sizeRange}, page: ${page}`);
    return { success: true, message: "Data successfully stored", sizeRange, page };
  } catch (error) {
    logger.error(`Error storing size range and page: ${error.message}`);
    throw error; // Rethrow the error to let the caller handle it
  }
};