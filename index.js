
const express = require('express');
const bodyParser = require('body-parser');
const { GoogleAuth } = require('google-auth-library');
const { SessionsClient } = require('@google-cloud/dialogflow');
const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// ✅ Use credentials.json file from local path
const auth = new GoogleAuth({
  keyFilename: path.join(__dirname, 'credentials.json'),
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const sessionClient = new SessionsClient({ auth });

// ✅ Google Sheets logging
const logToSheet = async (number, text, botReply) => {
  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Sheet1!A:D',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[new Date().toISOString(), number, text, botReply]],
      },
    });
  } catch (error) {
    console.error('❌ Error logging to sheet:', error.message);
  }
};

// ✅ Webhook for WhatsApp messages
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || !message.from || !message.text) {
      return res.sendStatus(200);
    }

    const senderId = message.from;
    const userText = message.text.body;
    const sessionPath = sessionClient.projectAgentSessionPath(
      process.env.DIALOGFLOW_PROJECT_ID,
      senderId
    );

    const responses = await sessionClient.detectIntent({
      session: sessionPath,
      queryInput: {
        text: { text: userText, languageCode: 'en' },
      },
    });

    const reply = responses[0].queryResult.fulfillmentText;

    await logToSheet(senderId, userText, reply);
    await sendMessage(senderId, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Webhook Error:', err);
    res.sendStatus(500);
  }
});

// ✅ Send WhatsApp reply
const sendMessage = async (to, message) => {
  try {
    await axios.post(
      'https://graph.facebook.com/v19.0/' + process.env.PHONE_NUMBER_ID + '/messages',
      {
        messaging_product: 'whatsapp',
        to,
        text: { body: message },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.error('❌ WhatsApp send error:', error.response?.data || error.message);
  }
};

// ✅ Meta webhook verification
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
