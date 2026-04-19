// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const prisma = new PrismaClient();

// Configurazione multer per avatar
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'public/uploads/avatars';
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo immagini permesse'), false);
    }
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email e password obbligatori'
      });
    }

    // Verifica se utente esiste
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Utente già registrato'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Crea utente
    const user = await prisma.user.create({
      data: {
        email,
        name: name || email.split('@')[0],
        password: hashedPassword
      }
    });

    // Genera JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante la registrazione'
    });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email e password obbligatori'
      });
    }

    // Trova utente
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Credenziali non valide'
      });
    }

    // Verifica password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Credenziali non valide'
      });
    }

    // Genera JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il login'
    });
  }
});


// GET /api/auth/profile
const { authenticateToken } = require('../middleware/auth');
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, avatar: true }
    });
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utente non trovato' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ success: false, error: 'Errore durante il recupero del profilo' });
  }
});

// POST /api/auth/profile/avatar
router.post('/profile/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    let avatarPath = req.body.avatar; // Può essere un nome di avatar predefinito

    // Se è stato caricato un file, usa il percorso del file
    if (req.file) {
      avatarPath = `/uploads/avatars/${req.file.filename}`;
    }

    if (!avatarPath) {
      return res.status(400).json({ success: false, error: 'Avatar non specificato' });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatar: avatarPath },
      select: { id: true, name: true, avatar: true }
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('Avatar update error:', error);
    res.status(500).json({ success: false, error: 'Errore durante l\'aggiornamento dell\'avatar' });
  }
});

module.exports = router;