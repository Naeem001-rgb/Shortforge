# Browser verification

Run `npm --prefix dashboard test` from the project root. Playwright starts its own engine on port 8788 and Vite server on 5174 with a temporary `SHORTFORGE_DATA_DIR`. It does not use the live Library. Setup and manual checks are in [TESTING.md](TESTING.md).

| Harness | Coverage |
| --- | --- |
| `dashboard/tests/concat-studio.spec.ts` | Native Studio launch status, retries, saved selection and navigation with a simulated Concat launch |
| `dashboard/tests/library-*.spec.ts` | Layout, bounded pagination, search, selections and refresh behavior |
| `dashboard/tests/dashboard-redesign.spec.ts`, `workspace.spec.ts` | Themes, keyboard navigation, dialogs, Library and Settings |
| `dashboard/tests/instagram-library.spec.ts` | Instagram sources and thumbnails |
| `dashboard/tests/youtube-settings.spec.ts` | Channel configuration and connection states with simulated Google responses |
| `extension/tests/packaged-dashboard.mjs` | Actual unpacked MV3 package, local assets, CSP, loopback API and Studio handoff |
| `extension/tests/browser-fixture.mjs` | YouTube page parsing and count fixtures |
| `extension/tests/instagram-fixture.mjs` | Instagram page parsing and payload fixtures |

Build first, then run the extension fixtures from `extension/`:

```bash
npm --prefix extension run build
cd extension
node tests/packaged-dashboard.mjs
node tests/browser-fixture.mjs
node tests/instagram-fixture.mjs
```

The dashboard suite uses `CHROME_PATH` or `/usr/bin/google-chrome`. The packaged extension fixture uses Playwright's Chromium. These fixtures do not require a logged-in social account. Generated reports and screenshots remain ignored by Git.

Report failures and retries separately. Passing these checks does not verify live social markup, real Google authorization, full accessibility, or native Concat exports. The removed timeline harness and its scripts are described only in the [historical archive](archive/browser-editor/QA-HARNESS.md).
