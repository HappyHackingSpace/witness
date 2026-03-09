import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-svelte"],
  manifest: {
    name: "Witness",
    description: "Capture, preserve, and organize web evidence for investigations",
    permissions: [
      "activeTab",
      "tabs",
      "scripting",
      "webNavigation",
      "pageCapture",
      "storage",
      "unlimitedStorage",
      "sidePanel",
      "contextMenus",
      "debugger",
    ],
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
      default_title: "Witness (Paused)",
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline';",
    },
  },
});
