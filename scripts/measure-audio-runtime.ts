import { test, expect, chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3000/diagnostics/runtime');
  await page.waitForSelector('#rtd-health-dashboard');

  // Inject some test events to get latency metrics
  console.log("Injecting test events to measure latencies...");
  await page.click('#rtd-btn-inject');
  await page.waitForTimeout(2000); // Wait for the injected events to populate latency

  // Extract Latency
  console.log("Extracting Latency Metrics...");
  const latencies = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.rtd-latency-card'));
    return cards.map(c => {
      const label = c.querySelector('.rtd-latency-card__label')?.textContent || '';
      const value = c.querySelector('.rtd-latency-card__value')?.textContent || '';
      return `${label}: ${value}`;
    });
  });
  
  console.log("Latency Breakdown:");
  latencies.forEach(l => console.log(l));

  await browser.close();
})();
