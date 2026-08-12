import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ErrorState';

/**
 * Last-resort boundary around the whole app tree. "Try again" just clears
 * the error: React already unmounted the crashed subtree, so the children
 * remount from scratch (back at the Home screen).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error != null) {
      return (
        <ErrorState
          title="Something went wrong"
          message="An unexpected error occurred."
          actionLabel="Try again"
          onAction={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
