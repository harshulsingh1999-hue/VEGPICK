import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reportClientDiagnostic, runClientDeviceCleanup } from '../lib/appDiagnosticsClient';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public declare props: Props;
  public declare setState: (state: Partial<State> | ((prevState: State) => State)) => void;
  public state: State = {
    hasError: false,
    errorMessage: ''
  };

  constructor(props: Props) {
    super(props);
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || ''
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App ErrorBoundary caught error:', error, errorInfo);
    const msg = error?.message || '';
    void reportClientDiagnostic({
      severity: 'error',
      category: 'react_boundary',
      message: msg || 'React render exception caught by ErrorBoundary'
    });
    // Automatically recover once from stale dynamic chunk errors after deployment
    if (
      (msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed')) &&
      !sessionStorage.getItem('freshveggie_chunk_reloaded')
    ) {
      sessionStorage.setItem('freshveggie_chunk_reloaded', '1');
      void runClientDeviceCleanup({ preserveAuth: true, resetClusterCache: false }).finally(() => {
        window.location.reload();
      });
    }
  }

  private handleRecoverHome = () => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.assign('/home');
  };

  private handleRetryRender = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
          <div className="bg-white border border-gray-100 rounded-3xl shadow-sm p-8 max-w-md w-full space-y-4">
            <h1 className="text-2xl font-extrabold text-gray-900">Instant Auto-Recovery Ready</h1>
            <p className="text-sm text-gray-600">
              A temporary view error occurred. Your cart, session, and orders are safe.
            </p>
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2 justify-center">
              <button
                type="button"
                onClick={this.handleRetryRender}
                className="bg-green-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-green-700 transition-colors"
              >
                Recover Instantly
              </button>
              <button
                type="button"
                onClick={this.handleRecoverHome}
                className="bg-gray-100 text-gray-800 px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors"
              >
                Go to Home
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="bg-white border border-gray-200 text-gray-600 px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (this.props as Props).children;
  }
}
