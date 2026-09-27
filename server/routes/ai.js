const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');

// POST /api/ai/chat
router.post('/chat', (req, res, next) => {
  try {
    const { message, sessionId = 'default-session' } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    const response = aiService.processMessage(sessionId, message);
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/history/:sessionId
router.get('/history/:sessionId', (req, res, next) => {
  try {
    const conv = aiService.getOrCreateConversation(req.params.sessionId);
    const messages = aiService.getMessages(conv.id);
    res.json({
      conversation_id: conv.id,
      session_id: conv.session_id,
      messages
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/voice-agent
router.get('/voice-agent', (req, res) => {
  const agentId = process.env.VOICE_AGENT_ID || 'P2YJQU8i3wOC75sAJ3f';
  res.json({
    agent_id: agentId,
    status: 'active',
    provider: 'elevenlabs',
    widget_url: 'https://elevenlabs.io/convai-widget/index.js',
    capabilities: [
      'Hospital department discovery',
      'Doctor specialist consultation guidance',
      'Appointment booking navigation',
      'Medical triage advice (non-diagnostic)'
    ]
  });
});

module.exports = router;

