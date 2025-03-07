/**
 * console-dashboard.js
 *
 * Provides a colored console dashboard for the application with runtime statistics,
 * error tracking, and enhanced logging functionality.
 */

import chalk from "chalk";
import cliCursor from "cli-cursor";
import boxen from "boxen";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration.js";
import relativeTime from "dayjs/plugin/relativeTime.js";

dayjs.extend(duration);
dayjs.extend(relativeTime);

// Application state tracking
const appState = {
  startTime: new Date(),
  requests: {
    total: 0,
    success: 0,
    error: 0,
    teams: {
      helpdesk: 0,
      network: 0,
      ibmi: 0,
      windows: 0,
      sql: 0,
      sharepoint: 0,
      test: 0,
      health: 0,
    },
  },
  lastError: null,
  errors: [],
  maxErrors: 10, // Maximum number of errors to track
};

// Color scheme
const colors = {
  info: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  highlight: chalk.magenta,
  dim: chalk.gray,
  normal: chalk.white,
  heading: chalk.bold.white,
  title: chalk.bold.blue,
  badge: {
    info: chalk.black.bgCyan,
    success: chalk.black.bgGreen,
    warning: chalk.black.bgYellow,
    error: chalk.white.bgRed,
  },
};

// Boxen configuration
const boxenOptions = {
  padding: 1,
  margin: 1,
  borderStyle: "round",
  borderColor: "blue",
  title: colors.title("JSM Ops CCX Middleware"),
  titleAlignment: "center",
  width: 80, // Make the dashboard wider
  height: 35, // Set a consistent height
};

/**
 * Format a timestamp
 * @param {Date} date - Date object to format
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(date = new Date()) {
  return dayjs(date).format("YYYY-MM-DD HH:mm:ss");
}

/**
 * Format uptime duration
 * @returns {string} Formatted uptime
 */
function formatUptime() {
  const now = dayjs();
  const start = dayjs(appState.startTime);
  const diff = now.diff(start);
  const uptime = dayjs.duration(diff);

  const days = Math.floor(uptime.asDays());
  const hours = uptime.hours();
  const minutes = uptime.minutes();
  const seconds = uptime.seconds();

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Track a request
 * @param {string} team - Team name (route)
 * @param {boolean} success - Whether the request was successful
 */
function trackRequest(team, success = true) {
  appState.requests.total++;

  if (success) {
    appState.requests.success++;
  } else {
    appState.requests.error++;
  }

  // Track team-specific request
  const normTeam = team.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (appState.requests.teams[normTeam] !== undefined) {
    appState.requests.teams[normTeam]++;
  }
}

/**
 * Track an error
 * @param {string} message - Error message
 * @param {Error|null} error - Error object
 */
function trackError(message, error = null) {
  const timestamp = new Date();
  const errorObj = {
    timestamp,
    message,
    error: error ? error.stack || error.toString() : null,
  };

  appState.lastError = errorObj;
  appState.errors.unshift(errorObj); // Add to beginning

  // Keep max errors limit
  if (appState.errors.length > appState.maxErrors) {
    appState.errors.pop();
  }
}

/**
 * Create log prefix with severity badge
 * @param {string} type - Log type (info, success, warning, error)
 * @param {string} timestamp - Formatted timestamp
 * @returns {string} Log prefix
 */
function createLogPrefix(type, timestamp) {
  let badge;
  switch (type) {
    case "info":
      badge = colors.badge.info(" INFO ");
      break;
    case "success":
      badge = colors.badge.success(" DONE ");
      break;
    case "warning":
      badge = colors.badge.warning(" WARN ");
      break;
    case "error":
      badge = colors.badge.error(" ERROR ");
      break;
    default:
      badge = colors.badge.info(" INFO ");
  }

  return `${badge} [${timestamp}] `;
}

/**
 * Enhanced console logging with throttled dashboard updates
 */
const logger = {
  /**
   * Log informational message
   * @param {string} message - Log message
   * @param {Object|null} data - Optional data to include
   */
  info: (message, data = null) => {
    const timestamp = formatTimestamp();
    const prefix = createLogPrefix("info", timestamp);

    // Format data as JSON, but handle circular references gracefully
    let dataStr = "";
    if (data) {
      try {
        dataStr =
          ": " +
          JSON.stringify(
            data,
            (key, value) => {
              if (key === "stack" && typeof value === "string") {
                // Truncate stack traces in logs for brevity
                return value.split("\n").slice(0, 3).join("\n") + "...";
              }
              return value;
            },
            2
          );
      } catch (e) {
        dataStr = ": [Complex Object]";
      }
    }

    const output = prefix + message + dataStr;
    console.log(output);

    // Update dashboard - no need to force, use throttling
    updateDashboard();
  },

  /**
   * Log success message
   * @param {string} message - Log message
   * @param {Object|null} data - Optional data to include
   */
  success: (message, data = null) => {
    const timestamp = formatTimestamp();
    const prefix = createLogPrefix("success", timestamp);

    // Format data as JSON, but handle circular references gracefully
    let dataStr = "";
    if (data) {
      try {
        dataStr = ": " + JSON.stringify(data);
      } catch (e) {
        dataStr = ": [Complex Object]";
      }
    }

    const output = prefix + message + dataStr;
    console.log(output);

    // Update dashboard - no need to force, use throttling
    updateDashboard();
  },

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object|null} data - Optional data to include
   */
  warning: (message, data = null) => {
    const timestamp = formatTimestamp();
    const prefix = createLogPrefix("warning", timestamp);

    // Format data as JSON, but handle circular references gracefully
    let dataStr = "";
    if (data) {
      try {
        dataStr = ": " + JSON.stringify(data);
      } catch (e) {
        dataStr = ": [Complex Object]";
      }
    }

    const output = prefix + message + dataStr;
    console.warn(output);

    // Update dashboard - no need to force, use throttling
    updateDashboard();
  },

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Error|Object|null} error - Optional error object or data
   */
  error: (message, error = null) => {
    const timestamp = formatTimestamp();
    const prefix = createLogPrefix("error", timestamp);

    // Process error object
    let errorStr = "";
    if (error) {
      if (error instanceof Error) {
        errorStr = ": " + error.message + "\n" + error.stack;
      } else {
        try {
          errorStr = ": " + JSON.stringify(error);
        } catch (e) {
          errorStr = ": [Complex Error Object]";
        }
      }
    }

    const output = prefix + message + errorStr;
    console.error(output);

    // Track error for dashboard
    trackError(message, error);

    // Force dashboard update immediately for errors
    // Errors are important and should be shown right away
    updateDashboard(true);
  },
};

