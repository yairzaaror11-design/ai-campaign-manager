const router = require('express').Router();

router.get('/', (req, res) =>
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    readOnly: process.env.READ_ONLY !== 'false',
    configured: {
      whatsapp: !!(
        process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID
      ),
      claude: !!process.env.ANTHROPIC_API_KEY,
      metaAds: !!process.env.META_ADS_ACCESS_TOKEN,
      signatureVerification: !!process.env.META_APP_SECRET,
      authorizedPhones: !!process.env.AUTHORIZED_PHONE_NUMBERS
    }
  })
);

module.exports = router;
