#!/usr/bin/env node

/**
 * Full Migration Script
 * 
 * This script combines all migration operations into a single comprehensive script.
 * It runs sequentially through all the required steps:
 * 
 * 1. Add legacy columns (always runs)
 * 2. Extract Data (optional, default: no)
 *    - Extract wine data
 *    - Extract user data  
 *    - Extract case data
 * 3. Delete Data (optional, default: true)
 * 4. Import Data
 *    - Import wine data
 *    - Import user data
 *    - Import case data
 * 
 * Usage:
 *   node scripts/full-migration.js [options]
 * 
 * Options:
 *   --extract-data              Extract data from legacy system (default: false)
 *   --no-delete-data           Skip deleting existing data (default: delete data)
 *   --clear-existing           Clear existing data before import (default: true)
 *   --config=<path>            Database configuration file path
 *   --help, -h                Show help message
 * 
 * Examples:
 *   node scripts/full-migration.js                                    # Full migration with delete
 *   node scripts/full-migration.js --extract-data                    # Extract + full migration
 *   node scripts/full-migration.js --no-delete-data                  # Skip deletion
 *   node scripts/full-migration.js --extract-data --no-delete-data   # Extract + migrate without delete
 *   pnpm run full-migration                                          # Run via npm script
 */

const { DataSource } = require('typeorm');
const { config } = require('dotenv');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Load environment variables
config();

// Import utility classes
const { DatabaseConfig, parseConfigPath } = require('./utils/database-config');
const { createDefaultTenant } = require('./utils/tenant-utils');

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    extractData: false,
    deleteData: true,
    clearExisting: true,
    config: null,
    help: false
  };

  for (const arg of args) {
    switch (arg) {
      case '--extract-data':
        options.extractData = true;
        break;
      case '--no-delete-data':
        options.deleteData = false;
        break;
      case '--clear-existing':
        options.clearExisting = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--config=')) {
          options.config = arg.split('=')[1];
        } else {
          console.warn(`⚠️ Unknown argument: ${arg}`);
        }
        break;
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Full Migration Script

This script combines all migration operations into a single comprehensive script.
It runs sequentially through all the required steps:

1. Add legacy columns (always runs)
2. Extract Data (optional, default: no)
   - Extract wine data
   - Extract user data  
   - Extract case data
3. Delete Data (optional, default: true)
4. Import Data
   - Import wine data
   - Import user data
   - Import case data

Usage:
  node scripts/full-migration.js [options]

Options:
  --extract-data              Extract data from legacy system (default: false)
  --no-delete-data           Skip deleting existing data (default: delete data)
  --clear-existing           Clear existing data before import (default: true)
  --config=<path>            Database configuration file path
  --help, -h                Show help message

Examples:
  node scripts/full-migration.js                                    # Full migration with delete
  node scripts/full-migration.js --extract-data                    # Extract + full migration
  node scripts/full-migration.js --no-delete-data                  # Skip deletion
  node scripts/full-migration.js --extract-data --no-delete-data   # Extract + migrate without delete
  pnpm run full-migration                                          # Run via npm script

Prerequisites:
  - PostgreSQL database running and accessible
  - Legacy SQL Server database accessible (if extracting)
  - Environment variables configured (.env file)
  - All required npm packages installed

Environment Variables:
  DB_HOST=localhost              # Database host
  DB_PORT=5432                  # Database port
  DB_USERNAME=postgres          # Database username
  DB_PASSWORD=postgres          # Database password
  DB_DATABASE=winehaus          # Database name

Safety Notes:
  - The script will delete existing data by default unless --no-delete-data is used
  - Use --extract-data to pull fresh data from the legacy system
  - All operations run sequentially to maintain data integrity
  - The script will stop on any error to prevent partial migrations
`);
}

/**
 * Execute a child process and return a promise
 */
function executeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 Executing: node ${scriptPath} ${args.join(' ')}`);
    
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Script completed successfully: ${scriptPath}`);
        resolve();
      } else {
        console.error(`❌ Script failed with code ${code}: ${scriptPath}`);
        reject(new Error(`Script failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      console.error(`❌ Script execution error: ${error.message}`);
      reject(error);
    });
  });
}

/**
 * Main migration orchestrator class
 */
class FullMigrationOrchestrator {
  constructor(options) {
    this.options = options;
    this.dataSource = null;
    this.startTime = Date.now();
  }

  async run() {
    console.log('🎯 Starting Full Migration Process');
    console.log('===================================\n');
    
    // Display configuration
    this.displayConfiguration();
    
    try {
      // Step 1: Always add legacy columns
      await this.step1AddLegacyColumns();
      
      // Step 2: Extract data (if requested)
      if (this.options.extractData) {
        await this.step2ExtractData();
      } else {
        console.log('⏭️ Skipping data extraction (use --extract-data to enable)');
      }
      
      // Step 3: Delete existing data (if requested)
      if (this.options.deleteData) {
        await this.step3DeleteData();
      } else {
        console.log('⏭️ Skipping data deletion (use --no-delete-data to disable)');
      }
      
      // Step 4: Import data
      await this.step4ImportData();
      
      // Final summary
      await this.showFinalSummary();
      
    } catch (error) {
      console.error('\n❌ Migration failed:', error.message);
      console.error('\n🛑 Stopping migration process due to error');
      throw error;
    }
  }

