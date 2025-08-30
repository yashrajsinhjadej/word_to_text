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

// Simple direct docx loading since package is confirmed installed
function loadDocxModule() {
  console.log('[DOCX] Loading docx module directly...');
  
  try {
    const docx = require('docx');
    console.log(`[DOCX] Raw docx module loaded`);
    console.log(`[DOCX] Available exports: ${Object.keys(docx).slice(0, 20).join(', ')}`);
    
    // Check what we actually got
    const hasDocument = !!docx.Document;
    const hasPacker = !!docx.Packer;
    const hasParagraph = !!docx.Paragraph;
    const hasTextRun = !!docx.TextRun;
    
    console.log(`[DOCX] Export check - Document: ${hasDocument}, Packer: ${hasPacker}, Paragraph: ${hasParagraph}, TextRun: ${hasTextRun}`);
    
    if (!hasDocument || !hasPacker || !hasParagraph || !hasTextRun) {
      console.log(`[DOCX] Missing exports, trying destructuring...`);
      
      // Log actual exports for debugging
      console.log(`[DOCX] Actual exports type:`, typeof docx);
      console.log(`[DOCX] Is array:`, Array.isArray(docx));
      console.log(`[DOCX] Constructor:`, docx.constructor.name);
      
      throw new Error(`Missing required exports. Available: ${Object.keys(docx).join(', ')}`);
    }
    
    console.log(`[DOCX] ✅ All required exports found`);
    return {
      Document: docx.Document,
      Packer: docx.Packer,
      Paragraph: docx.Paragraph,
      TextRun: docx.TextRun
    };
    
  } catch (error) {
    console.error(`[DOCX] ❌ Failed to load docx:`, error);
    throw new Error(`Could not load docx module: ${error.message}`);
  }
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
    console.log('[PROCESS] 🚀 Starting processing...');
    console.log('[PROCESS] Query params:', req.query);
    console.log('[PROCESS] Environment:', {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd()
    });

    const { batchId } = req.query;
    
    if (!batchId) {
      console.log('[ERROR] No batchId provided');
      return res.status(400).json({ error: 'Batch ID is required' });
    }

    console.log(`[PROCESS] 📋 Processing batchId: ${batchId}`);

    // Check required environment variables
    if (!process.env.MONGODB_URI) {
      console.log('[ERROR] MongoDB URI missing');
      return res.status(500).json({ error: "❌ Missing MongoDB configuration" });
    }
    
    if (!process.env.GOOGLE_API_KEY) {
      console.log('[ERROR] Google API key missing');
      return res.status(500).json({ error: "❌ Missing Google API key" });
    }

    console.log('[PROCESS] ✅ Environment variables validated');

    // Load docx module with improved error handling
    console.log('[PROCESS] 📦 Loading docx module...');
    let Document, Packer, Paragraph, TextRun;
    
    try {
      const docxModule = loadDocxModule();
      Document = docxModule.Document;
      Packer = docxModule.Packer;
      Paragraph = docxModule.Paragraph;
      TextRun = docxModule.TextRun;
      
      console.log('[PROCESS] ✅ docx module loaded successfully');
      
    } catch (docxError) {
      console.error('[ERROR] 💥 docx module load failed:', docxError);
      console.error('[ERROR] Error stack:', docxError.stack);
      
      return res.status(500).json({ 
        error: "❌ Word document module not available", 
        details: docxError.message,
        debug: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          cwd: process.cwd(),
          nodePath: process.env.NODE_PATH,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Connect to MongoDB
    console.log('[PROCESS] 🗄️ Connecting to MongoDB...');
    const client = await connectToDatabase();
    const db = client.db('word_to_text');
    const collection = db.collection('images');
    console.log('[PROCESS] ✅ MongoDB connected successfully');

    // Retrieve images for this batch
    console.log(`[PROCESS] 🔍 Querying images for batchId: ${batchId}`);
    const images = await collection.find({ 
      batchId: batchId,
      processed: false 
    }).sort({ order: 1 }).toArray();

    console.log(`[PROCESS] 📸 Found ${images.length} images for batch ${batchId}`);

    if (images.length === 0) {
      console.log('[ERROR] No unprocessed images found');
      const totalImages = await collection.countDocuments({ batchId: batchId });
      const processedImages = await collection.countDocuments({ batchId: batchId, processed: true });
      
      console.log(`[INFO] Total images in batch: ${totalImages}, Processed: ${processedImages}`);
      
      if (totalImages === 0) {
        return res.status(400).json({ 
          error: 'No images found for this batch ID',
          batchId: batchId,
          debug: {
            totalInBatch: totalImages,
            processedInBatch: processedImages
          }
        });
      } else {
        return res.status(400).json({ 
          error: 'All images in this batch have already been processed',
          batchId: batchId,
          debug: {
            totalInBatch: totalImages,
            processedInBatch: processedImages
          }
        });
      }
    }

    // Initialize Google AI
    console.log('[PROCESS] 🤖 Initializing Google AI...');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    let allParagraphs = [];

    // Process each image
    for (const [index, imageDoc] of images.entries()) {
      console.log(`[PROCESS] 🖼️ Processing image ${index + 1}/${images.length}: ${imageDoc.filename}`);
      
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
        console.log(`[PROCESS] 📊 Image data length: ${imageBase64.length} characters`);

        console.log(`[PROCESS] 🔮 Calling Gemini API for image: ${imageDoc.filename}`);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([
          {
            inlineData: { 
              data: imageBase64, 
              mimeType: imageDoc.contentType 
            },
          },
          {
            text: "Extract text from this image and keep formatting/line breaks. Convert any handwritten text to typed text.",
          },
        ]);

        let extracted = result.response.text();
        console.log(`[PROCESS] ✅ OCR extracted from ${imageDoc.filename}: ${extracted.slice(0, 100)}...`);

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
            spacing: {
              after: 200,
            },
          })
        );
        allParagraphs.push(new Paragraph("")); // spacing

        // Format extracted text into Word paragraphs
        const lines = extracted
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        for (const line of lines) {
          if (line.includes(":") && line.split(":")[0].length < 50) {
            // Treat as label:value pair if the part before colon is short
            const [key, ...rest] = line.split(":");
            allParagraphs.push(
              new Paragraph({
                children: [
                  new TextRun({ text: key.trim() + ":", bold: true }),
                  new TextRun(" " + rest.join(":").trim()),
                ],
                spacing: {
                  after: 120,
                },
              })
            );
          } else {
            // Regular paragraph
            allParagraphs.push(
              new Paragraph({
                children: [new TextRun(line)],
                spacing: {
                  after: 120,
                },
              })
            );
          }
        }
        
        // Add spacing between pages
        allParagraphs.push(new Paragraph(""));
        allParagraphs.push(new Paragraph(""));

      } catch (imageError) {
        console.error(`[ERROR] 💥 Failed to process image ${imageDoc.filename}:`, imageError);
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
        allParagraphs.push(new Paragraph(""));
      }
    }

    console.log('[PROCESS] 📄 Creating Word document...');
    console.log(`[PROCESS] Total paragraphs to include: ${allParagraphs.length}`);
    
    // Create Word document with all pages
    const doc = new Document({ 
      sections: [{ 
        properties: {
          page: {
            margin: {
              top: 1440,    // 1 inch
              right: 1440,  // 1 inch  
              bottom: 1440, // 1 inch
              left: 1440,   // 1 inch
            },
          },
        },
        children: allParagraphs 
      }] 
    });
    
    console.log('[PROCESS] 🔄 Generating document buffer...');
    const buffer = await Packer.toBuffer(doc);
    console.log(`[PROCESS] ✅ Document buffer created, size: ${buffer.length} bytes`);
    
    // Mark images as processed
    console.log('[PROCESS] 🏷️ Marking images as processed...');
    const updateResult = await collection.updateMany(
      { batchId: batchId },
      { $set: { processed: true, processedAt: new Date() } }
    );
    console.log(`[PROCESS] ✅ Updated ${updateResult.modifiedCount} documents as processed`);

    // Return Word document
    res.setHeader('Content-Disposition', `attachment; filename=extracted_document_${batchId}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Length', buffer.length.toString());
    
    console.log('[PROCESS] 🎉 Sending Word document to client...');
    res.send(buffer);

    console.log('[PROCESS] ✅ Process completed successfully');

    // Clean up old processed images (older than 1 hour) - do this async
    setTimeout(async () => {
      try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const deleteResult = await collection.deleteMany({
          processed: true,
          processedAt: { $lt: oneHourAgo }
        });
        console.log(`[CLEANUP] 🧹 Deleted ${deleteResult.deletedCount} old processed images`);
      } catch (cleanupError) {
        console.error('[CLEANUP] Error during cleanup:', cleanupError);
      }
    }, 1000);

  } catch (err) {
    console.error("[ERROR] 💥 Detailed error:", err);
    console.error("[ERROR] Error stack:", err.stack);
    
    // Send more detailed error information
    res.status(500).json({ 
      error: "❌ Error processing images",
      details: err.message,
      type: err.constructor.name,
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      batchId: req.query.batchId
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};