#!/usr/bin/env node

/**
 * Legacy User Data Extraction Script
 * 
 * See LLM_SCRIPT_INSTRUCTIONS.md for project-wide guidelines
 * 
 * This script connects to the legacy SQL Server database, extracts user data,
 * and saves it locally in your preferred format.
 * 
 * Usage:
 *   node scripts/extract-user-data.js --help
 *   node scripts/extract-user-data.js --config=./database-extract.config.json
 *   node scripts/extract-user-data.js --output=./extracted-data --format=json
 */

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// SQL queries for user data extraction
// IMPORTANT: These queries extract ALL data - active, inactive, deleted, and historical records
const EXTRACTION_QUERIES = {
  users: `
    SELECT 
      u.UserID as legacy_user_id,
      u.FirstName,
      u.LastName,
      u.Email,
      u.Username,
      u.Role,
      CASE WHEN u.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      u.LastLogin,
      u.DateCreated as created_at,
      u.DateUpdated as updated_at
    FROM Users u
    ORDER BY u.UserID
  `,
  
  accounts: `
    SELECT 
      a.AccountID as legacy_account_id,
      a.UserID as legacy_user_id,
      a.AccountName,
      a.FirstName,
      a.LastName,
      a.Email,
      CASE WHEN a.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      a.NormalPrice,
      a.BreakVolume1,
      a.BreakPrice1,
      a.BreakVolume2,
      a.BreakPrice2,
      a.Notes,
      a.DateCreated as created_at,
      a.DateUpdated as updated_at
    FROM Accounts a
    ORDER BY a.AccountID
  `,
  
  accountPhones: `
    SELECT 
      ap.AccountPhoneID as legacy_phone_id,
      ap.AccountID as legacy_account_id,
      ap.PhoneLabel,
      ap.PhoneNumber
    FROM AccountPhones ap
    ORDER BY ap.AccountPhoneID
  `,
  
  addresses: `
    SELECT 
      addr.AddressID as legacy_address_id,
      addr.AccountID as legacy_account_id,
      addr.AddressName,
      addr.AddressLine1,
      addr.AddressLine2,
      addr.City,
      addr.State,
      addr.ZipCode,
      addr.AddressType,
      CASE WHEN addr.PreferredShipping = 1 THEN 'true' ELSE 'false' END as preferred_shipping,
      CASE WHEN addr.PreferredBilling = 1 THEN 'true' ELSE 'false' END as preferred_billing,
      CASE WHEN addr.IsActive = 1 THEN 'true' ELSE 'false' END as is_active
    FROM Addresses addr
    ORDER BY addr.AddressID
  `,
  
  contacts: `
    SELECT 
      c.ContactID as legacy_contact_id,
      c.AccountID as legacy_account_id,
      c.Title,
      c.FirstName,
      c.LastName,
      c.Email,
      c.ContactType,
      CASE WHEN c.Preferred = 1 THEN 'true' ELSE 'false' END as preferred,
      c.DateCreated as created_at,
      c.DateUpdated as updated_at
    FROM Contacts c
    ORDER BY c.ContactID
  `,
  
  contactPhones: `
    SELECT 
      cp.ContactPhoneID as legacy_phone_id,
      cp.ContactID as legacy_contact_id,
      cp.PhoneLabel,
      cp.PhoneNumber
    FROM ContactPhones cp
    ORDER BY cp.ContactPhoneID
  `,
  
  userLogs: `
    SELECT 
      ul.UserLogID as legacy_log_id,
      ul.UserID as legacy_user_id,
      ul.DateLogged,
      ul.RemoteIPAddress,
      ul.UserAgent
    FROM UserLogs ul
    ORDER BY ul.UserLogID
  `,
  
  userNameHistory: `
    SELECT 
      unh.UserNameHistoryID as legacy_history_id,
      unh.UserID as legacy_user_id,
      unh.UserName,
      unh.dte_start as start_date,
      unh.dte_end as end_date
    FROM UserNameHistory unh
    ORDER BY unh.UserNameHistoryID
  `
};

/**
 * Database connection configuration
 */
class DatabaseConfig {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(configData);
      }
    } catch (error) {
      console.warn(`Warning: Could not load config from ${this.configPath}:`, error.message);
    }

    // Default configuration - you can override these with environment variables
    return {
      server: process.env.DB_SERVER || 'localhost',
      database: process.env.DB_NAME || 'Chelsea',
      user: process.env.DB_USER || 'sa',
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT || 1433,
      options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
        enableArithAbort: true
      }
    };
  }

  getConnectionString() {
    return {
      server: this.config.server,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      port: this.config.port,
      options: this.config.options
    };
  }
}

/**
 * Data extractor class
 */
class LegacyUserDataExtractor {
  constructor(config) {
    this.config = config;
    this.mssql = null;
    this.connection = null;
  }