/**
 * createDashboard function with fixed border alignment
 * Replace just this function in your code to fix the border issue
 */
function createDashboard() {
  const now = new Date();
  const uptime = formatUptime();
  const successRate = appState.requests.total
    ? Math.round((appState.requests.success / appState.requests.total) * 100)
    : 100;

  // Create content for panels

  // Server info content
  const statusText = appState.lastError ? "● ERROR" : "● RUNNING";
  const statusColor = appState.lastError ? colors.error : colors.success;

  let serverInfo = "";
  serverInfo += `${colors.heading("STATUS")}:      ${statusColor(
    statusText
  )}\n`;
  serverInfo += `${colors.heading("SERVER")}:      ${colors.normal(
    process.env.NODE_ENV || "development"
  )}\n`;
  serverInfo += `${colors.heading("VERSION")}:     ${colors.normal(
    process.version
  )}\n`;
  serverInfo += `${colors.heading("PORT")}:        ${colors.normal(
    process.env.PORT || "3100"
  )}\n`;
  serverInfo += `${colors.heading("CONN MODE")}:   ${colors.normal(
    process.env.SQL_AUTH_MODE || "sql"
  )}`;

  // Stats content
  const rateColor = successRate >= 95 ? colors.success : colors.warning;
  const rateText = successRate + "%";

  let statsInfo = "";
  statsInfo += `${colors.heading("TOTAL")}:    ${colors.normal(
    appState.requests.total
  )}\n`;
  statsInfo += `${colors.heading("SUCCESS")}: ${colors.success(
    appState.requests.success
  )}\n`;
  statsInfo += `${colors.heading("ERROR")}:   ${colors.error(
    appState.requests.error
  )}\n`;
  statsInfo += `${colors.heading("RATE")}:    ${rateColor(rateText)}`;

  // Time info content
  let timeInfo = "";
  timeInfo += `${colors.heading("STARTED")}:  ${colors.normal(
    formatTimestamp(appState.startTime)
  )}\n`;
  timeInfo += `${colors.heading("UPTIME")}:   ${colors.highlight(uptime)}\n`;
  timeInfo += `${colors.heading("CURRENT")}:  ${colors.normal(
    formatTimestamp(now)
  )}`;

  // Controls content
  let controlsInfo = "";
  controlsInfo += `${colors.dim("Press")} ${colors.highlight(
    "Ctrl+C"
  )} ${colors.dim("to shutdown")}\n`;
  controlsInfo += `${colors.dim("server")}\n`;
  controlsInfo += `${colors.dim("Press")} ${colors.highlight("r")} ${colors.dim(
    "to refresh dashboard"
  )}`;

  // Team stats content
  const teams = Object.entries(appState.requests.teams);
  let teamsInfo = "";

  // Format team stats in a consistent 3-column layout
  for (let i = 0; i < teams.length; i += 3) {
    const row = [];

    for (let j = 0; j < 3; j++) {
      const teamIndex = i + j;
      if (teamIndex < teams.length) {
        const [team, count] = teams[teamIndex];
        const displayTeam = team.charAt(0).toUpperCase() + team.slice(1);
        row.push(
          `${colors.normal(displayTeam.padEnd(10))}: ${colors.normal(
            count.toString().padStart(3)
          )}`
        );
      } else {
        row.push(" ".repeat(15)); // Padding for empty cells
      }
    }

    teamsInfo += row.join("    ") + "\n";
  }

  // Remove trailing newline if needed
  teamsInfo = teamsInfo.trim();

  // Error content
  let errorInfo = "";
  if (appState.lastError) {
    const errorTime = formatTimestamp(appState.lastError.timestamp);
    errorInfo += `${colors.dim("Time")}: ${colors.normal(errorTime)}\n`;
    errorInfo += colors.error(appState.lastError.message);
  } else {
    errorInfo = colors.success("No errors reported");
  }

  // Add titles and separators
  const addTitleAndSeparator = (title, content) => {
    const titleLine = colors.title(title);
    const separator = "-".repeat(
      title === "TEAM STATISTICS" || title === "LAST ERROR" ? 72 : 30
    );
    return `${titleLine}\n${separator}\n${content}`;
  };

  serverInfo = addTitleAndSeparator("SERVER INFO", serverInfo);
  statsInfo = addTitleAndSeparator("STATISTICS", statsInfo);
  timeInfo = addTitleAndSeparator("TIME INFO", timeInfo);
  controlsInfo = addTitleAndSeparator("CONTROLS", controlsInfo);
  teamsInfo = addTitleAndSeparator("TEAM STATISTICS", teamsInfo);
  errorInfo = addTitleAndSeparator("LAST ERROR", errorInfo);

  // Create top row panels with exact same width
  const panelWidth = 40; // Set exact width for all panels

  // Function to create a box with fixed exact width
  const createFixedBox = (content, options = {}) => {
    return boxen(content, {
      padding: 1,
      borderStyle: "round",
      borderColor: "blue",
      width: panelWidth,
      ...options,
    });
  };

  // Create the four main panels with exact same dimensions
  const serverBox = createFixedBox(serverInfo);
  const statsBox = createFixedBox(statsInfo);
  const timeBox = createFixedBox(timeInfo);
  const controlsBox = createFixedBox(controlsInfo);

  // Create full-width boxes - make sure width is exactly 2*panelWidth + spacing
  const fullWidth = 2 * panelWidth + 2; // +2 for spacing
  const teamsBox = boxen(teamsInfo, {
    padding: 1,
    borderStyle: "round",
    borderColor: "blue",
    width: fullWidth,
  });

  const errorBox = boxen(errorInfo, {
    padding: 1,
    borderStyle: "round",
    borderColor: "blue",
    width: fullWidth,
  });

  // For fixing the border alignment issue:
  // 1. Split all boxes into lines
  const serverLines = serverBox.split("\n");
  const statsLines = statsBox.split("\n");
  const timeLines = timeBox.split("\n");
  const controlsLines = controlsBox.split("\n");

  // 2. Make sure all panels in each row have exactly the same height
  const topRowHeight = Math.max(serverLines.length, statsLines.length);
  const midRowHeight = Math.max(timeLines.length, controlsLines.length);

  // 3. Fill missing lines with empty strings of exact same width
  const padToHeight = (lines, targetHeight, width) => {
    const result = [...lines];
    while (result.length < targetHeight) {
      result.push(" ".repeat(width));
    }
    return result;
  };

  // 4. Instead of padding partial lines, reconstruct exact empty lines that preserve borders
  const paddedServerLines = padToHeight(serverLines, topRowHeight, panelWidth);
  const paddedStatsLines = padToHeight(statsLines, topRowHeight, panelWidth);
  const paddedTimeLines = padToHeight(timeLines, midRowHeight, panelWidth);
  const paddedControlsLines = padToHeight(
    controlsLines,
    midRowHeight,
    panelWidth
  );

  // 5. Manually rebuild the layout with exact alignment
  let dashboard = "";

  // Top row - Server info and Stats with 2 space gap
  for (let i = 0; i < topRowHeight; i++) {
    dashboard += paddedServerLines[i] + "  " + paddedStatsLines[i] + "\n";
  }

  // Add a small gap
  dashboard += "\n";

  // Middle row - Time info and Controls with 2 space gap
  for (let i = 0; i < midRowHeight; i++) {
    dashboard += paddedTimeLines[i] + "  " + paddedControlsLines[i] + "\n";
  }

  // Add Teams panel
  dashboard += "\n" + teamsBox + "\n\n";

  // Add Error panel
  dashboard += errorBox;

  // Return the complete dashboard
  return dashboard;
}

