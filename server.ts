import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const resendApiKey = process.env.RESEND_API_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);
const resend = new Resend(resendApiKey);

// User data from constants.ts (simplified for server use)
const USERS: Record<string, any> = {
  kathreen:    {id:'kathreen',    name:'Kathreen Mourad',   role:'AP_COORDINATOR',      email:'kathreen@dossaniparadise.com'},
  anila:       {id:'anila',       name:'Anila Dossani',     role:'AP_SUPERVISOR',       email:'anila@dossaniparadise.com'},
  sam:         {id:'sam',         name:'Sam Merchant',      role:'VP',                  email:'sam@dossaniparadise.com'},
  armaan:      {id:'armaan',      name:'Armaan Dossani',    role:'COO',                 email:'armaan@dossaniparadise.com'},
  rick_dir:    {id:'rick_dir',    name:'Rick Tharani',      role:'DIRECTOR',            email:'rick@dossaniparadise.com'},
  paul:        {id:'paul',        name:'Paul Fernandez',    role:'DIRECTOR',            email:'paul@dossaniparadise.com'},
  rick_tharani:{id:'rick_tharani',name:'Rick Tharani',      role:'AREA_COACH',          email:'rick@dossaniparadise.com'},
  jennifer:    {id:'jennifer',    name:'Jennifer Sanders',  role:'AREA_COACH',          email:'jennifer@dossaniparadise.com'},
  vishal:      {id:'vishal',      name:'Vishal Chhetri',    role:'AREA_COACH',          email:'vishal@dossaniparadise.com'},
  betty:       {id:'betty',       name:'Betty Wilson',      role:'AREA_COACH',          email:'betty@dossaniparadise.com'},
  pedro:       {id:'pedro',       name:'Pedro Alcantar',    role:'AREA_COACH',          email:'pedro@dossaniparadise.com'},
  waleska:     {id:'waleska',     name:'Waleska Rios',      role:'AREA_COACH',          email:'waleska@dossaniparadise.com'},
  dane:        {id:'dane',        name:'Dane Martin',       role:'AREA_COACH',          email:'dane@dossaniparadise.com'},
  claudia:     {id:'claudia',     name:'Claudia Fernandez', role:'AREA_COACH',          email:'claudia@dossaniparadise.com'},
  steve:       {id:'steve',       name:'Steve Cardone',     role:'AREA_COACH',          email:'steve@dossaniparadise.com'},
  elizabeth:   {id:'elizabeth',   name:'Elizabeth Cruz',    role:'AREA_COACH',          email:'elizabeth@dossaniparadise.com'},
  it:          {id:'it',          name:'IT Support',        role:'IT_COORDINATOR',      email:'it@dossaniparadise.com'},
};

const canUserAct = (user: any, invoice: any): boolean => {
  if (invoice.status === 'PAID' || invoice.status === 'APPROVED') return false;
  
  if (user.role === 'AP_SUPERVISOR' && invoice.currentStage === 'AP_SUPERVISOR') return true;
  
  return invoice.currentStage === user.role && (
    invoice.acId === user.id || 
    invoice.directorId === user.id ||
    (invoice.currentStage === 'VP' && user.id === 'sam') ||
    (invoice.currentStage === 'COO' && user.id === 'armaan') ||
    (invoice.currentStage === 'AP_SUPERVISOR' && user.id === 'anila') ||
    (invoice.currentStage === 'AP_COORDINATOR' && user.id === 'kathreen')
  );
};

async function sendWeeklyReminders() {
  console.log('Running weekly reminder job...');
  if (!resendApiKey) {
    console.error('RESEND_API_KEY is not set. Skipping reminders.');
    return;
  }

  try {
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('archived', false)
      .not('status', 'in', '("PAID","APPROVED","DENIED")');

    if (error) throw error;
    if (!invoices || invoices.length === 0) {
      console.log('No pending invoices found.');
      return;
    }

    for (const userId in USERS) {
      const user = USERS[userId];
      const pendingCount = invoices.filter(inv => canUserAct(user, inv)).length;

      if (pendingCount > 0) {
        console.log(`Sending reminder to ${user.email} (${pendingCount} invoices)`);
        await resend.emails.send({
          from: 'Invoice Tracker <onboarding@resend.dev>',
          to: user.email,
          subject: 'Weekly Invoice Approval Reminder',
          html: `<p>You have <strong>${pendingCount}</strong> invoices awaiting your approval.</p>
                 <p>Please review them at <a href="https://dossaniparadise.github.io/invoice-tracker/">https://dossaniparadise.github.io/invoice-tracker/</a></p>`
        });
      }
    }
  } catch (err) {
    console.error('Error in weekly reminder job:', err);
  }
}

// Schedule: Every Monday at 9:00 AM
cron.schedule('0 9 * * 1', () => {
  sendWeeklyReminders();
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route to manually trigger reminders (for testing)
  app.post('/api/trigger-reminders', async (req, res) => {
    await sendWeeklyReminders();
    res.json({ status: 'Reminders triggered' });
  });

  // API Route to send a test email
  app.post('/api/test-email', async (req, res) => {
    const { email, name } = req.body;
    if (!resendApiKey) {
      return res.status(500).json({ error: 'RESEND_API_KEY not set' });
    }
    try {
      await resend.emails.send({
        from: 'Invoice Tracker <onboarding@resend.dev>',
        to: email,
        subject: 'TEST: Weekly Invoice Approval Reminder',
        html: `<p>Hello ${name},</p>
               <p>This is a <strong>sample test email</strong> from the Invoice Tracker system.</p>
               <p>You have <strong>3</strong> invoices awaiting your approval (Sample Data).</p>
               <p>Please review at <a href="https://dossaniparadise.github.io/invoice-tracker/">https://dossaniparadise.github.io/invoice-tracker/</a></p>
               <hr/>
               <p style="color: #8c909a; font-size: 12px;">This is a test message triggered by IT Support.</p>`
      });
      res.json({ status: 'Test email sent' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to send test email' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
