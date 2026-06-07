const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: {
      whatsapp: !!process.env.WHATSAPP_ACCESS_TOKEN,
      claude: !!process.env.ANTHROPIC_API_KEY,
      meta: !!process.env.META_ACCESS_TOKEN
    }
  });
});

module.exports = router;
