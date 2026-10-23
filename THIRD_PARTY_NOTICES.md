# Third-party notices

This distribution includes or depends on the following third-party components.

| Component | Used by | License |
|---|---|---|
| Microsoft Edge WebView2 SDK (Microsoft.Web.WebView2, WebView2LoaderStatic.lib, statically linked) | Rocks-cells Browser (C++) | Microsoft WebView2 SDK license (BSD-style; see https://www.nuget.org/packages/Microsoft.Web.WebView2/ "License") |
| Microsoft Edge WebView2 Runtime (not bundled; preinstalled on Windows 10/11) | Rocks-cells Browser | Microsoft Software License Terms |
| nlohmann/json 3.12.0 (header-only, compiled in) | Rocks-cells Browser (C++) | MIT, Copyright (c) 2013-2025 Niels Lohmann |
| @anthropic-ai/sdk (bundled into ui/assets/*.js) | Rocks-cells Browser UI | MIT, Copyright (c) Anthropic, PBC |
| Vite, TypeScript, Vitest (build/test tools only, not shipped) | Rocks-cells Browser UI | MIT / Apache-2.0 |
| Electron 33 (desktop version of hex-memo only, not shipped in the portable zip) | hex-memo | MIT, Copyright (c) Electron contributors / GitHub Inc. (Electron bundles Chromium and Node.js under their own licenses) |

The full license texts are available from each project. The MIT text for the bundled
JavaScript (@anthropic-ai/sdk and its dependencies) is reproduced by the upstream packages
under `ui/node_modules/<package>/LICENSE` when building from source.