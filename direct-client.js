/**
 * direct-client.js
 *
 * A clean, modular implementation for directly accessing Jira Service Manager
 * and SQL database to retrieve on-call phone numbers.
 *
 * Uses modern async/await patterns and proper error handling.
 */

import fetch from "node-fetch";
import sql from "mssql";
import dashboard from "./console-dashboard.js";
import config from "./config.js";

// Cache for responses to minimize API calls and database connections
const cache = {
  schedules: {
    data: null,
    expiry: null,
    duration: 15 * 60 * 1000, // 15 minutes
  },
  phoneData: {
    data: null,
    expiry: null,
    duration: 60 * 60 * 1000, // 1 hour
  },
};

/**
 * Get on-call phone number for a specific team
 *
 * @param {string} teamName - Name of the team
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<string>} Phone number
 */
async function getTeamOnCallPhoneNumber(teamName, requestId) {
  try {
    // Step 1: Get the team's schedule
    const schedule = await getTeamSchedule(teamName, requestId);
    if (!schedule) {
      throw new Error(`No schedule found for team: ${teamName}`);
    }

    // Step 2: Get the on-call user for this schedule
    const user = await getOnCallUser(schedule.id, requestId);
    if (!user?.emailAddress) {
      throw new Error(`No on-call user with email found for team: ${teamName}`);
    }

    // Step 3: Look up the phone number for this user
    const phoneNumber = await getPhoneNumberByEmail(
      user.emailAddress,
      requestId
    );
    if (!phoneNumber) {
      throw new Error(`No phone number found for email: ${user.emailAddress}`);
    }

    return phoneNumber;
  } catch (error) {
    dashboard.logger.error(
      `Error getting on-call phone number for ${teamName}`,
      {
        requestId,
        error: error.message,
      }
    );
    throw error;
  }
}

/**
 * Get Jira schedule for a specific team
 *
 * @param {string} teamName - Name of the team
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<Object>} Schedule object
 */
async function getTeamSchedule(teamName, requestId) {
  dashboard.logger.info(`Looking up schedule for team ${teamName}`, {
    requestId,
  });

  // Get all schedules
  const schedules = await getSchedules(requestId);
  if (!schedules?.length) {
    return null;
  }

  // Log all available schedules for debugging
  dashboard.logger.info(`Available schedules:`, {
    requestId,
    schedules: schedules.map((s) => s.name),
  });

  // Find exact match by name (using exact Jira schedule names)
  const matchingSchedule = schedules.find(
    (schedule) => schedule.name === teamName
  );

  if (matchingSchedule) {
    dashboard.logger.info(`Found schedule: ${matchingSchedule.name}`, {
      requestId,
      scheduleId: matchingSchedule.id,
    });
  } else {
    dashboard.logger.warning(`No schedule found for team ${teamName}`, {
      requestId,
    });
  }

  return matchingSchedule;
}

/**
 * Get all schedules from Jira, with caching
 *
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<Array>} Array of schedule objects
 */
