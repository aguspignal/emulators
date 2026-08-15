import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n';
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
        // Class component, so no useTranslation: direct i18n.t is fine — a
        // crash screen not re-rendering on a language change is acceptable.
        <ErrorState
          title={i18n.t('errors.somethingWentWrong')}
          message={i18n.t('errors.unexpected')}
          actionLabel={i18n.t('common.tryAgain')}
          onAction={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
