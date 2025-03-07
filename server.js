/**
 * @file server.js
 * @description Express server providing RESTful API endpoints to access Jira Service Manager
 *              on-call schedule information and corresponding phone numbers from SQL database.
 *
 * This server provides endpoints for:
 * - Team-specific on-call phone number lookups (helpdesk, network, ibmi, etc.)
 * - Health check for monitoring
 * - Stats reset for clearing caches and metrics
 * - Test endpoint for quick connectivity verification
 *
 * @author Original: Systems Integration Team
 * @author Refactored by: JSM Ops Team
 */

import express from "express";
import dotenv from "dotenv";
import http from "http";
import util from "util";

// Load environment variables first to ensure availability for imported modules
dotenv.config();

// Load server configuration settings - use .js extension for ES Modules
import config from "./config.js";

// Import the console dashboard for logging and stats
import dashboard from "./console-dashboard.js";

// Import the client for Jira API and SQL database access
import directClient from "./direct-client.js";

// Initialize Express application
const app = express();

// Log startup with dashboard logger
dashboard.logger.info("Starting server...");
dashboard.logger.info("Configuration loaded", { port: config.server.port });

// Initialize the console dashboard
dashboard.initializeDashboard();

/**
 * Middleware Section
 * -----------------
 * Express middleware for request handling, logging, error management
 */

// Register built-in dashboard request tracking
app.use(dashboard.requestTracking);

/**
 * Request tracking middleware
 * Adds unique request ID and timing information to each request
 * Logs request start and completion for audit and performance tracking
 */
