import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const config = {};

// Server configuration
config.server = {};
config.server.port = process.env.PORT || 3100;
// Derive SERVER_URL from PORT if not explicitly set (to avoid duplicated port configuration)
config.server.url =
  process.env.SERVER_URL || `http://localhost:${config.server.port}`;

// Jira Service Manager API configuration
config.jira = {};
config.jira.username = process.env.JIRA_USERNAME;
config.jira.apiToken = process.env.JIRA_API_TOKEN;
config.jira.cloudId = process.env.JIRA_CLOUD_ID;
config.jira.hostUrl = process.env.JIRA_HOST_URL;
config.jira.basePath = process.env.JIRA_BASE_PATH;

// SQL Database configuration
config.sql = {};
config.sql.server = process.env.SQL_SERVER || "localhost";
config.sql.database = process.env.SQL_DATABASE;
config.sql.port = parseInt(process.env.SQL_PORT || "1433");
config.sql.encrypt = process.env.SQL_ENCRYPT === "true";
config.sql.trustServerCertificate =
  process.env.SQL_TRUST_SERVER_CERT === "true";
config.sql.table = process.env.SQL_TABLE || "dbo.PhoneDirectory";

// Authentication mode: 'windows' or 'sql'
config.sql.authMode = (process.env.SQL_AUTH_MODE || "sql").toLowerCase();

// SQL Auth properties (username/password)
config.sql.username = process.env.SQL_USERNAME;
config.sql.password = process.env.SQL_PASSWORD;

// Windows Auth properties
config.sql.domain = process.env.SQL_DOMAIN;
config.sql.trustedConnection = process.env.SQL_TRUSTED_CONNECTION === "true";

// Export auth mode to environment for dashboard display
process.env.SQL_AUTH_MODE = config.sql.authMode;

// File fallback configuration (for transition period)
config.fallback = {};

// FORCING SQL MODE: Override environment variable to use SQL only
// Comment out this line to revert to using environment variable
config.fallback.useTempFile = false;

// If above line is commented, this will be used instead:
// config.fallback.useTempFile = process.env.USE_TEMP_FILE === "true";

config.fallback.tempFile = process.env.TEMP_FILE || "phone-list.csv";

// Default phone number for test endpoint or fallback
config.defaultPhoneNumber = process.env.DEFAULT_PHONE_NUMBER || "15555555555";

function checkSqlConfig(requiredVars) {
  // Common SQL variables required regardless of auth mode
  requiredVars.push(
    { path: "sql.server", name: "SQL_SERVER" },
    { path: "sql.database", name: "SQL_DATABASE" }
  );
  if (config.sql.authMode === "sql") {
    requiredVars.push(
      { path: "sql.username", name: "SQL_USERNAME" },
      { path: "sql.password", name: "SQL_PASSWORD" }
    );
  } else if (config.sql.authMode === "windows") {
    if (!config.sql.trustedConnection) {
      console.warn(
        "WARNING: Windows authentication selected but SQL_TRUSTED_CONNECTION is not set to 'true'"
      );
    }
    if (!config.sql.domain) {
      console.warn(
        "WARNING: SQL_DOMAIN not set for Windows authentication - this may be required in some environments"
      );
    }
  } else {
    console.warn(
      `WARNING: Invalid SQL_AUTH_MODE '${config.sql.authMode}'. Valid values are 'sql' or 'windows'.`
    );
  }
}

function checkTempFile() {
  if (!config.fallback.tempFile) {
    console.warn("WARNING: USE_TEMP_FILE=true but TEMP_FILE is not set.");
  } else {
    try {
      if (!fs.existsSync(config.fallback.tempFile)) {
        console.warn(
          `WARNING: Specified TEMP_FILE "${config.fallback.tempFile}" does not exist!`
        );
      } else {
        console.log(
          `INFO: Using local CSV file: "${config.fallback.tempFile}" (USE_TEMP_FILE=true)`
        );
      }
    } catch (err) {
      console.warn(
        `WARNING: Error checking temp file "${config.fallback.tempFile}":`,
        err
      );
    }
  }
}

function validateConfig() {
  // Always check Jira variables
  const requiredVars = [
    { path: "jira.username", name: "JIRA_USERNAME" },
    { path: "jira.apiToken", name: "JIRA_API_TOKEN" },
    { path: "jira.cloudId", name: "JIRA_CLOUD_ID" },
    { path: "jira.hostUrl", name: "JIRA_HOST_URL" },
    { path: "jira.basePath", name: "JIRA_BASE_PATH" },
  ];

  if (!config.fallback.useTempFile) {
    checkSqlConfig(requiredVars);
  } else {
    checkTempFile();
  }

  const missingVars = requiredVars.filter((variable) => {
    const parts = variable.path.split(".");
    let current = config;
    for (const part of parts) {
      if (!current[part]) {
        return true;
      }
      current = current[part];
    }
    return false;
  });

  if (missingVars.length > 0) {
    console.warn("WARNING: Missing environment variables:");
    missingVars.forEach((variable) => {
      console.warn(`  - ${variable.name}`);
    });
    console.warn(
      "Application may not function correctly without these variables!"
    );
  }
}

function printConfig() {
  console.log("---------------------------------------------");
  console.log("CURRENT CONFIGURATION:");
  console.log("---------------------------------------------");
  console.log("Server:", {
    port: config.server.port,
    url: config.server.url,
  });

  console.log("Jira:", {
    username: config.jira.username ? "✓" : "✗",
    apiToken: config.jira.apiToken ? "✓" : "✗",
    cloudId: config.jira.cloudId ? "✓" : "✗",
    hostUrl: config.jira.hostUrl ? "✓" : "✗",
    basePath: config.jira.basePath ? "✓" : "✗",
  });

  // Show SQL config appropriate to the auth mode
  const sqlConfig = {
    authMode: config.sql.authMode,
    server: config.sql.server,
    database: config.sql.database,
    port: config.sql.port,
    encrypt: config.sql.encrypt,
    trustServerCert: config.sql.trustServerCertificate,
  };

  // Add auth mode-specific properties
  if (config.sql.authMode === "sql") {
    sqlConfig.username = config.sql.username ? "✓" : "✗";
    sqlConfig.password = config.sql.password ? "✓" : "✗";
  } else if (config.sql.authMode === "windows") {
    sqlConfig.trustedConnection = config.sql.trustedConnection;
    sqlConfig.domain = config.sql.domain || "(default)";
  }

  console.log("SQL:", sqlConfig);

  console.log("Fallback:", {
    useTempFile: config.fallback.useTempFile,
    tempFile: config.fallback.tempFile,
  });

  if (config.fallback.useTempFile) {
    console.log("WARNING: Using CSV fallback mode (SQL will be ignored)");
  } else {
    console.log("NOTICE: Using SQL mode (CSV fallback disabled)");
    if (!config.sql.username || !config.sql.password || !config.sql.database) {
      console.log(
        "CRITICAL: SQL configuration is incomplete! Check environment variables."
      );
    }
  }

  console.log("---------------------------------------------");
}

// Validate on import
validateConfig();

// Print configuration after validation
printConfig();

export default config;
