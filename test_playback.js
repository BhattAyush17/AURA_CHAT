import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning" || msg.text().includes("[MUSIC")) {
      console.log(`PAGE LOG: ${msg.text()}`);
    }
  });

  try {
    await page.goto("http://localhost:3000/");

    // We need to simulate user interaction to allow autoplay
    await page.click("body");

    // Evaluate in page to trigger the music play action
    const result = await page.evaluate(async () => {
      // Find the music service and trigger it directly if exposed,
      // or we can test the fallback by injecting our own fetch and tracking audio

      // Let's create an audio element to see if it can play the proxy URL directly
      const proxyBase = "http://localhost:8000/api/ytmusic/proxy";
      const searchEndpoint = "http://localhost:8000/api/ytmusic/search";

      console.log("[MUSIC_TEST] Searching...");
      const searchRes = await fetch(`${searchEndpoint}?query=Counting%20Stars%20OneRepublic`);
      if (!searchRes.ok) return { error: "Search failed" };
      const data = await searchRes.json();

      let proxyUrl = `${proxyBase}?url=${encodeURIComponent(data.audio_stream_url)}`;
      proxyUrl += `&h=${encodeURIComponent(btoa(JSON.stringify(data.http_headers)))}`;

      console.log("[MUSIC_TEST] Creating audio element...");
      const audio = new Audio();
      audio.crossOrigin = "anonymous";

      let canplayFired = false;
      let playingFired = false;

      audio.addEventListener("canplay", () => {
        console.log("[MUSIC_TEST] canplay fired");
        canplayFired = true;
      });

      audio.addEventListener("playing", () => {
        console.log("[MUSIC_TEST] playing fired");
        playingFired = true;
      });

      audio.src = proxyUrl;
      console.log("[MUSIC_TEST] audio.src set");

      try {
        await audio.play();
        console.log("[MUSIC_TEST] play() resolved!");
        // wait a moment for playing event
        await new Promise((r) => setTimeout(r, 1000));
        return { success: true, canplayFired, playingFired };
      } catch (err) {
        console.error("[MUSIC_TEST] play() rejected:", err.message);
        return { success: false, error: err.message };
      }
    });

    console.log("Result:", result);
  } catch (e) {
    console.error("Test failed:", e);
  } finally {
    await browser.close();
  }
})();
