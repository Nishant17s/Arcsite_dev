const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const app = express();
const PORT = 8000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Storage for uploaded maps
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const projectId = req.body.projectId || 'default';
    const dir = path.join(__dirname, 'projects', projectId, 'assets');
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, 'site-map' + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Generate unique project ID
function generateProjectId() {
  return crypto.randomBytes(16).toString('hex');
}

// Create new project
app.post('/api/projects/create', async (req, res) => {
  try {
    const projectId = generateProjectId();
    const projectDir = path.join(__dirname, 'projects', projectId);
    
    // Create project directories
    await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'docs'), { recursive: true });
    
    // Create initial data.json
    const initialData = {
      projectName: req.body.projectName || 'Untitled Project',
      createdAt: new Date().toISOString(),
      assets: []
    };
    
    await fs.writeFile(
      path.join(projectDir, 'data.json'),
      JSON.stringify(initialData, null, 2)
    );
    
    // Copy default site map
    try {
      await fs.copyFile(
        path.join(__dirname, 'public/assets/site-map.svg'),
        path.join(projectDir, 'assets/site-map.svg')
      );
    } catch (err) {
      console.log('No default map to copy');
    }
    
    res.json({
      success: true,
      projectId,
      url: `/project/${projectId}`
    });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get project data
app.get('/api/projects/:projectId/data', async (req, res) => {
  try {
    const { projectId } = req.params;
    const dataPath = path.join(__dirname, 'projects', projectId, 'data.json');
    
    const data = await fs.readFile(dataPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(404).json({ success: false, error: 'Project not found' });
  }
});

// Update project data
app.post('/api/projects/:projectId/data', async (req, res) => {
  try {
    const { projectId } = req.params;
    const dataPath = path.join(__dirname, 'projects', projectId, 'data.json');
    
    await fs.writeFile(dataPath, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload map image
app.post('/api/projects/:projectId/upload-map', upload.single('map'), async (req, res) => {
  try {
    const { projectId } = req.params;
    res.json({
      success: true,
      path: `/projects/${projectId}/assets/${req.file.filename}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve project assets
app.use('/projects', express.static('projects'));

// Serve project page
app.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectPath = path.join(__dirname, 'projects', projectId);
    
    // Check if project exists
    await fs.access(path.join(projectPath, 'data.json'));
    
    // Serve the main HTML with project ID injected
    res.sendFile(path.join(__dirname, 'public', 'project.html'));
  } catch (error) {
    res.status(404).send('Project not found');
  }
});

// Home page - create new project
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Multi-project mode enabled');
});
