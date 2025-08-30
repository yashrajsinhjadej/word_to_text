const { MongoClient } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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

export default async function handler(req, res) {
  console.log(`[${new Date().toISOString()}] Request received: ${req.method} ${req.url}`);
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('[CORS] OPTIONS request handled');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    console.log(`[ERROR] Method ${req.method} not allowed`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[PROCESS] Starting processing...');
    console.log('[PROCESS] Query params:', req.query);

    const { batchId } = req.query;
    
    if (!batchId) {
      console.log('[ERROR] No batchId provided');
      return res.status(400).json({ error: 'Batch ID is required' });
    }

    console.log(`[PROCESS] Processing batchId: ${batchId}`);

    // Check required environment variables
    if (!process.env.MONGODB_URI) {
      console.log('[ERROR] MongoDB URI missing');
      return res.status(500).json({ error: "❌ Missing MongoDB configuration" });
    }
    
    if (!process.env.GOOGLE_API_KEY) {
      console.log('[ERROR] Google API key missing');
      return res.status(500).json({ error: "❌ Missing Google API key" });
    }

    console.log('[PROCESS] Environment variables validated');

    // Connect to MongoDB
    console.log('[PROCESS] Connecting to MongoDB...');
    const client = await connectToDatabase();
    const db = client.db('word_to_text');
    const collection = db.collection('images');
    console.log('[PROCESS] MongoDB connected successfully');

    // Retrieve images for this batch
    console.log(`[PROCESS] Querying images for batchId: ${batchId}`);
    const images = await collection.find({ 
      batchId: batchId,
      processed: false 
    }).sort({ order: 1 }).toArray();

    console.log(`[PROCESS] Found ${images.length} images for batch ${batchId}`);

    if (images.length === 0) {
      console.log('[ERROR] No unprocessed images found');
      // Check if there are any images at all for this batch
      const totalImages = await collection.countDocuments({ batchId: batchId });
      console.log(`[INFO] Total images in batch: ${totalImages}`);
      
      if (totalImages === 0) {
        return res.status(400).json({ error: 'No images found for this batch ID' });
      } else {
        return res.status(400).json({ error: 'All images in this batch have already been processed' });
      }
    }

    // Initialize Google AI
    console.log('[PROCESS] Initializing Google AI...');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    let allParagraphs = [];

    // Load docx module
    console.log('[PROCESS] Loading docx module...');
    let Document, Packer, Paragraph, TextRun;
    try {
      const docx = require('docx');
      Document = docx.Document;
      Packer = docx.Packer;
      Paragraph = docx.Paragraph;
      TextRun = docx.TextRun;
      console.log('[PROCESS] docx module loaded successfully');
    } catch (docxError) {
      console.error('[ERROR] docx module load failed:', docxError);
      return res.status(500).json({ 
        error: "❌ Word document module not available", 
        details: docxError.message 
      });
    }

    // Process each image
    for (const [index, imageDoc] of images.entries()) {
      console.log(`[PROCESS] Processing image ${index + 1}/${images.length}: ${imageDoc.filename}`);
      
      try {
        // Validate image data
        if (!imageDoc.data) {
          console.log(`[ERROR] No data found for image: ${imageDoc.filename}`);
          throw new Error(`No data found for image: ${imageDoc.filename}`);
        }

        if (!imageDoc.contentType) {
          console.log(`[WARNING] No contentType for image: ${imageDoc.filename}, defaulting to image/jpeg`);
          imageDoc.contentType = 'image/jpeg';
        }

        // Use the base64 data directly from MongoDB
        const imageBase64 = imageDoc.data;
        console.log(`[PROCESS] Image data length: ${imageBase64.length} characters`);

        console.log(`[PROCESS] Calling Gemini API for image: ${imageDoc.filename}`);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([
          {
            inlineData: { 
              data: imageBase64, 
              mimeType: imageDoc.contentType 
            },
          },
          {
            text: "Extract text from this image and keep formatting/line breaks.",
          },
        ]);

        let extracted = result.response.text();
        console.log(`[PROCESS] OCR extracted from ${imageDoc.filename}: ${extracted.slice(0, 100)}...`);

        // Add page header for each image
        allParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({ 
                text: `--- Page ${index + 1}: ${imageDoc.filename} ---`, 
                bold: true, 
                size: 28,
                color: "2E74B5"
              }),
            ],
          })
        );
        allParagraphs.push(new Paragraph("")); // spacing

        // Format extracted text into Word paragraphs
        const lines = extracted
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        for (const line of lines) {
          if (line.includes(":")) {
            const [key, ...rest] = line.split(":");
            allParagraphs.push(
              new Paragraph({
                children: [
                  new TextRun({ text: key + ":", bold: true }),
                  new TextRun(" " + rest.join(":").trim()),
                ],
              })
            );
          } else {
            allParagraphs.push(new Paragraph(line));
          }
        }
        
        // Add spacing between pages
        allParagraphs.push(new Paragraph(""));
        allParagraphs.push(new Paragraph(""));

      } catch (imageError) {
        console.error(`[ERROR] Failed to process image ${imageDoc.filename}:`, imageError);
        // Continue with other images instead of failing completely
        allParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({ 
                text: `--- Error processing ${imageDoc.filename}: ${imageError.message} ---`, 
                color: "FF0000" 
              }),
            ],
          })
        );
      }
    }

    console.log('[PROCESS] Creating Word document...');
    
    // Create Word document with all pages
    const doc = new Document({ 
      sections: [{ 
        properties: {},
        children: allParagraphs 
      }] 
    });
    
    console.log('[PROCESS] Generating document buffer...');
    const buffer = await Packer.toBuffer(doc);
    console.log(`[PROCESS] Document buffer created, size: ${buffer.length} bytes`);
    
    // Mark images as processed
    console.log('[PROCESS] Marking images as processed...');
    const updateResult = await collection.updateMany(
      { batchId: batchId },
      { $set: { processed: true, processedAt: new Date() } }
    );
    console.log(`[PROCESS] Updated ${updateResult.modifiedCount} documents as processed`);

    // Return Word document
    res.setHeader('Content-Disposition', `attachment; filename=extracted_document_${batchId}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buffer);

    console.log('[PROCESS] Process completed successfully');

    // Clean up old processed images (older than 1 hour) - do this async
    setTimeout(async () => {
      try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const deleteResult = await collection.deleteMany({
          processed: true,
          processedAt: { $lt: oneHourAgo }
        });
        console.log(`[CLEANUP] Deleted ${deleteResult.deletedCount} old processed images`);
      } catch (cleanupError) {
        console.error('[CLEANUP] Error during cleanup:', cleanupError);
      }
    }, 1000);

  } catch (err) {
    console.error("[ERROR] Detailed error:", err);
    console.error("[ERROR] Error stack:", err.stack);
    
    // Send more detailed error information
    res.status(500).json({ 
      error: "❌ Error processing images",
      details: err.message,
      type: err.constructor.name,
      timestamp: new Date().toISOString()
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
    // Add timeout configuration
    externalResolver: true,
  },
};