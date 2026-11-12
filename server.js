const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');

const { initDB } = require('./src/db/database');
const { requireAuth } = require('./src/middleware/auth');
const { securityMiddleware, apiLimiter } = require('./src/middleware/security');
const authRoutes = require('./src/routes/auth');
const projectRoutes = require('./src/routes/projects');
const assetRoutes = require('./src/routes/assets');
const fileRoutes = require('./src/routes/files');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Init database
initDB();

// Security headers with CSP tuned for CDN viewers (pdf.js, three.js, esm.sh, Google Fonts) and WASM (web-ifc)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'wasm-unsafe-eval'",
        'https://cdnjs.cloudflare.com',
        'https://cdn.jsdelivr.net',
        'https://esm.sh',
        'https://unpkg.com'
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://cdnjs.cloudflare.com'
      ],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: [
        "'self'",
        'blob:',
        'data:',
        'https://cdnjs.cloudflare.com',
        'https://cdn.jsdelivr.net',
        'https://esm.sh',
        'https://unpkg.com',
        'https://huggingface.co',
        'https://*.hf.co',
        'https://*.huggingface.co'
      ],
      workerSrc: ["'self'", 'blob:', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  frameguard: { action: 'sameorigin' }
}));

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(securityMiddleware);

// Static public assets only (no-cache so browser always loads latest UI updates immediately)
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
    },
  })
);

// Health check (Railway / reverse proxy readiness)
app.get('/api/health', (req, res) => {
  const commit = (process.env.RAILWAY_GIT_COMMIT_SHA || 'bb7973c').slice(0, 7);
  res.json({
    ok: true,
    status: 'healthy',
    uptime: Math.round(process.uptime()),
    commit,
    version: '2.1.0-masterplan'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', apiLimiter, requireAuth, projectRoutes, assetRoutes, fileRoutes);

// 404 handler for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

// SPA fallback — serve index.html for all non-API, non-static routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`ArcSite Navigator running on http://localhost:${PORT}`);
});
