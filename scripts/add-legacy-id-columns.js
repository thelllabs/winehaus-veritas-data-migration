/**
 * Add Legacy ID Columns Script
 * Adds temporary legacy_id columns to wine tables for migration tracking
 */

const { DataSource } = require('typeorm');
const { config } = require('dotenv');

config();

class LegacyIdColumnAdder {
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  async addLegacyIdColumns() {
    console.log('🔧 Adding legacy ID columns to wine tables...');
    
    const tables = [
      'wine_countries', 'wine_regions', 'wine_villages', 'wine_producers',
      'wine_brands', 'wine_varietals', 'wine_styles', 'wine_types',
      'wine_bottle_vintages', 'wine_bottle_formats', 'wines', 'cases'
    ];

    for (const table of tables) {
      await this.addLegacyIdColumn(table);
    }

    console.log('✅ All legacy ID columns added successfully!');
    console.log('⚠️  REMEMBER: Remove these columns manually after migration!');
  }

  async addLegacyIdColumn(tableName) {
    try {
      const columnExists = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = $1 AND column_name = 'legacy_id'`,
        [tableName]
      );

      if (columnExists.length > 0) {
        console.log(`ℹ️  Column legacy_id already exists in ${tableName}`);
        return;
      }

      await this.dataSource.query(
        `ALTER TABLE ${tableName} ADD COLUMN legacy_id VARCHAR(255)`,
        []
      );

      await this.dataSource.query(
        `CREATE INDEX idx_${tableName}_legacy_id ON ${tableName} (legacy_id)`,
        []
      );

      console.log(`✅ Added legacy_id column and index to ${tableName}`);

    } catch (error) {
      console.error(`❌ Failed to add legacy_id column to ${tableName}:`, error);
      throw error;
    }
  }
}

async function bootstrap() {
  console.log('🚀 Starting Legacy ID Column Management...');
  
  let dataSource = null;
  
  try {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'winehaus',
      synchronize: false,
      logging: true
    });

    await dataSource.initialize();
    console.log('✅ Database connection established');

    const columnManager = new LegacyIdColumnAdder(dataSource);
    await columnManager.addLegacyIdColumns();

    console.log('🎉 Operation completed successfully!');
    
  } catch (error) {
    console.error('❌ Operation failed:', error);
    process.exit(1);
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('🔌 Database connection closed');
    }
  }
}

bootstrap();