app.use((req, res, next) => {
  // Generate cryptographically non-secure but unique enough ID for request tracking
  const requestId = Math.random().toString(36).substring(2, 15);
  req.id = requestId;

  // Extract client information for logging and troubleshooting
  const clientIp =
    req.headers["x-forwarded-for"] || req.connection.remoteAddress || "unknown";

  const userAgent = req.headers["user-agent"] || "Unknown";

  // Log request initiation with context details
  dashboard.logger.info(`Request ${requestId} started`, {
    method: req.method,
    url: req.url,
    ip: clientIp,
    userAgent,
  });

  // Record starting timestamp for duration calculation
  req.startTime = Date.now();

  // Intercept response completion to log duration and status
  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    // Restore original end function to avoid multiple intercepts
    res.end = originalEnd;

    // Call actual end function with original arguments
    res.end(chunk, encoding);

    // Calculate and log request duration and outcome
    const duration = Date.now() - req.startTime;
    const logLevel = res.statusCode >= 400 ? "warning" : "info";

    dashboard.logger[logLevel](`Request ${requestId} completed`, {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  };

  next();
});

/**
 * Error response helper middleware
 * Standardizes error responses across the application
 * Ensures consistent error format and logging
 */
app.use((req, res, next) => {
  res.sendError = (status, message, details = null) => {
    const errorId = `err-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 7)}`;

    // Log the error with context
    dashboard.logger.warning(`Error in request ${req.id}`, {
      status,
      message,
      errorId,
      details: details || {},
    });

    // Send standardized error response
    res.status(status).json({
      status: "error",
      message: message,
      errorId: errorId,
    });
  };
  next();
});

/**
 * Team Endpoints Configuration
 * --------------------------
 * Maps API endpoint paths to their corresponding team names in Jira
 */

// Team name mapping for endpoint -> Jira schedule name
// IMPORTANT: These names must match EXACTLY how they appear in Jira schedules
// or must be findable via the flexible search algorithm in directClient.getTeamSchedule
const TEAM_MAPPING = {
  helpdesk: "Help-Desk-schedule",
  network: "Network-schedule",
  ibmi: "IBM-i-schedule",
  windows: "Windows-schedule",
  sql: "SQL-schedule",
  sharepoint: "SharePoint-schedule",
};

/**
 * Handles on-call phone number lookup for a specific team
 *
 * This centralized handler eliminates duplicate code across team endpoints
 * and provides consistent error handling and response formatting.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} teamName - The team name to look up in Jira schedules
 * @returns {Promise<void>} - Sends HTTP response with phone number or error
 */
async function handleTeamPhoneLookup(req, res, teamName) {
  // Normalize team name for display (capitalizes first letter of each word)
  const friendlyTeamName = teamName.replace(/\b\w/g, (char) =>
    char.toUpperCase()
  );

  dashboard.logger.info(`Processing ${friendlyTeamName} on-call lookup`, {
    requestId: req.id,
    team: teamName,
  });

  try {
    // Attempt to retrieve the on-call phone number via the client
    const phoneNumber = await directClient.getTeamOnCallPhoneNumber(
      teamName,
      req.id
    );

    // Handle case when no phone number is found
    if (!phoneNumber) {
      return res.sendError(
        404,
        `No on-call phone number found for ${friendlyTeamName} team`,
        { team: teamName }
      );
    }

    // Log successful lookup
    dashboard.logger.success(`${friendlyTeamName} phone number found`, {
      requestId: req.id,
      team: teamName,
      // Mask full number in logs for privacy - show only last 4 digits
      number:
        phoneNumber.length > 4
          ? `****${phoneNumber.substring(phoneNumber.length - 4)}`
          : "****",
    });

    // Send phone number as plain text response
    // This format is required for compatibility with existing systems
    res.send(phoneNumber);
  } catch (err) {
    // Detailed error logging
    dashboard.logger.error(`Error processing ${friendlyTeamName} request`, {
      requestId: req.id,
      team: teamName,
      error: err.message,
      stack: err.stack,
    });

    // Determine if this is a known error type or generic server error
    const errorMessage =
      err.message || "Internal server error processing on-call lookup";

    // Send formatted error response
    return res.sendError(500, errorMessage, { team: teamName });
  }
}

// Register all team endpoints using the mapping and shared handler
Object.entries(TEAM_MAPPING).forEach(([endpoint, teamName]) => {
  // Express requires a leading slash for routes
  const path = `/${endpoint}`;

  // Register GET handler for this team endpoint
  app.get(path, async (req, res) => {
    await handleTeamPhoneLookup(req, res, teamName);
  });

  // Log endpoint registration
  dashboard.logger.info(`Registered team endpoint: ${path} → ${teamName}`);
});

/**
 * Utility Endpoints
 * ---------------
 * Special endpoints for testing, monitoring, and maintenance
 */

/**
 * Test endpoint
 * Returns a consistent phone number for connectivity verification
 * @route GET /test
 */
app.get("/test", async function (req, res) {
  dashboard.logger.info(`Test endpoint accessed`, { requestId: req.id });

  try {
    // Use a consistent test number for quick verification from config
    // IMPORTANT: This is a designated test number, not a personal number
    const testNumber = config.defaultPhoneNumber;

    // Mask all but last 4 digits for privacy in logs
    const maskedNumber = `****${testNumber.slice(-4)}`;
    
    dashboard.logger.success(`Test endpoint response ready`, {
      requestId: req.id,
      number: maskedNumber, // Only log last 4 digits for privacy
    });

    res.send(testNumber);
  } catch (err) {
    dashboard.logger.error(`Error in test endpoint`, {
      requestId: req.id,
      error: err.message,
      stack: err.stack,
    });
    return res.sendError(500, "Test endpoint error");
  }
});

/**
 * Statistics reset endpoint
 * Clears dashboard statistics and client caches
 * Useful for maintenance and troubleshooting
 * @route GET /stats/reset
 */
app.get("/stats/reset", async function (req, res) {
  dashboard.logger.info(`Statistics reset requested`, { requestId: req.id });

  try {
    // Track which operations succeeded
    const resetOperations = {
      dashboard: false,
      clientCache: false,
    };

    // Reset dashboard statistics
    dashboard.resetStats();
    resetOperations.dashboard = true;

    // Clear client caches (Jira schedules, etc.)
    directClient.clearCaches();
    resetOperations.clientCache = true;

    dashboard.logger.success(`Statistics and caches reset successfully`, {
      requestId: req.id,
      operations: resetOperations,
    });

    // Return detailed response about what was reset
    res.status(200).json({
      status: "ok",
      message: "Statistics and cache data reset successfully",
      timestamp: new Date().toISOString(),
      details: {
        dashboard: "Statistics counters reset to zero",
        clientCache: "Jira schedule and user caches cleared",
      },
    });
  } catch (err) {
    dashboard.logger.error(`Error resetting statistics`, {
      requestId: req.id,
      error: err.message,
      stack: err.stack,
    });
    return res.sendError(500, "Error resetting statistics", {
      error: err.message,
    });
  }
});

/**
 * Health check endpoint
 * Provides detailed system health information for monitoring
 * @route GET /health
 */
app.get("/health", async function (req, res) {
  dashboard.logger.info(`Health check requested`, { requestId: req.id });

  try {
    // Check Jira API connectivity
    const isApiHealthy = await directClient.isHealthy(req.id);
    const apiStatus = isApiHealthy ? "healthy" : "unhealthy";

    // Get application state metrics
    const appState = dashboard.getAppState();

    // Calculate uptime in a human-readable format
    const uptimeSeconds = process.uptime();
    const uptimeFormatted = formatUptime(uptimeSeconds);

    // Collect memory usage (converted to MB for readability)
    const memoryUsage = process.memoryUsage();
    const memoryFormatted = {
      rss: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100 + "MB",
      heapTotal:
        Math.round((memoryUsage.heapTotal / 1024 / 1024) * 100) / 100 + "MB",
      heapUsed:
        Math.round((memoryUsage.heapUsed / 1024 / 1024) * 100) / 100 + "MB",
      external:
        Math.round((memoryUsage.external / 1024 / 1024) * 100) / 100 + "MB",
    };

    // Error rate calculation
    const errorRate =
      appState.requests.total > 0
        ? Math.round((appState.requests.error / appState.requests.total) * 100)
        : 0;

    // Build comprehensive health response
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "unknown",
      environment: process.env.NODE_ENV || "development",
      uptime: {
        seconds: uptimeSeconds,
        formatted: uptimeFormatted,
      },
      memory: memoryFormatted,
      dependencies: {
        jiraApi: apiStatus,
      },
      requests: {
        total: appState.requests.total,
        success: appState.requests.success,
        error: appState.requests.error,
        errorRate: `${errorRate}%`,
      },
      started: appState.startTime,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    dashboard.logger.error(`Error in health check endpoint`, {
      requestId: req.id,
      error: err.message,
      stack: err.stack,
    });

    // Even on error, return 200 status but with error details
    // This follows health check best practices where the endpoint itself worked
    res.status(200).json({
      status: "warning",
      message: "Health check completed with warnings",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Formats uptime seconds into human-readable string
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime (e.g., "2d 4h 12m 30s")
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${remainingSeconds}s`);

  return parts.join(" ");
}

/**
 * Error Handling
 * -------------
 * Error middleware for catching unmatched routes and server exceptions
 */

/**
 * 404 Not Found handler
 * Catches any routes that weren't matched by our defined endpoints
 */
app.use((req, res) => {
  const errorId = `404-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  dashboard.logger.warning(`Route not found: ${req.method} ${req.url}`, {
    requestId: req.id,
    method: req.method,
    path: req.url,
    errorId,
    userAgent: req.headers["user-agent"] || "Unknown",
  });

  res.status(404).json({
    status: "error",
    message: "Route not found",
    errorId,
    path: req.url,
  });
});

/**
 * Global error handler
 * Catches any unhandled errors in route handlers
 */
app.use((err, req, res, next) => {
  const errorId = `500-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  dashboard.logger.error(`Unhandled server error`, {
    requestId: req.id,
    method: req.method,
    path: req.url,
    errorId,
    message: err.message,
    stack: err.stack,
    name: err.name,
  });

  res.status(500).json({
    status: "error",
    message: "Internal server error",
    requestId: req.id,
    errorId,
  });
});

/**
 * Server Initialization
 * --------------------
 * Configure and start the HTTP server
 */

// Set port from config, with environment variable override
const PORT = process.env.PORT || config.server.port;

// Set environment explicitly if not already set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
  dashboard.logger.info("No NODE_ENV specified, defaulting to production mode");
}

// Create HTTP server instance explicitly
// This allows for better handling of server events and graceful shutdown
const server = http.createServer(app);

// Start the HTTP server
server.listen(PORT, () => {
  dashboard.logger.success("Server started successfully", {
    port: PORT,
    env: process.env.NODE_ENV,
    nodeVersion: process.version,
    pid: process.pid,
  });
});

/**
 * Graceful Shutdown Management
 * --------------------------
 * Ensures proper cleanup of resources on application termination
 */

/**
 * Performs a graceful shutdown of the server and all resources
 *
 * This function:
 * 1. Stops accepting new connections
 * 2. Closes database connections
 * 3. Waits for ongoing requests to complete
 * 4. Exits the process cleanly
 *
 * @param {string} signal - The signal that triggered the shutdown
 * @param {Error} [error] - Optional error that caused the shutdown
 */
function gracefulShutdown(signal, error = null) {
  const shutdownStart = Date.now();

  // Log shutdown reason
  if (error) {
    dashboard.logger.error(`${signal} triggered shutdown`, {
      error: error.message,
      stack: error.stack,
      name: error.name,
    });
  } else {
    dashboard.logger.info(
      `${signal} signal received: initiating graceful shutdown...`
    );
  }

  // If we're already shutting down, don't do it again
  if (server.shuttingDown) {
    dashboard.logger.warning(
      "Shutdown already in progress, ignoring redundant signal"
    );
    return;
  }

  // Mark server as shutting down
  server.shuttingDown = true;

  // Log details about active connections
  const activeConnections = server._connections || 0;
  dashboard.logger.info(
    `Shutdown status: ${activeConnections} active connections`
  );

  // Set a safety timeout to force exit if graceful shutdown takes too long
  const FORCE_SHUTDOWN_TIMEOUT_MS = 10000; // 10 seconds
  const forceExit = setTimeout(() => {
    dashboard.logger.error(
      `Shutdown timed out after ${
        FORCE_SHUTDOWN_TIMEOUT_MS / 1000
      }s. Forcing exit.`,
      { activeConnections }
    );
    process.exit(1);
  }, FORCE_SHUTDOWN_TIMEOUT_MS);

  // Ensure the force exit timer doesn't prevent the process from exiting
  forceExit.unref();

  // Cleanup steps array for sequential execution
  const cleanupSteps = [];

  // Step 1: Close SQL connections
  cleanupSteps.push(async () => {
    try {
      if (directClient.closeSqlConnections) {
        dashboard.logger.info("Closing SQL database connections...");
        await directClient.closeSqlConnections();
        dashboard.logger.success("SQL connections closed successfully");
      } else {
        dashboard.logger.info("No database connections to close");
      }
      return true;
    } catch (err) {
      dashboard.logger.error("Error closing database connections", {
        error: err.message,
        stack: err.stack,
      });
      return false;
    }
  });

  // Step 2: Stop the HTTP server (stop accepting new connections)
  cleanupSteps.push(() => {
    return new Promise((resolve) => {
      dashboard.logger.info(
        "Stopping HTTP server (no longer accepting connections)..."
      );

      // Close the server
      server.close(() => {
        dashboard.logger.success("HTTP server closed successfully");
        resolve(true);
      });
    });
  });

  // Execute all cleanup steps sequentially
  (async () => {
    try {
      for (const step of cleanupSteps) {
        await step();
      }

      // Calculate shutdown duration
      const shutdownDuration = Date.now() - shutdownStart;

      // Clear the force exit timeout since we're shutting down properly
      clearTimeout(forceExit);

      // Final success message
      dashboard.logger.success(
        `Graceful shutdown completed in ${shutdownDuration}ms`
      );

      // Give time for final log messages to be processed
      setTimeout(() => {
        dashboard.logger.info("Shutdown complete. Goodbye!");
        process.exit(0);
      }, 500);
    } catch (err) {
      dashboard.logger.error("Error during graceful shutdown", {
        error: err.message,
        stack: err.stack,
      });

      // Exit with error code
      process.exit(1);
    }
  })();
}

// Register signal handlers for graceful shutdown
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT (Ctrl+C)"));

/**
 * Error Management
 * --------------
 * Global handlers for unhandled exceptions and rejections
 */

/**
 * Handle uncaught exceptions based on environment
 * In production: Fatal - trigger shutdown
 * In development: Non-fatal - log but continue
 */
process.on("uncaughtException", (error) => {
  dashboard.logger.error("UNCAUGHT EXCEPTION", {
    error: error.message,
    stack: error.stack,
    name: error.name,
  });

  // In production, any uncaught exception is fatal
  if (process.env.NODE_ENV === "production") {
    dashboard.logger.error(
      "Fatal uncaught exception in production environment"
    );
    gracefulShutdown("UNCAUGHT EXCEPTION", error);
  } else {
    dashboard.logger.warning(
      "Uncaught exception in development mode - keeping server running",
      { recommendation: "This would trigger shutdown in production!" }
    );
  }
});

/**
 * Handle unhandled promise rejections based on environment
 * In production: Fatal - trigger shutdown
 * In development: Non-fatal - log but continue
 */
process.on("unhandledRejection", (reason, promise) => {
  let errorMsg;
  if (typeof reason === "object") {
    try {
      errorMsg = JSON.stringify(reason);
    } catch (e) {
      errorMsg = util.inspect(reason, { depth: null });
    }
  } else {
    errorMsg = JSON.stringify(reason, null, 2);
  }
  const error = reason instanceof Error ? reason : new Error(errorMsg);

  dashboard.logger.error("UNHANDLED PROMISE REJECTION", {
    error: error.message,
    stack: error.stack,
    name: error.name,
    promise: util.inspect(promise, { depth: null }),
  });

  // In production, any unhandled rejection is fatal
  if (process.env.NODE_ENV === "production") {
    dashboard.logger.error(
      "Fatal unhandled rejection in production environment"
    );
    gracefulShutdown("UNHANDLED REJECTION", error);
  } else {
    dashboard.logger.warning(
      "Unhandled promise rejection in development mode - keeping server running",
      {
        recommendation: "Fix this issue! Would trigger shutdown in production.",
      }
    );
  }
});
