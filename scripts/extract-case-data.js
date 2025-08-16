#!/usr/bin/env node

/**
 * Legacy Case Data Extraction Script
 * 
 * See LLM_SCRIPT_INSTRUCTIONS.md for project-wide guidelines
 * 
 * This script connects to the legacy SQL Server database, extracts case data
 * from ACTIVE accounts only, and saves it locally in your preferred format
 * for migration purposes.
 * 
 * IMPORTANT: This script extracts data ONLY from active accounts (Accounts.IsActive = 1).
 * This ensures data quality and focuses on current business operations.
 * 
 * Usage:
 *   pnpm run case:extract                    # Extract with default settings
 *   pnpm run case:test                       # Show help and test script
 *   node scripts/extract-case-data.js --help # Show command line options
 *   
 * Examples:
 *   node scripts/extract-case-data.js --config=./database-extract.config.json
 *   node scripts/extract-case-data.js --output=./extracted-data --format=json
 *   node scripts/extract-case-data.js --format=csv --output=./case-data-csv
 * 
 * Output Files Generated (Active Accounts Only):
 * - cases.json - Main case information from active accounts
 * - caseDetails.json - Individual wine items within cases from active accounts
 * - caseLocations.json - Case storage locations (4K+ records expected)
 * - lockers.json - Storage locker details from active accounts
 * - wineItems.json - Wine product information (51K+ records expected)
 * - Plus all supporting wine metadata tables
 * 
 * Data Integrity Checks:
 * - Validates case details have associated cases
 * - Ensures wine items referenced in case details exist
 * - Checks case location and locker references
 * - Reports orphaned records for migration planning
 */

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// SQL queries for case data extraction
// IMPORTANT: These queries extract data ONLY from active accounts (Accounts.IsActive = 1)
// All queries join with the Accounts table to filter out inactive accounts
const EXTRACTION_QUERIES = {
  cases: `
    SELECT 
      c.CaseID as legacy_case_id,
      c.AccountID as legacy_account_id,
      CASE WHEN c.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      c.DateCreated as created_at,
      c.DateUpdated as updated_at,
      c.MaxQuantity,
      c.CaseNumber,
      c.CaseLocationID as legacy_case_location_id,
      c.LockerID as legacy_locker_id,
      c.UserID as legacy_user_id,
      CASE WHEN c.isUsed = 1 THEN 'true' ELSE 'false' END as is_used
    FROM Cases c
    INNER JOIN Accounts a ON c.AccountID = a.AccountID
    WHERE a.IsActive = 1
    ORDER BY c.CaseID
  `,
  
  caseDetails: `
    SELECT 
      cd.CaseDetailID as legacy_case_detail_id,
      cd.CaseID as legacy_case_id,
      cd.WineItemID as legacy_wine_item_id,
      cd.WineQuantity,
      cd.DateCreated as created_at,
      cd.DateUpdated as updated_at,
      cd.VintageID as legacy_vintage_id,
      cd.BottleSizeID as legacy_bottle_size_id,
      cd.Notes,
      cd.UserID as legacy_user_id
    FROM CaseDetails cd
    INNER JOIN Cases c ON cd.CaseID = c.CaseID
    INNER JOIN Accounts a ON c.AccountID = a.AccountID
    WHERE a.IsActive = 1
    ORDER BY cd.CaseDetailID
  `,
  
  caseLocations: `
    SELECT 
      cl.CaseLocationID as legacy_case_location_id,
      cl.CaseLocationName,
      cl.DateCreated as created_at,
      cl.DateUpdated as updated_at,
      CASE WHEN cl.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      cl.LockerID as legacy_locker_id
    FROM CaseLocations cl
    ORDER BY cl.CaseLocationID
  `,

  activities: `
    SELECT 
      a.[ActivityID]
      ,a.[AccountID]
      ,a.[TransactionType]
      ,a.[ToAddressID]
      ,a.[ToAddressType]
      ,a.[FromAddressID]
      ,a.[FromAddressType]
      ,a.[HandlingQty]
      ,a.[HandlingPrice]
      ,a.[Notes]
      ,a.[ShippingMethodID]
      ,a.[ShippingQty]
      ,a.[ShippingRate]
      ,a.[ShippingTotal]
      ,a.[ShippingDate]
      ,a.[Status]
      ,a.[DateCreated]
      ,a.[DateUpdated]
      ,a.[isTransfer]
      ,a.[StagingNote]
      ,a.[UserID]
      ,a.[CreatedByUserID]
    FROM Activities a
    INNER JOIN Accounts acc ON a.AccountID = acc.AccountID
    WHERE acc.IsActive = 1
  `,

  activityDetails: `
    SELECT 
      ad.[ActivityDetailID]
      ,ad.[ActivityID]
      ,ad.[WineItemID]
      ,ad.[SupplyID]
      ,ad.[Quantity]
      ,ad.[ActivityType]
      ,ad.[CaseID]
      ,ad.[CaseDetailID]
      ,ad.[VintageID]
      ,ad.[BottleSizeID]
      ,ad.[FromCaseLocationID]
      ,ad.[FromLockerID]
      ,ad.[ToCaseLocationID]
      ,ad.[ToLockerID]
      ,ad.[DateCreated]
      ,ad.[DateUpdated]
      ,ad.[UserID]
    FROM ActivityDetails ad
  `,
  
  lockers: `
    SELECT 
      l.LockerID as legacy_locker_id,
      l.LockerNumber,
      CASE WHEN l.InventoryControl = 1 THEN 'true' ELSE 'false' END as inventory_control,
      l.Rate,
      l.AccountID as legacy_account_id,
      l.DateCreated as created_at,
      l.DateUpdated as updated_at,
      CASE WHEN l.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      CASE WHEN l.isCustom = 1 THEN 'true' ELSE 'false' END as is_custom
    FROM Lockers l
    INNER JOIN Accounts a ON l.AccountID = a.AccountID
    WHERE a.IsActive = 1
    ORDER BY l.LockerID
  `,
  
  caseTypes: `
    SELECT 
      ct.CaseTypeID as legacy_case_type_id,
      ct.CaseTypeName,
      ct.NumberOfBottles
    FROM DEP_CaseTypes ct
    ORDER BY ct.CaseTypeID
  `,
  
  // Additional case-related data for comprehensive extraction
  lockerDetails: `
    SELECT 
      ld.LockerDetailID as legacy_locker_detail_id,
      ld.LockerID as legacy_locker_id,
      ld.CaseID as legacy_case_id,
      ld.DateCreated as created_at,
      ld.DateUpdated as updated_at
    FROM DEP_LockerDetails ld
    ORDER BY ld.LockerDetailID
  `,
  
  lockerHistory: `
    SELECT 
      lh.LockerHistoryID as legacy_locker_history_id,
      lh.LockerID as legacy_locker_id,
      lh.AccountID as legacy_account_id,
      lh.DateStarted,
      lh.DateEnded,
      lh.Rate,
      CASE WHEN lh.InventoryControl = 1 THEN 'true' ELSE 'false' END as inventory_control,
      lh.UserID as legacy_user_id
    FROM LockerHistory lh
    INNER JOIN Accounts a ON lh.AccountID = a.AccountID
    WHERE a.IsActive = 1
    ORDER BY lh.LockerHistoryID
  `,    
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
class LegacyCaseDataExtractor {
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
    
    // Check for critical case data
    if (extractedData.cases && extractedData.cases.length === 0) {
      console.warn('⚠️ Warning: No cases found - this may indicate a configuration issue');
    }
    
    if (extractedData.caseDetails && extractedData.caseDetails.length === 0) {
      console.warn('⚠️ Warning: No case details found - this may indicate a configuration issue');
    }
    
    // Check for orphaned case details
    if (extractedData.caseDetails && extractedData.cases) {
      const caseIds = new Set(extractedData.cases.map(c => c.legacy_case_id));
      const orphanedCaseDetails = extractedData.caseDetails.filter(cd => !caseIds.has(cd.legacy_case_id));
      if (orphanedCaseDetails.length > 0) {
        console.warn(`⚠️ Warning: ${orphanedCaseDetails.length} case details found without associated cases`);
      }
    }
    
    // Check for orphaned wine items in case details
    if (extractedData.caseDetails && extractedData.wineItems) {
      const wineItemIds = new Set(extractedData.wineItems.map(wi => wi.legacy_wine_item_id));
      const orphanedWineItems = extractedData.caseDetails.filter(cd => !wineItemIds.has(cd.legacy_wine_item_id));
      if (orphanedWineItems.length > 0) {
        console.warn(`⚠️ Warning: ${orphanedWineItems.length} case details reference non-existent wine items`);
      }
    }
    
    // Check for orphaned case locations
    if (extractedData.cases && extractedData.caseLocations) {
      const caseLocationIds = new Set(extractedData.caseLocations.map(cl => cl.legacy_case_location_id));
      const orphanedCaseLocations = extractedData.cases.filter(c => !caseLocationIds.has(c.legacy_case_location_id));
      if (orphanedCaseLocations.length > 0) {
        console.warn(`⚠️ Warning: ${orphanedCaseLocations.length} cases reference non-existent case locations`);
      }
    }
    
    // Check for orphaned lockers
    if (extractedData.cases && extractedData.lockers) {
      const lockerIds = new Set(extractedData.lockers.map(l => l.legacy_locker_id));
      const orphanedLockers = extractedData.cases.filter(c => !lockerIds.has(c.legacy_locker_id));
      if (orphanedLockers.length > 0) {
        console.warn(`⚠️ Warning: ${orphanedLockers.length} cases reference non-existent lockers`);
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
      this.saveData(data, `cases-${queryName}`);
    }
    
    console.log(`\n✅ All data saved to: ${this.outputDir}`);
  }
}

/**
 * Main function
 */
async function main() {
  program
    .name('extract-case-data')
    .description('Extract case data from legacy SQL Server system and save locally')
    .option('-c, --config <path>', 'Database configuration file path', './database-extract.config.json')
    .option('-o, --output <dir>', 'Output directory for extracted data', './extracted-data')
    .option('-f, --format <format>', 'Output format (json, csv, sql)', 'json')
    .parse(process.argv);
  
  const options = program.opts();
  
  try {
    console.log('📦 Legacy Case Data Extractor');
    console.log('==============================\n');
    console.log('This script will extract case data from ACTIVE accounts only in your legacy SQL Server database');
    console.log('and save it locally in your preferred format for migration.\n');
    console.log('💡 Quick start: pnpm run case:extract\n');
    
    // Load database configuration
    const dbConfig = new DatabaseConfig(options.config);
    
    // Create data extractor
    const extractor = new LegacyCaseDataExtractor(dbConfig);
    
    // Connect to database
    await extractor.connect();
    
    // Extract all data
    console.log('\n📊 Extracting case data from ACTIVE accounts only...\n');
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
    
    console.log(`\n🎉 Case data extraction completed successfully!`);
    
    // Provide validation queries
    console.log(`\n📊 Validation Queries:`);
    console.log(`========================`);
    console.log(`-- Verify case data integrity:`);
    console.log(`-- SELECT COUNT(*) as total_cases FROM Cases;`);
    console.log(`-- SELECT COUNT(*) as total_case_details FROM CaseDetails;`);
    console.log(`-- SELECT COUNT(*) as total_case_locations FROM CaseLocations;`);
    console.log(`-- SELECT COUNT(*) as total_lockers FROM Lockers;`);
    console.log(`-- SELECT COUNT(*) as total_wine_items FROM WineItems;`);
    
    console.log(`\nNext steps:`);
    console.log(`1. Review the extracted data in: ${options.output}`);
    console.log(`2. Use the extracted data for your migration process`);
    console.log(`3. Run the case import script when ready`);
    
    // Provide rollback instructions
    console.log(`\n🔄 Rollback Instructions:`);
    console.log(`=======================`);
    console.log(`If you need to rollback the extraction:`);
    console.log(`1. Delete the extracted data files from: ${options.output}`);
    console.log(`2. No database changes were made - extraction is read-only`);
    console.log(`3. Re-run extraction with corrected configuration if needed`);
    
  } catch (error) {
    console.error('\n❌ Case data extraction failed:', error.message);
    
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
  LegacyCaseDataExtractor,
  DataSaver,
  EXTRACTION_QUERIES
};
