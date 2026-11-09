/**
 * Host half of dsh-split-view.
 *
 * The plugin is a pure client-surface extension: it registers a `main` panel
 * that renders the existing conversation panel twice, each bound to its own
 * session. Nothing on the host side needs to change, so `apply` is a no-op
 * whose only job is to keep the bundle row mountable.
 */

/** Cordis plugin name used by the loader row. */
export const name = 'dsh-split-view';

/** No host services are required. */
export const inject = [];

/**
 * Mount the host half.
 *
 * @returns void
 */
export function apply() {
  // Intentionally empty: the whole feature lives in lib/client.js.
}
