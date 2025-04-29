/**
 * list-schedules.js
 * A simple script to fetch and list all on-call schedules from Jira
 */

import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Jira API configuration - pulled from your environment
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_CLOUD_ID = process.env.JIRA_CLOUD_ID;
const JIRA_HOST_URL = process.env.JIRA_HOST_URL;
const JIRA_BASE_PATH = process.env.JIRA_BASE_PATH;

// Verify we have required configuration
if (
  !JIRA_USERNAME ||
  !JIRA_API_TOKEN ||
  !JIRA_CLOUD_ID ||
  !JIRA_HOST_URL ||
  !JIRA_BASE_PATH
) {
  console.error("ERROR: Missing required Jira API configuration variables");
  console.error("Please ensure these environment variables are set:");
  console.error("- JIRA_USERNAME");
  console.error("- JIRA_API_TOKEN");
  console.error("- JIRA_CLOUD_ID");
  console.error("- JIRA_HOST_URL");
  console.error("- JIRA_BASE_PATH");
  process.exit(1);
}

/**
 * Fetch all schedules from Jira
 */
async function fetchSchedules() {
  console.log("Fetching schedules from Jira API...");

  // Build the URL and auth header
  const url = `${JIRA_HOST_URL}/${JIRA_BASE_PATH}/${JIRA_CLOUD_ID}/v1/schedules`;
  const auth =
    "Basic " +
    Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString("base64");

  console.log(`API URL: ${url}`);

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

    return data.values;
  } catch (error) {
    const sanitizedMessage = error.message.replace(/[\r\n]/g, " ");
    console.error("Error fetching schedules from Jira:", sanitizedMessage);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Get all schedules
    const schedules = await fetchSchedules();

    console.log("\n=== JIRA ON-CALL SCHEDULES ===");
    console.log(`Total schedules found: ${schedules.length}\n`);

    // Display all schedules with their IDs
    schedules.forEach((schedule, index) => {
      const sanitize = (str) => str.replace(/[\r\n]/g, " ").replace(/["']/g, "");
      console.log(`${index + 1}. ID: ${sanitize(schedule.id)}`);
      console.log(`   Name: "${sanitize(schedule.name)}"`);
      console.log(`   Description: ${sanitize(schedule.description || "N/A")}`);
      console.log(`   Time Zone: ${sanitize(schedule.timezone || "N/A")}`);
      console.log(``);
    });

    // Show summarized list for easy reference
    console.log("=== SCHEDULE NAMES (SIMPLE LIST) ===");
    schedules.forEach((schedule, index) => {
      const sanitizedScheduleName = schedule.name.replace(/[\r\n]/g, " ").replace(/["']/g, "");
      console.log(`${index + 1}. "${sanitizedScheduleName}"`);
    });

    // Help with matching to endpoints
    console.log("\n=== SUGGESTED MAPPING ===");

    // Define your endpoints
    const endpoints = [
      "helpdesk",
      "network",
      "ibmi",
      "windows",
      "sql",
      "sharepoint",
    ];

    endpoints.forEach((endpoint) => {
      // Try to find potential matches
      const normalized = endpoint.toLowerCase();
      const potentialMatches = schedules.filter(
        (s) =>
          s.name.toLowerCase().includes(normalized) ||
          normalized.includes(s.name.toLowerCase())
      );

      if (potentialMatches.length > 0) {
        const sanitizedEndpoint = endpoint.replace(/[\r\n]/g, " ").replace(/["']/g, "");
        console.log(`Endpoint "/${sanitizedEndpoint}" might match these schedules:`);
        potentialMatches.forEach((match) => {
          console.log(`  - "${match.name}"`);
        });
      } else {
        const sanitizedEndpoint = endpoint.replace(/[\r\n]/g, " ").replace(/["']/g, "");
        console.log(`No potential matches found for endpoint "/${sanitizedEndpoint}"`);
      }
      console.log(``);
    });
  } catch (error) {
    console.error("Script failed:", error);
    process.exit(1);
  }
}

// Run the script
main();
