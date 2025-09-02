const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Import your API handlers (now CommonJS)
const { handler: uploadHandler } = require('./api/upload');
const { handler: processHandler } = require('./api/process');

// Convert handlers to Express routes
app.post('/api/upload', (req, res) => {
  uploadHandler(req, res);
});

app.get('/api/process', (req, res) => {
  processHandler(req, res);
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404s
app.get('*', (req, res) => {
  res.status(404).send('Route not found');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
});

module.exports = app;