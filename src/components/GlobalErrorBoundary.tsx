import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-white/50 rounded-xl">
      <div className="bg-red-50 text-red-600 p-4 rounded-full mb-4">
        <AlertTriangle className="w-10 h-10" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">
        Something went wrong loading this view
      </h2>
      <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
        An unexpected error occurred while rendering this component.
      </p>

      <div className="flex gap-4 mb-6">
        <button
          onClick={resetErrorBoundary}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors font-semibold"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
        <button
          onClick={() => {
            resetErrorBoundary();
            navigate('/');
          }}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-semibold"
        >
          <Home className="w-4 h-4" />
          Return to Dashboard
        </button>
      </div>

      {import.meta.env?.DEV && error && (
        <details className="mt-4 w-full max-w-2xl bg-gray-50 border border-gray-200 rounded-lg p-4 text-left overflow-hidden">
          <summary className="font-mono text-xs text-red-500 cursor-pointer mb-2 font-semibold select-none">
            Developer Details: {error.message}
          </summary>
          <pre className="text-[10px] text-gray-700 font-mono overflow-auto max-h-64 mt-2">
            {error.stack}
          </pre>
        </details>
      )}
    </div>
  );
}

export const GlobalErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      {children}
    </ErrorBoundary>
  );
};
