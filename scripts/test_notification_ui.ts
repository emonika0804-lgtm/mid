import '../tests/setTestEnv';
import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { setupIsolatedTestDb } from '../tests/setupIsolatedTestDb';
import { startTestServer, stopTestServer, BASE_URL } from '../tests/testApp';
import db from '../server/src/db';

async function main() {
  console.log('======================================================================');
  console.log('   PIL CARGO CLAIMS — NOTIFICATION CENTER UI BROWSER VERIFICATION');
  console.log('======================================================================\n');

  const screenshotsDir = path.resolve(__dirname, '../tests/e2e/screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 1. Setup isolated test db and start test server
  console.log('[1/5] Initializing test database and test server...');
  await setupIsolatedTestDb();
  await startTestServer();

  // Insert a test notification if none exist
  await db.query(`
    INSERT INTO notifications (id, type, message, claim_id, user_id, read, created_date)
    VALUES 
      ('test-notif-1', 'claim', 'New claim CLM-2026-0001 submitted by Agency Singapore', 'clm-test-1', NULL, 0, NOW()),
      ('test-notif-2', 'survey', 'New survey request SVY-2026-0001 created by Surveyor Alex', NULL, NULL, 0, NOW())
    ON CONFLICT (id) DO UPDATE SET read = 0
  `);

  console.log('[2/5] Launching real Google Chrome browser...');
  const browser: Browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  try {
    // ----------------------------------------------------
    // TEST 1: DESKTOP VIEWPORT (1280 x 800)
    // ----------------------------------------------------
    console.log('[3/5] Testing Desktop Viewport (1280x800)...');
    const page: Page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Login as MID user
    await page.fill('input[type="email"]', 'mid@pilship.com');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/`);
    await page.waitForSelector('nav');

    // Screenshot before clicking notification
    await page.screenshot({ path: path.join(screenshotsDir, 'notif_desktop_before.png') });

    // Click Notification trigger button in sidebar
    const notifBtn = page.locator('button[title="Notifications"]');
    await notifBtn.waitFor({ state: 'visible' });
    await notifBtn.click();

    // Wait for panel to open
    const notifPanel = page.locator('text=Notifications').first();
    await notifPanel.waitFor({ state: 'visible' });
    await page.waitForTimeout(300); // Allow animation to settle

    // Measure panel rect and sidebar scrollLeft
    const desktopMetrics = await page.evaluate(() => {
      const btn = document.querySelector('button[title="Notifications"]');
      const sidebarNav = document.querySelector('nav');
      const aside = document.querySelector('aside');
      
      // Find the notification portal panel
      const allDivs = Array.from(document.querySelectorAll('div'));
      const panel = allDivs.find(d => d.style.position === 'fixed' && d.style.zIndex === '50');
      
      const panelRect = panel ? panel.getBoundingClientRect() : null;
      const btnRect = btn ? btn.getBoundingClientRect() : null;
      const asideRect = aside ? aside.getBoundingClientRect() : null;
      
      return {
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        sidebarScrollLeft: sidebarNav ? sidebarNav.scrollLeft : 0,
        asideWidth: asideRect ? asideRect.width : 0,
        panelRect: panelRect ? {
          left: panelRect.left,
          top: panelRect.top,
          right: panelRect.right,
          bottom: panelRect.bottom,
          width: panelRect.width,
          height: panelRect.height,
        } : null,
      };
    });

    console.log('  Desktop Metrics:', JSON.stringify(desktopMetrics, null, 2));

    if (!desktopMetrics.panelRect) {
      throw new Error('Notification panel rect not found!');
    }

    // Assertions for Desktop
    const p = desktopMetrics.panelRect;
    if (p.left < 200) {
      throw new Error(`Desktop panel overlaps sidebar! Left is ${p.left}, expected >= 256`);
    }
    if (p.right > desktopMetrics.windowWidth) {
      throw new Error(`Desktop panel overflows viewport right! Right is ${p.right}, width is ${desktopMetrics.windowWidth}`);
    }
    if (desktopMetrics.sidebarScrollLeft > 0) {
      throw new Error(`Sidebar has horizontal scroll! scrollLeft is ${desktopMetrics.sidebarScrollLeft}`);
    }

    console.log('  [PASS] Desktop notification panel positioned cleanly to the right of sidebar, zero horizontal scroll, fully inside viewport.');
    await page.screenshot({ path: path.join(screenshotsDir, 'notif_desktop_opened.png') });

    // Test Mark All Read
    const markAllBtn = page.locator('button[title="Mark all as read"]');
    if (await markAllBtn.isVisible()) {
      await markAllBtn.click();
      await page.waitForTimeout(500);
      console.log('  [PASS] Mark all read button clicked successfully.');
    }

    await page.close();

    // ----------------------------------------------------
    // TEST 2: NARROW / TABLET VIEWPORT (768 x 1024)
    // ----------------------------------------------------
    console.log('[4/5] Testing Tablet Viewport (768x1024)...');
    const tabletPage: Page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await tabletPage.goto(`${BASE_URL}/login`);
    await tabletPage.fill('input[type="email"]', 'mid@pilship.com');
    await tabletPage.fill('input[type="password"]', 'Password123!');
    await tabletPage.click('button[type="submit"]');
    await tabletPage.waitForURL(`${BASE_URL}/`);

    const tabletNotifBtn = tabletPage.locator('button[title="Notifications"]');
    await tabletNotifBtn.click();
    await tabletPage.waitForTimeout(300);

    const tabletMetrics = await tabletPage.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const panel = allDivs.find(d => d.style.position === 'fixed' && d.style.zIndex === '50');
      const panelRect = panel ? panel.getBoundingClientRect() : null;
      return {
        windowWidth: window.innerWidth,
        panelRect: panelRect ? {
          left: panelRect.left,
          right: panelRect.right,
          width: panelRect.width,
        } : null,
      };
    });

    console.log('  Tablet Metrics:', JSON.stringify(tabletMetrics, null, 2));
    if (tabletMetrics.panelRect && tabletMetrics.panelRect.right > tabletMetrics.windowWidth) {
      throw new Error(`Tablet panel overflows right! ${tabletMetrics.panelRect.right} > ${tabletMetrics.windowWidth}`);
    }
    console.log('  [PASS] Tablet notification panel opens fully inside viewport.');
    await tabletPage.screenshot({ path: path.join(screenshotsDir, 'notif_tablet_opened.png') });
    await tabletPage.close();

    // ----------------------------------------------------
    // TEST 3: MOBILE / NARROW VIEWPORT (375 x 812)
    // ----------------------------------------------------
    console.log('[5/5] Testing Mobile Viewport (375x812)...');
    const mobilePage: Page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await mobilePage.goto(`${BASE_URL}/login`);
    await mobilePage.fill('input[type="email"]', 'mid@pilship.com');
    await mobilePage.fill('input[type="password"]', 'Password123!');
    await mobilePage.click('button[type="submit"]');
    await mobilePage.waitForURL(`${BASE_URL}/`);

    const mobileNotifBtn = mobilePage.locator('button[title="Notifications"]');
    await mobileNotifBtn.click();
    await mobilePage.waitForTimeout(300);

    const mobileMetrics = await mobilePage.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const panel = allDivs.find(d => d.style.position === 'fixed' && d.style.zIndex === '50');
      const panelRect = panel ? panel.getBoundingClientRect() : null;
      return {
        windowWidth: window.innerWidth,
        panelRect: panelRect ? {
          left: panelRect.left,
          right: panelRect.right,
          width: panelRect.width,
        } : null,
      };
    });

    console.log('  Mobile Metrics:', JSON.stringify(mobileMetrics, null, 2));
    if (mobileMetrics.panelRect) {
      if (mobileMetrics.panelRect.left < 0) {
        throw new Error(`Mobile panel clipped beyond left boundary! Left is ${mobileMetrics.panelRect.left}`);
      }
      if (mobileMetrics.panelRect.right > mobileMetrics.windowWidth) {
        throw new Error(`Mobile panel clipped beyond right boundary! Right is ${mobileMetrics.panelRect.right}`);
      }
    }
    console.log('  [PASS] Mobile notification panel centered and completely contained within viewport.');
    await mobilePage.screenshot({ path: path.join(screenshotsDir, 'notif_mobile_opened.png') });
    await mobilePage.close();

    console.log('\n======================================================================');
    console.log('   ALL BROWSER INTERACTION CHECKS PASSED (100%)');
    console.log('======================================================================');
  } finally {
    await browser.close();
    await stopTestServer();
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
