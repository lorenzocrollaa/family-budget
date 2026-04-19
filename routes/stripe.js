const express = require('express');
const Stripe = require('stripe');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();
const getStripe = () => Stripe(process.env.STRIPE_SECRET_KEY);

// POST /api/stripe/checkout — crea sessione di pagamento
router.post('/checkout', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id }
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId }
      });
    }

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      success_url: `${process.env.APP_URL}/?upgrade=success`,
      cancel_url: `${process.env.APP_URL}/?upgrade=cancelled`,
    });

    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ success: false, error: 'Errore durante il checkout' });
  }
});

// POST /api/stripe/portal — gestione abbonamento (cancella, cambia piano)
router.post('/portal', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user.stripeCustomerId) {
      return res.status(400).json({ success: false, error: 'Nessun abbonamento attivo' });
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.APP_URL}/`
    });

    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Stripe portal error:', error);
    res.status(500).json({ success: false, error: 'Errore durante l\'apertura del portale' });
  }
});

// POST /api/stripe/webhook — eventi Stripe (raw body richiesto)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await activatePro(session.customer, session.subscription);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        await activatePro(invoice.customer, invoice.subscription);
        break;
      }
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const obj = event.data.object;
        const customerId = obj.customer || obj.customer;
        await prisma.user.updateMany({
          where: { stripeCustomerId: customerId },
          data: { plan: 'free', stripeSubId: null, planExpiresAt: null }
        });
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).send('Webhook processing failed');
  }

  res.json({ received: true });
});

async function activatePro(customerId, subscriptionId) {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const expiresAt = new Date(sub.current_period_end * 1000);

  await prisma.user.updateMany({
    where: { stripeCustomerId: customerId },
    data: {
      plan: 'pro',
      stripeSubId: subscriptionId,
      planExpiresAt: expiresAt
    }
  });
}

module.exports = router;
