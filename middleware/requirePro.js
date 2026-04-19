const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function requirePro(req, res, next) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { plan: true, planExpiresAt: true }
  });

  if (!user || user.plan !== 'pro') {
    return res.status(403).json({
      success: false,
      error: 'Funzionalità disponibile solo nel piano Pro',
      upgradeUrl: '/api/stripe/checkout'
    });
  }

  if (user.planExpiresAt && user.planExpiresAt < new Date()) {
    return res.status(403).json({
      success: false,
      error: 'Il tuo abbonamento è scaduto',
      upgradeUrl: '/api/stripe/checkout'
    });
  }

  next();
}

module.exports = { requirePro };
