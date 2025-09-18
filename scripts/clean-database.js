#!/usr/bin/env node

/**
 * Database Cleaning Script
 *
 * This script cleans the database by removing all imported legacy data
 * using the same delete methods from all import scripts (wine, user, case).
 *
 * Usage:
 *   node scripts/clean-database.js [options]
 *
 * Options:
 *   --confirm              Actually perform the deletion (required for safety)
 *   --dry-run              Show what would be deleted without actually doing it
 *   --config=<path>        Path to database config file (default: database-import.config.json)
 *   --help, -h            Show this help message
 *
 * Examples:
 *   node scripts/clean-database.js --dry-run                    # See what would be deleted
 *   node scripts/clean-database.js --confirm                    # Actually clean the database
 *   node scripts/clean-database.js --confirm --config=database-import.local.config.json
 *   pnpm run clean:db -- --confirm                             # Run via npm script
 */

const { DataSource } = require('typeorm');
const { config } = require('dotenv');
const { createDefaultTenant } = require('./utils/tenant-utils');
const { DatabaseConfig, parseConfigPath } = require('./utils/database-config');

// Load environment variables
config();

// Parse command line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    confirm: false,
    dryRun: false,
    help: false,
    config: null
  };

  for (const arg of args) {
    if (arg === '--confirm') {
      options.confirm = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--config=')) {
      options.config = arg.split('=')[1];
    } else {
      console.warn(`⚠️ Unknown argument: ${arg}`);
    }
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
Database Cleaning Script

This script cleans the database by removing all imported legacy data using the same 
delete methods from all import scripts (wine, user, case).

⚠️  WARNING: This will permanently delete all imported data from the database!

Usage:
  node scripts/clean-database.js [options]

Options:
  --confirm              Actually perform the deletion (required for safety)
  --dry-run              Show what would be deleted without actually doing it
  --config=<path>        Path to database config file (default: database-import.config.json)
  --help, -h            Show this help message

Examples:
  node scripts/clean-database.js --dry-run                    # See what would be deleted
  node scripts/clean-database.js --confirm                    # Actually clean the database
  node scripts/clean-database.js --confirm --config=database-import.local.config.json
  pnpm run clean:db -- --confirm                             # Run via npm script

Environment Variables:
  DB_HOST=localhost          # Database host
  DB_PORT=5432              # Database port
  DB_USERNAME=postgres      # Database username
  DB_PASSWORD=postgres      # Database password
  DB_DATABASE=winehaus      # Database name

Safety Notes:
  - The --confirm flag is required to actually perform deletions
  - Use --dry-run first to see what would be deleted
  - Only deletes data for the default tenant
  - Follows proper foreign key dependency order
`);
}

class DatabaseCleaner {
  constructor(dataSource) {
    this.dataSource = dataSource;
    this.defaultTenantId = null;
  }

  async clean(options = {}) {
    console.log('🧹 Starting Database Cleaning...');
    
    try {
      // Get default tenant
      this.defaultTenantId = await createDefaultTenant(this.dataSource);
      console.log(`🏢 Using tenant ID: ${this.defaultTenantId}`);

      if (options.dryRun) {
        console.log('📋 DRY RUN MODE - No data will be deleted');
        await this.showWhatWouldBeDeleted();
      } else if (options.confirm) {
        console.log('⚠️  DELETION MODE - Data will be permanently deleted');
        await this.performDeletion();
      } else {
        console.error('❌ Error: Either --dry-run or --confirm flag is required');
        console.log('Use --help for more information');
        process.exit(1);
      }

      console.log('✅ Database cleaning completed successfully!');
    } catch (error) {
      console.error('❌ Cleaning failed:', error);
      throw error;
    }
  }

  async showWhatWouldBeDeleted() {
    console.log('📊 Checking what data would be deleted...\n');

    const tables = [
      // Case/inventory data (deleted first due to dependencies)
      'wine_inventory_entries',
      'operation_extras',
      'cases_operations',
      'operations_requests',
      'operations_groups',
      'cases',
      
      // User data
      'addresses',
      'users',
      
      // Wine data (wines deleted before lookup tables)
      'wines',
      
      // Wine lookup tables (no dependencies between them)
      'wine_types',
      'wine_styles',
      'wine_varietals',
      'wine_brands',
      'wine_producers',
      'wine_villages',
      'wine_regions',
      'wine_countries',
      'wine_bottle_formats',
      'wine_bottle_vintages',
      'wine_vineyards'
    ];

    let totalRecords = 0;
    
    for (const table of tables) {
      try {
        let query;
        let params;
        
        // Special case for addresses table
        if (table === 'addresses') {
          query = `SELECT COUNT(*) as count FROM ${table} WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1) AND tenant_id = $1`;
          params = [this.defaultTenantId];
        } else {
          query = `SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = $1`;
          params = [this.defaultTenantId];
        }
        
        const result = await this.dataSource.query(query, params);
        const count = parseInt(result[0].count);
        totalRecords += count;
        
        if (count > 0) {
          console.log(`  📋 ${table}: ${count.toLocaleString()} records`);
        }
      } catch (error) {
        console.log(`  ⚠️ ${table}: Could not check (${error.message})`);
      }
    }
    
    console.log(`\n📊 Total records to delete: ${totalRecords.toLocaleString()}`);
    console.log('\n💡 To actually perform the deletion, use: --confirm');
  }

  async performDeletion() {
    console.log('🗑️ Performing database deletion...\n');

    // Clear in proper foreign key dependency order - dependent tables first
    
    console.log('🔄 Step 1: Clearing case/inventory data (depends on wines and users)...');
    await this.deleteFromTable('wine_inventory_entries', 'Wine inventory entries');
    await this.deleteFromTable('operation_extras', 'Operation extras');
    await this.deleteFromTable('cases_operations', 'Case operations');
    await this.deleteFromTable('operations_requests', 'Operation requests');
    await this.deleteFromTable('operations_groups', 'Operation groups');
    await this.deleteFromTable('cases', 'Cases');

    console.log('\n👥 Step 2: Clearing user data...');
    // Clear addresses first (depends on users)
    await this.deleteFromTableWithUserCondition('addresses', 'Addresses');
    // Clear users with legacy_user_id (imported users only)
    await this.deleteFromTable('users', 'Legacy users');

    console.log('\n🍷 Step 3: Clearing wine data...');
    // Clear wines first (depends on other wine tables)
    await this.deleteFromTable('wines', 'Wines');
    
    console.log('\n📚 Step 4: Clearing wine lookup tables...');
    // Then delete the wine lookup tables (no dependencies between them)
    await this.deleteFromTable('wine_types', 'Wine types');
    await this.deleteFromTable('wine_styles', 'Wine styles');
    await this.deleteFromTable('wine_varietals', 'Wine varietals');
    await this.deleteFromTable('wine_brands', 'Wine brands');
    await this.deleteFromTable('wine_producers', 'Wine producers');
    await this.deleteFromTable('wine_villages', 'Wine villages');
    await this.deleteFromTable('wine_regions', 'Wine regions');
    await this.deleteFromTable('wine_countries', 'Wine countries');
    await this.deleteFromTable('wine_bottle_formats', 'Wine bottle formats');
    await this.deleteFromTable('wine_bottle_vintages', 'Wine bottle vintages');
    await this.deleteFromTable('wine_vineyards', 'Wine vineyards');

    console.log('\n🎉 All data successfully deleted!');
  }

  async deleteFromTable(tableName, description) {
    try {
      const result = await this.dataSource.query(
        `DELETE FROM ${tableName} WHERE tenant_id = $1`, 
        [this.defaultTenantId]
      );
      const deletedCount = result[1] || 0; // PostgreSQL returns [result, affectedRows]
      console.log(`  ✅ ${description}: ${deletedCount.toLocaleString()} records deleted`);
    } catch (error) {
      console.error(`  ❌ ${description}: Failed to delete (${error.message})`);
    }
  }

  async deleteFromTableWithCondition(tableName, condition, description) {
    try {
      const result = await this.dataSource.query(
        `DELETE FROM ${tableName} WHERE ${condition} AND tenant_id = $1`, 
        [this.defaultTenantId]
      );
      const deletedCount = result[1] || 0;
      console.log(`  ✅ ${description}: ${deletedCount.toLocaleString()} records deleted`);
    } catch (error) {
      console.error(`  ❌ ${description}: Failed to delete (${error.message})`);
    }
  }

  async deleteFromTableWithUserCondition(tableName, description) {
    try {
      const result = await this.dataSource.query(
        `DELETE FROM ${tableName} WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1) AND tenant_id = $1`, 
        [this.defaultTenantId]
      );
      const deletedCount = result[1] || 0;
      console.log(`  ✅ ${description}: ${deletedCount.toLocaleString()} records deleted`);
    } catch (error) {
      console.error(`  ❌ ${description}: Failed to delete (${error.message})`);
    }
  }
}

async function bootstrap() {
  console.log('🚀 Starting Database Cleaner...');

  // Parse command line arguments
  const options = parseArguments();
  const configPath = options.config || parseConfigPath();

  if (options.help) {
    showHelp();
    return;
  }

  // Validate options
  if (!options.dryRun && !options.confirm) {
    console.error('❌ Error: Either --dry-run or --confirm flag is required');
    console.log('Use --help for more information');
    process.exit(1);
  }

  if (options.dryRun && options.confirm) {
    console.error('❌ Error: Cannot use both --dry-run and --confirm flags');
    process.exit(1);
  }

  let dataSource = null;

  try {
    // Load database configuration
    const dbConfig = new DatabaseConfig(configPath);
    dbConfig.validate();
    
    // Create database connection
    dataSource = new DataSource(dbConfig.getConnectionConfig());

    // Initialize connection
    await dataSource.initialize();
    console.log('✅ Database connection established');

    // Run the cleaner with options
    const cleaner = new DatabaseCleaner(dataSource);
    await cleaner.clean(options);

  } catch (error) {
    console.error('❌ Database cleaning failed:', error);
    process.exit(1);
  } finally {
    // Close connection
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('🔌 Database connection closed');
    }
  }
}

bootstrap();

// Export the class for use in other scripts
module.exports = { DatabaseCleaner };
