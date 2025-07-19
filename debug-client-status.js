// Debug script to check client status values
import { usePortfolioStore } from './src/portfolioStore.js';

console.log('=== CLIENT STATUS DEBUG ===');

// Get the current clients from the store
const store = usePortfolioStore.getState();
const clients = store.clients;

console.log('Total clients:', clients.length);

if (clients.length > 0) {
  console.log('\nClient Status Breakdown:');
  const statusCount = {};
  
  clients.forEach((client, index) => {
    console.log(`Client ${index + 1}: "${client.name}" - Status: "${client.status}" (type: ${typeof client.status})`);
    
    const status = client.status || 'null';
    statusCount[status] = (statusCount[status] || 0) + 1;
  });
  
  console.log('\nStatus Summary:');
  Object.entries(statusCount).forEach(([status, count]) => {
    console.log(`  ${status}: ${count} clients`);
  });
  
  console.log('\nExpected status values: Active, Prospect, Inactive, Former');
  console.log('Legacy status codes: IF (Active), P (Prospect), D (Former), H (Inactive)');
} else {
  console.log('No clients found in store');
}
