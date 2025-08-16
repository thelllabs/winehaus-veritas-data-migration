/**
 * Legacy Wine Data Import Script
 *
 * See LLM_SCRIPT_INSTRUCTIONS.md for project-wide guidelines
 */

const { DataSource } = require("typeorm");
const { v4: uuidv4 } = require("uuid");
const { config } = require("dotenv");
const fs = require("fs");
const path = require("path");

// Load environment variables
config();

class LegacyDataSeeder {
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  async seed(options = {}) {
    console.log("🌱 Starting Legacy Data Seeding...");

    try {
      // Load extracted data
      await this.loadExtractedData();

      // Create default tenant
      await this.createDefaultTenant();

      await this.clearExistingData();

      // Seed data in dependency order
      await this.seedWineCountries();
      await this.seedWineRegions();
      await this.seedWineVillages();
      await this.seedWineProducers();
      await this.seedWineBrands();
      await this.seedWineVarietals();
      await this.seedWineStyles();
      await this.seedWineBottleVintages();
      await this.seedWineBottleSizes();
      await this.seedWineTypes();
      await this.seedWines();

      console.log("✅ Legacy data seeding completed successfully!");
    } catch (error) {
      console.error("❌ Seeding failed:", error);
      throw error;
    }
  }

  async clearExistingData() {
    console.log("🧹 Clearing existing data for tenant...");

    // Clear case data first
    await this.dataSource.query("DELETE FROM wine_inventory_entries WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM operation_extras WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM cases_operations WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM operations_requests WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM operations_groups WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM cases WHERE tenant_id = $1", [this.defaultTenantId]);

    // Clear wine data in reverse dependency order
    // Delete from wines first since it references other tables
    await this.dataSource.query("DELETE FROM wines WHERE tenant_id = $1", [this.defaultTenantId]);
    
    // Also delete any wines without tenant_id that might reference other tables
    await this.dataSource.query("DELETE FROM wines WHERE tenant_id IS NULL OR tenant_id != $1", [this.defaultTenantId]);
    
    await this.dataSource.query("DELETE FROM wine_types WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_styles WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_varietals WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_brands WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_producers WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_villages WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_regions WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_countries WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_bottle_formats WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_bottle_vintages WHERE tenant_id = $1", [this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM wine_vineyards WHERE tenant_id = $1", [this.defaultTenantId]);
    

    console.log("✅ Existing tenant data cleared");
  }

  async loadExtractedData() {
    console.log("📂 Loading extracted data...");

    const dataDir = path.join(process.cwd(), "extracted-data");

    if (!fs.existsSync(dataDir)) {
      throw new Error(`Extracted data directory not found: ${dataDir}`);
    }

    this.legacyData = {
      wineCountries: this.loadJsonFile(
        path.join(dataDir, "wineCountries.json")
      ),
      wineRegions: this.loadJsonFile(path.join(dataDir, "wineRegions.json")),
      wineVillages: this.loadJsonFile(path.join(dataDir, "wineVillages.json")),
      wineRelationships: this.loadJsonFile(
        path.join(dataDir, "wineRelationships.json")
      ),
      wineProducers: this.loadJsonFile(
        path.join(dataDir, "wineProducers.json")
      ),
      wineBrands: this.loadJsonFile(path.join(dataDir, "wineBrands.json")),
      wineVarietals: this.loadJsonFile(
        path.join(dataDir, "wineVarietals.json")
      ),
      wineStyles: this.loadJsonFile(path.join(dataDir, "wineStyles.json")),
      wineColors: this.loadJsonFile(path.join(dataDir, "wineColors.json")),
      wineBottleVintages: this.loadJsonFile(
        path.join(dataDir, "wineBottleVintages.json")
      ),
      wineBottleSizes: this.loadJsonFile(
        path.join(dataDir, "wineBottleSizes.json")
      ),
      wineItems: this.loadJsonFile(path.join(dataDir, "wineItems.json")),
    };

    console.log(
      `📊 Loaded data: ${Object.entries(this.legacyData)
        .map(([key, data]) => `${key}: ${data.length}`)
        .join(", ")}`
    );
  }

  loadJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ File not found: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  }

  async createDefaultTenant() {
    console.log("🏢 Creating default tenant...");

    // Check if default tenant exists
    const existingTenant = await this.dataSource.query(
      "SELECT id FROM tenants WHERE name = $1",
      ["Veritas"]
    );

    if (existingTenant.length === 0) {
      const tenantId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO tenants (id, name, document_number, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
        [tenantId, "Veritas", "VERITAS-001", new Date(), new Date()]
      );
      console.log("✅ Created default tenant");
      this.defaultTenantId = tenantId;
    } else {
      console.log("✅ Using existing default tenant");
      this.defaultTenantId = existingTenant[0].id;
    }
  }

  async seedWineCountries() {
    console.log("🌍 Seeding wine countries...");

    let inserted = 0;

    for (const country of this.legacyData.wineCountries) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_countries (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          country.name,
          this.defaultTenantId,
          country.legacy_id ? country.legacy_id.toString() : null,
          new Date(country.created_at),
          new Date(country.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine countries: ${inserted} inserted`);
  }

  async seedWineRegions() {
    console.log("🗺️ Seeding wine regions...");

    let inserted = 0;

    for (const region of this.legacyData.wineRegions) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_regions (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          region.name,
          this.defaultTenantId,
          region.legacy_id ? region.legacy_id.toString() : null,
          new Date(region.created_at),
          new Date(region.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine regions: ${inserted} inserted`);
  }

  async seedWineVillages() {
    console.log("🏘️ Seeding wine villages...");

    let inserted = 0;

    for (const village of this.legacyData.wineVillages) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_villages (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          village.name,
          this.defaultTenantId,
          village.legacy_id ? village.legacy_id.toString() : null,
          new Date(village.created_at),
          new Date(village.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine villages: ${inserted} inserted`);
  }

  async seedWineProducers() {
    console.log("🍷 Seeding wine producers...");

    let inserted = 0;

    for (const producer of this.legacyData.wineProducers) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_producers (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          producer.name,
          this.defaultTenantId,
          producer.legacy_id ? producer.legacy_id.toString() : null,
          new Date(producer.created_at),
          new Date(producer.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine producers: ${inserted} inserted`);
  }

  async seedWineBrands() {
    console.log("🏷️ Seeding wine brands...");

    let inserted = 0;

    for (const brand of this.legacyData.wineBrands) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_brands (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          brand.name,
          this.defaultTenantId,
          brand.legacy_id ? brand.legacy_id.toString() : null,
          new Date(brand.created_at),
          new Date(brand.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine brands: ${inserted} inserted`);
  }

  async seedWineVarietals() {
    console.log("🍇 Seeding wine varietals...");

    let inserted = 0;

    for (const varietal of this.legacyData.wineVarietals) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_varietals (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          varietal.name,
          this.defaultTenantId,
          varietal.legacy_id ? varietal.legacy_id.toString() : null,
          new Date(varietal.created_at),
          new Date(varietal.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine varietals: ${inserted} inserted`);
  }

  async seedWineStyles() {
    console.log("🎨 Seeding wine styles...");

    let inserted = 0;

    for (const style of this.legacyData.wineStyles) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_styles (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          style.name,
          this.defaultTenantId,
          style.legacy_id ? style.legacy_id.toString() : null,
          new Date(style.created_at),
          new Date(style.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine styles: ${inserted} inserted`);
  }

  async seedWineBottleVintages() {
    console.log("🍾 Seeding wine bottle vintages...");

    let inserted = 0;

    for (const vintage of this.legacyData.wineBottleVintages) {
      // Convert year to string, handling null cases
      const vintageName =
        vintage.year === "NV" ? "NV" : vintage.year.toString();

      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_bottle_vintages (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          vintageName,
          this.defaultTenantId,
          vintage.legacy_id ? vintage.legacy_id.toString() : null,
          new Date(vintage.created_at),
          new Date(vintage.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine bottle vintages: ${inserted} inserted`);
  }

  async seedWineBottleSizes() {
    console.log("🍾 Seeding wine bottle sizes...");

    let inserted = 0;

    for (const size of this.legacyData.wineBottleSizes) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_bottle_formats (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          size.name,
          this.defaultTenantId,
          size.legacy_id ? size.legacy_id.toString() : null,
          new Date(size.created_at),
          new Date(size.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine bottle sizes: ${inserted} inserted`);
  }

  async seedWineTypes() {
    console.log("🎭 Seeding wine types (colors)...");

    let inserted = 0;

    for (const type of this.legacyData.wineColors) {
      const newId = uuidv4();
      await this.dataSource.query(
        "INSERT INTO wine_types (id, name, tenant_id, legacy_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          newId,
          type.name,
          this.defaultTenantId,
          type.legacy_id ? type.legacy_id.toString() : null,
          new Date(type.created_at),
          new Date(type.updated_at),
        ]
      );
      inserted++;
    }

    console.log(`✅ Wine types: ${inserted} inserted`);
  }

  async seedWines() {
    console.log("🍷 Seeding wines...");

    // Get all the lookup entities for relationships with legacy_id
    const countries = await this.dataSource.query(
      "SELECT id, legacy_id FROM wine_countries"
    );
    const regions = await this.dataSource.query(
      "SELECT id, legacy_id FROM wine_regions"
    );
    const villages = await this.dataSource.query(
      "SELECT id, legacy_id FROM wine_villages"
    );
    const producers = await this.dataSource.query(
      "SELECT id, legacy_id FROM wine_producers"
    );
    const varietals = await this.dataSource.query(
      "SELECT id, legacy_id FROM wine_varietals"
    );
    const brands = await this.dataSource.query(
      "SELECT id, legacy_id FROM wine_brands"
    );
    const styles = await this.dataSource.query(
      "SELECT id, legacy_id FROM wine_styles"
    );
    const types = await this.dataSource.query(
      "SELECT id, legacy_id FROM wine_types"
    );

    // Create lookup maps for legacy IDs
    const countryMap = new Map(countries.map((c) => [c.legacy_id, c.id]));
    const regionMap = new Map(regions.map((r) => [r.legacy_id, r.id]));
    const villageMap = new Map(villages.map((v) => [v.legacy_id, v.id]));
    const producerMap = new Map(producers.map((p) => [p.legacy_id, p.id]));
    const varietalMap = new Map(varietals.map((v) => [v.legacy_id, v.id]));
    const brandMap = new Map(brands.map((b) => [b.legacy_id, b.id]));
    const styleMap = new Map(styles.map((s) => [s.legacy_id, s.id]));
    const typeMap = new Map(types.map((t) => [t.legacy_id, t.id]));

    // Log mapping statistics for debugging
    console.log(`📊 Lookup maps created:`);
    console.log(`   Countries: ${countryMap.size} mapped`);
    console.log(`   Regions: ${regionMap.size} mapped`);
    console.log(`   Villages: ${villageMap.size} mapped`);
    console.log(`   Producers: ${producerMap.size} mapped`);
    console.log(`   Varietals: ${varietalMap.size} mapped`);
    console.log(`   Brands: ${brandMap.size} mapped`);
    console.log(`   Styles: ${styleMap.size} mapped`);
    console.log(`   Types: ${typeMap.size} mapped`);

    let inserted = 0;

    for (const item of this.legacyData.wineItems) {
      
      // Insert wine directly since we have a clean database
      const newId = uuidv4();

      // Find related entities by legacy_id for more reliable mapping
      const payload = {
        id: newId,
        type_id: item.type_legacy_id ? typeMap.get(item.type_legacy_id.toString()) : null,
        brand_id: item.brand_legacy_id ? brandMap.get(item.brand_legacy_id.toString()) : null,
        country_id: item.country_legacy_id ? countryMap.get(item.country_legacy_id.toString()) : null,
        producer_id: item.producer_legacy_id ? producerMap.get(item.producer_legacy_id.toString()) : null,
        region_id: item.region_legacy_id ? regionMap.get(item.region_legacy_id.toString()) : null,
        style_id: item.style_legacy_id ? styleMap.get(item.style_legacy_id.toString()) : null,
        varietal_id: item.varietal_legacy_id ? varietalMap.get(item.varietal_legacy_id.toString()) : null,
        village_id: item.village_legacy_id ? villageMap.get(item.village_legacy_id.toString()) : null,
        legacy_id: item.legacy_id ? item.legacy_id.toString() : null,
        tenant_id: this.defaultTenantId,
        // deleted_at: item.is_approved === "true" ? null : new Date(),
      };

      // Dynamically generate SQL columns and placeholders from payload
      const columns = Object.keys(payload);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      
      await this.dataSource.query(
        `INSERT INTO wines (${columns.join(', ')}) VALUES (${placeholders})`,
        Object.values(payload)
      );

      inserted++;
    }

    console.log(`✅ Wines: ${inserted} inserted`);
  }
}

async function bootstrap() {
  console.log("🚀 Starting Legacy Data Seeder...");

  let dataSource = null;

  try {
    // Create database connection
    dataSource = new DataSource({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      username: process.env.DB_USERNAME || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      database: process.env.DB_DATABASE || "winehaus",
      synchronize: false,
      logging: false,
    });

    // Initialize connection
    await dataSource.initialize();
    console.log("✅ Database connection established");

    // Run only the wine seeder (case seeder has separate issues)
    const seeder = new LegacyDataSeeder(dataSource);
    await seeder.seed();

    console.log("🎉 Wine data seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
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
