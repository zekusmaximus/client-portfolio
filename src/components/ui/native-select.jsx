import React from 'react';
import { clsx } from 'clsx';

// A plain <select> styled like Input. Unlike ./select.jsx, which shows the raw
// value in its trigger, the browser shows the chosen option's label, so the
// value can be an id.
const NativeSelect = React.forwardRef(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={clsx(
      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
  </select>
));

NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
