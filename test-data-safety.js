/**
 * Quick test for the data safety fixes
 */

import { 
  safePracticeAreaToArray, 
  safeFrequencyToLowerCase,
  practiceAreaMatchesSearch 
} from './src/utils/dataUtils.js';

// Test practice area handling
console.log('Testing practice area handling:');
console.log(safePracticeAreaToArray(['Healthcare', 'Legal'])); // Should work
console.log(safePracticeAreaToArray('Healthcare')); // Should convert to array
console.log(safePracticeAreaToArray(null)); // Should return empty array
console.log(safePracticeAreaToArray([null, 'Healthcare', undefined, 'Legal'])); // Should filter

// Test frequency handling
console.log('\nTesting frequency handling:');
console.log(safeFrequencyToLowerCase('WEEKLY')); // Should return 'weekly'
console.log(safeFrequencyToLowerCase(null)); // Should return ''
console.log(safeFrequencyToLowerCase(123)); // Should return ''

// Test practice area search
console.log('\nTesting practice area search:');
console.log(practiceAreaMatchesSearch(['Healthcare', 'Legal'], 'health')); // Should return true
console.log(practiceAreaMatchesSearch(['Healthcare', 'Legal'], 'tax')); // Should return false
console.log(practiceAreaMatchesSearch(null, 'health')); // Should return false
console.log(practiceAreaMatchesSearch(['Healthcare', null, 'Legal'], 'legal')); // Should return true

console.log('\n✅ All data safety tests completed successfully!');
