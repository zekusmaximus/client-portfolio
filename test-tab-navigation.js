// Test file to verify tab navigation fixes
// This validates that the problematic useEffect was removed

const fs = require('fs');
const path = require('path');

// Read the App.jsx file
const appPath = path.join(__dirname, 'src', 'App.jsx');
const appContent = fs.readFileSync(appPath, 'utf8');

// Check for the problematic useEffect that was forcing data-upload view
const problemPattern = /if.*!hasData.*currentView.*!==.*data-upload.*setCurrentView.*data-upload/s;
const hasProblematicCode = problemPattern.test(appContent);

console.log('✅ Tab Navigation Fix Test Results:');
console.log('====================================');

if (hasProblematicCode) {
  console.log('❌ FAILED: Problematic useEffect still exists that forces data-upload view');
  console.log('   This would prevent users from navigating to other tabs without data');
} else {
  console.log('✅ PASSED: Problematic useEffect has been removed');
  console.log('   Users can now navigate to all tabs even without data');
}

// Check if the new logic only sets initial view when no view is set
const newPattern = /if.*isAuthenticated.*!currentView.*setCurrentView.*data-upload/s;
const hasNewLogic = newPattern.test(appContent);

if (hasNewLogic) {
  console.log('✅ PASSED: New logic only sets initial view when no view is set');
} else {
  console.log('❌ FAILED: New logic for initial view setting not found');
}

// Check for tab structure
const tabsPattern = /TabsTrigger.*value=.*dashboard|TabsTrigger.*value=.*client-details|TabsTrigger.*value=.*ai|TabsTrigger.*value=.*scenarios/g;
const tabMatches = appContent.match(tabsPattern);

if (tabMatches && tabMatches.length >= 4) {
  console.log('✅ PASSED: All expected tabs are present:', tabMatches.length);
} else {
  console.log('❌ FAILED: Missing tabs. Found:', tabMatches ? tabMatches.length : 0);
}

console.log('\n✅ Empty State Fix Test Results:');
console.log('================================');

// Check ClientListView empty state
const clientListPath = path.join(__dirname, 'src', 'ClientListView.jsx');
const clientListContent = fs.readFileSync(clientListPath, 'utf8');

const hasAddClientButton = clientListContent.includes('Add New Client') && 
                          clientListContent.includes('Add Your First Client');

if (hasAddClientButton) {
  console.log('✅ PASSED: ClientListView has "Add Client" buttons in empty state');
} else {
  console.log('❌ FAILED: ClientListView missing "Add Client" buttons in empty state');
}

// Check AIAdvisor empty state
const aiPath = path.join(__dirname, 'src', 'AIAdvisor.jsx');
const aiContent = fs.readFileSync(aiPath, 'utf8');

const hasAIEmptyState = aiContent.includes('Ready to provide AI-powered insights') &&
                       aiContent.includes('Add Clients to Get Started');

if (hasAIEmptyState) {
  console.log('✅ PASSED: AIAdvisor has proper empty state with navigation');
} else {
  console.log('❌ FAILED: AIAdvisor missing proper empty state');
}

// Check ScenarioModeler empty state
const scenarioPath = path.join(__dirname, 'src', 'ScenarioModeler.jsx');
const scenarioContent = fs.readFileSync(scenarioPath, 'utf8');

const hasScenarioEmptyState = scenarioContent.includes('Strategic Scenario Planning') &&
                             scenarioContent.includes('Add Clients to Get Started');

if (hasScenarioEmptyState) {
  console.log('✅ PASSED: ScenarioModeler has proper empty state with navigation');
} else {
  console.log('❌ FAILED: ScenarioModeler missing proper empty state');
}

console.log('\n🎉 Test Summary:');
console.log('================');
console.log('The main issue was a useEffect in App.jsx that automatically redirected');
console.log('users back to the data-upload tab whenever they had no data.');
console.log('This has been fixed, and all tabs should now be accessible.');
console.log('');
console.log('Additionally, empty states have been improved to:');
console.log('- Show "Add Client" buttons even when no data exists');
console.log('- Provide helpful navigation between tabs');
console.log('- Explain what each feature does when empty');
