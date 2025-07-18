// Test HTML entity decoding
function decodeHTMLEntities(text) {
  if (!text || typeof text !== 'string') return text;
  
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-fA-F0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Test cases from the error
const testCases = [
  "AT&amp;T",
  "Boy&#x27;s Village",
  "CT Institute&#x2F;Comm",
  "Gov&#x27;s Partnership",
  "Procter &amp; Gamble",
  "McDonald&#x27;s"
];

console.log('Testing HTML entity decoding:');
testCases.forEach(test => {
  const decoded = decodeHTMLEntities(test);
  console.log(`"${test}" -> "${decoded}"`);
  
  // Test against regex pattern
  const isValid = /^[a-zA-Z0-9\s\-\.,&'()\/]+$/.test(decoded);
  console.log(`  Valid: ${isValid}`);
});

// Test the specific pattern from the error
const pattern = /^[a-zA-Z0-9\s\-\.,&'()\/]+$/;
const testString = "AT&T";
console.log(`\nPattern test: "${testString}" matches: ${pattern.test(testString)}`);
