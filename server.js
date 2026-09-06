const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');

// Optional Puppeteer load (gracefully handled on Vercel serverless)
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.log('[Info] Puppeteer not loaded in serverless environment; using fast HTTP scraper.');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper to auto-locate installed Chrome executable locally
function getChromeExecutablePath() {
  const cacheBase = path.join(process.env.USERPROFILE || 'C:\\Users\\davib', '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(cacheBase)) {
    const versions = fs.readdirSync(cacheBase);
    for (const ver of versions) {
      const execPath = path.join(cacheBase, ver, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(execPath)) return execPath;
    }
  }
  return null;
}

// 1. Fast HTTP SSR JSON Scraper (Runs in <1s, 100% Vercel Serverless compatible)
async function scrapeAirbnbFast(targetUrl) {
  console.log(`[Fast Scraper] Fetching: ${targetUrl}`);
  
  const response = await axios.get(targetUrl, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
      'Cache-Control': 'no-cache',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  const html = response.data;
  const unescaped = html.replace(/\\\/|\\u002F/g, '/');

  // Extract page title
  const $ = cheerio.load(html);
  let title = $('title').text() || $('h1').text() || 'Anúncio Airbnb';
  if (title.includes('Airbnb:')) {
    const h1 = $('h1').first().text();
    if (h1) title = h1;
  }

  // Find all muscache images
  const imgRegex = /https:\/\/a0\.muscache\.com\/im\/pictures\/[a-zA-Z0-9_\-\.\/]+/g;
  const matches = unescaped.match(imgRegex) || [];

  const rawBases = new Set();
  const imageUrls = new Set();

  for (let rawMatch of matches) {
    if (
      rawMatch.includes('/user/') ||
      rawMatch.includes('/av/') ||
      rawMatch.includes('profile') ||
      rawMatch.includes('logo') ||
      rawMatch.includes('icon') ||
      rawMatch.includes('badge') ||
      rawMatch.includes('platform-assets') ||
      rawMatch.includes('AirbnbPlatformAssets')
    ) {
      continue;
    }
    
    let base = rawMatch.split('?')[0].replace(/[\,"'\s].*$/, '');
    if (
      base.endsWith('.jpg') ||
      base.endsWith('.jpeg') ||
      base.endsWith('.webp') ||
      base.endsWith('.png') ||
      base.includes('/miso/') ||
      base.includes('/prohost-api/') ||
      base.includes('/hosting/')
    ) {
      if (!rawBases.has(base)) {
        rawBases.add(base);
        imageUrls.add(`${base}?im_w=1920`);
      }
    }
  }

  const photosList = Array.from(imageUrls);
  console.log(`[Fast Scraper] Found ${photosList.length} photos`);
  return { title: title.trim(), photos: photosList };
}

// 2. Puppeteer Scraper Fallback (For local execution if available)
async function scrapeAirbnbPuppeteer(targetUrl) {
  if (!puppeteer) return null;
  console.log(`[Puppeteer Scraper] Launching browser for: ${targetUrl}`);
  
  const chromePath = getChromeExecutablePath();
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  };
  if (chromePath) launchOptions.executablePath = chromePath;

  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    const imageUrls = new Set();
    const rawBases = new Set();

    page.on('response', (response) => {
      const resUrl = response.url();
      if (resUrl.includes('a0.muscache.com/im/pictures/')) {
        if (
          !resUrl.includes('/user/') &&
          !resUrl.includes('/av/') &&
          !resUrl.includes('profile') &&
          !resUrl.includes('logo') &&
          !resUrl.includes('icon') &&
          !resUrl.includes('badge') &&
          !resUrl.includes('platform-assets')
        ) {
          let base = resUrl.split('?')[0];
          if (!rawBases.has(base)) {
            rawBases.add(base);
            imageUrls.add(`${base}?im_w=1920`);
          }
        }
      }
    });

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 35000 });

    // Scroll page
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 350;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight || totalHeight > 4500) {
            clearInterval(timer);
            resolve();
          }
        }, 80);
      });
    });

    let title = await page.title();
    const content = await page.content();
    const unescaped = content.replace(/\\\/|\\u002F/g, '/');
    const imgRegex = /https:\/\/a0\.muscache\.com\/im\/pictures\/[a-zA-Z0-9_\-\.\/]+/g;
    const matches = unescaped.match(imgRegex) || [];

    for (let rawMatch of matches) {
      if (
        rawMatch.includes('/user/') ||
        rawMatch.includes('/av/') ||
        rawMatch.includes('profile') ||
        rawMatch.includes('logo') ||
        rawMatch.includes('icon') ||
        rawMatch.includes('badge') ||
        rawMatch.includes('platform-assets')
      ) {
        continue;
      }
      let base = rawMatch.split('?')[0].replace(/[\,"'\s].*$/, '');
      if (!rawBases.has(base)) {
        rawBases.add(base);
        imageUrls.add(`${base}?im_w=1920`);
      }
    }

    await browser.close();
    return { title: title.trim(), photos: Array.from(imageUrls) };
  } catch (err) {
    if (browser) await browser.close();
    console.error(`[Puppeteer Scraper Error] ${err.message}`);
    return null;
  }
}

