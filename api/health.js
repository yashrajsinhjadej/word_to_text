export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic health check
  const healthStatus = {
    message: 'Word-to-Text API Server is running!!!!',
    status: 'Active',
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform
  };

  // If requested, check dependencies
  if (req.query.checkDeps === 'true') {
    const dependencies = {};
    
    try {
      require('mongodb');
      dependencies.mongodb = '✅ Available';
    } catch (e) {
      dependencies.mongodb = `❌ Missing: ${e.message}`;
    }
    
    try {
      const docx = require('docx');
      dependencies.docx = `✅ Available (${Object.keys(docx).join(', ')})`;
    } catch (e) {
      dependencies.docx = `❌ Missing: ${e.message}`;
    }
    
    try {
      require('@google/generative-ai');
      dependencies.googleAI = '✅ Available';
    } catch (e) {
      dependencies.googleAI = `❌ Missing: ${e.message}`;
    }
    
    // Environment variables check
    const envVars = {
      MONGODB_URI: process.env.MONGODB_URI ? '✅ Set' : '❌ Missing',
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Missing'
    };
    
    healthStatus.dependencies = dependencies;
    healthStatus.environment = envVars;
  }

  res.status(200).json(healthStatus);
}