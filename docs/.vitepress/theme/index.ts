/**
 * @purpose Custom VitePress theme definition registering global components.
 * @rationale Extends VitePress default theme to provide interactive Scalar API reference visualizer.
 * @preconditions VitePress runtime; Vue 3 environment.
 * @param ctx Theme enhancement context containing Vue app instance.
 * @returns {void}
 * @throws Never throws.
 * @invariants Pure component registration; Big-O O(1).
 */

import DefaultTheme from 'vitepress/theme';
import type { EnhanceAppContext } from 'vitepress';
import ScalarViewer from './ScalarViewer.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }: EnhanceAppContext): void {
    app.component('ScalarViewer', ScalarViewer);
  },
};