// Scrape API Endpoint
app.get('/api/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Por favor forneça uma URL do Airbnb.' });
  }

  if (!url.includes('airbnb.')) {
    return res.status(400).json({ success: false, error: 'URL inválida. Certifique-se de que é um link do Airbnb.' });
  }

  try {
    // Try fast HTTP scraper first
    let data = await scrapeAirbnbFast(url);
    
    // If fast scraper got 0 photos and puppeteer is available, try puppeteer
    if ((!data.photos || data.photos.length === 0) && puppeteer) {
      console.log('[Scraper] Fast scraper found 0 photos, falling back to Puppeteer...');
      const puppeteerData = await scrapeAirbnbPuppeteer(url);
      if (puppeteerData && puppeteerData.photos.length > 0) {
        data = puppeteerData;
      }
    }

    res.json({
      success: true,
      title: data.title || 'Anúncio Airbnb',
      totalPhotos: data.photos.length,
      photos: data.photos
    });
  } catch (err) {
    console.error('[API Scrape Error]', err.message);
    res.status(500).json({
      success: false,
      error: 'Não foi possível extrair as fotos do anúncio. Verifique se o link está correto e tente novamente.',
      details: err.message
    });
  }
});

// Proxy Image Endpoint (bypasses CORS)
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('URL is required');

  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(response.data);
  } catch (error) {
    console.error('[Proxy Error]', error.message);
    res.status(500).send('Failed to proxy image');
  }
});

// Download ZIP Endpoint
app.post('/api/download-zip', async (req, res) => {
  const { photos, title } = req.body;

  if (!photos || !Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ error: 'Nenhuma foto fornecida para download.' });
  }

  try {
    console.log(`[ZIP] Creating ZIP file for ${photos.length} photos...`);
    const zip = new JSZip();
    const folder = zip.folder('fotos_airbnb');

    let completed = 0;
    const downloadPromises = photos.map(async (photoUrl, idx) => {
      try {
        const response = await axios.get(photoUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        let ext = 'jpg';
        if (photoUrl.includes('.png')) ext = 'png';
        if (photoUrl.includes('.webp')) ext = 'webp';

        const num = String(idx + 1).padStart(3, '0');
        const filename = `foto_${num}.${ext}`;

        folder.file(filename, response.data);
        completed++;
      } catch (err) {
        console.error(`[ZIP] Failed photo ${idx + 1}:`, err.message);
      }
    });

    await Promise.all(downloadPromises);

    console.log(`[ZIP] Successfully packaged ${completed}/${photos.length} photos.`);
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });

    const safeTitle = (title || 'airbnb_fotos')
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .slice(0, 30);

    const filename = `${safeTitle}_fotos.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipContent);

  } catch (err) {
    console.error('[ZIP Error]', err.message);
    res.status(500).json({ error: 'Erro ao gerar o arquivo ZIP.' });
  }
});

// Start local server if executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Airbnb Photo Downloader Pro rodando na porta ${PORT}`);
    console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

// Export Express app for Vercel Serverless Functions
module.exports = app;
