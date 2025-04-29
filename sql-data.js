/**
 * sql-data.js
 *
 * Provides database connection and query functionality to retrieve phone numbers
 * from SQL Server database, with fallback to local CSV file during transition.
 */

import sql from "mssql";
import config from "./config.js";

// Import dashboard for enhanced logging
import dashboard from "./console-dashboard.js";

// Use dashboard logger instead of direct console methods
function logInfo(message, data = null) {
  const formattedMessage = `[SQL] ${message}`;
  dashboard.logger.info(formattedMessage, data);
}

function logWarning(message, data = null) {
  const formattedMessage = `[SQL] ${message}`;
  dashboard.logger.warning(formattedMessage, data);
}

function logError(message, error = null) {
  const formattedMessage = `[SQL] ${message}`;
  dashboard.logger.error(formattedMessage, error);
}

// SQL Server connection configuration from config.js
const sqlConfig = {
  user: config.sql.username,
  password: config.sql.password,
  server: config.sql.server,
  database: config.sql.database,
  port: config.sql.port,
  options: {
    encrypt: config.sql.encrypt,
    trustServerCertificate: config.sql.trustServerCertificate,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  connectTimeout: 15000, // 15 seconds
};

// In-memory cache for phone data
let phoneDataCache = null;
let phoneDataExpiry = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Connection pool - initialized once and reused
let pool = null;

/**
 * Initialize the SQL connection pool
 */
async function initSqlPool() {
  if (!pool) {
    try {
      // Log SQL configuration (with password masked)
      const redactedConfig = {
        ...sqlConfig,
        password: sqlConfig.password ? "********" : null,
      };
      logInfo("SQL configuration", redactedConfig);

      logInfo("Initializing SQL connection pool");
      pool = await sql.connect(sqlConfig);
      logInfo("SQL connection pool initialized successfully");
      return true;
    } catch (err) {
      logError("Failed to initialize SQL connection pool", err);
      return false;
    }
  }
  return true;
}

/**
 * Get phone number by email (case-insensitive)
 *
 * @param {string} email - Email address to look up
 * @param {function} callback - Callback function(phoneNumber)
 */
async function getPhoneNumberByEmail(email, callback) {
  try {
    logInfo(`Looking up phone number for email: ${email}`);
    await ensurePhoneDataLoaded();

    if (!phoneDataCache || phoneDataCache.length === 0) {
      logWarning("Phone data cache is empty or not loaded");
      return callback(null);
    }

    logInfo(`Phone data cache has ${phoneDataCache.length} records`);
    // Only log sample if there are records
    if (phoneDataCache.length > 0) {
      const sampleSize = Math.min(2, phoneDataCache.length);
      const sample = phoneDataCache.slice(0, sampleSize);
      logInfo("Sample of phone data cache", sample);
    }

    const record = phoneDataCache.find(
      (row) => row.email && row.email.toLowerCase() === email.toLowerCase()
    );

    if (!record) {
      logWarning(`No record found for email: ${email}`);
      const emailsInCache = phoneDataCache.map((record) => record.email);
      logInfo(`Available emails in cache: ${emailsInCache.join(", ")}`);
      return callback(null);
    }

    logInfo(`Found record for email ${email}`, record);

    if (record.cellPhone) {
      let phoneNumber = record.cellPhone.trim().replace(/\D/g, "");
      if (phoneNumber.length === 10) {
        phoneNumber = "1" + phoneNumber;
      }
      logInfo(`Formatted phone number for ${email}`, phoneNumber);
      return callback(phoneNumber);
    }

    if (record.extension) {
      let extensionNumber = record.extension.toString().trim();
      if (extensionNumber) {
        logInfo(`Using extension number for ${email}`, extensionNumber);
        return callback(config.defaultPhoneNumber);
      }
      logWarning(
        `Record found for ${email}, but no extension is available`,
        record
      );
      return callback(null);
    }

    logWarning(
      `Record found for ${email}, but no cell phone or extension number is available`,
      record
    );
    return callback(null);
  } catch (err) {
    logError(`Error retrieving phone number for ${email}`, err);
    return callback(null);
  }
}

// Flag to force refresh of cache - synced with ops-jira-api.js
let _forceRefresh = false;

/**
 * Ensure phone data is loaded and not expired
 */
async function ensurePhoneDataLoaded() {
  const now = Date.now();

  // Get the force refresh flag from ops-jira-api if available
  try {
    const api = await import("./ops-jira-api.js");
    _forceRefresh = api.default.forceRefresh;
  } catch (err) {
    logWarning(
      "Could not import ops-jira-api.js, using local refresh flag",
      err
    );
  }

  if (
    !_forceRefresh &&
    phoneDataCache &&
    phoneDataExpiry &&
    now < phoneDataExpiry
  ) {
    logInfo("Using existing phone data cache");
    return;
  }

  if (_forceRefresh) {
    logInfo("Force refresh enabled, bypassing phone data cache");
    _forceRefresh = false; // Reset flag after use
  }

  logInfo("Phone data cache expired or not initialized, fetching fresh data");

  // Re-fetch data from SQL or CSV
  phoneDataCache = await fetchPhoneData();
  phoneDataExpiry = now + CACHE_DURATION;
}

/**
 * Fetch phone data from SQL database with CSV fallback
 */
async function fetchPhoneData() {
  logInfo("Starting phone data fetch process");
  logInfo("SQL config present:", {
    username: !!config.sql.username,
    password: !!config.sql.password,
    server: config.sql.server,
    database: config.sql.database,
  });
  logInfo("Using temp file:", config.fallback.useTempFile);

  // First try to use the local CSV file if configured
  if (config.fallback.useTempFile) {
    try {
      const fs = await import("fs");
      const tempFile = config.fallback.tempFile;

      logInfo(`Checking for CSV file at path: ${tempFile}`);

      if (fs.existsSync(tempFile)) {
        logInfo(`Found CSV file: "${tempFile}"`);
        const { parse } = await import("csv-parse/sync");
        const csvText = fs.readFileSync(tempFile, "utf8");

        logInfo(`CSV file content length: ${csvText.length} characters`);
        logInfo(`CSV preview: ${csvText.substring(0, 200)}...`);

        // Parse CSV with optimized settings
        const records = parse(csvText, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          skip_records_with_empty_values: true,
          skip_lines_with_error: true,
        });

        logInfo(`Parsed ${records.length} records from CSV`);

        // Transform to our expected format
        const transformedRecords = records.map((record) => ({
          fullName: record["Full Name"] || "",
          extension: record["Ext"] || "",
          cellPhone: record["Cell Phone"] || "",
          primaryResponsibility: record["Primary Responsibility"] || "",
          backup: record["Backup"] || "",
          email: record["Email Address"] || "",
        }));

        logInfo(
          `Transformed ${transformedRecords.length} phone directory records from CSV`
        );
        return transformedRecords;
      } else {
        logWarning(`CSV file not found at path: ${tempFile}`);
      }
    } catch (csvErr) {
      logWarning(`Failed to read CSV file, falling back to SQL`, csvErr);
    }
  } else {
    logInfo("CSV fallback is disabled, skipping CSV check");
  }

  // If CSV fallback is disabled or failed, try SQL
  try {
    // Check if we have SQL configuration
    if (!config.sql.username || !config.sql.password || !config.sql.database) {
      logError("SQL database configuration is incomplete", {
        username: !!config.sql.username,
        password: !!config.sql.password,
        database: !!config.sql.database,
      });
      return [];
    }

    logInfo(
      "SQL configuration is complete, attempting to initialize connection pool"
    );

    const initialized = await initSqlPool();
    if (!initialized) {
      logError("SQL connection pool initialization failed");
      throw new Error("SQL connection pool not initialized");
    }

    logInfo("Fetching phone directory data from SQL database");

    // Execute the query with properly escaped "Backup" keyword
    const query = `
      SELECT 
        FullName AS fullName,
        Ext AS extension,
        CellPhone AS cellPhone,
        PrimaryResponsibility AS primaryResponsibility,
        [Backup] AS backup,
        EmailAddress AS email
      FROM [${config.sql.table}]
    `;

    logInfo(`Executing SQL query: ${query}`);

    const result = await pool.request().query(query);

    logInfo(
      `Retrieved ${result.recordset.length} phone directory records from SQL`
    );

    // Log a sample of records for debugging
    if (result.recordset.length > 0) {
      const sample = result.recordset.slice(
        0,
        Math.min(2, result.recordset.length)
      );
      logInfo("Sample of SQL query results", sample);
    }

    return result.recordset;
  } catch (err) {
    logError("Error fetching phone data from SQL", err);
    return [];
  }
}

