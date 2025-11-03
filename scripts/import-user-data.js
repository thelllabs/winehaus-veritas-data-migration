/**
 * Legacy User Data Import Script
 * 
 * See LLM_SCRIPT_INSTRUCTIONS.md for project-wide guidelines
 * 
 * IMPORTANT: This script maps legacy data to the new UserEntity structure:
 * 
 * Expected enum values:
 * - TenantRole: ['operator', 'admin', 'owner', 'customer']
 * - TenantUserStatus: ['enabled', 'blocked']
 * - Phone.type: ['mobile', 'home', 'work', 'fax', 'other']
 * 
 * Required fields from UserEntity:
 * - id, tenant_id, email, roles, status, phones (all required)
 * - first_name, last_name, notes, legacy_user_id (nullable)
 * - password, reset_password_token, deleted_at (set to null for legacy users)
 * 
 * Required fields from AddressEntity:
 * - id, user_id, address_line_1, city, state, postal_code, country, tenant_id (all required)
 * - name, address_line_2, notes, location, deleted_at (nullable)
 * - location: GeoLocation interface { lat: number, lng: number } or null
 */

const { DataSource } = require('typeorm');
const { v4: uuidv4 } = require('uuid');
const { config } = require('dotenv');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { parsePhoneNumber, isValidPhoneNumber } = require('libphonenumber-js');
const { createDefaultTenant } = require('./utils/tenant-utils');
const { DatabaseConfig, parseConfigPath } = require('./utils/database-config');

// Load environment variables
config();


class LegacyUserDataSeeder {
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  async seed(options = {}) {
    console.log('🌱 Starting Legacy User Data Seeding...');
    
    try {
      // Load extracted data
      await this.loadExtractedData();
      
      // Create default tenant
      this.defaultTenantId = await createDefaultTenant(this.dataSource);
      
      console.log({options});
      // Clear existing data if requested
      if (options.clearExisting) {
        await this.clearExistingData();
      }
      
      // Seed data in dependency order
      await this.seedUsersByAccounts();      
      // await this.seedUsers();
      await this.seedManagers();
      await this.seedAddresses();
      
      console.log('✅ Legacy user data seeding completed successfully!');
      
    } catch (error) {
      console.error('❌ Seeding failed:', error);
      throw error;
    }
  }

  async clearExistingData() {
    console.log('🧹 Clearing existing user data for tenant...');
    
    // Clear in reverse dependency order, only for the specific tenant
    await this.dataSource.query("DELETE FROM users_notifications WHERE tenant_id = $1",[this.defaultTenantId]);
    await this.dataSource.query("DELETE FROM invoices WHERE tenant_id = $1",[this.defaultTenantId]);
    await this.dataSource.query('DELETE FROM operation_extras WHERE tenant_id = $1', [this.defaultTenantId]);
    await this.dataSource.query('DELETE FROM cases_operations WHERE tenant_id = $1', [this.defaultTenantId]);
    await this.dataSource.query('DELETE FROM operations_requests WHERE tenant_id = $1', [this.defaultTenantId]);
    await this.dataSource.query('DELETE FROM operations_groups WHERE tenant_id = $1', [this.defaultTenantId]);
    await this.dataSource.query('DELETE FROM cases WHERE tenant_id = $1', [this.defaultTenantId]);
    await this.dataSource.query('DELETE FROM addresses WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1) AND tenant_id = $1', [this.defaultTenantId]);
    await this.dataSource.query('DELETE FROM users WHERE tenant_id = $1', [this.defaultTenantId]);
    
    console.log('✅ Existing tenant user data cleared');
  }

  async loadExtractedData() {
    console.log('📂 Loading extracted user data...');
    
    const dataDir = path.join(process.cwd(), 'extracted-data');
    
    if (!fs.existsSync(dataDir)) {
      throw new Error(`Extracted data directory not found: ${dataDir}`);
    }

    this.legacyData = {
      users: this.loadJsonFile(path.join(dataDir, 'users.json')),
      accounts: this.loadJsonFile(path.join(dataDir, 'accounts.json')),
      accountPhones: this.loadJsonFile(path.join(dataDir, 'accountPhones.json')),
      addresses: this.loadJsonFile(path.join(dataDir, 'addresses.json')),
      contacts: this.loadJsonFile(path.join(dataDir, 'contacts.json')),
      contactPhones: this.loadJsonFile(path.join(dataDir, 'contactPhones.json')),
      userLogs: this.loadJsonFile(path.join(dataDir, 'userLogs.json')),
      userNameHistory: this.loadJsonFile(path.join(dataDir, 'userNameHistory.json'))
    };

    console.log(`📊 Loaded data: ${Object.entries(this.legacyData).map(([key, data]) => `${key}: ${data.length}`).join(', ')}`);
  }

  loadJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ File not found: ${filePath}`);
      return [];
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }


  async seedUsers() {
    console.log('👥 Seeding users...');
    
    let inserted = 0;
    let skipped = 0;
    
    for (const user of this.legacyData.users) {

      // Skip users without email (required field in new schema)
      if (!user.Email) {
        // console.warn(`⚠️ Skipping user ${user.legacy_user_id} - no email address`);
        continue;
      }

      const userFormattedEmail = this.formatEmail(user.Email);
      
      // Check if user already exists
      const existing = await this.dataSource.query(
        'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
        [userFormattedEmail, this.defaultTenantId]
      );
      
      if (existing.length === 0) {
        // Prepare phone data from account phones
        const userPhones = this.getUserPhones(user.legacy_user_id);
        
        // Determine user status based on legacy is_active field
        let userStatus = 'enabled'; // Default to enabled
        if (user.is_active === 'false' || user.is_active === false) {
          userStatus = 'blocked';
        }
        
        // Validate user status enum value
        if (!['enabled', 'blocked'].includes(userStatus)) {
          console.warn(`⚠️ Invalid user status for user ${user.legacy_user_id}: ${userStatus}, defaulting to 'enabled'`);
          userStatus = 'enabled';
        }
        
        // Determine user roles based on legacy role
        // Map legacy roles to TenantRole enum values: ['operator', 'admin', 'owner', 'customer']
        let userRoles = ['customer']; // Default role for all users
        if (user.Role) {
          const role = user.Role.toLowerCase().trim();
          if (role === 'staff' || role === 'staff manager') {
            userRoles = ['admin'];
          }
          // If role is 'customer' or anything else, keep default ['customer']
        }
        
        // Validate user roles enum values
        const validRoles = ['operator', 'admin', 'owner', 'customer'];
        userRoles = userRoles.filter(role => validRoles.includes(role));
        if (userRoles.length === 0) {
          console.warn(`⚠️ No valid roles found for user ${user.legacy_user_id}, defaulting to ['customer']`);
          userRoles = ['customer'];
        }
        
        // Parse and format user data
        const firstName = this.formatName(user.FirstName);
        const lastName = this.formatName(user.LastName);
        const email = this.formatEmail(user.Email);
        
        // Log formatting for debugging (only for first few users)
        if (inserted < 5) {
          console.log(`📝 Formatting user ${user.legacy_user_id}: "${user.FirstName}" → "${firstName}", "${user.LastName}" → "${lastName}", "${user.Email}" → "${email}"`);
        }
        
        // Create user with all required fields
        const userId = uuidv4();
        await this.dataSource.query(
          `INSERT INTO users (
            id, tenant_id, first_name, last_name, email, password, reset_password_token, 
            roles, status, phones, notes, legacy_user_id, created_at, updated_at, deleted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            userId,
            this.defaultTenantId,
            firstName,
            lastName,
            email,
            bcrypt.hashSync(user.Password, 10), // password - hash the legacy password
            null, // reset_password_token
            `{${userRoles.join(',')}}`, // Convert array to PostgreSQL array format
            userStatus,
            JSON.stringify(userPhones), // Store phones as JSONB
            `Legacy user: ${user.Username || 'Unknown'}. Role: ${user.Role || 'Customer'}. Last login: ${user.LastLogin || 'Never'}`,
            user.legacy_user_id.toString(), // Store legacy ID for reference
            new Date(user.created_at || Date.now()),
            new Date(user.updated_at || Date.now()),
            null // deleted_at - set to null for active users
          ]
        );
        
        // Store user ID mapping for addresses
        if (!this.userIdMap) this.userIdMap = new Map();
        this.userIdMap.set(user.legacy_user_id.toString(), userId);
        
        inserted++;
      } else {
        skipped++;
      }
    }
    
    console.log(`✅ Users: ${inserted} inserted, ${skipped} skipped`);
  }

  async seedManagers() {
    console.log('👥 Seeding users...');
    
    let inserted = 0;
    let skipped = 0;
    
    for (const user of this.legacyData.users) {      

      if (user.Role !== 'Staff Manager') {
        continue;
      }

      // Skip users without email (required field in new schema)
      if (!user.Email) {
        // console.warn(`⚠️ Skipping user ${user.legacy_user_id} - no email address`);
        continue;
      }

      const userFormattedEmail = this.formatEmail(user.Email);
      
      // Check if user already exists
      const existing = await this.dataSource.query(
        'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
        [userFormattedEmail, this.defaultTenantId]
      );
      
      if (existing.length === 0) {
        // Prepare phone data from account phones
        const userPhones = this.getUserPhones(user.legacy_user_id);
        
        // Determine user status based on legacy is_active field
        let userStatus = 'enabled'; // Default to enabled
        if (user.is_active === 'false' || user.is_active === false) {
          userStatus = 'blocked';
        }
        
        // Validate user status enum value
        if (!['enabled', 'blocked'].includes(userStatus)) {
          console.warn(`⚠️ Invalid user status for user ${user.legacy_user_id}: ${userStatus}, defaulting to 'enabled'`);
          userStatus = 'enabled';
        }
        
        // Determine user roles based on legacy role
        // Map legacy roles to TenantRole enum values: ['operator', 'admin', 'owner', 'customer']
        let userRoles = ['customer']; // Default role for all users
        if (user.Role) {
          const role = user.Role.toLowerCase().trim();
          if (role === 'staff' || role === 'staff manager') {
            userRoles = ['admin'];
          }
          // If role is 'customer' or anything else, keep default ['customer']
        }
        
        // Validate user roles enum values
        const validRoles = ['operator', 'admin', 'owner', 'customer'];
        userRoles = userRoles.filter(role => validRoles.includes(role));
        if (userRoles.length === 0) {
          console.warn(`⚠️ No valid roles found for user ${user.legacy_user_id}, defaulting to ['customer']`);
          userRoles = ['customer'];
        }
        
        // Parse and format user data
        const firstName = this.formatName(user.FirstName);
        const lastName = this.formatName(user.LastName);
        const email = this.formatEmail(user.Email);
        
        // Log formatting for debugging (only for first few users)
        if (inserted < 5) {
          console.log(`📝 Formatting user ${user.legacy_user_id}: "${user.FirstName}" → "${firstName}", "${user.LastName}" → "${lastName}", "${user.Email}" → "${email}"`);
        }
        
        // Create user with all required fields
        const userId = uuidv4();
        await this.dataSource.query(
          `INSERT INTO users (
            id, tenant_id, first_name, last_name, email, password, reset_password_token, 
            roles, status, phones, notes, legacy_user_id, created_at, updated_at, deleted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            userId,
            this.defaultTenantId,
            firstName,
            lastName,
            email,
            bcrypt.hashSync(user.Password, 10), // password - hash the legacy password
            null, // reset_password_token
            `{${userRoles.join(',')}}`, // Convert array to PostgreSQL array format
            userStatus,
            JSON.stringify(userPhones), // Store phones as JSONB
            `Legacy user: ${user.Username || 'Unknown'}. Role: ${user.Role || 'Customer'}. Last login: ${user.LastLogin || 'Never'}`,
            user.legacy_user_id.toString(), // Store legacy ID for reference
            new Date(user.created_at || Date.now()),
            new Date(user.updated_at || Date.now()),
            null // deleted_at - set to null for active users
          ]
        );
        
        // Store user ID mapping for addresses
        if (!this.userIdMap) this.userIdMap = new Map();
        this.userIdMap.set(user.legacy_user_id.toString(), userId);
        
        inserted++;
      } else {
        skipped++;
      }
    }
    
    console.log(`✅ Users: ${inserted} inserted, ${skipped} skipped`);
  }

  async seedUsersByAccounts() {
    console.log('👥 Seeding users by accounts...');
    
    let inserted = 0;
    let skipped = 0;
    
    for (const account of this.legacyData.accounts) {

      if (account.is_active === 'false') {
        // console.warn(`⚠️ Skipping account ${account.FirstName} ${account.LastName} - account is inactive`);
        continue;
      }

      // Find associated user data for this account
      const user = this.legacyData.users.find(
        u => u.legacy_user_id === account.legacy_user_id && u.is_active === 'true'
      );
      
      const getFirstName = account.FirstName || user.FirstName;
      const getLastName = account.LastName || user.LastName;
      const getEmail = account.Email || user.Email || `temp-${account.legacy_account_id}@veritaswinestorage.com`;

      // Parse and format user data
      const firstName = this.formatName(getFirstName);
      const lastName = this.formatName(getLastName);
      const email = this.formatEmail(getEmail);

      // Check if user already exists
      const existing = await this.dataSource.query(
        'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
        [email, this.defaultTenantId]
      );
      
      if (existing.length === 0) {
        // Prepare phone data from account phones
        const userPhones = this.getUserPhonesByAccount(account.legacy_account_id);
        
        // Determine user status based on legacy is_active field
        let userStatus = 'enabled'; // Default to enabled
        if (user.is_active === 'false' || user.is_active === false) {
          userStatus = 'blocked';
        }        
        
        // Determine user roles based on legacy role
        // Map legacy roles to TenantRole enum values: ['operator', 'admin', 'owner', 'customer']
        let userRoles = ['customer']; // Default role for all users
        if (user.Role) {
          const role = user.Role.toLowerCase().trim();
          if (role === 'staff' || role === 'staff manager') {
            userRoles = ['admin'];
          }
          // If role is 'customer' or anything else, keep default ['customer']
        }
        
        // Create user with all required fields
        const userId = uuidv4();
        await this.dataSource.query(
          `INSERT INTO users (
            id, tenant_id, first_name, last_name, email, password, reset_password_token, 
            roles, status, phones, notes, legacy_user_id, created_at, updated_at, deleted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            userId,
            this.defaultTenantId,
            firstName,
            lastName,
            email,
            bcrypt.hashSync(user.Password, 10), // password - set to null for legacy users (they'll need to reset)
            null, // reset_password_token
            `{${userRoles.join(',')}}`, // Convert array to PostgreSQL array format
            userStatus,
            JSON.stringify(userPhones), // Store phones as JSONB
            account.Notes,
            account.legacy_account_id.toString(), // Store legacy ID for reference
            new Date(account.created_at || Date.now()),
            new Date(account.updated_at || Date.now()),
            null // deleted_at - set to null for active users
          ]
        );
        
        // Store user ID mapping for addresses
        if (!this.userIdMap) this.userIdMap = new Map();
        this.userIdMap.set(user.legacy_user_id.toString(), userId);
        
        inserted++;
      } else {
        console.log(`⚠️ User ${getEmail} already exists`);
        skipped++;
      }
    }
    
    console.log(`✅ Users by accounts: ${inserted} inserted, ${skipped} skipped`);
  }

  getUserPhones(legacyUserId) {
    const phones = [];
    
    // Get account phones for this user
    const accountPhones = this.legacyData.accountPhones.filter(
      phone => {
        const account = this.legacyData.accounts.find(
          acc => acc.legacy_user_id === legacyUserId
        );
        return account && phone.legacy_account_id === account.legacy_account_id;
      }
    );
    
    // Get contact phones for this user
    const contactPhones = this.legacyData.contactPhones.filter(
      phone => {
        const contact = this.legacyData.contacts.find(
          cont => {
            const account = this.legacyData.accounts.find(
              acc => acc.legacy_user_id === legacyUserId
            );
            return account && cont.legacy_account_id === account.legacy_account_id;
          }
        );
        return contact && phone.legacy_contact_id === contact.legacy_contact_id;
      }
    );
    
    // Combine and format phones according to NestJS interface: { type: PhoneType, number: string }
    // Only add valid phone numbers
    [...accountPhones, ...contactPhones].forEach(phone => {
      if (phone.PhoneNumber) {
        const parsedNumber = this.parsePhoneNumber(phone.PhoneNumber);
        
        // Only add the phone if it's valid (parsePhoneNumber returns null for invalid numbers)
        if (parsedNumber) {
          const phoneType = this.mapPhoneLabelToType(phone.PhoneLabel);
          phones.push({
            type: this.validatePhoneType(phoneType),
            number: parsedNumber
          });
        } else {
          // Log invalid phone numbers for debugging (optional)
          console.warn(`⚠️ Skipping invalid phone number for user ${legacyUserId}: "${phone.PhoneNumber}" (${phone.PhoneLabel || 'unknown'})`);
        }
      }
    });
    
    return phones;
  }

  getUserPhonesByAccount(legacyAccountId) {
    const phones = [];
    
    // Get account phones for this account
    const accountPhones = this.legacyData.accountPhones.filter(
      phone => phone.legacy_account_id === legacyAccountId
    );
    
    // Get contact phones for this account
    const contactPhones = this.legacyData.contactPhones.filter(
      phone => {
        const contact = this.legacyData.contacts.find(
          cont => cont.legacy_account_id === legacyAccountId
        );
        return contact && phone.legacy_contact_id === contact.legacy_contact_id;
      }
    );
    
    // Combine and format phones according to NestJS interface: { type: PhoneType, number: string }
    // Only add valid phone numbers
    [...accountPhones, ...contactPhones].forEach(phone => {
      if (phone.PhoneNumber) {
        const parsedNumber = this.parsePhoneNumber(phone.PhoneNumber);
        
        // Only add the phone if it's valid (parsePhoneNumber returns null for invalid numbers)
        if (parsedNumber) {
          const phoneType = this.mapPhoneLabelToType(phone.PhoneLabel);
          phones.push({
            type: this.validatePhoneType(phoneType),
            number: parsedNumber
          });
        } else {
          // Log invalid phone numbers for debugging (optional)
          // console.warn(`⚠️ Skipping invalid phone number for account ${legacyAccountId}: "${phone.PhoneNumber}" (${phone.PhoneLabel || 'unknown'})`);
        }
      }
    });
    
    return phones;
  }

  parsePhoneNumber(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return null;
    }

    // Clean the input by removing common formatting characters but keep + for international
    const cleanedNumber = phoneNumber.trim();
    
    if (!cleanedNumber) {
      return null;
    }

    try {
      // Extract only digits for pattern matching
      const digitsOnly = cleanedNumber.replace(/[^\d]/g, '');
      
      // First, try to parse as US number (with various formats)
      let usNumber = cleanedNumber;
      
      // If it looks like a US number without country code (10 digits starting with 2-9)
      if (/^[2-9]\d{9}$/.test(digitsOnly)) {
        usNumber = '+1' + digitsOnly;
      } 
      // If it looks like a US number with country code (11 digits starting with 1)
      else if (/^1[2-9]\d{9}$/.test(digitsOnly)) {
        usNumber = '+' + digitsOnly;
      }
      
      if (isValidPhoneNumber(usNumber, 'US')) {
        const parsed = parsePhoneNumber(usNumber, 'US');
        return parsed.number; // Return full international format
      }

      // If US parsing fails, try international parsing
      if (isValidPhoneNumber(cleanedNumber)) {
        const parsed = parsePhoneNumber(cleanedNumber);
        return parsed.number; // Return full international format
      }

      // If both fail, return null
      return null;
    } catch (error) {
      // If parsing throws an error, return null
      return null;
    }
  }

  // Map legacy PhoneLabel to PhoneType enum values
  mapPhoneLabelToType(phoneLabel) {
    if (!phoneLabel) return 'mobile'; // Default fallback
    
    const label = phoneLabel.toLowerCase().trim();
    
    // Map common phone label patterns to PhoneType enum values
    // These should match your Phone interface enum values
    switch (label) {
      case 'mobile':
      case 'cell':
      case 'cellular':
        return 'mobile';
      case 'home':
      case 'residence':
        return 'home';
      case 'work':
      case 'office':
      case 'business':
        return 'work';
      case 'fax':
        return 'fax';
      case 'other':
      case 'alternate':
      case 'alt':
        return 'other';
      default:
        // For unknown labels, try to infer from the label content
        if (label.includes('mobile') || label.includes('cell')) return 'mobile';
        if (label.includes('home') || label.includes('res')) return 'home';
        if (label.includes('work') || label.includes('office') || label.includes('bus')) return 'work';
        if (label.includes('fax')) return 'fax';
        // Default to mobile for unknown types
        return 'mobile';
    }
  }
  
  // Validate phone type enum values
  validatePhoneType(phoneType) {
    const validTypes = ['mobile', 'home', 'work', 'fax', 'other'];
    if (!validTypes.includes(phoneType)) {
      console.warn(`⚠️ Invalid phone type: ${phoneType}, defaulting to 'mobile'`);
      return 'mobile';
    }
    return phoneType;
  }
  
  // Format name to proper case (capitalize first letter, lowercase rest)
  formatName(name) {
    if (!name || typeof name !== 'string') {
      return null;
    }
    
    // Trim whitespace and convert to proper case
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return null;
    }
    
    // Capitalize first letter, lowercase the rest
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }
  
  // Format email to lowercase
  formatEmail(email) {
    if (!email || typeof email !== 'string') {
      return null;
    }
    
    // Trim whitespace and convert to lowercase
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      return null;
    }
    
    return trimmed.toLowerCase();
  }
  
  // Location field - set to null since legacy system has no coordinates
  formatLocation(address) {
    // Legacy system doesn't have coordinates, so always return null
    // You can implement geocoding later if needed to get lat/lng from address
    return null;
  }

  async seedAddresses() {
    console.log('🏠 Seeding addresses...');
    
    if (!this.userIdMap) {
      // console.log('⚠️ No users found, skipping addresses');
      return;
    }
    
    let inserted = 0;
    let skipped = 0;
    
    for (const address of this.legacyData.addresses) {
      // Find the user ID for this address
      const account = this.legacyData.accounts.find(
        acc => acc.legacy_account_id === address.legacy_account_id
      );
      
      if (!account) {
        console.warn(`⚠️ Skipping address ${address.legacy_address_id} - no account found`);
        continue;
      }
      
      const userId = this.userIdMap.get(account.legacy_user_id.toString());
      if (!userId) {
        console.warn(`⚠️ Skipping address ${address.legacy_address_id} - no user found`);
        continue;
      }
      
      // Check if address already exists
      const existing = await this.dataSource.query(
        'SELECT id FROM addresses WHERE user_id = $1 AND address_line_1 = $2 AND city = $3',
        [userId, address.AddressLine1, address.City]
      );
      
      if (existing.length === 0) {
        // Determine address name
        let addressName = address.AddressName;
        if (!addressName) {
          if (address.preferred_shipping === 'true') {
            addressName = 'Shipping Address';
          } else if (address.preferred_billing === 'true') {
            addressName = 'Billing Address';
          } else {
            addressName = 'Address';
          }
        }
        
        // Validate required fields
        if (!address.AddressLine1 || !address.City || !address.State || !address.ZipCode) {
          // console.warn(`⚠️ Skipping address ${address.legacy_address_id} - missing required fields`);
          continue;
        }
        
        // Create address with all required fields in correct order
        await this.dataSource.query(
          `INSERT INTO addresses (
            id, created_at, updated_at, deleted_at, user_id, name, address_line_1, 
            address_line_2, city, state, postal_code, country, notes, location, tenant_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            uuidv4(),
            new Date(),
            new Date(),
            null, // deleted_at - set to null for active addresses
            userId,
            addressName,
            address.AddressLine1 || null,
            address.AddressLine2 || null,
            address.City,
            address.State,
            address.ZipCode,
            'US', // Default country - you might want to extract this from legacy data
            `Legacy address type: ${address.AddressType || 'Unknown'}`,
            this.formatLocation(address), // Handle GeoLocation interface
            this.defaultTenantId
          ]
        );
        
        inserted++;
      } else {
        skipped++;
      }
    }
    
    console.log(`✅ Addresses: ${inserted} inserted, ${skipped} skipped`);
  }
}

async function bootstrap() {
  console.log('🚀 Starting Legacy User Data Seeder...');
  
  // Parse command line arguments
  const clearExisting = process.argv.includes('--clear-existing');
  const configPath = parseConfigPath();
  
  if (clearExisting) {
    console.log('🧹 Clear existing data mode enabled');
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

    // Run the seeder with options
    const seeder = new LegacyUserDataSeeder(dataSource);
    await seeder.seed({ clearExisting });

    console.log('🎉 User data seeding completed successfully!');
    
  } catch (error) {
    console.error('❌ User data seeding failed:', error);
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
