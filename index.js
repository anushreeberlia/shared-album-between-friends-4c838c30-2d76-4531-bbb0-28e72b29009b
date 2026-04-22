const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  const oldSend = res.send;
  res.send = function(data) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - ${res.statusCode}`);
    oldSend.apply(this, arguments);
  };
  next();
});

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, '/data/uploads')));

// Ensure data directories exist
async function ensureDirectories() {
  try {
    await fs.mkdir('/data', { recursive: true });
    await fs.mkdir('/data/uploads', { recursive: true });
    console.log('Data directories created/verified');
  } catch (error) {
    console.error('Error creating directories:', error);
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, '/data/uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Utility functions
async function loadAlbums() {
  try {
    const data = await fs.readFile('/data/albums.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function saveAlbums(albums) {
  await fs.writeFile('/data/albums.json', JSON.stringify(albums, null, 2));
}

function generateShareCode() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Photo Album API is running',
    timestamp: new Date().toISOString()
  });
});

// Get all albums
app.get('/api/albums', async (req, res) => {
  try {
    const albums = await loadAlbums();
    res.json(albums);
  } catch (error) {
    console.error('Error loading albums:', error);
    res.status(500).json({ error: 'Failed to load albums' });
  }
});

// Get album by ID
app.get('/api/albums/:id', async (req, res) => {
  try {
    const albums = await loadAlbums();
    const album = albums.find(a => a.id === req.params.id);
    
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }
    
    res.json(album);
  } catch (error) {
    console.error('Error loading album:', error);
    res.status(500).json({ error: 'Failed to load album' });
  }
});

// Get album by share code
app.get('/api/albums/share/:shareCode', async (req, res) => {
  try {
    const albums = await loadAlbums();
    const album = albums.find(a => a.shareCode.toUpperCase() === req.params.shareCode.toUpperCase());
    
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }
    
    res.json(album);
  } catch (error) {
    console.error('Error finding album by share code:', error);
    res.status(500).json({ error: 'Failed to find album' });
  }
});

// Create new album
app.post('/api/albums', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Album name is required' });
    }
    
    const albums = await loadAlbums();
    const shareCode = generateShareCode();
    
    const newAlbum = {
      id: uuidv4(),
      name: name.trim(),
      description: description?.trim() || null,
      createdAt: new Date().toISOString(),
      shareCode,
      photos: []
    };
    
    albums.push(newAlbum);
    await saveAlbums(albums);
    
    res.status(201).json(newAlbum);
  } catch (error) {
    console.error('Error creating album:', error);
    res.status(500).json({ error: 'Failed to create album' });
  }
});

// Upload photo to album
app.post('/api/albums/:id/photos', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo file provided' });
    }
    
    const albums = await loadAlbums();
    const albumIndex = albums.findIndex(a => a.id === req.params.id);
    
    if (albumIndex === -1) {
      // Clean up uploaded file
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: 'Album not found' });
    }
    
    const newPhoto = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.body.uploadedBy || 'Anonymous'
    };
    
    albums[albumIndex].photos.push(newPhoto);
    await saveAlbums(albums);
    
    res.status(201).json(newPhoto);
  } catch (error) {
    console.error('Error uploading photo:', error);
    // Clean up uploaded file if it exists
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// Upload photo to album by share code
app.post('/api/albums/share/:shareCode/photos', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo file provided' });
    }
    
    const albums = await loadAlbums();
    const albumIndex = albums.findIndex(a => a.shareCode.toUpperCase() === req.params.shareCode.toUpperCase());
    
    if (albumIndex === -1) {
      // Clean up uploaded file
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: 'Album not found' });
    }
    
    const newPhoto = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.body.uploadedBy || 'Anonymous'
    };
    
    albums[albumIndex].photos.push(newPhoto);
    await saveAlbums(albums);
    
    res.status(201).json(newPhoto);
  } catch (error) {
    console.error('Error uploading photo:', error);
    // Clean up uploaded file if it exists
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// Delete photo from album
app.delete('/api/albums/:albumId/photos/:photoId', async (req, res) => {
  try {
    const albums = await loadAlbums();
    const albumIndex = albums.findIndex(a => a.id === req.params.albumId);
    
    if (albumIndex === -1) {
      return res.status(404).json({ error: 'Album not found' });
    }
    
    const album = albums[albumIndex];
    const photoIndex = album.photos.findIndex(p => p.id === req.params.photoId);
    
    if (photoIndex === -1) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    const photo = album.photos[photoIndex];
    
    // Remove photo from album
    album.photos.splice(photoIndex, 1);
    await saveAlbums(albums);
    
    // Delete file from disk
    try {
      await fs.unlink(path.join('/data/uploads', photo.filename));
    } catch (fileError) {
      console.error('Error deleting photo file:', fileError);
    }
    
    res.json({ message: 'Photo deleted successfully' });
  } catch (error) {
    console.error('Error deleting photo:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// Delete album
app.delete('/api/albums/:id', async (req, res) => {
  try {
    const albums = await loadAlbums();
    const albumIndex = albums.findIndex(a => a.id === req.params.id);
    
    if (albumIndex === -1) {
      return res.status(404).json({ error: 'Album not found' });
    }
    
    const album = albums[albumIndex];
    
    // Delete all photos from disk
    for (const photo of album.photos) {
      try {
        await fs.unlink(path.join('/data/uploads', photo.filename));
      } catch (fileError) {
        console.error('Error deleting photo file:', fileError);
      }
    }
    
    // Remove album from array
    albums.splice(albumIndex, 1);
    await saveAlbums(albums);
    
    res.json({ message: 'Album deleted successfully' });
  } catch (error) {
    console.error('Error deleting album:', error);
    res.status(500).json({ error: 'Failed to delete album' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
async function startServer() {
  await ensureDirectories();
  
  app.listen(PORT, () => {
    console.log(`Photo Album API server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/`);
  });
}

startServer().catch(console.error);