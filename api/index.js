const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Fast HTTP SSR JSON Scraper (Runs in <1s, 100% Vercel Serverless compatible)
async function scrapeAirbnbFast(targetUrl) {
  console.log(`[Vercel API] Fetching: ${targetUrl}`);
  
  const response = await axios.get(targetUrl, {
    timeout: 12000,
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
  console.log(`[Vercel API] Found ${photosList.length} photos`);
  return { title: title.trim(), photos: photosList };
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
    const data = await scrapeAirbnbFast(url);

    res.json({
      success: true,
      title: data.title || 'Anúncio Airbnb',
      totalPhotos: data.photos.length,
      photos: data.photos
    });
  } catch (err) {
    console.error('[Vercel Scrape Error]', err.message);
    res.status(500).json({
      success: false,
      error: 'Não foi possível extrair as fotos do anúncio. Verifique se o link está correto e tente novamente.',
      details: err.message
    });
  }
});

// Proxy Image Endpoint
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
    console.error('[Vercel Proxy Error]', error.message);
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
    console.log(`[Vercel ZIP] Creating ZIP for ${photos.length} photos...`);
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
        console.error(`[Vercel ZIP] Failed photo ${idx + 1}:`, err.message);
      }
    });

    await Promise.all(downloadPromises);

    console.log(`[Vercel ZIP] Packaged ${completed}/${photos.length} photos.`);
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });

    const safeTitle = (title || 'airbnb_fotos')
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .slice(0, 30);

    const filename = `${safeTitle}_fotos.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipContent);

  } catch (err) {
    console.error('[Vercel ZIP Error]', err.message);
    res.status(500).json({ error: 'Erro ao gerar o arquivo ZIP.' });
  }
});

module.exports = app;
