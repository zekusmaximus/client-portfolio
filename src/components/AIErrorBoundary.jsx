import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class AIErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error for debugging (in production, send to error reporting service)
    console.error('AI Component Error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-5 w-5" />
              AI Feature Unavailable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-red-700">
                The AI optimization feature encountered an error. You can continue using manual redistribution modes.
              </p>
              <div className="flex gap-2">
                <Button 
                  onClick={this.handleRetry}
                  variant="outline"
                  size="sm"
                  className="text-red-800 border-red-300 hover:bg-red-100"
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Retry
                </Button>
                {this.props.fallbackAction && (
                  <Button 
                    onClick={this.props.fallbackAction}
                    variant="outline"
                    size="sm"
                  >
                    Continue Manually
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

export default AIErrorBoundary;