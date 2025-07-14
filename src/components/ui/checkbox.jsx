import React from 'react';
import { clsx } from 'clsx';

const Checkbox = React.forwardRef(({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
  const handleChange = (e) => {
    onCheckedChange?.(e.target.checked);
  };

  return (
    <div className="relative inline-flex items-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        className={clsx(
          'peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
          'appearance-none cursor-pointer transition-colors',
          'checked:bg-primary checked:border-primary',
          className
        )}
        data-state={checked ? 'checked' : 'unchecked'}
        {...props}
      />
      {checked && (
        <svg
          className="absolute left-0.5 top-0.5 h-3 w-3 text-primary-foreground pointer-events-none"
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </div>
  );
});

Checkbox.displayName = 'Checkbox';

export { Checkbox };