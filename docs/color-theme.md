# Color theme

Chopin offers a light, a dark, and a system color theme. The toggle at the trailing edge of the
Projects sidebar header cycles light → dark → system. A user who never chose follows the
operating system.

## Persistence

The preference belongs to the user, not the browser. `GET /api/preferences` returns
`{ "theme": "light" | "dark" | "system" }`, and `PATCH /api/preferences` with the same body
saves it. Both require a session; the write also requires the application origin. Preferences
carry no repository authority.

Storage is the `user_preferences` table (`mantl_user_preferences` migration), reached through
`StorageAdapter.preferences`. A missing row means `system`.

The browser caches the last choice in local storage under `chopin:theme` so the first frame
paints in the right scheme. At startup it reads the server copy and adopts it unless the user
already changed the theme in that page. Both sign-in paths reload the page, so every login
applies the saved preference.

## Rendering

`color-theme-boot.ts` resolves the preference onto `<html data-theme="light|dark">` before the
first render, and the lazily loaded store keeps it current as the system scheme changes.
`apps/web/src/dark-theme.css` redefines the canonical tokens from `packages/visuals/theme.css`
under `:root[data-theme="dark"]`, so components follow without their own dark rules. The
neutral scale keeps its meaning: low steps are surfaces and high steps are ink. The ground sits
below the page so the document still reads as lifted.

Derived views that paint their own colors read the resolved scheme with the editor's
`useColorScheme()` hook. The code and diff previews switch between `pierre-light` and
`pierre-dark`. Mermaid diagrams already read the theme's custom properties.

The dark token values are recorded as reviewed design-contract exceptions in
`scripts/design-contract/exceptions/color-theme.json`, because only
`packages/visuals/theme.css` may define canonical literals.
