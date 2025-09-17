/**
 * Tenant Utilities
 * 
 * Shared utilities for managing tenant operations across import scripts.
 * This module provides reusable functions for tenant creation and management
 * to avoid code duplication.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Creates or retrieves the default tenant for the migration
 * @param {DataSource} dataSource - TypeORM DataSource instance
 * @param {string} tenantName - Name of the tenant (default: 'Veritas')
 * @param {string} documentNumber - Document number for the tenant (default: 'VERITAS-001')
 * @returns {Promise<string>} The tenant ID
 */
async function createDefaultTenant(dataSource, tenantName = 'Veritas002', documentNumber = 'VERITAS-002') {
  console.log(`🏢 Creating/retrieving default tenant: ${tenantName}...`);

  try {
    // Check if default tenant exists
    const existingTenant = await dataSource.query(
      'SELECT id FROM tenants WHERE name = $1',
      [tenantName]
    );

    if (existingTenant.length === 0) {
      const tenantId = uuidv4();
      await dataSource.query(
        'INSERT INTO tenants (id, name, document_number, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
        [tenantId, tenantName, documentNumber, new Date(), new Date()]
      );
      console.log(`✅ Created default tenant: ${tenantName} (${tenantId})`);
      return tenantId;
    } else {
      const tenantId = existingTenant[0].id;
      console.log(`✅ Using existing default tenant: ${tenantName} (${tenantId})`);
      return tenantId;
    }
  } catch (error) {
    console.error(`❌ Failed to create/retrieve tenant ${tenantName}:`, error);
    throw error;
  }
}

/**
 * Gets a tenant ID by name
 * @param {DataSource} dataSource - TypeORM DataSource instance
 * @param {string} tenantName - Name of the tenant to find
 * @returns {Promise<string|null>} The tenant ID or null if not found
 */
async function getTenantByName(dataSource, tenantName) {
  try {
    const tenant = await dataSource.query(
      'SELECT id FROM tenants WHERE name = $1',
      [tenantName]
    );
    
    return tenant.length > 0 ? tenant[0].id : null;
  } catch (error) {
    console.error(`❌ Failed to get tenant ${tenantName}:`, error);
    throw error;
  }
}

/**
 * Lists all tenants in the system
 * @param {DataSource} dataSource - TypeORM DataSource instance
 * @returns {Promise<Array>} Array of tenant objects with id, name, and document_number
 */
async function listTenants(dataSource) {
  try {
    const tenants = await dataSource.query(
      'SELECT id, name, document_number, created_at FROM tenants ORDER BY created_at ASC'
    );
    
    return tenants;
  } catch (error) {
    console.error('❌ Failed to list tenants:', error);
    throw error;
  }
}

module.exports = {
  createDefaultTenant,
  getTenantByName,
  listTenants
};
