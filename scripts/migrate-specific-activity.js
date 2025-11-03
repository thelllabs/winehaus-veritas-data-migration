/**
 * Specific Case Activity Migration Script
 *
 * This script migrates a specific case activity based on its legacy ID.
 * It creates the necessary operation group, case operations, and inventory entries
 * for a single activity from the legacy system.
 *
 * Usage:
 *   node scripts/migrate-specific-activity.js --activity-id <LEGACY_ACTIVITY_ID> [options]
 *
 * Options:
 *   --activity-id <ID>     Legacy activity ID to migrate (required)
 *   --clear-existing       Clear existing data for this activity before migrating
 *   --help, -h             Show this help message
 *
 * Examples:
 *   node scripts/migrate-specific-activity.js --activity-id 109
 *   node scripts/migrate-specific-activity.js --activity-id 150 --clear-existing
 *   pnpm run migrate:activity -- --activity-id 109
 */

const { DataSource } = require("typeorm");
const { v4: uuidv4 } = require("uuid");
const { config } = require("dotenv");
const fs = require("fs");
const path = require("path");
const { createDefaultTenant } = require("./utils/tenant-utils");
const { DatabaseConfig, parseConfigPath } = require("./utils/database-config");

const synced_inventory_status = true;

// Load environment variables
config();

// Parse command line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    activityId: null,
    clearExisting: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--activity-id":
        options.activityId = args[i + 1];
        i++; // Skip next argument as it's the value
        break;
      case "--clear-existing":
        options.clearExisting = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        console.warn(`⚠️ Unknown argument: ${arg}`);
        break;
    }
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
Specific Case Activity Migration Script

This script migrates a specific case activity from legacy JSON files into the new Veritas database structure.

Usage:
  node scripts/migrate-specific-activity.js --activity-id <LEGACY_ACTIVITY_ID> [options]

Options:
  --activity-id <ID>     Legacy activity ID to migrate (required)
  --clear-existing       Clear existing data for this activity before migrating
  --help, -h             Show this help message

Examples:
  node scripts/migrate-specific-activity.js --activity-id 109
  node scripts/migrate-specific-activity.js --activity-id 150 --clear-existing
  pnpm run migrate:activity -- --activity-id 109

Prerequisites:
  - PostgreSQL database running and accessible
  - Users must be imported before activities (activities link to customers/users)
  - Cases must be imported before activities (activities link to cases)
  - Extracted case data files in extracted-data/ directory
  - Environment variables configured (.env file)

Environment Variables:
  DB_HOST=localhost          # Database host
  DB_PORT=5432              # Database port
  DB_USERNAME=postgres      # Database username
  DB_PASSWORD=postgres      # Database password
  DB_DATABASE=winehaus      # Database name
