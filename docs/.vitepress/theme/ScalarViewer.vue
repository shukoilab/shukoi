<!--
  @purpose Vue component embedding the interactive Scalar OpenAPI 3.1.0 visualizer.
  @rationale Isolates OpenAPI styling and client-side execution within a sandboxed iframe to prevent CSS collisions with VitePress themes.
  @preconditions Vue 3 environment; valid BASE_URL environment variable.
  @param None (standalone SFC component).
  @returns Rendered client-only iframe component.
  @throws Never throws; errors are caught and logged gracefully.
  @invariants Client-only rendering; deterministic subpath URL resolution; Big-O O(1).
-->

<script setup lang="ts">
import { computed } from 'vue';

/**
 * @purpose Computes the full HTML document string for the sandboxed Scalar iframe with deterministic spec URL resolution.
 * @rationale Avoids path guessing inside srcdoc context where window.location.pathname evaluates to 'srcdoc'.
 * @preconditions import.meta.env.BASE_URL must be defined or default to '/shukoi/'.
 * @param None.
 * @returns {string} Raw HTML document containing pinned Scalar script and exact data-url attribute.
 * @throws Never throws.
 * @invariants Pure string template interpolation; Big-O O(1).
 */
const srcdoc = computed(() => {
  const basePath = import.meta.env.BASE_URL || '/shukoi/';
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const specUrl = `${normalizedBase}openapi.json`;

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <title>Shukoi API Reference</title>',
    '  <meta charset="utf-8"/>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1"/>',
    '  <style>body { margin: 0; padding: 0; }</style>',
    '</head>',
    '<body>',
    `  <script id="api-reference" data-url="${specUrl}"><` + '/script>',
    '  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.78.1"><' +
      '/script>',
    '</body>',
    '</html>',
  ].join('\n');
});
</script>

<template>
  <ClientOnly>
    <div class="scalar-container">
      <iframe
        :srcdoc="srcdoc"
        class="scalar-iframe"
        title="Scalar OpenAPI Visualizer"
      />
    </div>
  </ClientOnly>
</template>

<style scoped>
.scalar-container {
  width: 100%;
  height: calc(100vh - 120px);
  margin-top: 1rem;
}
.scalar-iframe {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 8px;
}
</style>
