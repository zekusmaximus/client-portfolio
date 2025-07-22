import React from 'react';

const TooltipProvider = ({ children }) => {
  return <div className="tooltip-provider">{children}</div>;
};

const Tooltip = ({ children }) => {
  return <div className="group relative inline-block">{children}</div>;
};

const TooltipTrigger = ({ children, asChild, ...props }) => {
  return <div {...props}>{children}</div>;
};

const TooltipContent = ({ children, className = '', ...props }) => {
  const baseClasses = "absolute z-50 w-64 rounded-md border bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 shadow-lg border-gray-200 dark:border-gray-700 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 bottom-full left-1/2 transform -translate-x-1/2 mb-2 pointer-events-none";
  
  return (
    <div 
      className={`${baseClasses} ${className}`}
      {...props}
    >
      {children}
      {/* Arrow */}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white dark:border-t-gray-800"></div>
    </div>
  );
};

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };