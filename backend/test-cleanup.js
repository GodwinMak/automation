#!/usr/bin/env node

/**
 * Test script to run the cleanupStaleCustomers function
 */

const cleanupModule = require('./cron/cleanupStaleCustomers')(null); // Pass null for io since we don't need socket notifications for testing

console.log('🧪 Starting cleanup test...');

cleanupModule.cleanupStaleCustomers()
  .then(() => {
    console.log('✅ Cleanup test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Cleanup test failed:', error.message);
    process.exit(1);
  });