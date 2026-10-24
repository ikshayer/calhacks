import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * A backstop for the 3D scene.
 *
 * Without one, a throw anywhere in the island tree unmounts the whole React
 * root and the page goes blank — the sidebar, the report and the run controls
 * disappear along with the thing that actually failed. Catching here keeps the
 * instrument panel usable and says what broke instead.
 *
 * Deliberately not a general app-wide wrapper: it exists for the canvas, where
 * a single malformed asset should cost the scene and nothing else.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: Error, retry: () => void) => ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack is the only thing that identifies which part of the
    // scene threw, and React does not include it in the error itself.
    console.error('The island scene failed to render.', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }))
    }
    return this.props.children
  }
}
