const { chromium } = require("playwright");

(async () => {
  console.log("Launching Playwright for Frontend Test...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.exposeFunction("logFromBrowser", (msg) => {
    console.log(`[BROWSER AUDIO] ${msg}`);
  });

  page.on("console", (msg) => {
    console.log(`[PAGE CONSOLE] ${msg.type()}: ${msg.text()}`);
  });

  await page.addInitScript(() => {
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.logFromBrowser(`play() called on src=${this.src.substring(0, 80)}...`);
      this.addEventListener("loadedmetadata", () => window.logFromBrowser("loadedmetadata fired"));
      this.addEventListener("canplay", () => window.logFromBrowser("canplay fired"));
      this.addEventListener("playing", () => window.logFromBrowser("playing fired"));
      this.addEventListener("waiting", () => window.logFromBrowser("waiting fired"));
      this.addEventListener("stalled", () => window.logFromBrowser("stalled fired"));
      this.addEventListener("error", (e) => window.logFromBrowser(`error fired: ${e.message}`));

      let lastTime = -1;
      setInterval(() => {
        if (this.currentTime !== lastTime) {
          window.logFromBrowser(
            `readyState=${this.readyState} networkState=${this.networkState} paused=${this.paused} duration=${this.duration.toFixed(2)} currentTime=${this.currentTime.toFixed(2)}`,
          );
          lastTime = this.currentTime;
        }
      }, 1000);

      const p = originalPlay.apply(this, arguments);
      if (p) {
        p.then(() => window.logFromBrowser("play() resolved successfully")).catch((e) =>
          window.logFromBrowser(`play() rejected: ${e.message}`),
        );
      }
      return p;
    };
  });

  console.log("Navigating to local AURA frontend...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  await page.waitForTimeout(2000);

  console.log("Triggering musicService...");
  await page.evaluate(async () => {
    if (window.musicService) {
      window.logFromBrowser("Found window.musicService, dispatching intent...");
      await window.musicService.processIntent({
        type: "play",
        query: "Believer by Imagine Dragons",
      });
    } else {
      window.logFromBrowser("ERROR: window.musicService not found.");
    }
  });

  console.log("Waiting for playback events (timeout in 60s)...");
  await page.waitForTimeout(60000);

  await browser.close();
  console.log("Frontend Test Finished.");
})();
