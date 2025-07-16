import React from 'react';
import { clsx } from 'clsx';

const Slider = React.forwardRef(({ className, min = 0, max = 100, step = 1, value, onValueChange, ...props }, ref) => {
  const handleChange = (e) => {
    const newValue = [parseInt(e.target.value)];
    onValueChange?.(newValue);
  };

  const currentValue = Array.isArray(value) ? value[0] : value;
  const percentage = ((currentValue - min) / (max - min)) * 100;

  return (
    <div className={clsx('relative flex w-full touch-none select-none items-center', className)}>
      <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
        {/* Track fill */}
        <div
          className="absolute h-2 bg-blue-500 rounded-full transition-all duration-200"
          style={{ width: `${percentage}%` }}
        />
        {/* Slider input */}
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentValue}
          onChange={handleChange}
          className={clsx(
            'absolute inset-0 w-full h-2 cursor-pointer appearance-none bg-transparent outline-none',
            // Webkit styles for the thumb
            '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md',
            // Firefox styles for the thumb
            '[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:border-none',
            // Focus styles
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
          {...props}
        />
      </div>
    </div>
  );
});

Slider.displayName = 'Slider';

export { Slider };