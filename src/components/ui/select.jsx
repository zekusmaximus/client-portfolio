import React from 'react';

const Select = React.forwardRef(({ children, className = '', ...props }, ref) => (
  <select ref={ref} className={`border rounded-md p-2 ${className}`} {...props}>
    {children}
  </select>
));

Select.displayName = 'Select';

export { Select };