import React from 'react';
import { clsx } from 'clsx';

const RadioGroup = React.forwardRef(({ className, value, onValueChange, children, ...props }, ref) => {
  const handleValueChange = (selectedValue) => {
    onValueChange?.(selectedValue);
  };

  return (
    <div
      ref={ref}
      className={clsx('grid gap-2', className)}
      role="radiogroup"
      {...props}
    >
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          // Recursively update RadioGroupItem components within the child
          const updatedChild = React.cloneElement(child, {
            children: React.Children.map(child.props.children, (grandChild) => {
              if (React.isValidElement(grandChild) && grandChild.type === RadioGroupItem) {
                return React.cloneElement(grandChild, {
                  checked: grandChild.props.value === value,
                  onCheckedChange: handleValueChange,
                });
              }
              return grandChild;
            })
          });
          return updatedChild;
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
          'aspect-square h-4 w-4 rounded-full border-2 ring-offset-background',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors cursor-pointer',
          checked
            ? 'bg-blue-500 border-blue-500'
            : 'border-gray-300 hover:border-blue-400 bg-white',
          className
        )}
        {...props}
      >
        {checked && (
          <div className="flex items-center justify-center w-full h-full">
            <div className="h-2 w-2 rounded-full bg-white" />
          </div>
        )}
      </button>
      {children && (
        <label
          className={clsx(
            'text-sm font-medium leading-none cursor-pointer select-none',
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