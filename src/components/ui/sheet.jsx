import * as React from "react";
import { X } from "lucide-react";

const Sheet = ({ open, onOpenChange, children }) => {
  if (!open) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onOpenChange(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-end z-50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      {children}
    </div>
  );
};

const SheetContent = ({ className, children }) => (
  <div className={`bg-white h-full overflow-y-auto shadow-2xl ${className || ""}`}>
    {children}
  </div>
);

const SheetHeader = ({ children }) => (
  <div className="p-6 border-b border-gray-200">
    {children}
  </div>
);

const SheetTitle = ({ children }) => (
  <h2 className="text-lg font-semibold text-gray-900">
    {children}
  </h2>
);

const SheetClose = ({ onClick }) => (
  <button 
    onClick={onClick}
    className="absolute top-4 right-4 p-2 text-gray-500 hover:text-gray-700"
  >
    <X className="h-4 w-4" />
  </button>
);

export { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose };