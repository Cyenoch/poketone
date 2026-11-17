import { Container } from "@pmndrs/uikit";

/**
 * The run's loading state in the overlay: the app curtain covers the load (title and progress on
 * its ink slab), so this draws nothing; it only keeps the overlay modal, holding the run's input,
 * until the load ends.
 */
export class GpuRunLoading {
  readonly root = new Container({ width: "100%", height: "100%" });
  /** It holds the run's input while shown (also keeps it apart from the other contents' types). */
  readonly holdsInput = true;
  dispose(): void {
    this.root.removeFromParent();
    this.root.dispose();
  }
}
