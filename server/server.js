require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_KEY = process.env.MONDAY_API_KEY || process.env.REACT_APP_MONDAY_API_KEY || '';

app.use(cors());
app.use(express.json());

// Proxy: POST /api/monday -> Monday.com GraphQL
app.post('/api/monday', async (req, res) => {
  const { query, variables = {} } = req.body;

  if (!MONDAY_API_KEY || !MONDAY_API_KEY.trim()) {
    return res.status(400).json({
      errors: [{ message: 'MONDAY_API_KEY არ არის დაყენებული სერვერზე (server/.env ან environment)' }]
    });
  }

  if (!query) {
    return res.status(400).json({
      errors: [{ message: 'query არის სავალდებულო' }]
    });
  }

  try {
    const response = await axios.post(
      MONDAY_API_URL,
      { query, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': MONDAY_API_KEY,
          'API-Version': '2024-01'
        },
        timeout: 30000
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Monday.com API Error:', error.message);
    if (error.response) {
      res.status(error.response.status || 500).json(error.response.data || { error: error.message });
    } else {
      res.status(502).json({
        errors: [{ message: 'Monday.com API-სთან კავშირი ვერ დამყარდა. ' + (error.message || '') }]
      });
    }
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    hasApiKey: !!(MONDAY_API_KEY && MONDAY_API_KEY.trim())
  });
});

app.listen(PORT, () => {
  console.log(`Kandan API proxy: http://localhost:${PORT}`);
  console.log(`Monday.com API Key: ${MONDAY_API_KEY ? 'დაყენებულია' : 'არ არის დაყენებული'}`);
});
