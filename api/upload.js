const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Configure multer for Vercel
const upload = multer({
  dest: '/tmp/uploads',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

// Ensure uploads directory exists
const uploadDir = '/tmp/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ error: 'File upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`[UPLOAD] ${req.file.originalname}`);
    res.json({ 
      message: "✅ Uploaded", 
      file: req.file.filename,
      originalName: req.file.originalname
    });
  });
}

export const config = {
  api: {
    bodyParser: false, // Required for multer
  },
};