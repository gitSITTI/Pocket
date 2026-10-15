// Step 1 of the recipe for a web app: use the app the way a person would, while recording the traffic.
//
// This drives the demo page in a headless browser and saves what the page sent and received as a HAR
// file. For a real app you do the same by hand: open the browser's DevTools, go to the Network tab,
// use the app, then "Save all as HAR". Only do that with your own account and with an app you are
// allowed to examine. A HAR file contains your tokens and your data: keep it private.
//
//   node capture/capture.mjs [--out capture/notebook.har] [--port 4010]
//
// Needs Playwright, which is not a dependency of Pocket: install it yourself, or set
// PLAYWRIGHT_MODULE to a path that has it, and CHROME_PATH to a Chrome or Chromium binary.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, DEMO_USER } from "../app/server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const out = resolve(arg("out", resolve(here, "notebook.har")));
const port = Number.parseInt(arg("port", "4010"), 10);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const app = await startApp({ port });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

try {
  const context = await browser.newContext({
    // Record only the app's API calls; the page's own files are not interesting.
    recordHar: { path: out, content: "embed", urlFilter: `${app.url}/api/**` },
  });
  const page = await context.newPage();
  await page.goto(app.url);

  // A wrong password first, so the failure shape is on record too.
  await page.fill("#username", DEMO_USER.username);
  await page.fill("#password", "wrong");
  await page.click("#sign-in");
  await page.waitForSelector("#login-error:not(:empty)");

  await page.fill("#password", DEMO_USER.password);
  await page.click("#sign-in");
  await page.waitForSelector("#notes li");

  // Page through the list, filter it, open a note, and make one change.
  await page.click("#more");
  await page.waitForFunction(() => document.querySelectorAll("#notes li").length > 3);
  await page.selectOption("#tag", "work");
  await page.waitForFunction(() => [...document.querySelectorAll("#notes li")].every((li) => li.textContent !== "Groceries"));
  await page.click("#notes li >> nth=0");
  await page.waitForFunction(() => document.getElementById("detail").textContent !== "");
  await page.fill("#new-title", "Captured note");
  await page.fill("#new-body", "Added while recording.");
  const created = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/notes");
  await page.click("#add");
  await created;
  await page.waitForLoadState("networkidle"); // let the refresh and the analytics beacon finish before the HAR is written

  await context.close(); // writes the HAR file
  console.log(`saved ${out}`);
} finally {
  await browser.close();
  await app.close();
}
