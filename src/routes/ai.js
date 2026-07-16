const router = require('express').Router();
const { z } = require('zod');
const { requireAdmin, validate, aiLimiter, sanitizeHtml } = require('../middleware');
const { generateProductContent } = require('../services/claude');

const genSchema = z.object({
  productName: z.string().trim().max(200).optional().default(''),
  sourceUrl: z.string().url().max(600).optional(),
  extraNotes: z.string().max(1500).optional().default(''),
  images: z.array(z.object({
    media_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    data: z.string().max(6_000_000), // base64
  })).max(4).optional().default([]),
}).refine((d) => d.productName || d.sourceUrl || d.images.length, {
  message: 'Product name, URL বা ছবি — অন্তত একটা দিতে হবে',
});

/**
 * POST /api/admin/ai/generate
 * সরবরাহকারীর official link/ছবি → Sonnet 5 → বাংলা description + specs + FAQ
 */
router.post('/generate', requireAdmin, aiLimiter, validate(genSchema), async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY .env এ সেট করা নেই' });
    }
    const result = await generateProductContent(req.body);
    // stored-XSS প্রতিরোধ: AI output কেও sanitize করা হয়
    result.descriptionHtml = sanitizeHtml(result.descriptionHtml);
    res.json(result);
  } catch (e) {
    if (e.status === 401) return res.status(500).json({ error: 'Anthropic API key ভুল' });
    if (e.status === 429) return res.status(429).json({ error: 'Anthropic rate limit — একটু পরে চেষ্টা করুন' });
    next(e);
  }
});

module.exports = router;
