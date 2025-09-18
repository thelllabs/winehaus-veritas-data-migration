#!/usr/bin/env node

/**
 * Database Connection Test Script
 *
 * This script tests database connections to help diagnose connectivity issues.
 *
 * Usage:
 *   node scripts/test-connection.js [config-file]
 *   node scripts/test-connection.js database-import.local.config.json
 *   node scripts/test-connection.js database-import.config.json
 */

const { DataSource } = require('typeorm');
const { config } = require('dotenv');
const { DatabaseConfig } = require('./utils/database-config');
const fs = require('fs');
const path = require('path');

// Load environment variables
config();

function parseArguments() {
  const args = process.argv.slice(2);
  return {
    configFile: args[0] || 'database-import.config.json'
  };
}

async function testConnection(configPath) {
  console.log(`🔍 Testing connection with config: ${configPath}`);
  
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    return false;
  }

  let dataSource = null;
  
  try {
    // Load and validate config
    console.log('📋 Loading database configuration...');
    const dbConfig = new DatabaseConfig(configPath);
    dbConfig.validate();
    
    const connectionConfig = dbConfig.getConnectionConfig();
    console.log('🔧 Connection details:');
    console.log(`   Host: ${connectionConfig.host}`);
    console.log(`   Port: ${connectionConfig.port}`);
    console.log(`   Database: ${connectionConfig.database}`);
    console.log(`   Username: ${connectionConfig.username}`);
    console.log(`   SSL: ${connectionConfig.ssl ? 'enabled' : 'disabled'}`);
    
    // Create connection
    console.log('\n🔌 Creating database connection...');
    dataSource = new DataSource(connectionConfig);
    
    // Test connection with timeout
    console.log('⏳ Attempting to connect (30s timeout)...');
    const connectionPromise = dataSource.initialize();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000);
    });
    
    await Promise.race([connectionPromise, timeoutPromise]);
    
    console.log('✅ Database connection successful!');
    
    // Test a simple query
    console.log('🔍 Testing simple query...');
    const result = await dataSource.query('SELECT NOW() as current_time');
    console.log(`📅 Database time: ${result[0].current_time}`);
    
    // Test tenant-related tables
    console.log('🏢 Checking for tenants table...');
    try {
      const tenants = await dataSource.query('SELECT COUNT(*) as count FROM tenants');
      console.log(`📊 Tenants table found with ${tenants[0].count} records`);
    } catch (error) {
      console.log(`⚠️ Tenants table issue: ${error.message}`);
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Connection failed:');
    console.error(`   Error: ${error.message}`);
    console.error(`   Code: ${error.code || 'N/A'}`);
    console.error(`   Details: ${error.errno || 'N/A'}`);
    
    // Provide specific guidance based on error type
    if (error.code === 'ETIMEDOUT') {
      console.log('\n💡 Connection timeout suggestions:');
      console.log('   - Check if you need to be connected to a VPN');
      console.log('   - Verify the database server is running');
      console.log('   - Check firewall rules and IP whitelisting');
      console.log('   - Try connecting from a different network');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Connection refused suggestions:');
      console.log('   - Database service might be down');
      console.log('   - Check if the port is correct');
      console.log('   - Verify the host/IP address');
    } else if (error.code === 'ENOTFOUND') {
      console.log('\n💡 Host not found suggestions:');
      console.log('   - Check the hostname/IP address');
      console.log('   - Verify DNS resolution');
      console.log('   - Check internet connectivity');
    } else if (error.message.includes('authentication')) {
      console.log('\n💡 Authentication suggestions:');
      console.log('   - Verify username and password');
      console.log('   - Check if the user has database access');
      console.log('   - Confirm SSL settings match server requirements');
    }
    
    return false;
    
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('🔌 Connection closed');
    }
  }
}

async function testAllConfigs() {
  console.log('🚀 Database Connection Tester\n');
  
  const configs = [
    'database-import.local.config.json',
    'database-import.config.json',
    'database-import.prod.config.json'
  ];
  
  const results = {};
  
  for (const configFile of configs) {
    const configPath = path.join(process.cwd(), configFile);
    if (fs.existsSync(configPath)) {
      console.log(`\n${'='.repeat(60)}`);
      const success = await testConnection(configPath);
      results[configFile] = success;
      console.log(`${'='.repeat(60)}\n`);
    } else {
      console.log(`⏭️ Skipping ${configFile} (not found)`);
      results[configFile] = null;
    }
  }
  
  // Summary
  console.log('\n📊 CONNECTION TEST SUMMARY:');
  console.log('━'.repeat(40));
  for (const [config, result] of Object.entries(results)) {
    if (result === null) {
      console.log(`⏭️ ${config}: Not found`);
    } else if (result) {
      console.log(`✅ ${config}: SUCCESS`);
    } else {
      console.log(`❌ ${config}: FAILED`);
    }
  }
  
  const successfulConnections = Object.values(results).filter(r => r === true).length;
  console.log(`\n🎯 ${successfulConnections} out of ${Object.keys(results).length} connections successful`);
}

async function main() {
  const options = parseArguments();
  
  if (options.configFile === 'all' || process.argv.includes('--all')) {
    await testAllConfigs();
  } else {
    const configPath = path.join(process.cwd(), options.configFile);
    await testConnection(configPath);
  }
}

main().catch(error => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
