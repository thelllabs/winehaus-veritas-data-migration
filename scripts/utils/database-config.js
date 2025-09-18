/**
 * Database Configuration Utilities
 * 
 * Shared utilities for managing database configurations across import scripts.
 * This module provides reusable database connection configuration to avoid
 * code duplication and ensure consistency.
 * 
 * IMPORTANT: This module requires a valid database config file to be present.
 * It will NOT fall back to environment variables - the config file must exist
 * and contain all required database connection parameters.
 */

const fs = require('fs');

/**
 * Database connection configuration class
 * Handles loading configuration from JSON files only - no environment variable fallbacks
 */
class DatabaseConfig {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this.loadConfig();
  }

  /**
   * Loads database configuration from file
   * @returns {Object} Database configuration object
   * @throws {Error} If config file doesn't exist or is invalid
   */
  loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Database config file not found: ${this.configPath}`);
    }

    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      const config = JSON.parse(configData);
      console.log(`📁 Loaded database config from: ${this.configPath}`);
      return config;
    } catch (error) {
      throw new Error(`Failed to load or parse config file ${this.configPath}: ${error.message}`);
    }
  }

  /**
   * Returns TypeORM-compatible connection configuration
   * @returns {Object} TypeORM DataSource configuration
   */
  getConnectionConfig() {
    const config = {
      type: 'postgres',
      host: this.config.server,
      port: this.config.port,
      username: this.config.user,
      password: this.config.password,
      database: this.config.database,
      synchronize: false,
      logging: false
    };

    // Add SSL configuration if present
    if (this.config.ssl) {
      config.ssl = this.config.ssl;
    }

    return config;
  }

  /**
   * Returns raw configuration object
   * @returns {Object} Raw database configuration
   */
  getRawConfig() {
    return this.config;
  }

  /**
   * Validates that all required configuration properties are present
   * @returns {boolean} True if configuration is valid
   * @throws {Error} If required configuration is missing
   */
  validate() {
    const required = ['server', 'database', 'user', 'password', 'port'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required database configuration: ${missing.join(', ')}`);
    }
    
    return true;
  }

  /**
   * Returns a connection string for debugging purposes (password masked)
   * @returns {string} Masked connection string
   */
  getConnectionString() {
    return `postgresql://${this.config.user}:****@${this.config.server}:${this.config.port}/${this.config.database}`;
  }
}


/**
 * Helper function to parse config path from command line arguments
 * @param {Array} argv - Command line arguments (default: process.argv)
 * @param {string} defaultPath - Default config path if not specified
 * @returns {string} Configuration file path
 */
function parseConfigPath(argv = process.argv, defaultPath = './database-import.local.config.json') {
  const configArg = argv.find(arg => arg.startsWith('--config='));
  return configArg ? configArg.split('=')[1] : defaultPath;
}

module.exports = {
  DatabaseConfig,
  parseConfigPath
};