async function getSchedules(requestId) {
  // Check if we have a valid cache
  const now = Date.now();
  if (
    cache.schedules.data &&
    cache.schedules.expiry &&
    now < cache.schedules.expiry
  ) {
    dashboard.logger.info(
      `Using cached schedule data (expires in ${Math.round(
        (cache.schedules.expiry - now) / 1000
      )} seconds)`,
      { requestId }
    );
    return cache.schedules.data;
  }

  dashboard.logger.info(`Fetching schedules from Jira API`, { requestId });

  // Jira API configuration from config.js
  const JIRA_USERNAME = config.jira.username;
  const JIRA_API_TOKEN = config.jira.apiToken;
  const JIRA_CLOUD_ID = config.jira.cloudId;
  const JIRA_HOST_URL = config.jira.hostUrl;
  const JIRA_BASE_PATH = config.jira.basePath;

  if (
    !JIRA_USERNAME ||
    !JIRA_API_TOKEN ||
    !JIRA_CLOUD_ID ||
    !JIRA_HOST_URL ||
    !JIRA_BASE_PATH
  ) {
    throw new Error("Incomplete Jira API configuration");
  }

  // Build the URL and auth header
  const url = `${JIRA_HOST_URL}/${JIRA_BASE_PATH}/${JIRA_CLOUD_ID}/v1/schedules`;
  const auth =
    "Basic " +
    Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString("base64");

  try {
    // Make the request
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: auth,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.values || !Array.isArray(data.values)) {
      throw new Error("Invalid response format from Jira API");
    }

    // Update cache
    cache.schedules.data = data.values;
    cache.schedules.expiry = now + cache.schedules.duration;

    dashboard.logger.info(
      `Retrieved ${data.values.length} schedules from Jira`,
      { requestId }
    );
    return data.values;
  } catch (error) {
    dashboard.logger.error(`Error fetching schedules from Jira`, {
      requestId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get on-call user for a specific schedule
 *
 * @param {string} scheduleId - ID of the schedule
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<Object>} User object
 */
async function getOnCallUser(scheduleId, requestId) {
  dashboard.logger.info(`Looking up on-call user for schedule ${scheduleId}`, {
    requestId,
  });

  // Jira API configuration from config.js
  const JIRA_USERNAME = config.jira.username;
  const JIRA_API_TOKEN = config.jira.apiToken;
  const JIRA_CLOUD_ID = config.jira.cloudId;
  const JIRA_HOST_URL = config.jira.hostUrl;
  const JIRA_BASE_PATH = config.jira.basePath;
  const JIRA_DOMAIN = process.env.JIRA_DOMAIN;

  // Generate today's date at midnight UTC in ISO 8601 format
  const now = new Date();
  const todayISO = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();

  // Build auth header
  const auth =
    "Basic " +
    Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString("base64");

  try {
    // Step 1: Get on-call participants
    const onCallUrl = `${JIRA_HOST_URL}/${JIRA_BASE_PATH}/${JIRA_CLOUD_ID}/v1/schedules/${scheduleId}/on-calls?date=${todayISO}`;

    dashboard.logger.info(`Fetching on-call data from: ${onCallUrl}`, {
      requestId,
    });

    const onCallResponse = await fetch(onCallUrl, {
      method: "GET",
      headers: {
        Authorization: auth,
        Accept: "application/json",
      },
    });

    if (!onCallResponse.ok) {
      dashboard.logger.error(`Error response from Jira API`, {
        requestId,
        status: onCallResponse.status,
        statusText: onCallResponse.statusText,
      });
      throw new Error(
        `HTTP error ${onCallResponse.status}: ${onCallResponse.statusText}`
      );
    }

    const onCallData = await onCallResponse.json();

    dashboard.logger.info(`On-call data received`, {
      requestId,
      hasParticipants:
        !!onCallData.onCallParticipants &&
        onCallData.onCallParticipants.length > 0,
    });

    if (
      !onCallData.onCallParticipants ||
      onCallData.onCallParticipants.length === 0
    ) {
      dashboard.logger.warning(
        `No on-call participants found for schedule ${scheduleId}`,
        { requestId }
      );
      return null;
    }

    const participant = onCallData.onCallParticipants[0];
    dashboard.logger.info(
      `Found on-call participant with ID ${participant.id}`,
      { requestId }
    );

    // Step 2: Get user details
    const userUrl = `https://${JIRA_DOMAIN}/rest/api/3/user?accountId=${participant.id}`;

    dashboard.logger.info(`Fetching user data from: ${userUrl}`, { requestId });

    const userResponse = await fetch(userUrl, {
      method: "GET",
      headers: {
        Authorization: auth,
        Accept: "application/json",
      },
    });

    if (!userResponse.ok) {
      dashboard.logger.error(`Error response from Jira User API`, {
        requestId,
        status: userResponse.status,
        statusText: userResponse.statusText,
      });
      throw new Error(
        `HTTP error ${userResponse.status}: ${userResponse.statusText}`
      );
    }

    const userData = await userResponse.json();

    dashboard.logger.info(`User data received`, {
      requestId,
      hasEmail: !!userData.emailAddress,
      userName: userData.displayName || "unknown",
    });

    if (!userData.emailAddress) {
      dashboard.logger.warning(
        `User ${userData.displayName || participant.id} has no email address`,
        { requestId }
      );
      return null;
    }

    dashboard.logger.info(
      `Found on-call user: ${userData.displayName} (${userData.emailAddress})`,
      { requestId }
    );
    return userData;
  } catch (error) {
    dashboard.logger.error(`Error getting on-call user`, {
      requestId,
      scheduleId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get phone number by email from SQL database
 *
 * @param {string} email - Email address to look up
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<string>} Formatted phone number
 */
async function getPhoneNumberByEmail(email, requestId) {
  dashboard.logger.info(`Looking up phone number for email: ${email}`, {
    requestId,
  });

  // Base SQL connection configuration from config.js
  const sqlConfig = {
    server: config.sql.server,
    database: config.sql.database,
    port: config.sql.port,
    options: {
      encrypt: config.sql.encrypt,
      trustServerCertificate: config.sql.trustServerCertificate,
    },
    connectTimeout: 15000,
  };

  // Determine authentication mode and set appropriate options
  const authMode = config.sql.authMode;

  if (authMode === "windows") {
    // Windows Authentication (trusted connection)
    dashboard.logger.info(`Using Windows Authentication for SQL connection`, {
      requestId,
    });

    // For Windows auth in SQL Server, we need to set these specific options
    sqlConfig.options.trustedConnection = true;
    sqlConfig.options.enableArithAbort = true;
    sqlConfig.options.integratedSecurity = true;

    // Add domain if specified
    if (config.sql.domain) {
      sqlConfig.options.domain = config.sql.domain;
      dashboard.logger.info(`Using domain: ${config.sql.domain}`, {
        requestId,
      });
    }

    // For Windows auth, we remove user/password properties completely
    delete sqlConfig.user;
    delete sqlConfig.password;
  } else {
    // SQL Server Authentication (username/password)
    dashboard.logger.info(
      `Using SQL Server Authentication for SQL connection`,
      { requestId }
    );

    // Add username and password
    sqlConfig.user = config.sql.username;
    sqlConfig.password = config.sql.password;

    // Check for required credentials
    if (!sqlConfig.user || !sqlConfig.password) {
      dashboard.logger.error(
        `Missing SQL credentials for SQL Server Authentication`,
        { requestId }
      );
      throw new Error("SQL authentication requires username and password");
    }
  }

  // Log connection attempt (without sensitive info)
  const redactedConfig = { ...sqlConfig };
  if (redactedConfig.password) redactedConfig.password = "********";

  dashboard.logger.info(
    `Attempting SQL connection to ${sqlConfig.server}:${sqlConfig.port}/${sqlConfig.database}`,
    {
      requestId,
      authMode,
      options: redactedConfig.options,
    }
  );

  // Check if database is specified
  if (!sqlConfig.database) {
    dashboard.logger.error(`Missing SQL database name`, { requestId });
    throw new Error("SQL database name is required");
  }

  let pool = null;
  try {
    // Create connection pool
    pool = await sql.connect(sqlConfig);
    dashboard.logger.info(`SQL connection established`, { requestId });

    // Query the database
    const query = `
      SELECT TOP 1
        FullName AS fullName,
        CellPhone AS cellPhone,
        EmailAddress AS email
      FROM [${config.sql.table}]
      WHERE EmailAddress = @email
    `;

    dashboard.logger.info(`Executing SQL query for email: ${email}`, {
      requestId,
    });

    const result = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(query);

    if (result.recordset.length === 0) {
      dashboard.logger.warning(`No record found for email: ${email}`, {
        requestId,
      });
      return null;
    }

    const record = result.recordset[0];
    dashboard.logger.info(`Record found for ${email}`, {
      requestId,
      name: record.fullName,
      hasPhone: !!record.cellPhone,
    });

    if (!record.cellPhone) {
      dashboard.logger.warning(
        `Record found for ${email}, but no cell phone number available`,
        {
          requestId,
          name: record.fullName,
        }
      );
      return null;
    }

    // Format the phone number
    let phoneNumber = record.cellPhone.trim();
    phoneNumber = phoneNumber.replace(/\D/g, ""); // Remove non-digits

    // If exactly 10 digits, prepend '1' for country code
    if (phoneNumber.length === 10) {
      phoneNumber = "1" + phoneNumber;
    }

    dashboard.logger.info(`Found phone number for ${email}: ${phoneNumber}`, {
      requestId,
      name: record.fullName,
    });

    return phoneNumber;
  } catch (error) {
    dashboard.logger.error(`Error looking up phone number`, {
      requestId,
      email,
      error: error.message,
    });
    throw error;
  } finally {
    // Always close the connection pool
    if (pool) {
      dashboard.logger.info(`Closing SQL connection`, { requestId });
      await pool.close();
    }
  }
}

// Export the client functions
export default {
  getTeamOnCallPhoneNumber,
  getTeamSchedule,
  getSchedules,
  getOnCallUser,
  getPhoneNumberByEmail,

  // Expose method to manually clear caches
  clearCaches: () => {
    cache.schedules.data = null;
    cache.schedules.expiry = null;
    cache.phoneData.data = null;
    cache.phoneData.expiry = null;
    return true;
  },

  // Health check method
  isHealthy: async (requestId) => {
    try {
      // Check if we can get schedules as a basic health check
      const schedules = await getSchedules(requestId);
      return schedules && schedules.length > 0;
    } catch (error) {
      dashboard.logger.error(`Health check failed`, {
        requestId,
        error: error.message,
      });
      return false;
    }
  },

  // Close all SQL connections for clean shutdown
  closeSqlConnections: async () => {
    try {
      // In this implementation, we don't need to track connections since
      // we're already properly closing them in the finally blocks
      dashboard.logger.info(
        `SQL connections are automatically closed after each request`
      );

      // If you change the implementation to maintain persistent connections,
      // add cleanup code here
      return true;
    } catch (error) {
      dashboard.logger.error(`Error during SQL connection cleanup`, {
        error: error.message,
      });
      return false;
    }
  },
};
