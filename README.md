# JSM Ops CCX Middleware

A Node.js middleware application that integrates Cisco Contact Center Express (CCX) with Jira Service Manager (JSM) and SQL database for phone lookups. The service retrieves the current on-call resource for a specified team from Jira, looks up their phone number from the SQL database, and returns the formatted phone number back to CCX for call transfer.

## Overview

This application is designed to:
- **Integrate with Jira Service Manager**: Retrieve on-call schedules using Jira's API.
- **Lookup Phone Numbers**: Find the on-call user's phone number using SQL database queries.
- **Provide REST Endpoints**: Expose endpoints (e.g., `/helpdesk`, `/network`, `/windows`, etc.) that CCX can call to obtain the on-call number.
- **Robust Logging & Error Handling**: Log request details with timestamps and request IDs; handle errors gracefully with detailed diagnostics.
- **Interactive Dashboard**: Real-time dashboard to monitor system health and request statistics.

## Components

- **server.js**  
  The main Express server that defines REST endpoints, sets up request logging, error handling, and graceful shutdown. Implements robust error handling and resource management.

- **config.js**  
  Loads and validates environment variables using [dotenv](https://www.npmjs.com/package/dotenv). It configures the server settings, Jira API details, and SQL database connection options.

- **direct-client.js**  
  Contains the modern implementation for interfacing with Jira Service Manager and SQL database. It retrieves schedule data, caches results for 15 minutes, processes on-call user information, and looks up phone numbers in the SQL database.

- **console-dashboard.js**  
  Provides an interactive terminal dashboard for monitoring system health, request statistics, and errors. Updates every 15 seconds or manually when pressing 'r'.

## Technologies & Versions

- **Node.js**: Built on Node.js v22.
- **ES Modules**: The project uses ECMAScript modules (`import`/`export`).
- **Express**: For building the RESTful API.
- **dotenv**: For loading environment variables.
- **node-fetch**: For making HTTP requests to Jira API.
- **mssql**: For SQL database connectivity.
- **chalk**, **boxen**, **dayjs**: For interactive terminal dashboard.
- **cli-cursor**: For terminal UI management.
- **Nodemon**: For development hot-reloading.

## Installation

1. **Clone the Repository**  
   ```bash
   git clone https://github.com/tpaulsoncdw/jsm-ops-ccx-middleware.git
   cd jsm-ops-ccx-middleware
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Set Up Environment Variables**

Create a `.env` file in the project root. Use the template below as a guide:

```env
# Server Configuration
PORT=3100
# SERVER_URL is optional and will be derived from PORT if not specified
# SERVER_URL=http://example.com:3100

# Jira Service Manager API
JIRA_USERNAME=your_jira_username
JIRA_API_TOKEN=your_jira_api_token
JIRA_CLOUD_ID=your_jira_cloud_id
JIRA_HOST_URL=https://your_jira_host
JIRA_BASE_PATH=rest/servicedeskapi
JIRA_DOMAIN=your-domain.atlassian.net

# SQL Database Configuration - Common Settings
SQL_SERVER=your_sql_server
SQL_DATABASE=your_database
SQL_TABLE=dbo.PhoneDirectory
SQL_PORT=1433
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERT=false

# SQL Authentication Mode ('sql' or 'windows')
SQL_AUTH_MODE=sql

# For SQL Server Authentication (when SQL_AUTH_MODE=sql)
SQL_USERNAME=your_sql_username
SQL_PASSWORD=your_sql_password

# For Windows Authentication (when SQL_AUTH_MODE=windows)
# SQL_TRUSTED_CONNECTION=true
# SQL_DOMAIN=optional_domain_name

# Temporary Local File (Fallback mode)
USE_TEMP_FILE=false
TEMP_FILE=phone-list.csv

# Default phone number for tests/fallbacks
DEFAULT_PHONE_NUMBER=15555555555
```

Adjust these values to match your environment. The application primarily uses SQL database for phone lookups, but can optionally use a local CSV file if `USE_TEMP_FILE=true` is set.

### Example: Windows Authentication Configuration

For environments that use Windows Authentication to SQL Server:

```env
# Set authentication mode to Windows
SQL_AUTH_MODE=windows
SQL_TRUSTED_CONNECTION=true

# Optional domain (may be required in some environments)
SQL_DOMAIN=CONTOSO

# Other SQL settings remain the same
SQL_SERVER=your_sql_server
SQL_DATABASE=your_database
SQL_TABLE=dbo.PhoneDirectory
SQL_PORT=1433
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERT=true
```

With this configuration, the application will use the Windows credentials of the running process to connect to SQL Server.

4. **Run the Application**

   For production:
   ```bash
   npm start       # Sets NODE_ENV=production
   # or
   npm run prod    # Alternative production command
   ```

   For development (with hot-reloading):
   ```bash
   npm run dev     # Sets NODE_ENV=development
   ```

   The production mode has stricter error handling that will shut down the server on uncaught exceptions or unhandled promise rejections, while development mode keeps the server running to make debugging easier.

## Dashboard Controls

The application features an interactive terminal dashboard that provides real-time information about the system:

- **Auto-update**: Dashboard refreshes automatically every 15 seconds
- **Manual refresh**: Press `r` to immediately refresh the dashboard
- **Exit**: Press `Ctrl+C` to gracefully shut down the server

The dashboard displays:
- **Server status**: Status, uptime, port, environment
- **Request statistics**: Total, success, error counts, and success rate
- **Team-specific metrics**: Request counts per team endpoint
- **Error information**: Most recent error details


## API Endpoints

### Team On-Call Phone Number Endpoints
- `GET /helpdesk` – Retrieves the on-call number for the Help Desk team
- `GET /network` – Retrieves the on-call number for the Network team
- `GET /ibmi` – Retrieves the on-call number for the IBM i team
- `GET /windows` – Retrieves the on-call number for the Windows team
- `GET /sql` – Retrieves the on-call number for the SQL team
- `GET /sharepoint` – Retrieves the on-call number for the SharePoint team

Each endpoint returns a phone number as plain text (e.g., `15551234567`) for direct use by CCX.

### Utility Endpoints
- `GET /test` – Returns a consistent test phone number for connectivity verification
- `GET /health` – Health check endpoint that returns detailed system status information including:
  - API health status
  - Uptime metrics
  - Memory usage
  - Request statistics
  - Error rate
- `GET /stats/reset` – Resets statistics counters and clears caches

## Architecture Features

### Request Handling and Logging
- **Request Tracking**: Each request gets a unique ID for complete traceability
- **Structured Logging**: Contextual logging with timestamp, severity, request ID, and detailed metadata
- **Performance Metrics**: Request duration tracking with success/failure analysis
- **Privacy Protection**: Phone numbers masked in logs for privacy compliance

### Error Handling
- **Standardized Error Responses**: Consistent JSON error format with error IDs
- **Graceful Error Recovery**: Detailed error logging with context for troubleshooting
- **Route-specific Handling**: Customized error handling for each endpoint type
- **Global Error Boundary**: Catches and logs unhandled exceptions

### Caching and Performance
- **Jira API Cache**: Schedule data cached for 15 minutes to minimize external API calls
- **Efficient Resource Usage**: Dashboard updates throttled to reduce CPU usage

### Reliability and Resilience
- **Graceful Shutdown**: Proper resource cleanup and connection termination
- **Signal Handling**: SIGTERM and SIGINT (Ctrl+C) handlers with orderly shutdown sequence
- **Production-ready Exception Handling**: Automatic shutdown for critical errors in production
- **Development Mode**: More lenient error handling in development for easier debugging

### SQL Database Integration
- **Connection Pooling**: Efficient database resource management
- **Parameterized Queries**: Protection against SQL injection
- **Proper Connection Closing**: Resources released after each query
- **Table Configuration**: SQL table name configurable via environment variables
- **Multiple Authentication Methods**: Support for both SQL Server Authentication (username/password) and Windows Authentication (trusted connection)
- **Domain Support**: Optional domain specification for Windows Authentication
- **Flexible Configuration**: Easy switching between authentication methods via environment variables
- **Default Fallback Values**: Configurable default phone numbers for testing and fallback scenarios

## Customization Options

The system can be customized through environment variables and code modifications:

### Schedule and Cache Timeouts
- Jira schedule cache duration (default: 15 minutes)
- Dashboard refresh interval (default: 15 seconds)

### Team Mapping
The mapping between API endpoints and Jira schedule names is defined in `server.js` within the `TEAM_MAPPING` constant. Modify this to match your specific Jira schedule naming conventions.

### SQL Configuration
- The SQL table name is configurable via the `SQL_TABLE` environment variable
- The SQL queries use the table name from configuration and can be customized to match your database schema
- A default phone number for testing is configurable via the `DEFAULT_PHONE_NUMBER` environment variable

## Author & Contact

**TJ Paulson**  
CDW  
Email: tj.paulson@cdw.com

## License

This project is licensed under the ISC License.

## Dependencies

### Production Dependencies
- `express`: Web application framework
- `dotenv`: Environment variable management
- `node-fetch`: HTTP request library
- `mssql`: SQL Server database client
- `chalk`, `boxen`, `dayjs`: Terminal dashboard components
- `cli-cursor`: Terminal cursor control

### Development Dependencies
- `nodemon`: Development server with hot-reloading