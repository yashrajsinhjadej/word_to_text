const { MongoClient } = require('mongodb');

let cachedClient = null;

async function connectToDatabase() {
  if (cachedClient) {
    return cachedClient;
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[UPLOAD] Starting upload process...');

    // Check MongoDB connection
    if (!process.env.MONGODB_URI) {
      return res.status(500).json({ error: "❌ Missing MongoDB configuration" });
    }

    // Parse multipart form data
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
    }

    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({ error: 'No boundary found in multipart data' });
    }

    // Get raw body data
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    
    await new Promise((resolve, reject) => {
      req.on('end', resolve);
      req.on('error', reject);
    });

    const body = Buffer.concat(chunks);
    const files = parseMultipartData(body, boundary);
    
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files found in request' });
    }

    console.log(`[UPLOAD] Found ${files.length} files to upload`);

    // Connect to MongoDB
    const client = await connectToDatabase();
    const db = client.db('word_to_text');
    const collection = db.collection('images');

    // Create a batch ID for this upload session
    const batchId = new Date().getTime().toString();
    
    // Store each image in MongoDB
    const insertPromises = files.map(async (file, index) => {
      const document = {
        batchId: batchId,
        filename: file.filename || `image_${index + 1}`,
        contentType: file.contentType || 'image/jpeg',
        data: file.data.toString('base64'), // Store as base64
        uploadedAt: new Date(),
        processed: false,
        order: index
      };

      return collection.insertOne(document);
    });

    await Promise.all(insertPromises);
    
    console.log(`[UPLOAD] Successfully stored ${files.length} images with batch ID: ${batchId}`);

    res.json({
      success: true,
      message: `✅ ${files.length} images uploaded successfully`,
      batchId: batchId,
      filesCount: files.length
    });

  } catch (err) {
    console.error("[UPLOAD] Error:", err);
    res.status(500).json({ 
      error: "❌ Error uploading images",
      details: err.message 
    });
  }
}

// Helper function to parse multipart form data
function parseMultipartData(body, boundary) {
  const files = [];
  const boundaryBuffer = Buffer.from('--' + boundary);
  
  let start = 0;
  let end = body.indexOf(boundaryBuffer, start);
  
  while (end !== -1) {
    const part = body.slice(start, end);
    
    if (part.length > 0) {
      const file = parseFilePart(part);
      if (file) {
        files.push(file);
      }
    }
    
    start = end + boundaryBuffer.length;
    end = body.indexOf(boundaryBuffer, start);
  }
  
  return files;
}

function parseFilePart(part) {
  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;
  
  const headers = part.slice(0, headerEnd).toString();
  const data = part.slice(headerEnd + 4);
  
  const filenameMatch = headers.match(/filename="([^"]+)"/);
  const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
  
  if (!filenameMatch) return null;
  
  return {
    filename: filenameMatch[1],
    contentType: contentTypeMatch ? contentTypeMatch[1] : 'image/jpeg',
    data: data
  };
}

// Export for CommonJS (Node.js/Express)
module.exports = { handler };