/**
 * Backfill Wine Colors Script
 *
 * See LLM_SCRIPT_INSTRUCTIONS.md for project-wide guidelines
 *
 * This script updates the type_id (color) field for wines that were imported
 * before the color mapping fix. It uses the legacy_id to match wines with
 * their color information from the extracted data.
 */

const { DataSource } = require("typeorm");
const { config } = require("dotenv");
const fs = require("fs");
const path = require("path");
const { DatabaseConfig, parseConfigPath } = require("./utils/database-config");

// Load environment variables
config();

class WineColorBackfiller {
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  async backfill() {
    console.log("🎨 Starting Wine Color Backfill...");

    try {
      // Load extracted wine items data
      await this.loadExtractedData();

      // Get all wines from the database
      const wines = await this.dataSource.query(
        "SELECT id, legacy_id, type_id FROM wines WHERE legacy_id IS NOT NULL"
      );

      console.log(`📊 Found ${wines.length} wines with legacy_id`);

      // Get wine types lookup table
      const wineTypes = await this.dataSource.query(
        "SELECT id, legacy_id FROM wine_types"
      );

      // Create lookup map for wine types (color_legacy_id -> new type_id)
      const typeMap = new Map(wineTypes.map((t) => [t.legacy_id, t.id]));
      console.log(`📊 Loaded ${typeMap.size} wine types for mapping`);

      // Create lookup map for wine items (legacy_id -> color_legacy_id)
      const wineItemsMap = new Map();
      for (const item of this.wineItems) {
        if (item.legacy_id && item.color_legacy_id) {
          wineItemsMap.set(
            item.legacy_id.toString(),
            item.color_legacy_id.toString()
          );
        }
      }
      console.log(`📊 Loaded ${wineItemsMap.size} wine items with color data`);

      let updated = 0;
      let skipped = 0;
      let notFound = 0;

      for (const wine of wines) {
        // Get the color_legacy_id from extracted data
        const colorLegacyId = wineItemsMap.get(wine.legacy_id);

        if (!colorLegacyId) {
          notFound++;
          console.log(
            `⚠️  No color data found for wine legacy_id: ${wine.legacy_id}`
          );
          continue;
        }

        // Get the new type_id from the wine_types table
        const newTypeId = typeMap.get(colorLegacyId);

        if (!newTypeId) {
          console.log(
            `⚠️  No wine type found for color_legacy_id: ${colorLegacyId}`
          );
          continue;
        }

        // Skip if already has the correct type_id
        if (wine.type_id === newTypeId) {
          skipped++;
          continue;
        }

        // Update the wine with the correct type_id
        await this.dataSource.query(
          "UPDATE wines SET type_id = $1 WHERE id = $2",
          [newTypeId, wine.id]
        );

        updated++;

        if (updated % 100 === 0) {
          console.log(`✅ Updated ${updated} wines so far...`);
        }
      }

      console.log("\n📊 Backfill Summary:");
      console.log(`   Total wines processed: ${wines.length}`);
      console.log(`   ✅ Updated: ${updated}`);
      console.log(`   ⏭️  Skipped (already correct): ${skipped}`);
      console.log(`   ⚠️  Not found in extracted data: ${notFound}`);

      console.log("\n✅ Wine color backfill completed successfully!");
    } catch (error) {
      console.error("❌ Backfill failed:", error);
      throw error;
    }
  }

  async loadExtractedData() {
    console.log("📂 Loading extracted wine items data...");

    const dataDir = path.join(process.cwd(), "extracted-data");
    const wineItemsPath = path.join(dataDir, "wineItems.json");

    if (!fs.existsSync(wineItemsPath)) {
      throw new Error(`Wine items file not found: ${wineItemsPath}`);
    }

    const content = fs.readFileSync(wineItemsPath, "utf8");
    this.wineItems = JSON.parse(content);

    console.log(`📊 Loaded ${this.wineItems.length} wine items`);
  }
}

async function bootstrap() {
  console.log("🚀 Starting Wine Color Backfill Script...");

  // Parse command line arguments for config path
  const configPath = parseConfigPath();

  let dataSource = null;

  try {
    // Load database configuration
    const dbConfig = new DatabaseConfig(configPath);
    dbConfig.validate();

    // Create database connection
    dataSource = new DataSource(dbConfig.getConnectionConfig());

    // Initialize connection
    await dataSource.initialize();
    console.log("✅ Database connection established");

    // Run the backfill
    const backfiller = new WineColorBackfiller(dataSource);
    await backfiller.backfill();

    console.log("🎉 Wine color backfill completed successfully!");
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  } finally {
    // Close connection
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      console.log("🔌 Database connection closed");
    }
  }
}

bootstrap();