/**
 * Check if database connection is healthy
 */
async function isHealthy() {
  logInfo("Checking health of database connection");

  // If we're using a temp file, consider the service healthy
  if (config.fallback.useTempFile) {
    try {
      const fs = await import("fs");
      const tempFile = config.fallback.tempFile;
      logInfo(`Checking if temp file exists: ${tempFile}`);

      if (fs.existsSync(tempFile)) {
        logInfo("Temp file exists, considering service healthy");
        return true;
      } else {
        logWarning(`Temp file does not exist: ${tempFile}`);
      }
      const fsPromises = fs.promises;
      await fsPromises.access(tempFile);
      logInfo("Temp file exists, considering service healthy");
      return true;
    } catch (err) {
      logWarning("Error checking temp file", err);
      return false; // Return false on error checking temp file
    }
  }

  // Try SQL connection if configured
  if (config.sql.username && config.sql.password && config.sql.database) {
    try {
      logInfo("SQL configuration is present, checking connection");

      const initialized = await initSqlPool();
      if (!initialized) {
        logError(
          "Failed to initialize SQL connection pool during health check"
        );
        return false;
      }

      // Try a simple query to check the connection
      logInfo("Running health check query");
      const result = await pool.request().query("SELECT 1 AS healthCheck");
      logInfo("Health check query result", result.recordset);
      return true;
    } catch (err) {
      logError("Database health check failed", err);
      return false;
    }
  } else {
    logWarning("SQL configuration incomplete, cannot check database health");
    logError("An error occurred during the health check", err);
    return false;
  }
}

/**
 * Close the SQL connection pool
 *
 * @returns {Promise<boolean>} True if closed successfully, false otherwise
 */
async function closePool() {
  if (!pool) {
    logInfo("No active pool to close");
    return true;
  }

  try {
    logInfo("Closing SQL connection pool");
    await pool.close();
    logInfo("SQL connection pool closed successfully");
    pool = null;
    return true;
  } catch (err) {
    logError("Error closing SQL connection pool", err);
    return false;
  }
}

// Handle process termination
process.on("SIGTERM", async () => {
  logInfo("SIGTERM received, closing pool");
  await closePool();
});

process.on("SIGINT", async () => {
  logInfo("SIGINT received, closing pool");
  const closed = await closePool();
  logInfo(`Pool closed successfully: ${closed}`);
  process.exit(0);
});

// Module exports
export default {
  getPhoneNumberByEmail: getPhoneNumberByEmail,
  isHealthy: isHealthy,
  closePool: closePool, // Export for external graceful shutdown
};
