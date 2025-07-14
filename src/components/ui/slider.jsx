import React from 'react';
import { clsx } from 'clsx';

const Slider = React.forwardRef(({ className, min = 0, max = 100, step = 1, value, onValueChange, ...props }, ref) => {
  const handleChange = (e) => {
    const newValue = [parseInt(e.target.value)];
    onValueChange?.(newValue);
  };

  return (
    <div className={clsx('relative flex w-full touch-none select-none items-center', className)}>
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Array.isArray(value) ? value[0] : value}
        onChange={handleChange}
        className={clsx(
          'relative h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary outline-none',
          'slider-thumb:appearance-none slider-thumb:h-5 slider-thumb:w-5 slider-thumb:rounded-full slider-thumb:bg-primary slider-thumb:cursor-pointer slider-thumb:border-2 slider-thumb:border-primary slider-thumb:transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:transition-colors',
          '[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:transition-colors'
        )}
        {...props}
      />
    </div>
  );
});

Slider.displayName = 'Slider';

export { Slider };