  async connect() {
    try {
      // Dynamically import mssql to avoid requiring it if not needed
      this.mssql = require('mssql');
      
      const connectionConfig = this.config.getConnectionString();
      
      console.log('Connecting to SQL Server...');
      console.log(`Server: ${connectionConfig.server}:${connectionConfig.port}`);
      console.log(`Database: ${connectionConfig.database}`);
      console.log(`User: ${connectionConfig.user}`);
      
      this.connection = await this.mssql.connect(connectionConfig);
      console.log('✅ Connected to SQL Server successfully');
      
    } catch (error) {
      console.error('❌ Failed to connect to SQL Server:', error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.close();
      console.log('✅ Disconnected from SQL Server');
    }
  }

  async executeQuery(queryName, query) {
    try {
      console.log(`Executing query: ${queryName}`);
      const result = await this.connection.request().query(query);
      console.log(`✅ ${queryName}: ${result.recordset.length} records extracted`);
      return result.recordset;
    } catch (error) {
      console.error(`❌ Error executing ${queryName}:`, error.message);
      
      // Provide specific troubleshooting guidance based on error type
      if (error.message.includes('permission')) {
        console.error(`💡 Permission Error: Ensure database user has SELECT permissions on ${queryName} table`);
      } else if (error.message.includes('Invalid object name')) {
        console.error(`💡 Table Not Found: Verify table '${queryName}' exists in the database`);
      } else if (error.message.includes('Login failed')) {
        console.error(`💡 Authentication Error: Check username/password in database configuration`);
      } else if (error.message.includes('timeout')) {
        console.error(`💡 Timeout Error: Check network connectivity and database performance`);
      } else if (error.message.includes('connection')) {
        console.error(`💡 Connection Error: Verify SQL Server is running and accessible`);
      }
      
      throw error;
    }
  }

  async extractAllData() {
    const extractedData = {};
    
    for (const [queryName, query] of Object.entries(EXTRACTION_QUERIES)) {
      try {
        extractedData[queryName] = await this.executeQuery(queryName, query);
      } catch (error) {
        console.error(`Failed to extract ${queryName}, continuing with other queries...`);
        extractedData[queryName] = [];
      }
    }
    
    // Perform data integrity checks
    await this.validateDataIntegrity(extractedData);
    
    return extractedData;
  }

  async validateDataIntegrity(extractedData) {
    console.log('\n🔍 Performing data integrity checks...');
    
    // Check for critical data
    if (extractedData.users && extractedData.users.length === 0) {
      console.warn('⚠️ Warning: No users found - this may indicate a configuration issue');
    }
    
    if (extractedData.accounts && extractedData.accounts.length === 0) {
      console.warn('⚠️ Warning: No accounts found - this may indicate a configuration issue');
    }
    
    // Check for orphaned records
    if (extractedData.addresses && extractedData.accounts) {
      const accountIds = new Set(extractedData.accounts.map(a => a.legacy_account_id));
      const orphanedAddresses = extractedData.addresses.filter(addr => !accountIds.has(addr.legacy_account_id));
      if (orphanedAddresses.length > 0) {
        console.warn(`⚠️ Warning: ${orphanedAddresses.length} addresses found without associated accounts`);
      }
    }
    
    // Check for data consistency
    if (extractedData.users && extractedData.accounts) {
      const userIds = new Set(extractedData.users.map(u => u.legacy_user_id));
      const orphanedAccounts = extractedData.accounts.filter(acc => !userIds.has(acc.legacy_user_id));
      if (orphanedAccounts.length > 0) {
        console.warn(`⚠️ Warning: ${orphanedAccounts.length} accounts found without associated users`);
      }
    }
    
    console.log('✅ Data integrity checks completed');
  }
}

/**
 * Data saver class
 */
class DataSaver {
  constructor(outputDir, format = 'json') {
    this.outputDir = outputDir;
    this.format = format.toLowerCase();
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      console.log(`Created output directory: ${this.outputDir}`);
    }
  }

  saveData(data, filename) {
    const filePath = path.join(this.outputDir, `${filename}.${this.format}`);
    
    try {
      let content;
      
      switch (this.format) {
        case 'json':
          content = JSON.stringify(data, null, 2);
          break;
          
        case 'csv':
          content = this.convertToCSV(data);
          break;
          
        case 'sql':
          content = this.convertToSQL(data, filename);
          break;
          
        default:
          throw new Error(`Unsupported format: ${this.format}`);
      }
      
      fs.writeFileSync(filePath, content);
      console.log(`✅ Saved ${filename}.${this.format} (${data.length} records)`);
      
    } catch (error) {
      console.error(`❌ Failed to save ${filename}.${this.format}:`, error.message);
      throw error;
    }
  }

  convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        // Escape commas and quotes in CSV
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
  }

  convertToSQL(data, tableName) {
    if (!data || data.length === 0) return `-- No data for ${tableName}\n`;
    
    const columns = Object.keys(data[0]);
    let sql = `-- ${tableName} data\n`;
    sql += `INSERT INTO temp_${tableName} (${columns.join(', ')}) VALUES\n`;
    
    const values = data.map(row => {
      const rowValues = columns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        return value;
      });
      return `(${rowValues.join(', ')})`;
    });
    
    sql += values.join(',\n') + ';\n';
    return sql;
  }

  saveAllData(extractedData) {
    console.log(`\nSaving extracted data in ${this.format.toUpperCase()} format...`);
    
    for (const [queryName, data] of Object.entries(extractedData)) {
      this.saveData(data, queryName);
    }
    
    console.log(`\n✅ All data saved to: ${this.outputDir}`);
  }
}

/**
 * Main function
 */
async function main() {
  program
    .name('extract-user-data')
    .description('Extract user data from legacy SQL Server system and save locally')
    .option('-c, --config <path>', 'Database configuration file path', './database-extract.config.json')
    .option('-o, --output <dir>', 'Output directory for extracted data', './extracted-data')
    .option('-f, --format <format>', 'Output format (json, csv, sql)', 'json')
    .parse(process.argv);
  
  const options = program.opts();
  
  try {
    console.log('👥 Legacy User Data Extractor');
    console.log('==============================\n');
    console.log('This script will extract user data from your legacy SQL Server database');
    console.log('and save it locally in your preferred format.\n');
    
    // Load database configuration
    const dbConfig = new DatabaseConfig(options.config);
    
    // Create data extractor
    const extractor = new LegacyUserDataExtractor(dbConfig);
    
    // Connect to database
    await extractor.connect();
    
    // Extract all data
    console.log('\n📊 Extracting user data from legacy system...\n');
    const extractedData = await extractor.extractAllData();
    
    // Disconnect from database
    await extractor.disconnect();
    
    // Save extracted data
    const dataSaver = new DataSaver(options.output, options.format);
    dataSaver.saveAllData(extractedData);
    
    // Summary
    console.log('\n📋 Extraction Summary:');
    console.log('========================');
    for (const [queryName, data] of Object.entries(extractedData)) {
      console.log(`${queryName}: ${data.length} records`);
    }
    
    console.log(`\n🎉 User data extraction completed successfully!`);
    
    // Provide validation queries
    console.log(`\n📊 Validation Queries:`);
    console.log(`========================`);
    console.log(`-- Verify user data integrity:`);
    console.log(`-- SELECT COUNT(*) as total_users FROM Users;`);
    console.log(`-- SELECT COUNT(*) as total_accounts FROM Accounts;`);
    console.log(`-- SELECT COUNT(*) as total_addresses FROM Addresses;`);
    console.log(`-- SELECT COUNT(*) as total_phones FROM AccountPhones;`);
    
    console.log(`\nNext steps:`);
    console.log(`1. Review the extracted data in: ${options.output}`);
    console.log(`2. Use the extracted data for your migration process`);
    console.log(`3. Run the user import script when ready`);
    
    // Provide rollback instructions
    console.log(`\n🔄 Rollback Instructions:`);
    console.log(`=======================`);
    console.log(`If you need to rollback the extraction:`);
    console.log(`1. Delete the extracted data files from: ${options.output}`);
    console.log(`2. No database changes were made - extraction is read-only`);
    console.log(`3. Re-run extraction with corrected configuration if needed`);
    
  } catch (error) {
    console.error('\n❌ User data extraction failed:', error.message);
    
    // Provide comprehensive error guidance
    console.log('\n🔧 Troubleshooting Guide:');
    console.log('========================');
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('1. Check if SQL Server is running');
      console.log('2. Verify the server address and port in database-extract.config.json');
      console.log('3. Check firewall settings and network connectivity');
    } else if (error.message.includes('Login failed')) {
      console.log('1. Verify username and password in database-extract.config.json');
      console.log('2. Check if the user account is active and has proper permissions');
      console.log('3. Ensure the database name is correct');
    } else if (error.message.includes('permission')) {
      console.log('1. Ensure the database user has SELECT permissions on all tables');
      console.log('2. Check if the user has access to the specified database');
      console.log('3. Verify the user is not locked or expired');
    } else if (error.message.includes('Invalid object name')) {
      console.log('1. Verify table names exist in the database');
      console.log('2. Check if you\'re connected to the correct database');
      console.log('3. Ensure table names match the case sensitivity of your SQL Server');
    } else {
      console.log('1. Check the database connection configuration');
      console.log('2. Verify SQL Server is accessible from your network');
      console.log('3. Review the error message above for specific details');
    }
    
    console.log('\n📞 For additional help, check the database connection and try again.');
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  DatabaseConfig,
  LegacyUserDataExtractor,
  DataSaver,
  EXTRACTION_QUERIES
};
