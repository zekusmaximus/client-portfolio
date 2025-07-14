import React from 'react';
import { clsx } from 'clsx';

const RadioGroup = React.forwardRef(({ className, value, onValueChange, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={clsx('grid gap-2', className)}
      role="radiogroup"
      {...props}
    >
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            checked: child.props.value === value,
            onCheckedChange: () => onValueChange?.(child.props.value),
          });
        }
        return child;
      })}
    </div>
  );
});

RadioGroup.displayName = 'RadioGroup';

const RadioGroupItem = React.forwardRef(({ className, value, checked, onCheckedChange, disabled, children, ...props }, ref) => {
  const handleChange = () => {
    if (!disabled) {
      onCheckedChange?.(value);
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={handleChange}
        disabled={disabled}
        className={clsx(
          'aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors cursor-pointer',
          checked && 'bg-primary border-primary',
          className
        )}
        {...props}
      >
        {checked && (
          <div className="flex items-center justify-center">
            <div className="h-2.5 w-2.5 rounded-full bg-primary-foreground" />
          </div>
        )}
      </button>
      {children && (
        <label
          className={clsx(
            'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer',
            disabled && 'cursor-not-allowed opacity-70'
          )}
          onClick={handleChange}
        >
          {children}
        </label>
      )}
    </div>
  );
});

RadioGroupItem.displayName = 'RadioGroupItem';

export { RadioGroup, RadioGroupItem };