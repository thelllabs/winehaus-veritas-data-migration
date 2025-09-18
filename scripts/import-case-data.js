/**
 * Legacy Case Data Import Script
 *
 * See LLM_SCRIPT_INSTRUCTIONS.md for project-wide guidelines
 *
 * IMPORTANT: This script maps legacy case data to the new CaseEntity structure:
 *
 * Expected enum values:
 * - case_operation_type_enum: ['in', 'out', 'transfer', 'adjustment', 'other']
 * - case_operation_status_enum: ['pending', 'in_progress', 'processed', 'cancelled', 'failed']
 * - operation_group_status_enum: ['pending', 'in_progress', 'processed', 'cancelled', 'failed']
 * - operation_request_type_enum: ['in', 'out', 'transfer', 'adjustment', 'other']
 * - operation_request_status_enum: ['pending', 'approved', 'rejected', 'cancelled']
 *
 * Required fields from CaseEntity:
 * - id, tenant_id, customer_id, name, max_items, current_items (all required)
 * - description, billing_start_date, billing_end_date (nullable)
 *
 * Required fields from CaseOperationEntity:
 * - id, tenant_id, case_id, type, status, logs, synced_inventory, reverted_on_inventory, group_id (all required)
 * - request_id (nullable)
 *
 * Required fields from OperationGroupEntity:
 * - id, tenant_id, customer_id, status (all required)
 *
 * Required fields from OperationRequestEntity:
 * - id, tenant_id, customer_id, type, status, extra_data, phones, requester_id (all required)
 * - reason (nullable)
 *
 * Required fields from OperationExtraEntity:
 * - id, tenant_id, operation_id, operation_group_id, invoice_title, price_per_item, amount (all required)
 * - description, template_id (nullable)
 *
 * IMPORTANT: This script only imports cases for active users (status != 'blocked').
 * Cases for inactive users are skipped but their customer ID mappings are still stored
 * for potential future use in operation groups and other related entities.
 *
 * Usage:
 *   node scripts/import-case-data.js [options]
 *
 * Options:
 *   --clear-existing    Clear existing imported case data before importing
 *   --help, -h         Show this help message
 *
 * Examples:
 *   node scripts/import-case-data.js                    # Import case data (skip existing)
 *   node scripts/import-case-data.js --clear-existing   # Clear and re-import all case data
 *   pnpm run case:import                               # Run via npm script
 *   pnpm run case:import -- --clear-existing           # Run with clear flag
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
    clearExisting: false,
    help: false,
  };

  for (const arg of args) {
    switch (arg) {
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
Legacy Case Data Import Script

This script imports case data from legacy JSON files into the new Veritas database structure.

Usage:
  node scripts/import-case-data.js [options]

Options:
  --clear-existing    Clear existing imported case data before importing
  --help, -h         Show this help message

Examples:
  node scripts/import-case-data.js                    # Import case data (skip existing)
  node scripts/import-case-data.js --clear-existing   # Clear and re-import all case data
  pnpm run case:import                               # Run via npm script
  pnpm run case:import -- --clear-existing           # Run with clear flag

Prerequisites:
  - PostgreSQL database running and accessible
  - Users must be imported before cases (cases link to customers/users)
  - Extracted case data files in extracted-data/ directory
  - Environment variables configured (.env file)

Note: Only cases for active users (status != 'blocked') will be imported.
Cases for inactive users are skipped but customer mappings are preserved.

Environment Variables:
  DB_HOST=localhost          # Database host
  DB_PORT=5432              # Database port
  DB_USERNAME=postgres      # Database username
  DB_PASSWORD=postgres      # Database password
  DB_DATABASE=winehaus      # Database name

Data Import Order:
  1. Cases (linked to customers/users)
  2. Operation Groups (for grouping operations)
  3. Operation Requests (for tracking requests)
  4. Case Operations (for tracking case activities)
  5. Operation Extras (for additional charges/items)
`);
}

class LegacyCaseDataSeeder {
  constructor(dataSource) {
    this.dataSource = dataSource;
    this.wineMapId = new Map();
    this.bottleFormatMapId = new Map();
    this.bottleVintageMapId = new Map();
  }

  async seed(options = {}) {
    console.log("🌱 Starting Legacy Case Data Seeding...");

    try {
      // Load extracted data
      await this.loadExtractedData();

      // Create default tenant
      this.defaultTenantId = await createDefaultTenant(this.dataSource);

      // Clear existing data if requested
      if (options.clearExisting) {
        await this.clearExistingData();
      }

      // Seed data in dependency order
      await this.seedCases();
      await this.seedOperationGroups();
      
      // Seed wine inventory entries from case details
      await this.seedWineInventoryEntriesFromCaseDetails();

      console.log("✅ Legacy case data seeding completed successfully!");
    } catch (error) {
      console.error("❌ Seeding failed:", error);
      throw error;
    }
  }

  async clearExistingData() {
    console.log("🧹 Clearing existing case data for tenant...");

    // Clear in reverse dependency order, only for the specific tenant
    await this.dataSource.query(
      "DELETE FROM wine_inventory_entries WHERE tenant_id = $1",
      [this.defaultTenantId]
    );
    await this.dataSource.query(
      "DELETE FROM operation_extras WHERE tenant_id = $1",
      [this.defaultTenantId]
    );
    await this.dataSource.query(
      "DELETE FROM cases_operations WHERE tenant_id = $1",
      [this.defaultTenantId]
    );
    await this.dataSource.query(
      "DELETE FROM operations_requests WHERE tenant_id = $1",
      [this.defaultTenantId]
    );
    await this.dataSource.query(
      "DELETE FROM operations_groups WHERE tenant_id = $1",
      [this.defaultTenantId]
    );
    await this.dataSource.query("DELETE FROM cases WHERE tenant_id = $1", [
      this.defaultTenantId,
    ]);

    console.log("✅ Existing tenant case data cleared");
  }

  async loadExtractedData() {
    console.log("📂 Loading extracted case data...");

    const dataDir = path.join(process.cwd(), "extracted-data");

    if (!fs.existsSync(dataDir)) {
      throw new Error(`Extracted data directory not found: ${dataDir}`);
    }

    this.legacyData = {
      cases: this.loadJsonFile(path.join(dataDir, "cases-cases.json")),
      caseDetails: this.loadJsonFile(
        path.join(dataDir, "cases-caseDetails.json")
      ),
      caseLocations: this.loadJsonFile(
        path.join(dataDir, "cases-caseLocations.json")
      ),
      caseTypes: this.loadJsonFile(path.join(dataDir, "cases-caseTypes.json")),
      lockerDetails: this.loadJsonFile(
        path.join(dataDir, "cases-lockerDetails.json")
      ),
      lockerHistory: this.loadJsonFile(
        path.join(dataDir, "cases-lockerHistory.json")
      ),
      lockers: this.loadJsonFile(path.join(dataDir, "cases-lockers.json")),
      activities: this.loadJsonFile(
        path.join(dataDir, "cases-activities.json")
      ),
      activityDetails: this.loadJsonFile(
        path.join(dataDir, "cases-activityDetails.json")
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


  async seedCases() {
    console.log("📦 Seeding cases...");
    console.log(`📊 Total cases to process: ${this.legacyData.cases.length}`);

    let inserted = 0;
    let skipped = 0;
    let inactiveUsersSkipped = 0;
    let noAccountFound = 0;
    let noUserFound = 0;
    let userNotImported = 0;

    for (const caseData of this.legacyData.cases) {
      // Check if case already exists
      const existing = await this.dataSource.query(
        "SELECT id FROM cases WHERE legacy_id = $1",
        [caseData.legacy_case_id.toString()]
      );

      if (existing.length === 0) {
        // Find the customer (user) for this case
        const account = this.legacyData.accounts.find(
          (acc) => acc.legacy_account_id === caseData.legacy_account_id
        );

        if (!account) {
          console.warn(
            `⚠️ Skipping case ${caseData.legacy_case_id} - no account found`
          );
          noAccountFound++;
          continue;
        }

        // Get the new user ID from the users table
        const newUser = await this.dataSource.query(
          "SELECT id FROM users WHERE legacy_user_id = $1",
          [caseData.legacy_account_id.toString()]
        );

        if (newUser.length === 0) {
          console.warn(
            `⚠️ Skipping case ${caseData.legacy_case_id} - user not yet imported`
          );
          userNotImported++;
          continue;
        }

        const customerId = newUser[0].id;

        // Check if the user is active in the new system
        // const userStatus = await this.dataSource.query(
        //   "SELECT status FROM users WHERE id = $1",
        //   [customerId]
        // );

        // if (userStatus.length === 0 || userStatus[0].status === "blocked") {
        //   console.warn(
        //     `⚠️ Skipping case ${
        //       caseData.legacy_case_id
        //     } - user is inactive (status: ${
        //       userStatus[0]?.status || "unknown"
        //     })`
        //   );

        //   // Store customer ID mapping for skipped users (inactive users)
        //   if (!this.customerIdMap) this.customerIdMap = new Map();
        //   this.customerIdMap.set(
        //     caseData.legacy_account_id.toString(),
        //     customerId
        //   );

        //   inactiveUsersSkipped++;
        //   continue;
        // }

        // Determine case name
        let caseName = `#${caseData.CaseNumber}`;

        let caseLocation = null
        if (caseData.legacy_case_location_id) {
          const location = this.legacyData.caseLocations.find(
            (loc) =>
              loc.legacy_case_location_id === caseData.legacy_case_location_id
          );
          if (location) {            
            caseLocation = location.CaseLocationName;
          }
        }

        // Create case with all required fields
        const caseId = uuidv4();
        await this.dataSource.query(
          `INSERT INTO cases (
            id, tenant_id, customer_id, name, location, description, billing_start_date, 
            billing_end_date, max_items, current_items, created_at, updated_at, 
            deleted_at, legacy_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            caseId,
            this.defaultTenantId,
            customerId,
            caseName,
            caseLocation,
            `Legacy Case ID: ${caseData.legacy_case_id}. Legacy Case Status: ${caseData.is_active}.`,
            new Date(caseData.created_at || Date.now()),
            caseData.is_active === "false" ? new Date() : null, // billing_end_date - set to null for legacy cases
            caseData.MaxQuantity,
            0, // current_items - start with 0, will be calculated from operations
            new Date(caseData.created_at || Date.now()),
            new Date(caseData.updated_at || Date.now()),
            null, // deleted_at - soft delete if inactive
            caseData.legacy_case_id.toString()
          ]
        );

        // Store case ID mapping for operations
        if (!this.caseIdMap) this.caseIdMap = new Map();
        this.caseIdMap.set(caseData.legacy_case_id.toString(), caseId);

        // Store customer ID mapping for operation groups
        if (!this.customerIdMap) this.customerIdMap = new Map();
        this.customerIdMap.set(
          caseData.legacy_account_id.toString(),
          customerId
        );

        inserted++;
      } else {
        skipped++;
      }
    }

    console.log(`✅ Cases: ${inserted} inserted, ${skipped} skipped`);
    console.log(
      `📊 Summary: ${inserted} cases imported, ${skipped} already existed, ${inactiveUsersSkipped} skipped due to inactive users, ${noAccountFound} no account found, ${noUserFound} no user found, ${userNotImported} user not yet imported`
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
    }
  }

  parseActivityTransactionType(activity) {
    switch (activity.TransactionType) {
      case "D":
        return "deposit";
      case "W":
        return "withdrawal";
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

    switch (activity.TransactionType) {
      case "D":
        await this.createCaseOperationsFromActivityDepositOrWithdrawal(
          operationGroupId,
          activity
        );
        break;
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
        console.log(
          `⚠️ Skipping creating case operation - TransactionType is ${activity.TransactionType}, skipping`
        );
    }

    // await new Promise((resolve) => setTimeout(resolve, 1000));
    // await this.processOperationGroup(operationGroupId);

    return operationGroupId;
  }

  async getWinePropFromCaseDetail(caseDetailId, prop) {
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

    switch (prop) {
      case "wineId":
        return caseDetail.legacy_wine_item_id;
      case "bottleFormatId":
        return caseDetail.legacy_bottle_size_id;
      case "bottleVintageId":
        return caseDetail.legacy_vintage_id;
      default:
        console.log(`⚠️ Invalid property ${prop}, skipping`);
        return;
    }
  }

  async createNewWine(legacyWineId, description) {

    // Try find the wine in the tenant database
    const wine = await this.dataSource.query(
      `SELECT id FROM wines WHERE legacy_id = $1 AND tenant_id = $2`,
      [legacyWineId, this.defaultTenantId]
    );

    if (wine.length > 0) {
      return wine[0].id;
    }

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
      console.log({ error, activityDetail, newWineId, newBottleFormatId, newBottleVintageId });
      // console.log(teste);
      return;
    }

    if (!newWineId) {
      // Has to create a new wine with the legacy wine id
      newWineId = await this.createNewWine(legacyWineId, "Legacy Wine - Veritas - " + legacyWineId);
    }

    if (!legacyWineId || !legacyBottleFormatId || !legacyBottleVintageId || !newWineId || !newBottleFormatId || !newBottleVintageId) {
      console.log(
        `⚠️ ValidateInventoryActivityDetail failed for detail ${activityDetail.ActivityDetailID}, skipping`
      );
      console.log({
        legacyWineId,
        legacyBottleFormatId,
        legacyBottleVintageId,
        newWineId,
        newBottleFormatId,
        newBottleVintageId,
      });
      const activity = this.legacyData.activities.find(
        (activity) => activity.ActivityID == activityDetail.ActivityID
      );
      console.log({ activity });
      console.log({ activityDetail });
      // console.log(teste);
      return;
    }

    return {
      newWineId,
      newBottleFormatId,
      newBottleVintageId,
    };
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
        this.parseActivityTransactionType(activity), // Default type for legacy cases
        this.parseActivityStatus(activity.Status), // Default status for legacy cases
        JSON.stringify([]),
        null, // request_id - assume null for legacy cases
        synced_inventory_status, // synced_inventory - assume true for legacy cases
        false, // reverted_on_inventory - assume false for legacy cases
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
      console.log({ caseDetailId });
      // console.log(teste);
      return;
    }

    let caseId;
    try {
      caseId = this.caseIdMap.get(caseDetail.legacy_case_id.toString());
    } catch (error) {
      console.log({ caseDetail });
      console.log({ error, caseDetailId });
      // console.log(teste);
      return;
    }

    if (!caseId) {
      console.log(
        `⚠️ No case ID found for case detail ID ${caseDetailId}, skipping`
      );
      console.log({ caseDetailId });
      // console.log(teste);
      return;
    }

    return caseId;
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
        type, // Default type for legacy cases
        this.parseActivityStatus(activity.Status), // Default status for legacy cases
        JSON.stringify([]),
        null, // request_id - assume null for legacy cases
        synced_inventory_status, // synced_inventory - assume true for legacy cases
        false, // reverted_on_inventory - assume false for legacy cases
        operationGroupId,
        new Date(activity.DateCreated || Date.now()),
        new Date(activity.DateUpdated || Date.now()),
      ]
    );

    return operationId;
  }

  async createCaseOperationFromActivityTransferActivityDetail(
    operationGroupId,
    activityDetail,
    activity
  ) {

    if (activityDetail.ActivityType === "Case") {  
      // Cases were used for transfer case locations, we don't need that.    
      return;
    }

    if (activityDetail.ActivityType !== "Bottle") {
      console.log(
        `⚠️ Skipping activity type ${activityDetail.ActivityDetailID} - ${activityDetail.ActivityType}, skipping`
      );
      return;
    }

    const sourceCaseId = await this.getCaseIdFromCaseDetail(
      activityDetail.CaseDetailID
    );
    const destinationCaseId = await this.caseIdMap.get(
      activityDetail.CaseID.toString()
    );

    if (!sourceCaseId || !destinationCaseId) {
      console.log(
        `⚠️ No case ID found for case detail ID ${activityDetail.CaseDetailID}, skipping`
      );
      console.log({ activityDetail });
      // console.log(teste);
      return;
    }

    const { newWineId, newBottleFormatId, newBottleVintageId } =
      await this.validateInventoryActivityDetail(activityDetail);

    // Create case operation in sourceCaseId
    const sourceCaseOperationId =
      await this.createCaseOperationFromActivityTransfer(
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

    // Create case operation in destinationCaseId
    const destinationCaseOperationId =
      await this.createCaseOperationFromActivityTransfer(
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

    return;
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

  async getCaseOperationFromActivityDetail(
    operationGroupId,
    activityDetail,
    activity
  ) {
    let caseId;
    try {
      caseId = this.caseIdMap.get(activityDetail.CaseID.toString());
    } catch (error) {
      console.log({ error, activityDetail });
      // console.log({ teste });
      return;
    }

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

  async createCaseOperationInventoryEntry(
    caseOperationId,
    wineId,
    bottleFormatId,
    bottleVintageId,
    amount
  ) {
    // Check if a wine inventory entry already exists with the same properties
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
      // Entry exists, update the amount by summing
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
      // Entry doesn't exist, create a new one
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

    try {
      await this.createCaseOperationInventoryEntry(
        operationId,
        newWineId,
        newBottleFormatId,
        newBottleVintageId,
        activityDetail.Quantity
      );
    } catch (error) {
      console.log({
        error,
        operationId,
        activityDetail,
        activity,
        newWineId,
        newBottleFormatId,
        newBottleVintageId,
      });
      // console.log(teste);
      return;
    }

    return operationId;
  }

  async createOrUpdateCaseOperationFromActivityTransferActivityDetail(
    operationGroupId,
    activityDetail,
    activity
  ) {}

  async createCaseOperationsFromActivityDepositOrWithdrawal(
    operationGroupId,
    activity
  ) {
    const activityDetails = this.getInventoryActivityDetails(activity);

    if (activityDetails.length === 0) {
      console.log(
        `⚠️ No activity details found for activity ${activity.ActivityID}, skipping`
      );
      return;
    }

    for (const activitydetail of activityDetails) {
      await this.createOrUpdateCaseOperationFromActivityDepositOrWithdrawalActivityDetail(
        operationGroupId,
        activitydetail,
        activity
      );
    }

    return;
  }

  async createCaseOperationsFromActivityTransfer(operationGroupId, activity) {
    const activityDetails = this.getInventoryActivityDetails(activity);

    if (activityDetails.length === 0) {
      console.log(
        `⚠️ No activity details found for activity ${activity.ActivityID}, skipping`
      );
      return;
    }

    for (const activitydetail of activityDetails) {
      // Create case operation from activity detail
      await this.createCaseOperationFromActivityTransferActivityDetail(
        operationGroupId,
        activitydetail,
        activity
      );
    }
  }

  async getNewWineId(legacyWineId) {
    if (this.wineMapId.has(legacyWineId)) {
      return this.wineMapId.get(legacyWineId);
    }

    // Query the database using the legacy_id
    const wine = await this.dataSource.query(
      `SELECT id FROM wines WHERE legacy_id = $1 AND tenant_id = $2`,
      [legacyWineId.toString(), this.defaultTenantId]
    );

    if (wine.length === 0) {
      console.log(
        `⚠️ No wine found for wine legacy_id ${legacyWineId}, skipping`
      );
      return null;
    }

    const wineId = wine[0].id;

    // Store the wine ID mapping
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
      console.log(
        `⚠️ No bottle format found for legacy_id ${legacyBottleFormatId}, skipping`
      );
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
      console.log(
        `⚠️ No bottle vintage found for legacy_id ${legacyBottleVintageId}, skipping`
      );
      return null;
    }

    const bottleVintageId = bottleVintage[0].id;

    this.bottleVintageMapId.set(legacyBottleVintageId, bottleVintageId);

    return bottleVintageId;
  }

  async createCaseOperationInventoryEntryFromActivityDetail(
    newCaseId,
    newCaseOperationId,
    detail
  ) {
    const wineInventoryEntryId = uuidv4();

    const uniquePayloadItems = {
      tenant_id: this.defaultTenantId,
      operation_id: newCaseOperationId,
      wine_id: newWineId,
      bottle_format_id: newBottleFormatId,
      bottle_vintage_id: newBottleVintageId,
    };

    // Check if the wine inventory entry already exists (excluding operation_id since it's undefined)
    const existingWineInventoryEntry = await this.dataSource.query(
      `SELECT id FROM wine_inventory_entries 
        WHERE 
          tenant_id = $1 AND           
          wine_id = $2 AND 
          bottle_format_id = $3 AND 
          bottle_vintage_id = $4 AND
          operation_id = $5
        `,
      [
        this.defaultTenantId,
        newWineId,
        newBottleFormatId,
        newBottleVintageId,
        newCaseOperationId,
      ]
    );

    if (existingWineInventoryEntry.length > 0) {
      const existingWineInventoryEntryId = existingWineInventoryEntry[0].id;

      await this.dataSource.query(
        `UPDATE wine_inventory_entries SET amount = amount + $1, updated_at = $2 WHERE id = $3`,
        [
          detail.Quantity,
          new Date(detail.DateUpdated || Date.now()),
          existingWineInventoryEntryId,
        ]
      );
    } else {
      const payload = {
        id: wineInventoryEntryId,
        created_at: new Date(detail.DateCreated || Date.now()),
        updated_at: new Date(detail.DateUpdated || Date.now()),
        amount: detail.Quantity,
        ...uniquePayloadItems,
      };

      const columns = Object.keys(payload).join(", ");
      const placeholders = Object.keys(payload)
        .map((_, index) => `$${index + 1}`)
        .join(", ");
      const values = Object.values(payload);

      await this.dataSource.query(
        `INSERT INTO wine_inventory_entries (${columns}) VALUES (${placeholders})`,
        values
      );
    }

    return wineInventoryEntryId;
  }

  /**
   * Seed wine inventory entries from case details data
   * This function creates initial inventory entries based on case details
   */
  async seedWineInventoryEntriesFromCaseDetails() {
    console.log("🍷 Seeding wine inventory entries from case details...");

    this.customerIdMap = await this.getCustomerIdMap();
    this.caseIdMap = await this.getCaseIdMap();
    this.wineMapId = await this.getWineIdMap();
    this.bottleFormatMapId = await this.getBottleFormatIdMap();
    this.bottleVintageMapId = await this.getBottleVintageIdMap();


    if (!this.legacyData.caseDetails || this.legacyData.caseDetails.length === 0) {
      console.log("⚠️ No case details found, skipping wine inventory seeding");
      return;
    }

    // Delete all wine inventory entries related to cases
    await this.dataSource.query(`
      DELETE FROM wine_inventory_entries WHERE tenant_id = $1 AND operation_id IS NULL
    `, [this.defaultTenantId]);

    let inserted = 0;
    let skipped = 0;

    for (const caseDetail of this.legacyData.caseDetails) {
      try {
        // Skip if no wine item ID
        if (!caseDetail.legacy_wine_item_id) {
          console.log(`⚠️ No wine item ID found for case detail ${caseDetail.legacy_case_detail_id}, skipping`);
          skipped++;
          continue;
        }

        // Get the new wine ID
        const newWineId = await this.getNewWineId(caseDetail.legacy_wine_item_id);
        if (!newWineId) {
          console.log(`⚠️ No wine found for legacy_wine_item_id ${caseDetail.legacy_wine_item_id}, skipping`);
          skipped++;
          continue;
        }

        // Get the new bottle format ID
        const newBottleFormatId = await this.getNewBottleFormatId(caseDetail.legacy_bottle_size_id);
        if (!newBottleFormatId) {
          console.log(`⚠️ No bottle format found for legacy_bottle_size_id ${caseDetail.legacy_bottle_size_id}, skipping`);
          skipped++;
          continue;
        }

        // Get the new bottle vintage ID
        const newBottleVintageId = await this.getNewBottleVintageId(caseDetail.legacy_vintage_id);
        if (!newBottleVintageId) {
          console.log(`⚠️ No bottle vintage found for legacy_vintage_id ${caseDetail.legacy_vintage_id}, skipping`);
          skipped++;
          continue;
        }
        
       // Skip if caseDetail.WineQuantity is not greater than 0
       if (caseDetail.WineQuantity <= 0) {
        console.log(`⚠️ Wine quantity is not greater than 0 for case detail ${caseDetail.legacy_case_detail_id}, skipping`);
        skipped++;
        continue;
       }

       // Check if case does not exist
       if (!caseDetail.legacy_case_id) {
        console.log(`⚠️ No legacy_case_id found for case detail ${caseDetail.legacy_case_detail_id}, skipping`);
        skipped++;
        continue;
       }

       const newCaseId = this.caseIdMap.get(caseDetail.legacy_case_id.toString());
       if (!newCaseId) {
        console.log(`⚠️ Case does not exist for case detail ${caseDetail.legacy_case_detail_id}, skipping`);
        skipped++;
        continue;
       }
       

        await this.dataSource.query(
          `INSERT INTO wine_inventory_entries (
            id, tenant_id, wine_id, bottle_format_id, bottle_vintage_id, 
            amount, created_at, updated_at, case_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            uuidv4(),
            this.defaultTenantId,
            newWineId,
            newBottleFormatId,
            newBottleVintageId,
            caseDetail.WineQuantity || 0,
            new Date(caseDetail.created_at || Date.now()),
            new Date(caseDetail.updated_at || Date.now()),
            newCaseId
          ]
        );
        inserted++;        
      } catch (error) {
        console.error(`❌ Error processing case detail ${caseDetail.legacy_case_detail_id}:`, error);
        skipped++;
      }
    }
    console.log(`✅ Wine inventory entries: ${inserted} inserted, ${skipped} skipped`);
  }

  getInventoryActivityDetails(activity) {
    return this.legacyData.activityDetails.filter(
      (detail) =>
        detail.ActivityID &&
        detail.ActivityID.toString() === activity.ActivityID.toString() &&
        detail.ActivityType !== "Supply"
    );
  }

  groupBy(arr, key) {
    return arr.reduce((acc, obj) => {
      const val = obj[key] ? obj[key].toString() : "null";
      (acc[val] ||= []).push(obj);
      return acc;
    }, {});
  }

  async processOperationGroup(groupId) {
    try {
      const response = await fetch(
        `http://localhost:3000/admin/tenants/${this.defaultTenantId}/operation-groups/${groupId}/process`,
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "accept-language":
              "en-US,en;q=0.9,pt;q=0.8,la;q=0.7,fr;q=0.6,ru;q=0.5",
            authorization:
              "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxZTdlYjBiZC01ZWUwLTRjNDAtOTdlYS0wZmI5YjdmYjAwNTgiLCJpc3MiOiJhMDZmZWE2My01N2ZmLTQ0NTItOGFjNC01MzE5YTYzMTE3NWQiLCJhdWQiOiJhMDZmZWE2My01N2ZmLTQ0NTItOGFjNC01MzE5YTYzMTE3NWQiLCJlbWFpbCI6ImhpQGxpbmNvbG5sZW1vcy5jb20iLCJuYW1lIjoiTGVtb3MsIExpbmNvbG4gIiwicm9sZXMiOlsiY3VzdG9tZXIiLCJvd25lciJdLCJ0ZW5hbnRJZCI6ImEwNmZlYTYzLTU3ZmYtNDQ1Mi04YWM0LTUzMTlhNjMxMTc1ZCIsImlhdCI6MTc1NTE5NDMwMCwiZXhwIjoxNzU3Nzg2MzAwfQ.sLTAU2b7NiS06UQqyHYVcmwoOkm-MRXvwKu0OcDdhFU",
            "cache-control": "no-cache",
            pragma: "no-cache",
            "sec-ch-ua":
              '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            Referer: "http://localhost:3001/",
          },
          body: null,
          method: "PATCH",
        }
      );
    } catch (error) {
      console.log({ error });
    }
  }

  getCustomerActivities(legacyAccountId) {
    return this.legacyData.activities.filter(
      (activity) =>
        activity.AccountID &&
        activity.AccountID.toString() === legacyAccountId.toString() &&
        activity.Status === 1
    );
  }

  async processIventoryActivityDetails(activityDetails, groupId) {
    if (activityDetails.length === 0) {
      console.log("⚠️ No activity details found, skipping");
      return;
    }

    const activityDetailsByCaseId = this.groupBy(activityDetails, "CaseID");
    if (Object.keys(activityDetailsByCaseId).length === 0) {
      console.log("⚠️ No activity details by case ID found, skipping");
      return;
    }

    for (const caseId in activityDetailsByCaseId) {
      const details = activityDetailsByCaseId[caseId];

      const caseOperationId = await this.createCaseOperationFromActivity(
        groupId,
        activity,
        caseId
      );

      // Get the new UUID for this case from the mapping
      const newCaseId = this.caseIdMap.get(caseId.toString());

      if (!newCaseId) {
        console.log(
          `⚠️ No new case ID found for legacy case ${caseId}, skipping`
        );
        continue;
      }

      for (const detail of details) {
        await this.createCaseOperationInventoryEntryFromActivityDetail(
          newCaseId,
          caseOperationId,
          detail
        );
      }
    }
  }

  async getCustomerIdMap() {
    const customerIdMap = new Map();
    // Query database for all customers
    const customers = await this.dataSource.query(
      `SELECT id, legacy_user_id FROM users WHERE tenant_id = $1`,
      [this.defaultTenantId]
    );
    
    // Map legacy account id to customer id
    customers.forEach((customer) => {
      customerIdMap.set(customer.legacy_user_id, customer.id);
    });
    return customerIdMap;
  }

  async getCaseIdMap() {
    const caseIdMap = new Map();
    // Query database for all cases
    const cases = await this.dataSource.query(
      `SELECT id, legacy_id FROM cases WHERE tenant_id = $1`,
      [this.defaultTenantId]
    );
    // Map legacy case id to case id
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

  async seedOperationGroups() {
    console.log("🔄 Seeding operation groups...");
    this.customerIdMap = await this.getCustomerIdMap();
    this.caseIdMap = await this.getCaseIdMap();

    if (!this.customerIdMap || !this.legacyData.activities) {
      console.log(
        "⚠️ No customers or activities found, skipping operation groups"
      );
      return;
    }

    let inserted = 0;
    let skipped = 0;

    const filterByAccountId = null;
    // const filterByAccountId = 1084096;

    if (filterByAccountId) {
      this.customerIdMap = new Map(
        [...this.customerIdMap].filter(
          ([legacyAccountId, customerId]) => legacyAccountId == filterByAccountId
        )
      );
    }

    // Create operation groups for each customer based on their activities
    for (const [legacyAccountId, customerId] of this.customerIdMap) {
      // Get all activities for this legacy account ID
      const customerActivities = this.getCustomerActivities(legacyAccountId);
      if (customerActivities.length === 0) {
        console.log(
          `⚠️ No activities found for legacy account ${legacyAccountId}, skipping`
        );
        continue;
      }

      for (const activity of customerActivities) {
        await this.createOperationGroup(customerId, activity);
        inserted++;
      }
    }

    console.log(
      `✅ Operation groups: ${inserted} inserted, ${skipped} skipped`
    );
  }
}

async function bootstrap() {
  console.log("🚀 Starting Legacy Case Data Seeder...");

  // Parse command line arguments
  const options = parseArguments();
  const configPath = parseConfigPath();

  if (options.help) {
    showHelp();
    return;
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

    // Run the seeder with options
    const seeder = new LegacyCaseDataSeeder(dataSource);
    await seeder.seed({ clearExisting: options.clearExisting });

    console.log("🎉 Case data seeding completed successfully!");
  } catch (error) {
    console.error("❌ Case data seeding failed:", error);
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
module.exports = { LegacyCaseDataSeeder };
