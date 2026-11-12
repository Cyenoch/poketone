import { Component, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { webStyles } from "./platform/web/styles";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class RenderBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main {...stylex.props(webStyles.error)} role="alert">
          <h1 {...stylex.props(webStyles.errorTitle)}>无法启动 3D 画面</h1>
          <p {...stylex.props(webStyles.errorText)}>
            请使用支持 WebGL 2 的浏览器，并开启硬件加速。
          </p>
          <pre {...stylex.props(webStyles.errorDetail)}>{this.state.error.message}</pre>
          <button
            {...stylex.props(webStyles.errorButton)}
            type="button"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