// Dashboard update
let dashboardInterval = null;
let isDashboardVisible = false;
let lastUpdateTime = 0;
let pendingUpdate = false;

/**
 * Update the dashboard in the console
 * @param {boolean} [force=false] - Force update regardless of throttling
 */
function updateDashboard(force = false) {
  if (!isDashboardVisible) return;

  const now = Date.now();

  // If this is an automatic update (not forced) and it's been less than 250ms since the last update,
  // set a flag to update later but don't update now (prevents excessive redrawing)
  if (!force && now - lastUpdateTime < 250) {
    pendingUpdate = true;
    return;
  }

  // Reset the pending update flag
  pendingUpdate = false;
  lastUpdateTime = now;

  // Clear the console and update dashboard
  process.stdout.write("\x1Bc");
  process.stdout.write(createDashboard() + "\n\n");
  process.stdout.write("Press 'r' to manually refresh the dashboard\n");
}

/**
 * Initialize the dashboard with key controls and throttled updates
 */
function initializeDashboard() {
  isDashboardVisible = true;

  // Update dashboard immediately
  updateDashboard(true);

  // Set up interval to update dashboard every 15 seconds
  // This is much less resource-intensive than updating every second
  if (!dashboardInterval) {
    dashboardInterval = setInterval(() => {
      // Only update if something is pending or 15 seconds have passed
      const timeSinceLastUpdate = Date.now() - lastUpdateTime;
      if (pendingUpdate || timeSinceLastUpdate >= 15000) {
        updateDashboard(true);
      }
    }, 15000);
  }

  // Set up keyboard controls
  if (process.stdin.isTTY) {
    // Set raw mode to capture keypresses
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    // Handle keypresses
    process.stdin.on("data", (key) => {
      // If 'r' is pressed, refresh the dashboard immediately
      if (key == "r" || key == "R") {
        updateDashboard(true);
      }

      // If Ctrl+C is pressed, exit the process
      if (key == "\u0003") {
        process.exit();
      }
    });
  }

  // Hide cursor in console
  cliCursor.hide();

  // Handle cleanup on exit
  process.on("exit", () => {
    cliCursor.show();
    if (dashboardInterval) {
      clearInterval(dashboardInterval);
    }

    // Reset terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  });
}

/**
 * Express middleware to track requests
 */
function requestTracking(req, res, next) {
  // Extract team from URL
  const url = req.url.toLowerCase();
  let team = "other";

  if (url.startsWith("/helpdesk")) team = "helpdesk";
  else if (url.startsWith("/network")) team = "network";
  else if (url.startsWith("/ibmi")) team = "ibmi";
  else if (url.startsWith("/windows")) team = "windows";
  else if (url.startsWith("/sql")) team = "sql";
  else if (url.startsWith("/sharepoint")) team = "sharepoint";
  else if (url.startsWith("/test")) team = "test";
  else if (url.startsWith("/health")) team = "health";

  // Track request start
  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    res.end = originalEnd;
    res.end(chunk, encoding);

    // Track request completion
    const success = res.statusCode < 400;
    trackRequest(team, success);
  };

  next();
}

// Export the dashboard module
export default {
  logger,
  initializeDashboard,
  requestTracking,
  getAppState: () => ({ ...appState }),
  resetStats: () => {
    appState.requests.total = 0;
    appState.requests.success = 0;
    appState.requests.error = 0;
    Object.keys(appState.requests.teams).forEach((team) => {
      appState.requests.teams[team] = 0;
    });
  },
};
