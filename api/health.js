export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic health info
  const healthStatus = {
    message: 'Word-to-Text API Server is running!!!!',
    status: 'Active',
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch
  };

  // Check all dependencies
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

  try {
    require('mongoose');
    dependencies.mongoose = '✅ Available';
  } catch (e) {
    dependencies.mongoose = `❌ Missing: ${e.message}`;
  }
  
  // Environment variables check
  const environment = {
    MONGODB_URI: process.env.MONGODB_URI ? '✅ Set' : '❌ Missing',
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Missing'
  };

  // File system info (for debugging)
  const systemInfo = {
    currentWorkingDirectory: process.cwd(),
    nodePath: process.env.NODE_PATH || 'Not set'
  };

  // Try to check if node_modules exists
  let nodeModulesInfo = 'Unable to check';
  try {
    const fs = require('fs');
    const path = require('path');
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    
    if (fs.existsSync(nodeModulesPath)) {
      const packages = fs.readdirSync(nodeModulesPath);
      nodeModulesInfo = `${packages.length} packages installed`;
      
      // Specifically check for docx
      const docxPath = path.join(nodeModulesPath, 'docx');
      if (fs.existsSync(docxPath)) {
        systemInfo.docxPackageExists = '✅ docx folder exists in node_modules';
        try {
          const docxFiles = fs.readdirSync(docxPath);
          systemInfo.docxContents = docxFiles.slice(0, 10).join(', ');
        } catch (e) {
          systemInfo.docxContents = 'Could not read docx folder contents';
        }
      } else {
        systemInfo.docxPackageExists = '❌ docx folder NOT found in node_modules';
      }
    } else {
      nodeModulesInfo = 'node_modules directory does not exist';
    }
  } catch (e) {
    nodeModulesInfo = `Error checking: ${e.message}`;
  }

  // Combine all info
  const fullStatus = {
    ...healthStatus,
    dependencies,
    environment,
    system: {
      ...systemInfo,
      nodeModulesInfo
    }
  };

  res.status(200).json(fullStatus);
}