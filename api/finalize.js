const fs = require('fs');
const path = require('path');

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', method: req.method });
  }

  try {
    console.log('[DEBUG] Function started successfully');
    
    const uploadDir = '/tmp/uploads';
    console.log('[DEBUG] Checking upload directory:', uploadDir);
    
    // Check if directory exists
    if (!fs.existsSync(uploadDir)) {
      console.log('[DEBUG] Upload directory does not exist');
      return res.status(400).json({ 
        error: "❌ No files uploaded yet",
        debug: "Upload directory does not exist",
        uploadDir: uploadDir
      });
    }

    // Try to read directory
    let files;
    try {
      files = fs.readdirSync(uploadDir);
      console.log('[DEBUG] Files found:', files);
    } catch (dirError) {
      console.error('[DEBUG] Error reading directory:', dirError);
      return res.status(400).json({ 
        error: "❌ Cannot read upload directory",
        debug: dirError.message
      });
    }
    
    if (!files || files.length === 0) {
      console.log('[DEBUG] No files in directory');
      return res.status(400).json({ 
        error: "❌ No files uploaded yet",
        debug: "Directory exists but is empty",
        filesCount: files ? files.length : 'undefined'
      });
    }

    // Check environment variable
    if (!process.env.GOOGLE_API_KEY) {
      console.log('[DEBUG] Missing GOOGLE_API_KEY');
      return res.status(500).json({ 
        error: "❌ Missing API key configuration",
        debug: "GOOGLE_API_KEY environment variable not set"
      });
    }

    // If we get here, return success with debug info
    return res.status(200).json({
      success: true,
      message: "✅ All checks passed",
      debug: {
        uploadDir: uploadDir,
        filesFound: files.length,
        files: files,
        hasApiKey: !!process.env.GOOGLE_API_KEY,
        nodeVersion: process.version
      }
    });

  } catch (err) {
    console.error("[DEBUG] Unexpected error:", err);
    return res.status(500).json({ 
      error: "❌ Unexpected error",
      debug: err.message,
      stack: err.stack
    });
  }
}