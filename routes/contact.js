const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    const newMessage = new Message({ name, email, message });
    await newMessage.save();
    res.status(200).json({ message: 'Message received successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
