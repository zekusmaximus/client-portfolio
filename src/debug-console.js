// Debug script to check for application-specific console errors
// Add this to your main.jsx temporarily to catch application errors

// Global error handler for unhandled errors
window.addEventListener('error', (event) => {
  // Filter out extension errors
  const isExtensionError = event.filename?.includes('extension://') || 
                          event.filename?.includes('background.js') ||
                          event.filename?.includes('inpage.js') ||
                          event.message?.includes('Extension') ||
                          event.message?.includes('MetaMask') ||
                          event.message?.includes('LastPass');
  
  if (!isExtensionError) {
    console.error('🚨 APPLICATION ERROR:', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error
    });
  }
});

// Global handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  const isExtensionError = event.reason?.message?.includes('Extension') ||
                          event.reason?.message?.includes('MetaMask') ||
                          event.reason?.message?.includes('LastPass');
  
  if (!isExtensionError) {
    console.error('🚨 APPLICATION PROMISE REJECTION:', event.reason);
  }
});

// Override console.error to highlight app errors
const originalConsoleError = console.error;
console.error = function(...args) {
  const message = args.join(' ');
  const isExtensionError = message.includes('Extension') ||
                          message.includes('MetaMask') ||
                          message.includes('LastPass') ||
                          message.includes('background.js') ||
                          message.includes('inpage.js');
  
  if (!isExtensionError) {
    originalConsoleError.apply(console, ['🚨 APP ERROR:', ...args]);
  } else {
    // Suppress extension errors or show them dimmed
    originalConsoleError.apply(console, ['🔕 Extension:', ...args]);
  }
};

console.log('✅ Application error debugging enabled');
