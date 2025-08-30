export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.status(200).json({
    message: 'Word-to-Text API Server is running!!!!',
    status: 'Active',
    timestamp: new Date().toISOString()
  });
}