`);
}

class SpecificActivityMigrator {
  constructor(dataSource) {
    this.dataSource = dataSource;
    this.wineMapId = new Map();
    this.bottleFormatMapId = new Map();
    this.bottleVintageMapId = new Map();
  }

  async migrate(activityId, options = {}) {
    console.log(`🌱 Starting migration for activity ID: ${activityId}`);

    try {
      // Load extracted data
      await this.loadExtractedData();

      // Create default tenant
      this.defaultTenantId = await createDefaultTenant(this.dataSource);

      // Find the specific activity
      const activity = this.findActivityById(activityId);
      if (!activity) {
        throw new Error(`Activity with ID ${activityId} not found in legacy data`);
      }

      console.log(`📋 Found activity:`, {
        ActivityID: activity.ActivityID,
        AccountID: activity.AccountID,
        TransactionType: activity.TransactionType,
        Status: activity.Status,
        DateCreated: activity.DateCreated
      });

      // Validate dependencies
      await this.validateDependencies(activity);

      // Clear existing data if requested
      if (options.clearExisting) {
        await this.clearExistingActivityData(activityId);
      }

      // Check if activity already exists
      const existingOperationGroup = await this.findExistingOperationGroup(activityId);
      if (existingOperationGroup && !options.clearExisting) {
        console.log(`⚠️ Activity ${activityId} already migrated. Use --clear-existing to re-migrate.`);
        return;
      }

      // Load required mappings
      await this.loadMappings();

      // Migrate the activity
      await this.migrateActivity(activity);

      console.log("✅ Activity migration completed successfully!");
    } catch (error) {
      console.error("❌ Migration failed:", error);
      throw error;
    }
  }

  async loadExtractedData() {
    console.log("📂 Loading extracted case data...");

    const dataDir = path.join(process.cwd(), "extracted-data");

    if (!fs.existsSync(dataDir)) {
      throw new Error(`Extracted data directory not found: ${dataDir}`);
    }

    this.legacyData = {
      activities: this.loadJsonFile(path.join(dataDir, "cases-activities.json")),
      activityDetails: this.loadJsonFile(
        path.join(dataDir, "cases-activityDetails.json")
      ),
      caseDetails: this.loadJsonFile(
        path.join(dataDir, "cases-caseDetails.json")
      ),
      accounts: this.loadJsonFile(path.join(dataDir, "accounts.json")),
      users: this.loadJsonFile(path.join(dataDir, "users.json")),
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

  findActivityById(activityId) {
    return this.legacyData.activities.find(
      (activity) => activity.ActivityID.toString() === activityId.toString()
    );
  }

  async validateDependencies(activity) {
    console.log("🔍 Validating dependencies...");

    // Check if customer exists
    const customer = await this.dataSource.query(
      "SELECT id FROM users WHERE legacy_user_id = $1 AND tenant_id = $2",
      [activity.AccountID.toString(), this.defaultTenantId]
    );

    if (customer.length === 0) {
      throw new Error(`Customer with legacy ID ${activity.AccountID} not found. Please import users first.`);
    }

    // Check if cases exist for this activity's details
    const activityDetails = this.getActivityDetails(activity.ActivityID);
    for (const detail of activityDetails) {
      const caseExists = await this.dataSource.query(
        "SELECT id FROM cases WHERE legacy_id = $1 AND tenant_id = $2",
        [detail.CaseID.toString(), this.defaultTenantId]
      );

      if (caseExists.length === 0) {
        throw new Error(`Case with legacy ID ${detail.CaseID} not found. Please import cases first.`);
      }
    }

    console.log("✅ Dependencies validated");
  }

  async findExistingOperationGroup(activityId) {
    // Look for existing operation group by checking if any case operations reference this activity
    const existing = await this.dataSource.query(
      `SELECT og.id, og.customer_id 
       FROM operations_groups og
       JOIN cases_operations co ON co.group_id = og.id
       WHERE og.tenant_id = $1 
       AND co.logs::text LIKE $2`,
      [this.defaultTenantId, `%"legacy_activity_id":"${activityId}"%`]
    );

    return existing.length > 0 ? existing[0] : null;
  }

  async clearExistingActivityData(activityId) {
    console.log(`🧹 Clearing existing data for activity ${activityId}...`);

    // Find and delete operation groups that reference this activity
    const operationGroups = await this.dataSource.query(
      `SELECT og.id 
       FROM operations_groups og
       JOIN cases_operations co ON co.group_id = og.id
       WHERE og.tenant_id = $1 
       AND co.logs::text LIKE $2`,
      [this.defaultTenantId, `%"legacy_activity_id":"${activityId}"%`]
    );

    for (const group of operationGroups) {
      // Delete in reverse dependency order
      await this.dataSource.query(
        "DELETE FROM wine_inventory_entries WHERE operation_id IN (SELECT id FROM cases_operations WHERE group_id = $1) AND tenant_id = $2",
        [group.id, this.defaultTenantId]
      );
      
      await this.dataSource.query(
        "DELETE FROM cases_operations WHERE group_id = $1 AND tenant_id = $2",
        [group.id, this.defaultTenantId]
      );
      
      await this.dataSource.query(
        "DELETE FROM operations_groups WHERE id = $1 AND tenant_id = $2",
        [group.id, this.defaultTenantId]
      );
    }

    console.log(`✅ Cleared existing data for activity ${activityId}`);
  }

  async loadMappings() {
    console.log("🗺️ Loading ID mappings...");
    
    this.customerIdMap = await this.getCustomerIdMap();
    this.caseIdMap = await this.getCaseIdMap();
    this.wineMapId = await this.getWineIdMap();
    this.bottleFormatMapId = await this.getBottleFormatIdMap();
    this.bottleVintageMapId = await this.getBottleVintageIdMap();

    console.log("✅ ID mappings loaded");
  }

  async migrateActivity(activity) {
    console.log(`🔄 Migrating activity ${activity.ActivityID}...`);

    // Get customer ID
    const customerId = this.customerIdMap.get(activity.AccountID.toString());
    if (!customerId) {
      throw new Error(`Customer ID not found for legacy account ${activity.AccountID}`);
    }

    // Create operation group
    const operationGroupId = await this.createOperationGroup(customerId, activity);

    // Process activity details
    const activityDetails = this.getActivityDetails(activity.ActivityID);
    console.log(`📋 Found ${activityDetails.length} activity details`);

    if (activityDetails.length === 0) {
      console.log("⚠️ No activity details found for this activity");
      return;
    }

    // Process based on transaction type
    switch (activity.TransactionType) {
      case "D":
      case "W":
        await this.createCaseOperationsFromActivityDepositOrWithdrawal(
          operationGroupId,
          activity
        );
        break;
      case "T":
        await this.createCaseOperationsFromActivityTransfer(
          operationGroupId,
          activity
        );
        break;
      default:
        console.log(`⚠️ Unknown transaction type: ${activity.TransactionType}`);
    }

    console.log(`✅ Activity ${activity.ActivityID} migrated successfully`);
  }

  getActivityDetails(activityId) {
    return this.legacyData.activityDetails.filter(
      (detail) =>
        detail.ActivityID &&
        detail.ActivityID.toString() === activityId.toString() &&
        detail.ActivityType !== "Supply"
    );
  }

  parseActivityStatus(status) {
    switch (status) {
      case 1:
        return "processed";
      case 2:
        return "on_hold";
      case 3:
        return "confirmed";
      case 4:
        return "on_hold";
      default:
        return "pending";
    }
  }

  parseActivityTransactionType(activity) {
    switch (activity.TransactionType) {
      case "D":
        return "deposit";
      case "W":
        return "withdrawal";
      case "T":
        return "transfer";
      default:
        return "other";
    }
  }

  async createOperationGroup(customerId, activity) {
    const operationGroupId = uuidv4();

    await this.dataSource.query(
      `INSERT INTO operations_groups (
        id, tenant_id, customer_id, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        operationGroupId,
        this.defaultTenantId,
        customerId,
        this.parseActivityStatus(activity.Status),
        new Date(activity.DateCreated || Date.now()),
        new Date(activity.DateUpdated || Date.now()),
      ]
    );

    console.log(`✅ Created operation group ${operationGroupId}`);

    return operationGroupId;
  }

  async createCaseOperationsFromActivityDepositOrWithdrawal(
    operationGroupId,
    activity
  ) {
    const activityDetails = this.getActivityDetails(activity.ActivityID);

    for (const activityDetail of activityDetails) {
      await this.createOrUpdateCaseOperationFromActivityDepositOrWithdrawalActivityDetail(
        operationGroupId,
        activityDetail,
        activity
      );
    }
  }

  async createCaseOperationsFromActivityTransfer(operationGroupId, activity) {
    const activityDetails = this.getActivityDetails(activity.ActivityID);

    for (const activityDetail of activityDetails) {
      await this.createCaseOperationFromActivityTransferActivityDetail(
        operationGroupId,
        activityDetail,
        activity
      );
    }
  }

  async createOrUpdateCaseOperationFromActivityDepositOrWithdrawalActivityDetail(
    operationGroupId,
    activityDetail,
    activity
  ) {
    const operationId = await this.getCaseOperationFromActivityDetail(
      operationGroupId,
      activityDetail,
      activity
    );

    if (!operationId) {
      console.log(
        `⚠️ No case operation found for activity detail ${activityDetail.ActivityDetailID}, skipping`
      );
      return;
    }

    const { newWineId, newBottleFormatId, newBottleVintageId } =
      await this.validateInventoryActivityDetail(activityDetail);

    if (!newWineId || !newBottleFormatId || !newBottleVintageId) {
      console.log(
        `⚠️ Missing wine data for activity detail ${activityDetail.ActivityDetailID}, skipping`
      );
      return;
    }

    try {
      await this.createCaseOperationInventoryEntry(
        operationId,
        newWineId,
        newBottleFormatId,
        newBottleVintageId,
        activityDetail.Quantity
      );
    } catch (error) {
      console.error(`❌ Error creating inventory entry:`, error);
    }
  }

  async createCaseOperationFromActivityTransferActivityDetail(
    operationGroupId,
    activityDetail,
    activity
  ) {
    if (activityDetail.ActivityType === "Case") {
      return;
    }

    if (activityDetail.ActivityType !== "Bottle") {
      console.log(
        `⚠️ Skipping activity type ${activityDetail.ActivityDetailID} - ${activityDetail.ActivityType}`
      );
      return;
    }

    const sourceCaseId = await this.getCaseIdFromCaseDetail(
      activityDetail.CaseDetailID
    );
    const destinationCaseId = this.caseIdMap.get(
      activityDetail.CaseID.toString()
    );

    if (!sourceCaseId || !destinationCaseId) {
      console.log(
        `⚠️ No case ID found for activity detail ${activityDetail.ActivityDetailID}, skipping`
      );
      return;
    }

    const { newWineId, newBottleFormatId, newBottleVintageId } =
      await this.validateInventoryActivityDetail(activityDetail);

    if (!newWineId || !newBottleFormatId || !newBottleVintageId) {
      console.log(
        `⚠️ Missing wine data for activity detail ${activityDetail.ActivityDetailID}, skipping`
      );
      return;
    }

    // Create case operation in source case
    const sourceCaseOperationId = await this.createCaseOperationFromActivityTransfer(
      operationGroupId,
      activity,
      sourceCaseId,
      "withdrawal"
    );

    await this.createCaseOperationInventoryEntry(
      sourceCaseOperationId,
      newWineId,
      newBottleFormatId,
      newBottleVintageId,
      activityDetail.Quantity
    );

    // Create case operation in destination case
    const destinationCaseOperationId = await this.createCaseOperationFromActivityTransfer(
      operationGroupId,
      activity,
      destinationCaseId,
      "deposit"
    );

    await this.createCaseOperationInventoryEntry(
      destinationCaseOperationId,
      newWineId,
      newBottleFormatId,
      newBottleVintageId,
      activityDetail.Quantity
    );
  }

  async getCaseOperationFromActivityDetail(
    operationGroupId,
    activityDetail,
    activity
  ) {
    const caseId = this.caseIdMap.get(activityDetail.CaseID.toString());

    if (!caseId) {
      console.log(
        `⚠️ No case ID found for legacy case ${activityDetail.CaseID}, skipping`
      );
      return;
    }

    return await this.getCaseOperation(
      operationGroupId,
      caseId,
      activity,
      activityDetail
    );
  }

  async getCaseOperation(operationGroupId, caseId, activity, activityDetail) {
    const caseOperation = await this.dataSource.query(
      `SELECT id FROM cases_operations WHERE group_id = $1 AND case_id = $2 AND tenant_id = $3`,
      [operationGroupId, caseId, this.defaultTenantId]
    );

    if (caseOperation.length === 0) {
      return this.createCaseOperationFromActivityDetail(
        operationGroupId,
        activityDetail,
        activity
      );
    }
    return caseOperation[0].id;
  }

  async createCaseOperationFromActivityDetail(
    operationGroupId,
    activityDetail,
    activity
  ) {
    const operationId = uuidv4();
    const caseId = this.caseIdMap.get(activityDetail.CaseID.toString());

    if (!caseId) {
      console.log(
        `⚠️ No case ID found for legacy case ${activityDetail.CaseID}, skipping`
      );
      return;
    }

    await this.dataSource.query(
      `INSERT INTO cases_operations (
        id, tenant_id, case_id, type, status, logs, request_id, 
        synced_inventory, reverted_on_inventory, group_id, created_at, 
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        operationId,
        this.defaultTenantId,
        caseId,
        this.parseActivityTransactionType(activity),
        this.parseActivityStatus(activity.Status),
        JSON.stringify([{ legacy_activity_id: activity.ActivityID }]),
        null,
        synced_inventory_status,
        false,
        operationGroupId,
        new Date(activity.DateCreated || Date.now()),
        new Date(activity.DateUpdated || Date.now()),
      ]
    );

    return operationId;
  }

  async createCaseOperationFromActivityTransfer(
    operationGroupId,
    activity,
    caseId,
    type
  ) {
    const operationId = uuidv4();
    await this.dataSource.query(
      `INSERT INTO cases_operations (
        id, tenant_id, case_id, type, status, logs, request_id, 
        synced_inventory, reverted_on_inventory, group_id, created_at, 
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        operationId,
        this.defaultTenantId,
        caseId,
        type,
        this.parseActivityStatus(activity.Status),
        JSON.stringify([{ legacy_activity_id: activity.ActivityID }]),
        null,
        synced_inventory_status,
        false,
        operationGroupId,
        new Date(activity.DateCreated || Date.now()),
        new Date(activity.DateUpdated || Date.now()),
      ]
    );

    return operationId;
  }

  async getCaseIdFromCaseDetail(caseDetailId) {
    const caseDetail = this.legacyData.caseDetails.find(
      (detail) => detail.legacy_case_detail_id == caseDetailId
    );

    if (!caseDetail) {
      console.log(
        `⚠️ No case detail found for case detail ID ${caseDetailId}, skipping`
      );
      return;
    }

    const caseId = this.caseIdMap.get(caseDetail.legacy_case_id.toString());

    if (!caseId) {
      console.log(
        `⚠️ No case ID found for case detail ID ${caseDetailId}, skipping`
      );
      return;
    }

    return caseId;
  }

  async validateInventoryActivityDetail(activityDetail) {
    let legacyWineId,
      legacyBottleFormatId,
      legacyBottleVintageId,
      newWineId,
      newBottleFormatId,
      newBottleVintageId;

    try {
      legacyWineId =
        activityDetail.WineItemID ||
        (await this.getWinePropFromCaseDetail(
          activityDetail.CaseDetailID,
          "wineId"
        ));
      legacyBottleFormatId =
        activityDetail.BottleSizeID ||
        (await this.getWinePropFromCaseDetail(
          activityDetail.CaseDetailID,
          "bottleFormatId"
        ));
      legacyBottleVintageId =
        activityDetail.VintageID ||
        (await this.getWinePropFromCaseDetail(
          activityDetail.CaseDetailID,
          "bottleVintageId"
        ));

      newWineId = await this.getNewWineId(legacyWineId);
      newBottleFormatId = await this.getNewBottleFormatId(legacyBottleFormatId);
      newBottleVintageId = await this.getNewBottleVintageId(
        legacyBottleVintageId
      );
    } catch (error) {
      console.log({ error, activityDetail });
      return { newWineId: null, newBottleFormatId: null, newBottleVintageId: null };
    }

    if (!newWineId) {
      newWineId = await this.createNewWine(legacyWineId, "Legacy Wine - Veritas - " + legacyWineId);
    }

    if (!legacyWineId || !legacyBottleFormatId || !legacyBottleVintageId || !newWineId || !newBottleFormatId || !newBottleVintageId) {
      console.log(
        `⚠️ ValidateInventoryActivityDetail failed for detail ${activityDetail.ActivityDetailID}`
      );
      return { newWineId: null, newBottleFormatId: null, newBottleVintageId: null };
    }

    return {
      newWineId,
      newBottleFormatId,
      newBottleVintageId,
    };
  }

  async getWinePropFromCaseDetail(caseDetailId, prop) {
    const caseDetail = this.legacyData.caseDetails.find(
      (detail) => detail.legacy_case_detail_id == caseDetailId
    );

    if (!caseDetail) {
      return null;
    }

    switch (prop) {
      case "wineId":
        return caseDetail.legacy_wine_item_id;
      case "bottleFormatId":
        return caseDetail.legacy_bottle_size_id;
      case "bottleVintageId":
        return caseDetail.legacy_vintage_id;
      default:
        return null;
    }
  }

  async createNewWine(legacyWineId, description) {
    const wineId = uuidv4();

    await this.dataSource.query(
      `INSERT INTO wines (id, tenant_id, legacy_id, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        wineId,
        this.defaultTenantId,
        legacyWineId,
        description,
        new Date(),
        new Date(),
      ]
    );

    return wineId;
  }

  async createCaseOperationInventoryEntry(
    caseOperationId,
    wineId,
    bottleFormatId,
    bottleVintageId,
    amount
  ) {
    const existingEntry = await this.dataSource.query(
      `SELECT id, amount FROM wine_inventory_entries 
       WHERE tenant_id = $1 
       AND operation_id = $2 
       AND wine_id = $3 
       AND bottle_format_id = $4 
       AND bottle_vintage_id = $5`,
      [
        this.defaultTenantId,
        caseOperationId,
        wineId,
        bottleFormatId,
        bottleVintageId,
      ]
    );

    if (existingEntry.length > 0) {
      const existingId = existingEntry[0].id;
      const existingAmount = existingEntry[0].amount;
      const newAmount = existingAmount + amount;

      await this.dataSource.query(
        `UPDATE wine_inventory_entries 
         SET amount = $1 
         WHERE id = $2`,
        [newAmount, existingId]
      );
    } else {
      const wineInventoryEntryId = uuidv4();

      await this.dataSource.query(
        `INSERT INTO wine_inventory_entries (id, tenant_id, operation_id, wine_id, bottle_format_id, bottle_vintage_id, amount) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          wineInventoryEntryId,
          this.defaultTenantId,
          caseOperationId,
          wineId,
          bottleFormatId,
          bottleVintageId,
          amount,
        ]
      );
    }
  }

  async getNewWineId(legacyWineId) {
    if (this.wineMapId.has(legacyWineId)) {
      return this.wineMapId.get(legacyWineId);
    }

    const wine = await this.dataSource.query(
      `SELECT id FROM wines WHERE legacy_id = $1 AND tenant_id = $2`,
      [legacyWineId.toString(), this.defaultTenantId]
    );

    if (wine.length === 0) {
      return null;
    }

    const wineId = wine[0].id;
    this.wineMapId.set(legacyWineId, wineId);
    return wineId;
  }

  async getNewBottleFormatId(legacyBottleFormatId) {
    if (this.bottleFormatMapId.has(legacyBottleFormatId)) {
      return this.bottleFormatMapId.get(legacyBottleFormatId);
    }

    const bottleFormat = await this.dataSource.query(
      `SELECT id FROM wine_bottle_formats WHERE legacy_id = $1 AND tenant_id = $2`,
      [legacyBottleFormatId.toString(), this.defaultTenantId]
    );

    if (bottleFormat.length === 0) {
      return null;
    }

    const bottleFormatId = bottleFormat[0].id;
    this.bottleFormatMapId.set(legacyBottleFormatId, bottleFormatId);
    return bottleFormatId;
  }

  async getNewBottleVintageId(legacyBottleVintageId) {
    if (this.bottleVintageMapId.has(legacyBottleVintageId)) {
      return this.bottleVintageMapId.get(legacyBottleVintageId);
    }

    const bottleVintage = await this.dataSource.query(
      `SELECT id FROM wine_bottle_vintages WHERE legacy_id = $1 AND tenant_id = $2`,
      [legacyBottleVintageId.toString(), this.defaultTenantId]
    );

    if (bottleVintage.length === 0) {
      return null;
    }

    const bottleVintageId = bottleVintage[0].id;
    this.bottleVintageMapId.set(legacyBottleVintageId, bottleVintageId);
    return bottleVintageId;
  }

  async getCustomerIdMap() {
    const customerIdMap = new Map();
    const customers = await this.dataSource.query(
      `SELECT id, legacy_user_id FROM users WHERE tenant_id = $1`,
      [this.defaultTenantId]
    );
    
    customers.forEach((customer) => {
      customerIdMap.set(customer.legacy_user_id, customer.id);
    });
    return customerIdMap;
  }

  async getCaseIdMap() {
    const caseIdMap = new Map();
    const cases = await this.dataSource.query(
      `SELECT id, legacy_id FROM cases WHERE tenant_id = $1`,
      [this.defaultTenantId]
    );
    cases.forEach((c) => {
      caseIdMap.set(c.legacy_id, c.id);
    });
    return caseIdMap;
  }

  async getWineIdMap() {
    const wineIdMap = new Map();
    const wines = await this.dataSource.query(
      `SELECT id, legacy_id FROM wines WHERE tenant_id = $1`,
      [this.defaultTenantId]
    );
    wines.forEach((w) => {
      wineIdMap.set(w.legacy_id, w.id);
    });
    return wineIdMap;
  }

  async getBottleVintageIdMap() {
    const bottleVintageIdMap = new Map();
    const bottleVintages = await this.dataSource.query(
      `SELECT id, legacy_id FROM wine_bottle_vintages WHERE tenant_id = $1`,
      [this.defaultTenantId]
    );
    bottleVintages.forEach((b) => {
      bottleVintageIdMap.set(b.legacy_id, b.id);
    });
    return bottleVintageIdMap;
  }

  async getBottleFormatIdMap() {
    const bottleFormatIdMap = new Map();
    const bottleFormats = await this.dataSource.query(
      `SELECT id, legacy_id FROM wine_bottle_formats WHERE tenant_id = $1`,
      [this.defaultTenantId]
    );
    bottleFormats.forEach((b) => {
      bottleFormatIdMap.set(b.legacy_id, b.id);
    });
    return bottleFormatIdMap;
  }
}

async function bootstrap() {
  console.log("🚀 Starting Specific Activity Migration...");

  // Parse command line arguments
  const options = parseArguments();
  const configPath = parseConfigPath();

  if (options.help) {
    showHelp();
    return;
  }

  if (!options.activityId) {
    console.error("❌ Error: --activity-id is required");
    showHelp();
    process.exit(1);
  }

  if (options.clearExisting) {
    console.log("🧹 Clear existing data mode enabled");
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
    console.log("✅ Database connection established");

    // Run the migrator
    const migrator = new SpecificActivityMigrator(dataSource);
    await migrator.migrate(options.activityId, { clearExisting: options.clearExisting });

    console.log("🎉 Activity migration completed successfully!");
  } catch (error) {
    console.error("❌ Activity migration failed:", error);
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

// Export the class for use in other scripts
module.exports = { SpecificActivityMigrator };

