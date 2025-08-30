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
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[PROCESS] Starting processing...');

    const { batchId } = req.query;
    
    if (!batchId) {
      return res.status(400).json({ error: 'Batch ID is required' });
    }

    // Check required environment variables
    if (!process.env.MONGODB_URI) {
      return res.status(500).json({ error: "❌ Missing MongoDB configuration" });
    }
    
    if (!process.env.GOOGLE_API_KEY) {
      return res.status(500).json({ error: "❌ Missing Google API key" });
    }

    // Connect to MongoDB
    const client = await connectToDatabase();
    const db = client.db('word_to_text');
    const collection = db.collection('images');

    // Retrieve images for this batch
    const images = await collection.find({ 
      batchId: batchId,
      processed: false 
    }).sort({ order: 1 }).toArray();

    console.log(`[PROCESS] Found ${images.length} images for batch ${batchId}`);

    if (images.length === 0) {
      return res.status(400).json({ error: 'No images found for this batch ID' });
    }

    // Initialize services
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    let allParagraphs = [];

    // Load docx module
    let Document, Packer, Paragraph, TextRun;
    try {
      const docx = require('docx');
      Document = docx.Document;
      Packer = docx.Packer;
      Paragraph = docx.Paragraph;
      TextRun = docx.TextRun;
      console.log('[PROCESS] docx module loaded successfully');
    } catch (docxError) {
      console.error('[PROCESS] docx module load failed:', docxError.message);
      return res.status(500).json({ 
        error: "❌ Word document module not available", 
        details: docxError.message 
      });
    }

    // Process each image
    for (const [index, imageDoc] of images.entries()) {
      console.log(`[PROCESS] Processing image ${index + 1}/${images.length}: ${imageDoc.filename}`);
      
      // Use the base64 data directly from MongoDB
      const imageBase64 = imageDoc.data;

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
    }

    console.log('[PROCESS] Creating Word document...');
    
    // Create Word document with all pages
    const doc = new Document({ 
      sections: [{ 
        properties: {},
        children: allParagraphs 
      }] 
    });
    
    const buffer = await Packer.toBuffer(doc);
    
    console.log('[PROCESS] Word document created, sending response...');
    
    // Mark images as processed
    await collection.updateMany(
      { batchId: batchId },
      { $set: { processed: true, processedAt: new Date() } }
    );

    // Return Word document
    res.setHeader('Content-Disposition', `attachment; filename=extracted_document_${batchId}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buffer);

    console.log('[PROCESS] Process completed successfully');

    // Clean up old processed images (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await collection.deleteMany({
      processed: true,
      processedAt: { $lt: oneHourAgo }
    });

  } catch (err) {
    console.error("[PROCESS] Detailed error:", err);
    res.status(500).json({ 
      error: "❌ Error processing images",
      details: err.message 
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};