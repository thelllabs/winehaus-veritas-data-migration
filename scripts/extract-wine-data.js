#!/usr/bin/env node

/**
 * Legacy Data Extraction Script
 * 
 * See LLM_SCRIPT_INSTRUCTIONS.md for project-wide guidelines
 * 
 * This script connects to the legacy SQL Server database, extracts wine data,
 * and saves it locally in your preferred format.
 * 
 * Usage:
 *   node migration/extract-legacy-data.js --help
 *   node migration/extract-legacy-data.js --config=./migration/database.json
 *   node migration/extract-legacy-data.js --output=./data --format=json
 */

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// SQL queries for data extraction
const EXTRACTION_QUERIES = {
  wineCountries: `
    SELECT 
      WineCountryID as legacy_id,
      WineCountryName as name,
      CASE WHEN IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      DateCreated as created_at,
      DateUpdated as updated_at
    FROM WineCountries
    ORDER BY WineCountryID
  `,
  
  wineRegions: `
    SELECT 
      wr.WineRegionID as legacy_id,
      wr.WineRegionName as name,
      CASE WHEN wr.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      wr.DateCreated as created_at,
      wr.DateUpdated as updated_at
    FROM WineRegions wr
    ORDER BY wr.WineRegionID
  `,
  
  wineVillages: `
    SELECT 
      wva.WineVillageAvaID as legacy_id,
      wva.WineVillageAvaName as name,
      CASE WHEN wva.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      wva.DateCreated as created_at,
      wva.DateUpdated as updated_at
    FROM WineVillageAvas wva
    ORDER BY wva.WineVillageAvaID
  `,
  
  wineRelationships: `
    SELECT 
      vw.WineCountryRegionVillageAvaID as legacy_id,
      vw.WineCountryID as country_legacy_id,
      vw.WineCountryName as country_name,
      vw.CountryIsActive as country_is_active,
      vw.WineRegionID as region_legacy_id,
      vw.WineRegionName as region_name,
      vw.RegionIsActive as region_is_active,
      vw.WineVillageAvaID as village_legacy_id,
      vw.WineVillageAvaName as village_name,
      vw.VillageAvaIsActive as village_is_active,
      vw.DateCreated as created_at,
      vw.DateUpdated as updated_at
    FROM vwWineCountryRegionVillageAvas vw
    ORDER BY vw.WineCountryRegionVillageAvaID
  `,
  
  wineProducers: `
    SELECT 
      wp.WineProducerID as legacy_id,
      wp.WineProducerName as name,
      CASE WHEN wp.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      wp.DateCreated as created_at,
      wp.DateUpdated as updated_at
    FROM WineProducers wp
    ORDER BY wp.WineProducerID
  `,
  
  wineBrands: `
    SELECT 
      wb.WineBrandID as legacy_id,
      wb.WineBrandName as name,
      CASE WHEN wb.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      wb.DateCreated as created_at,
      wb.DateUpdated as updated_at
    FROM WineBrands wb
    ORDER BY wb.WineBrandID
  `,
  
  wineVarietals: `
    SELECT 
      wv.WineVarietalID as legacy_id,
      wv.WineVarietalName as name,
      CASE WHEN wv.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      wv.DateCreated as created_at,
      wv.DateUpdated as updated_at
    FROM WineVarietals wv
    ORDER BY wv.WineVarietalID
  `,
  
  wineStyles: `
    SELECT 
      ws.WineStyleID as legacy_id,
      ws.WineStyleName as name,
      CASE WHEN ws.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      ws.DateCreated as created_at,
      ws.DateUpdated as updated_at
    FROM WineStyles ws
    ORDER BY ws.WineStyleID
  `,
  
  wineColors: `
    SELECT 
      wc.WineColorID as legacy_id,
      wc.WineColorName as name,
      CASE WHEN wc.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      wc.DateCreated as created_at,
      wc.DateUpdated as updated_at
    FROM WineColors wc
    ORDER BY wc.WineColorID
  `,
  
  wineBottleVintages: `
    SELECT 
      v.VintageID as legacy_id,
      COALESCE(v.VintageYear, 'NV') as year,
      CASE WHEN v.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      v.DateCreated as created_at,
      v.DateUpdated as updated_at
    FROM Vintages v
    ORDER BY v.VintageID
  `,
  
  wineBottleSizes: `
    SELECT 
      bs.BottleSizeID as legacy_id,
      bs.BottleSizeName as name,
      CASE WHEN bs.IsActive = 1 THEN 'true' ELSE 'false' END as is_active,
      bs.DisplayOrder as display_order,
      bs.DateCreated as created_at,
      bs.DateUpdated as updated_at
    FROM BottleSizes bs
    ORDER BY bs.BottleSizeID
  `,
  
  wineItems: `
    SELECT 
      wi.WineItemID as legacy_id,
      wi.WineProducerID as producer_legacy_id,
      wp.WineProducerName as producer_name,
      wi.WineVarietalID as varietal_legacy_id,
      wv.WineVarietalName as varietal_name,
      wi.WineBrandID as brand_legacy_id,
      wb.WineBrandName as brand_name,
      wi.WineStyleID as style_legacy_id,
      ws.WineStyleName as style_name,
      wi.WineColorID as color_legacy_id,
      wc.WineColorName as color_name,
      wi.WineSingleVineyardID as vineyard_legacy_id,
      wsv.WineSingleVineyardName as vineyard_name,
      wi.WineVillageAvaID as village_legacy_id,
      wva.WineVillageAvaName as village_name,
      wi.WineRegionID as region_legacy_id,
      wr.WineRegionName as region_name,
      wi.WineCountryID as country_legacy_id,
      wc2.WineCountryName as country_name,
      CASE WHEN wi.Approved = 1 THEN 'true' ELSE 'false' END as is_approved,
      wi.DateCreated as created_at,
      wi.DateUpdated as updated_at
    FROM WineItems wi
    LEFT JOIN WineProducers wp ON wi.WineProducerID = wp.WineProducerID
    LEFT JOIN WineVarietals wv ON wi.WineVarietalID = wv.WineVarietalID
    LEFT JOIN WineBrands wb ON wi.WineBrandID = wb.WineBrandID
    LEFT JOIN WineStyles ws ON wi.WineStyleID = ws.WineStyleID
    LEFT JOIN WineColors wc ON wi.WineColorID = wc.WineColorID
    LEFT JOIN WineSingleVineyards wsv ON wi.WineSingleVineyardID = wsv.WineSingleVineyardID
    LEFT JOIN WineVillageAvas wva ON wi.WineVillageAvaID = wva.WineVillageAvaID
    LEFT JOIN WineRegions wr ON wi.WineRegionID = wr.WineRegionID
    LEFT JOIN WineCountries wc2 ON wi.WineCountryID = wc2.WineCountryID
    ORDER BY wi.WineItemID
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
class LegacyDataExtractor {
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
    
    return extractedData;
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
    .name('extract-legacy-data')
    .description('Extract wine data from legacy SQL Server system and save locally')
    .option('-c, --config <path>', 'Database configuration file path', './database-extract.config.json')
    .option('-o, --output <dir>', 'Output directory for extracted data', './extracted-data')
    .option('-f, --format <format>', 'Output format (json, csv, sql)', 'json')

    .parse(process.argv);
  
  const options = program.opts();
  
  try {
    console.log('🍷 Legacy Wine Data Extractor');
    console.log('==============================\n');
    console.log('This script will extract wine data from your legacy SQL Server database');
    console.log('and save it locally in your preferred format.\n');
    
    // Load database configuration
    const dbConfig = new DatabaseConfig(options.config);
    
    // Create data extractor
    const extractor = new LegacyDataExtractor(dbConfig);
    
    // Connect to database
    await extractor.connect();
    
    // Extract all data
    console.log('\n📊 Extracting data from legacy system...\n');
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
    
    console.log(`\n🎉 Data extraction completed successfully!`);
    console.log(`\nNext steps:`);
    console.log(`1. Review the extracted data in: ${options.output}`);
    console.log(`2. Use the extracted data for your migration process`);
    console.log(`3. Run the migration from migrate-legacy-wine-data.sql when ready`);
    
  } catch (error) {
    console.error('\n❌ Data extraction failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  DatabaseConfig,
  LegacyDataExtractor,
  DataSaver,
  EXTRACTION_QUERIES
};
