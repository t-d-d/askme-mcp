import { Component, type ReactNode } from "react";
import { Stopped } from "./Stopped";

// An error thrown while rendering would otherwise unmount the whole page
// and leave it blank. React has no hook for this, so it is a class.
export class Fallback extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <Stopped words="This page stopped working." />
    ) : (
      this.props.children
    );
  }
}
