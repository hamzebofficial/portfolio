const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Blog file setup
const BLOG_FILE = path.join(__dirname, 'blog.json');

// Ensure blog.json exists
if (!fs.existsSync(BLOG_FILE)) {
  fs.writeFileSync(BLOG_FILE, '[]');
  console.log('📁 blog.json created');
}

function readPosts() {
  try {
    const raw = fs.readFileSync(BLOG_FILE, 'utf-8');
    return raw.length ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("❌ Failed to read blog.json:", e);
    return [];
  }
}

function savePosts(posts) {
  try {
    fs.writeFileSync(BLOG_FILE, JSON.stringify(posts, null, 2));
  } catch (e) {
    console.error('❌ Failed to write blog.json:', e);
  }
}

// Blog routes
app.get('/blog', (req, res) => {
  const posts = readPosts();
  res.json(posts);
});

app.post('/blog', (req, res) => {
  const posts = readPosts();
  const { title, content, media, username } = req.body;

  if (!title || !content || !username) {
    return res.status(400).json({ message: 'Title, content, and username are required.' });
  }

  const newPost = {
    id: Date.now(),
    title,
    content,
    media: Array.isArray(media) ? media : (media ? [media] : []),
    owner: username
  };

  posts.push(newPost);
  savePosts(posts);
  res.status(201).json(newPost);
});

app.put('/blog/:id', (req, res) => {
  const postId = parseInt(req.params.id);
  const { title, content, media } = req.body;

  const posts = readPosts();
  const index = posts.findIndex(p => p.id === postId);
  if (index === -1) return res.status(404).json({ message: 'Post not found' });

  posts[index].title = title || posts[index].title;
  posts[index].content = content || posts[index].content;
  posts[index].media = Array.isArray(media) ? media : [];

  savePosts(posts);
  res.json({ message: 'Post updated', post: posts[index] });
});

app.delete('/blog/:id', (req, res) => {
  const postId = parseInt(req.params.id);
  const { username } = req.body;
  const posts = readPosts();
  const index = posts.findIndex(p => p.id === postId);

  if (index === -1) return res.status(404).json({ message: 'Post not found' });
  if (posts[index].owner !== username) {
    return res.status(403).json({ message: 'You are not allowed to delete this post' });
  }

  const deleted = posts.splice(index, 1)[0];
  savePosts(posts);
  res.json({ message: 'Post deleted', deleted });
});

// Serve frontend
const frontendPath = path.join(__dirname, '..', 'Portfolio');
app.use(express.static(frontendPath));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const Message = mongoose.model('Message', {
  name: String,
  email: String,
  message: String,
  date: { type: Date, default: Date.now }
});

const Media = mongoose.model('Media', {
  filename: String,
  title: String,
  category: String,
  uploadDate: { type: Date, default: Date.now },
  type: String
});

const User = mongoose.model('User', {
  username: String,
  password: String
});

// Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Contact
app.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'All fields required' });

  try {
    const newMessage = new Message({ name, email, message });
    await newMessage.save();

    if (process.env.SAVE_MESSAGES === 'true') {
      const msgDir = path.join(__dirname, 'messages');
      if (!fs.existsSync(msgDir)) fs.mkdirSync(msgDir);
      fs.writeFileSync(path.join(msgDir, `message-${Date.now()}.txt`), `Name: ${name}\nEmail: ${email}\nMessage:\n${message}`);
    }

    await transporter.sendMail({
      from: `"Portfolio" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_RECEIVER || process.env.EMAIL_USER,
      subject: 'New Message',
      text: `Name: ${name}\nEmail: ${email}\nMessage:\n${message}`
    });

    res.json({ success: 'Message sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send' });
  }
});

// Auth
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'All fields required' });

  const exists = await User.findOne({ username });
  if (exists) return res.status(409).json({ message: 'Username already taken' });

  const user = new User({ username, password });
  await user.save();

  res.status(201).json({ message: 'Signup successful' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });

  if (!user || user.password !== password) return res.status(401).json({ message: 'Invalid credentials' });

  res.status(200).json({ message: 'Login successful' });
});

// Upload config
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  const { title, category } = req.body;
  if (!req.file || !title || !category) return res.status(400).json({ error: 'File, title, and category required' });

  const type = req.file.mimetype;
  try {
    const media = new Media({ filename: req.file.filename, title, category, type });
    await media.save();
    res.json({ message: 'Upload successful', filename: req.file.filename });
  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Gallery
app.get('/api/gallery', async (req, res) => {
  const { search = '', category = '', page = 1, limit = 12 } = req.query;
  const query = {
    ...(search && { title: { $regex: search, $options: 'i' } }),
    ...(category && { category })
  };

  try {
    const total = await Media.countDocuments(query);
    const totalPages = Math.ceil(total / limit);
    const items = await Media.find(query).sort({ uploadDate: -1 }).skip((page - 1) * limit).limit(parseInt(limit));

    res.json({ page: Number(page), totalPages, items });
  } catch (err) {
    console.error('❌ Gallery fetch error:', err);
    res.status(500).json({ error: 'Failed to load gallery' });
  }
});

app.delete('/api/gallery/:filename', async (req, res) => {
  const file = req.params.filename;
  try {
    await Media.deleteOne({ filename: file });
    fs.unlink(path.join(uploadsDir, file), (err) => {
      if (err) console.warn('⚠️ File not found on delete:', file);
    });
    res.json({ message: '✅ File deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.post('/api/gallery/delete', async (req, res) => {
  const { filenames } = req.body;
  if (!filenames || !filenames.length) return res.status(400).json({ error: 'No files provided' });

  try {
    await Media.deleteMany({ filename: { $in: filenames } });
    filenames.forEach(f => {
      fs.unlink(path.join(uploadsDir, f), (err) => {
        if (err) console.warn('⚠️ File not found:', f);
      });
    });
    res.json({ message: '✅ Files deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Bulk delete failed' });
  }
});

app.get('/download/:filename', (req, res) => {
  const file = path.join(uploadsDir, req.params.filename);
  res.download(file, err => {
    if (err) res.status(404).send('File not found');
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