  displayConfiguration() {
    console.log('📋 Migration Configuration:');
    console.log('============================');
    console.log(`🔧 Add Legacy Columns: ${'✅ Yes (always runs)'}`);
    console.log(`📤 Extract Data: ${this.options.extractData ? '✅ Yes' : '❌ No'}`);
    console.log(`🗑️ Delete Existing Data: ${this.options.deleteData ? '✅ Yes' : '❌ No'}`);
    console.log(`🧹 Clear Existing on Import: ${this.options.clearExisting ? '✅ Yes' : '❌ No'}`);
    console.log(`⚙️ Config Path: ${this.options.config || 'auto-detected'}`);
    console.log('');
  }

  async step1AddLegacyColumns() {
    console.log('🔧 Step 1: Adding Legacy ID Columns');
    console.log('====================================');
    
    await executeScript('./scripts/add-legacy-id-columns.js');
    
    console.log('✅ Step 1 completed: Legacy columns added\n');
  }

  async step2ExtractData() {
    console.log('📤 Step 2: Extracting Data from Legacy System');
    console.log('==============================================');
    
    // Extract wine data
    console.log('\n🍷 Extracting wine data...');
    await executeScript('./scripts/extract-wine-data.js');
    
    // Extract user data
    console.log('\n👥 Extracting user data...');
    await executeScript('./scripts/extract-user-data.js');
    
    // Extract case data
    console.log('\n📦 Extracting case data...');
    await executeScript('./scripts/extract-case-data.js');
    
    console.log('✅ Step 2 completed: All data extracted\n');
  }

  async step3DeleteData() {
    console.log('🗑️ Step 3: Deleting Existing Data');
    console.log('==================================');
    
    const args = ['--confirm'];
    if (this.options.config) {
      args.push(`--config=${this.options.config}`);
    }
    
    await executeScript('./scripts/clean-database.js', args);
    
    console.log('✅ Step 3 completed: Existing data deleted\n');
  }

  async step4ImportData() {
    console.log('📥 Step 4: Importing Data');
    console.log('==========================');
    
    // Import wine data
    console.log('\n🍷 Importing wine data...');
    const wineArgs = this.options.clearExisting ? ['--clear-existing'] : [];
    if (this.options.config) {
      wineArgs.push(`--config=${this.options.config}`);
    }
    await executeScript('./scripts/import-wine-data.js', wineArgs);
    
    // Import user data
    console.log('\n👥 Importing user data...');
    const userArgs = this.options.clearExisting ? ['--clear-existing'] : [];
    if (this.options.config) {
      userArgs.push(`--config=${this.options.config}`);
    }
    await executeScript('./scripts/import-user-data.js', userArgs);
    
    // Import case data
    console.log('\n📦 Importing case data...');
    const caseArgs = this.options.clearExisting ? ['--clear-existing'] : [];
    if (this.options.config) {
      caseArgs.push(`--config=${this.options.config}`);
    }
    await executeScript('./scripts/import-case-data.js', caseArgs);
    
    console.log('✅ Step 4 completed: All data imported\n');
  }

  async showFinalSummary() {
    const endTime = Date.now();
    const duration = Math.round((endTime - this.startTime) / 1000);
    
    console.log('🎉 Migration Completed Successfully!');
    console.log('====================================');
    console.log(`⏱️ Total Duration: ${duration} seconds`);
    console.log('');
    console.log('📊 Summary of Operations:');
    console.log('  ✅ Legacy columns added');
    if (this.options.extractData) {
      console.log('  ✅ Data extracted from legacy system');
    }
    if (this.options.deleteData) {
      console.log('  ✅ Existing data deleted');
    }
    console.log('  ✅ Wine data imported');
    console.log('  ✅ User data imported');
    console.log('  ✅ Case data imported');
    console.log('');
    console.log('🚀 Your Veritas database is ready!');
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Verify the imported data in your application');
    console.log('  2. Test user login functionality');
    console.log('  3. Check case and wine inventory data');
    console.log('  4. Remove legacy_id columns when migration is confirmed complete');
  }
}

/**
 * Bootstrap function
 */
async function bootstrap() {
  // Parse command line arguments
  const options = parseArguments();
  
  if (options.help) {
    showHelp();
    return;
  }

  let orchestrator = null;

  try {
    // Create and run the migration orchestrator
    orchestrator = new FullMigrationOrchestrator(options);
    await orchestrator.run();

  } catch (error) {
    console.error('\n❌ Full migration failed:', error.message);
    console.error('\n🔧 Troubleshooting:');
    console.error('  1. Check database connectivity');
    console.error('  2. Verify environment variables');
    console.error('  3. Ensure all required scripts exist');
    console.error('  4. Check file permissions');
    console.error('  5. Review individual script outputs above');
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  bootstrap().catch(console.error);
}

// Export the class for use in other scripts
module.exports = { FullMigrationOrchestrator };
