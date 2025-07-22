import * as React from "react";

const Progress = React.forwardRef(({ className, value, variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    className={`relative h-2 w-full overflow-hidden rounded-full bg-secondary ${className || ""}`}
    {...props}
  >
    <div
      className={`h-full w-full flex-1 transition-all ${
        variant === "destructive" 
          ? "bg-red-500" 
          : "bg-primary"
      }`}
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </div>
));
Progress.displayName = "Progress";

export { Progress };