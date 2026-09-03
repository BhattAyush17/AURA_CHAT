import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning" || msg.text().includes("[TEST]")) {
      console.log(`PAGE LOG: ${msg.text()}`);
    }
  });

  try {
    await page.goto("http://localhost:3000/");

    // Simulate interaction
    await page.click("body");

    const result = await page.evaluate(async () => {
      console.log("[TEST] Starting real playback pipeline test");

      const searchEndpoint = "http://localhost:8000/api/ytmusic/search";
      const proxyBase = "http://localhost:8000/api/ytmusic/proxy";

      console.log("[TEST] Fetching search...");
      const searchRes = await fetch(`${searchEndpoint}?query=Counting%20Stars%20OneRepublic`);
      if (!searchRes.ok) return { error: "Search failed" };
      const data = await searchRes.json();

      let proxyUrl = `${proxyBase}?url=${encodeURIComponent(data.audio_stream_url)}`;
      proxyUrl += `&h=${encodeURIComponent(btoa(JSON.stringify(data.http_headers)))}`;

      console.log("[TEST] Creating Audio Element");
      const audio = new Audio();
      audio.crossOrigin = "anonymous";

      let events = [];
      const trackEvent = (name) => {
        audio.addEventListener(name, () => {
          events.push(name);
          console.log(`[TEST] Event Fired: ${name}`);
        });
      };

      ["loadedmetadata", "canplay", "playing", "waiting", "stalled", "ended", "error"].forEach(
        trackEvent,
      );

      audio.src = proxyUrl;
      console.log("[TEST] Calling audio.play()");

      let playbackTimes = [];
      try {
        await audio.play();
        console.log("[TEST] audio.play() Promise Resolved");
      } catch (e) {
        return { error: `play() failed: ${e.message}` };
      }

      // Monitor currentTime for 4 seconds
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        playbackTimes.push(audio.currentTime);
        console.log(`[TEST] currentTime: ${audio.currentTime.toFixed(2)}`);
      }

      // Test ducking (Simulate what MusicService does)
      console.log(`[TEST] Simulating Interruption (Voice ducking)...`);
      console.log(`[TEST] Before Interruption: volume=${audio.volume}`);
      const oldVol = audio.volume;
      audio.volume = Math.max(0, audio.volume * 0.2);
      console.log(`[TEST] During Interruption: volume=${audio.volume}`);

      await new Promise((r) => setTimeout(r, 1000));

      console.log(`[TEST] Simulating Resume (Voice end)...`);
      audio.volume = oldVol;
      console.log(`[TEST] After Interruption: volume=${audio.volume}`);

      return {
        success: true,
        events,
        playbackTimes,
        finalTime: audio.currentTime,
      };
    });

    console.log("RESULT_JSON:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Test failed:", e);
  } finally {
    await browser.close();
  }
})();
