import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, TrendingUp, Calculator, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingCardProps {
  stage: 'calculating' | 'generating-insights';
  className?: string;
}

export function LoadingCard({ stage, className }: LoadingCardProps) {
  return (
    <Card className={cn("animate-pulse border-blue-200", className)}>
      <CardContent className="flex flex-col items-center justify-center p-8">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          {stage === 'calculating' ? (
            <Calculator className="h-6 w-6 text-blue-500" />
          ) : (
            <Sparkles className="h-6 w-6 text-blue-500" />
          )}
        </div>
        <h3 className="font-semibold text-lg mb-2">
          {stage === 'calculating' ? 'Running Mathematical Analysis' : 'Generating AI Strategic Insights'}
        </h3>
        <p className="text-muted-foreground text-center max-w-md">
          {stage === 'calculating' 
            ? 'Calculating optimal scenarios and analyzing portfolio data...'
            : 'Our AI is analyzing your portfolio and generating strategic recommendations...'
          }
        </p>
        <div className="mt-4 flex space-x-1">
          <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce"></div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ResultsSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'info';
  className?: string;
}

export function ResultsSection({ title, icon, children, variant = 'default', className }: ResultsSectionProps) {
  const borderColor = {
    default: 'border-gray-200',
    success: 'border-green-200',
    info: 'border-blue-200'
  }[variant];

  const headerColor = {
    default: 'text-gray-900',
    success: 'text-green-900',
    info: 'text-blue-900'
  }[variant];

  return (
    <Card className={cn(`${borderColor} shadow-sm`, className)}>
      <CardHeader className="pb-3">
        <CardTitle className={cn("flex items-center gap-2", headerColor)}>
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
      </CardContent>
    </Card>
  );
}

interface MetricCardProps {
  label: string;
  value: string | number;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
  format?: 'currency' | 'percentage' | 'number';
  className?: string;
}

export function MetricCard({ 
  label, 
  value, 
  description, 
  trend, 
  format = 'number',
  className 
}: MetricCardProps) {
  const formatValue = (val: string | number) => {
    const numValue = typeof val === 'string' ? parseFloat(val) : val;
    
    switch (format) {
      case 'currency':
        return `$${numValue.toLocaleString()}`;
      case 'percentage':
        return `${numValue.toFixed(1)}%`;
      default:
        return numValue.toLocaleString();
    }
  };

  const trendColor = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-gray-600'
  }[trend || 'neutral'];

  return (
    <div className={cn("bg-gray-50 rounded-lg p-4 border", className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {trend && (
          <TrendingUp 
            className={cn("h-4 w-4", trendColor, {
              'rotate-180': trend === 'down'
            })} 
          />
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 mb-1">
        {formatValue(value)}
      </div>
      {description && (
        <p className="text-xs text-gray-500">{description}</p>
      )}
    </div>
  );
}

interface AIInsightsCardProps {
  title: string;
  content: string;
  isGenerating?: boolean;
  className?: string;
}

export function AIInsightsCard({ title, content, isGenerating, className }: AIInsightsCardProps) {
  if (isGenerating) {
    return <LoadingCard stage="generating-insights" className={className} />;
  }

  return (
    <Card className={cn("border-blue-100 bg-blue-50/50", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-blue-900">
          <Sparkles className="h-5 w-5 text-blue-600" />
          {title}
        </CardTitle>
        <CardDescription>
          AI-powered strategic analysis and recommendations
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div 
          className="prose prose-sm max-w-none prose-blue"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </CardContent>
    </Card>
  );
}

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  className?: string;
}

export function Tooltip({ children, content, className }: TooltipProps) {
  return (
    <div className={cn("group relative inline-block", className)}>
      {children}
      <div className="invisible group-hover:visible absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 text-xs text-white bg-gray-900 rounded-lg whitespace-nowrap z-10">
        {content}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
      </div>
    </div>
  );
}
