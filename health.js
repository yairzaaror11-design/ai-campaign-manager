const router = require('express').Router();

router.get('/', (req, res) =>
  res.json({
    status: 'healthy',
    version: '1.5.0',
    stage: 3,
    timestamp: new Date().toISOString(),
    ai: 'gemini',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    readOnly: process.env.READ_ONLY !== 'false',
    approvalEngine: true,
    metaWriteEngine: true,
    postWriteVerification: true,
    configured: {
      whatsapp: !!(
        process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID
      ),
      gemini: !!process.env.GEMINI_API_KEY,
      metaAds: !!process.env.META_ADS_ACCESS_TOKEN,
      signatureVerification: !!process.env.META_APP_SECRET,
      authorizedPhones: !!process.env.AUTHORIZED_PHONE_NUMBERS
    }
  })
);

module.exports = router;
