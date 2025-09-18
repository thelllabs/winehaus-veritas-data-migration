#!/usr/bin/env node

/**
 * Get Current IP Script
 * 
 * This script gets your current public IP address for adding to DigitalOcean trusted sources.
 */

const https = require('https');

function getCurrentIP() {
  return new Promise((resolve, reject) => {
    const req = https.get('https://checkip.amazonaws.com', (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve(data.trim());
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function main() {
  try {
    console.log('🌐 Getting your current public IP address...');
    const ip = await getCurrentIP();
    
    console.log('\n📍 Your Current Public IP:');
    console.log(`   ${ip}`);
    console.log('\n📋 For DigitalOcean Trusted Sources, add:');
    console.log(`   ${ip}/32`);
    console.log('\n🔗 DigitalOcean Database Settings:');
    console.log('   https://cloud.digitalocean.com/databases');
    console.log('   → Select your database → Settings → Trusted Sources → Edit');
    
  } catch (error) {
    console.error('❌ Failed to get IP:', error.message);
    console.log('\n💡 Manual alternatives:');
    console.log('   - Visit: https://www.whatismyip.com/');
    console.log('   - Or run: curl -s http://checkip.amazonaws.com');
  }
}

main();
