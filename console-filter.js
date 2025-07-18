// Console Filter - Add this to your browser's console to filter out extension errors
// Copy and paste this into your browser console:

(function() {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  const extensionKeywords = [
    'Extension',
    'MetaMask',
    'LastPass',
    'background.js',
    'inpage.js',
    'chrome-extension://',
    'Cannot access contents of the page',
    'FrameDoesNotExistError',
    'runtime.lastError',
    'duplicate id'
  ];
  
  function isExtensionError(message) {
    const msgStr = String(message);
    return extensionKeywords.some(keyword => msgStr.includes(keyword));
  }
  
  console.error = function(...args) {
    if (!isExtensionError(args[0])) {
      originalConsoleError.apply(console, ['🚨 APP ERROR:', ...args]);
    }
  };
  
  console.warn = function(...args) {
    if (!isExtensionError(args[0])) {
      originalConsoleWarn.apply(console, ['⚠️ APP WARNING:', ...args]);
    }
  };
  
  console.log('%c✅ Console filtering enabled - Extension errors hidden', 'color: green; font-weight: bold');
})();
