import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public props: Props;
  public state: State = {
    hasError: false
  };
  
  constructor(props: Props) {
    super(props);
    this.props = props;
  }

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-gray-600 mb-6">We apologize for the inconvenience. Please try refreshing the page.</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors"
          >
            Refresh Page
          </button>
        </div>
      );
    }

    return (this.props as Props).children;
  }
}
